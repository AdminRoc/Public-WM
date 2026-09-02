/* ═══════════════════════════════════════════════════════════
   quant.js — 量化操作（批量上架 / 批量下架）
   ═══════════════════════════════════════════════════════════ */

/* 快捷筛选 tag（用户核对确认版）。value 对应 WM /v2/items 的 tags 数组元素，
   不在这份表里的 tag 一律归入"其他"（_OTHER_KEY）。 */
var TAG_ZH = {
  mod:                'MOD',
  common:              '稀有度-普通',
  uncommon:            '稀有度-罕见',
  rare:                '稀有度-珍贵',
  legendary:            '稀有度-传说',
  augment:              '战甲强化MOD',
  arcane_enhancement:   '赋能',
  warframe:             '战甲',
  weapon:               '武器',
  primary:              '主武器',
  secondary:            '副武器',
  melee:                '近战武器',
  blueprint:            '图纸',
  prime:                'Prime物品',
  set:                  '套装',
  pvp:                  'PvP相关',
  veiled_riven:         '未鉴定裂罅Mod',
  stance:               '架式MOD',
  aura:                 '光环MOD',
  axi:                  '遗物-Axi',
  lith:                 '遗物-Lith',
  meso:                 '遗物-Meso',
  neo:                  '遗物-Neo',
  scene:                '摄影棚',
  syndicate:            '集团',
  necramech:            '殁世机甲',
  railjack:             '航道星舰',
  fish:                 '鱼类',
  arcane_helmet:        '秘奥头盔',
  companion:            '同伴',
  k_drive:              'K式悬浮板',
  kavat:                '库娃',
  gem:                  '宝石',
  ayatan_sculpture:     '阿耶檀识塑像',
  tome:                 '魔典',
  requiem:              '安魂',
};
var TAG_ORDER = Object.keys(TAG_ZH);
var _OTHER_KEY  = '__other__';
var _SPECIAL_KEY = '__special__';
var _DUPLICATE_KEY = '__duplicate__';
var _EXTRA_KEY = '__extra__';

var _qMode = 'list';      // 'list' | 'delist'
var _qSort = 'name_asc';  // name_asc | name_desc | avg_asc | avg_desc
var _qSearch = '';
var _qSelectedTags = new Set(); // 含 _OTHER_KEY / _SPECIAL_KEY
var _qSel = { list: new Set(), delist: new Set() }; // 已选中的候选（list: slug；delist: order.id）
var _qPriceMode = 'mult'; // 'mult'（按均价倍率）| 'fixed'（按指定价格）
var _qShowSpecial = false; // 是否显示稀缺物品

/* 批量上架"向上取整"：跟 index.html 共享同一个 localStorage key，两边偏好互通 */
var _qRoundMode = localStorage.getItem('bw_price_round_mode') || 'none';
function _qRoundPrice(p) {
  if (_qRoundMode === '5')  return Math.ceil(p / 5) * 5;
  if (_qRoundMode === '10') return Math.ceil(p / 10) * 10;
  return Math.round(p);
}

/* 批量上架等级模式：'max'=满级（默认）| '0'=0级 */
var _qRankMode = 'max';

var _qItems  = null;   // /v2/items 全量（含 tags/maxRank）
var _qOrders = null;   // 当前用户全部订单（含 slug/order_type）
var _qAvg    = null;   // avg_prices_full.json

var _qPinyinCollator = (function() {
  try { return new Intl.Collator('zh-Hans-u-co-pinyin', { sensitivity: 'base' }); }
  catch (e) { return new Intl.Collator('zh-Hans', { sensitivity: 'base' }); }
})();

/* 物品表浏览器强缓存 10分钟强制覆盖，与 main.js 同 key 共享 */
const _Q_ITEMS_LS_KEY='bw_items_cache_json';
const _Q_ITEMS_LS_TS='bw_items_ts';
let _qItemsPollTimer=null;
function _qItemsLoadFromCache(){
  try{ var raw=localStorage.getItem(_Q_ITEMS_LS_KEY); var ts=parseInt(localStorage.getItem(_Q_ITEMS_LS_TS)||'0',10); if(!raw||!ts) return false; var arr=JSON.parse(raw); if(!Array.isArray(arr)||!arr.length) return false; _qItems=arr; return true; }catch(e){ return false; }
}
function _qItemsSave(arr){ try{ localStorage.setItem(_Q_ITEMS_LS_KEY,JSON.stringify(arr)); localStorage.setItem(_Q_ITEMS_LS_TS,String(Date.now())); }catch(e){ try{ localStorage.removeItem(_Q_ITEMS_LS_KEY); localStorage.setItem(_Q_ITEMS_LS_KEY,JSON.stringify(arr)); localStorage.setItem(_Q_ITEMS_LS_TS,String(Date.now())); }catch(_){} } }
async function _qItemsFetchOnce(){
  var ok=false;
  await createReliableLoader(
    ['/api/wm/items','https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/wm-items.json','https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/wm-items.json'],
    function(j){ var arr=j&&j.data?j.data:j; if(!Array.isArray(arr)||!arr.length) return false; _qItems=arr; _qItemsSave(arr); ok=true; return true; },
    {retryDelay:2500,fetchTimeout:7000}
  ).promise;
  return ok;
}
function _qLoadItems() {
  if (_qItems) return Promise.resolve(_qItems);
  if(_qItemsLoadFromCache()){
    setTimeout(function(){ _qItemsFetchOnce(); },800);
    if(!_qItemsPollTimer){ _qItemsPollTimer=setInterval(function(){ if(!document.hidden) _qItemsFetchOnce(); },10*60*1000); document.addEventListener('visibilitychange', function(){ if(!document.hidden){ try{ var ts=parseInt(localStorage.getItem(_Q_ITEMS_LS_TS)||'0',10); if(Date.now()-ts>10*60*1000) _qItemsFetchOnce(); }catch(_){} } }); }
    return Promise.resolve(_qItems);
  }
  // Public 走 PWM_KV 单key整包（同 main.js），不走 pwm-api 的 /items（404）
  return _qItemsFetchOnce().then(function(ok){ if(ok && _qItems && _qItems.length) return _qItems; throw new Error('items load failed'); }).catch(function(e){ _qItems=[]; throw e; });
}
function _qLoadOrders() {
  return apiFetch('/orders').then(function(j) {
    var raw = Array.isArray(j.data) ? j.data : [];
    _qOrders = raw.map(function(o) {
      var slug = o.item?.url_name || o.slug || o.item?.id || '';
      var itemObj = null;
      if (slug && _qItems) itemObj = _qItems.find(function(i) { return (i.url_name || i.slug || i.id) === slug; });
      return Object.assign({}, o, {
        order_type:  o.order_type  || o.orderType  || o.type || 'sell',
        last_update: o.last_update || o.lastUpdate  || o.updatedAt || '',
        creation_date: o.creation_date || o.creationDate || o.createdAt || '',
        mod_rank:    o.rank !== undefined ? o.rank : (o.mod_rank !== undefined ? o.mod_rank : (o.modRank !== undefined ? o.modRank : undefined)),
        quantity_in_set: o.perTrade || o.quantity_in_set || o.quantityInSet || undefined,
        _slug:  slug,
        _name:  o.item?.en || o.item?.en_name || o.item?.name || slug,
        _zh:    o.item?.zh || (itemObj && itemObj.zh) || '',
        _tags:  (itemObj && itemObj.tags) || [],
      });
    });
    return _qOrders;
  }).catch(function(e) { _qOrders = []; throw e; });
}
let _qAvgPollTimer=null;
async function _qAvgFetchOnce(){
  var urls=['https://market.wfspeed.run/api/kv?key=avg_prices_full_json','https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/avg_prices_full.json','https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/avg_prices_full.json','/data/avg_prices_full.json','/api/wm/avg-prices'];
  var ok=false;
  await createReliableLoader(urls,function(j){
    if (j && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) j=j.data;
    if (!j || typeof j !== 'object' || j.ct || !Object.keys(j).length) return false;
    _qAvg=j; try{ localStorage.setItem('bw_avg_cache_json',JSON.stringify(j)); localStorage.setItem('bw_avg_ts',String(Date.now())); }catch(_){}
    ok=true; return true;
  },{fetchTimeout:7000}).promise;
  return ok;
}
function _qLoadAvg() {
  if (_qAvg) return Promise.resolve(_qAvg);
  // 浏览器强缓存10分钟强制覆盖：有缓存秒开，后台静默覆盖，失败自动重试
  try {
    var raw = localStorage.getItem('bw_avg_cache_json');
    var ts = parseInt(localStorage.getItem('bw_avg_ts')||'0',10);
    if (raw && ts) { var j = JSON.parse(raw); if (j && !j.ct && Object.keys(j).length > 10) { _qAvg = j; setTimeout(function(){ _qAvgFetchOnce(); },800); if(!_qAvgPollTimer){ _qAvgPollTimer=setInterval(function(){ if(!document.hidden) _qAvgFetchOnce(); },10*60*1000); document.addEventListener('visibilitychange', function(){ if(!document.hidden){ try{ var ts2=parseInt(localStorage.getItem('bw_avg_ts')||'0',10); if(Date.now()-ts2>10*60*1000) _qAvgFetchOnce(); }catch(_){} } }); } return Promise.resolve(_qAvg); } }
  } catch(e) {}
  var urls = [
    'https://market.wfspeed.run/api/kv?key=avg_prices_full_json',
    'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/avg_prices_full.json',
    'https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/avg_prices_full.json',
    '/data/avg_prices_full.json'
  ];
  // 走 shared.js 的严密解密+超时可靠加载器，包装自动解密，失败自动重试至成功，成功后启动10分钟强制覆盖
  return createReliableLoader(urls, function(j){
    if (j && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) j = j.data;
    if (!j || typeof j !== 'object' || j.ct || !Object.keys(j).length) return false;
    _qAvg = j;
    try{ localStorage.setItem('bw_avg_cache_json', JSON.stringify(j)); localStorage.setItem('bw_avg_ts', String(Date.now())); }catch(_){}
    return true;
  }, { fetchTimeout: 7000 }).promise.then(function(){ if(!_qAvgPollTimer){ _qAvgPollTimer=setInterval(function(){ if(!document.hidden) _qAvgFetchOnce(); },10*60*1000); } return _qAvg || {}; });
}

function _qAvgOf(slug) { return (_qAvg && _qAvg[slug]) || null; }
function _qIsSpecial(slug) {
  var a = _qAvgOf(slug);
  return !a || a.avg === null || a.avg === undefined || a.special === true;
}
function _qRankAvg(c, rank) {
  if (!c) return c;
  if (c.avg_zero || c.avg_max) {
    if (rank === 0 && c.avg_zero && c.avg_zero.avg != null) return c.avg_zero;
    if (c.max_rank != null && rank === c.max_rank && c.avg_max && c.avg_max.avg != null) return c.avg_max;
    if (c.avg_max  && c.avg_max.avg  != null) return c.avg_max;
    if (c.avg_zero && c.avg_zero.avg != null) return c.avg_zero;
    return { avg: null, count: 0, used: 0, special: true };
  }
  return c;
}
function _qIsSpecialAvg(c) { return !c || c.avg === null || c.avg === undefined || c.special === true; }

/* 判断物品是否需要特殊字段（perTrade/subtype/amberStars/cyanStars）。
   仅匹配已知报错类别，不做宽泛的 subtypes 判断。 */
var _EXTRA_TAGS = {
  ayatan_sculpture: true,   // 阿耶檀识雕像 → amberStars/cyanStars/perTrade
  fish: true,               // 鱼类 → perTrade/subtype
  arcane_enhancement: true,  // 赋能 → perTrade
  gem: true,                // 宝石 → perTrade
  axi: true,                // 遗物 → perTrade/subtype
  lith: true,
  meso: true,
  neo: true,
  veiled_riven: true,       // 未揭裂罅 → subtype
  requiem: true,            // 安魂遗物 → perTrade/subtype
};
function _qItemBySlug(slug) {
  if (!_qItems) return null;
  for (var i = 0; i < _qItems.length; i++) { if (_qItems[i].slug === slug) return _qItems[i]; }
  return null;
}
function _qIsExtra(c) {
  var tags = c.tags || [];
  if (tags.some(function(t) { return _EXTRA_TAGS[t]; })) return true;
  var rec = c.rec || _qItemBySlug(c.slug);
  return !!(rec && (rec.maxAmberStars || rec.maxCyanStars));
}
function _qAvgBadgeHtml(slug, rank) {
  var raw = _qAvgOf(slug);
  if (!raw) return '<span class="bw-avg-badge loading" data-slug="' + slug + '">均价…</span>';
  var c = _qRankAvg(raw, rank);
  if (!c || c.avg === null || c.avg === undefined) return '<span class="bw-avg-badge nodata" data-slug="' + slug + '">暂无其他卖家</span>';
  var cls = _qIsSpecialAvg(c) ? 'special' : 'ok';
  var tag = c.stale                ? '<span class="bw-avg-rare">参考价</span>'
          : _qIsSpecialAvg(c)     ? '<span class="bw-avg-rare">稀缺</span>' : '';
  return '<span class="bw-avg-badge ' + cls + '" data-slug="' + slug + '">' + tag + ' 均 ' + c.avg + 'p</span>';
}
function _qNameOf(rec) { return (rec && (rec.zh || rec.en)) || ''; }

/* ── tag 归类：命中已知 tag 用已知 tag；否则整体归"其他" ── */
function _qTagsOf(rec) {
  var raw = (rec && rec.tags) || [];
  var hit = raw.filter(function(t) { return TAG_ZH.hasOwnProperty(t); });
  return hit.length ? hit : [_OTHER_KEY];
}

/* ── 筛选 tag 栏渲染（多选复选，delist 模式额外带"稀缺"） ── */
function _qRenderTagbar() {
  var bar = document.getElementById('bw-quant-tagbar');
  if (!bar) return;
  var chips = TAG_ORDER.map(function(t) {
    return '<button class="bw-quant-tag-chip' + (_qSelectedTags.has(t) ? ' active' : '') + '" data-tag="' + t + '">' + TAG_ZH[t] + '</button>';
  });
  chips.push('<button class="bw-quant-tag-chip' + (_qSelectedTags.has(_OTHER_KEY) ? ' active' : '') + '" data-tag="' + _OTHER_KEY + '">其他</button>');
  chips.push('<button class="bw-quant-tag-chip is-extra' + (_qSelectedTags.has(_EXTRA_KEY) ? ' active' : '') + '" data-tag="' + _EXTRA_KEY + '">特殊</button>');
  if (_qMode === 'delist') {
    chips.push('<button class="bw-quant-tag-chip is-special' + (_qSelectedTags.has(_SPECIAL_KEY) ? ' active' : '') + '" data-tag="' + _SPECIAL_KEY + '">稀缺</button>');
    chips.push('<button class="bw-quant-tag-chip' + (_qSelectedTags.has(_DUPLICATE_KEY) ? ' active' : '') + '" data-tag="' + _DUPLICATE_KEY + '">重复订单</button>');
  }
  bar.innerHTML = chips.join('');
  bar.querySelectorAll('.bw-quant-tag-chip').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var t = btn.dataset.tag;
      if (_qSelectedTags.has(t)) _qSelectedTags.delete(t); else _qSelectedTags.add(t);
      btn.classList.toggle('active');
      _qRenderList();
    });
  });
}

/* ── 候选集合 ──
   list  ：/v2/items 全量 − 已有出售订单 slug −（默认）稀缺物品
   delist：当前所有出售订单 */
function _qCandidates() {
  if (_qMode === 'list') {
    var ownedSellSlugs = new Set(
      (_qOrders || [])
        .filter(function(o) { return o.order_type === 'sell'; })
        .map(function(o) { return o._slug; })
        .filter(Boolean)
    );
    return (_qItems || [])
      .filter(function(it) {
        if (!it.slug || ownedSellSlugs.has(it.slug)) return false;
        if (!_qShowSpecial && _qIsSpecial(it.slug)) return false;
        return true;
      })
      .map(function(it) {
        return { key: it.slug, slug: it.slug, zh: it.zh, en: it.en, tags: it.tags, maxRank: it.maxRank, rec: it, special: _qIsSpecial(it.slug) };
      });
  }
  /* delist: 先统计每个 slug 的 sell 订单数，标记重复 */
  var slugSellCounts = {};
  (_qOrders || []).forEach(function(o) {
    if (o.order_type === 'sell') {
      var s = o._slug;
      if (s) slugSellCounts[s] = (slugSellCounts[s] || 0) + 1;
    }
  });
  var duplicateSlugs = new Set(Object.keys(slugSellCounts).filter(function(s) { return slugSellCounts[s] >= 2; }));
  return (_qOrders || [])
    .filter(function(o) { return o.order_type === 'sell'; })
    .map(function(o) {
      var s = o._slug;
      return { key: o.id, order: o, slug: s, zh: o._zh || '', en: o._name || s, tags: (o._tags && o._tags.length) ? o._tags : (s && _qItemTagsBySlug(s)), maxRank: o.maxRank, isDuplicate: duplicateSlugs.has(s) };
    });
}
var _qItemTagIndex = null;
function _qItemTagsBySlug(slug) {
  if (!_qItemTagIndex) {
    _qItemTagIndex = {};
    (_qItems || []).forEach(function(it) { if (it.slug) _qItemTagIndex[it.slug] = it.tags; });
  }
  return _qItemTagIndex[slug] || [];
}

function _qFilterAndSort(list) {
  var q = _qSearch.trim().toLowerCase();
  var out = list.filter(function(c) {
    if (q) {
      var zh = (c.zh || '').toLowerCase(), en = (c.en || '').toLowerCase();
      if (zh.indexOf(q) === -1 && en.indexOf(q) === -1) return false;
    }
    if (_qSelectedTags.size) {
      /* 多选复选 = OR 逻辑：命中任一已选 tag（含"其他"/"稀缺"/"重复订单"）即算匹配 */
      var itemTags = c.tags && c.tags.length ? c.tags.filter(function(t) { return TAG_ZH.hasOwnProperty(t); }) : [];
      if (!itemTags.length) itemTags = [_OTHER_KEY];
      var matchTag       = itemTags.some(function(t) { return _qSelectedTags.has(t); });
      var matchSpecial   = _qSelectedTags.has(_SPECIAL_KEY) && _qIsSpecial(c.slug);
      var matchDuplicate = _qSelectedTags.has(_DUPLICATE_KEY) && c.isDuplicate;
      var matchExtra     = _qSelectedTags.has(_EXTRA_KEY) && _qIsExtra(c);
      if (!(matchTag || matchSpecial || matchDuplicate || matchExtra)) return false;
    }
    return true;
  });
  out.sort(function(a, b) {
    if (_qSort === 'name_asc' || _qSort === 'name_desc') {
      var r = _qPinyinCollator.compare(_qNameOf(a), _qNameOf(b));
      return _qSort === 'name_asc' ? r : -r;
    }
    var av = _qAvgOf(a.slug), bv = _qAvgOf(b.slug);
    var an = (av && av.avg != null) ? av.avg : -1;
    var bn = (bv && bv.avg != null) ? bv.avg : -1;
    return _qSort === 'avg_asc' ? an - bn : bn - an;
  });
  return out;
}

function _qRenderList() {
  var box = document.getElementById('bw-quant-list');
  var nEl = document.getElementById('bw-quant-n');
  if (!box) return;
  var list = _qFilterAndSort(_qCandidates());
  if (nEl) nEl.textContent = list.length;
  _qCurList = list;
  if (!list.length) {
    box.innerHTML = '<div class="bw-inv-empty">没有符合筛选条件的物品</div>';
    _qUpdateSelCount();
    return;
  }
  var selSet = _qSel[_qMode];
  if (_qMode === 'list') {
    /* 批量上架：原有简洁行（名称 + 均价文本 + 复选框） */
    box.innerHTML = list.map(function(c) {
      var avg = _qAvgOf(c.slug);
      var avgTxt = (avg && avg.avg != null) ? (avg.avg + ' 白金' + (avg.special ? ' · 稀缺' : '')) : '暂无均价';
      var checked = selSet.has(c.key) ? ' checked' : '';
      return '<label class="bw-quant-row">' +
        '<input type="checkbox" class="bw-quant-row-cb" data-key="' + c.key + '"' + checked + '>' +
        '<span class="bw-quant-row-name">' + _escHtml(c.zh || c.en || c.slug || '') + '</span>' +
        '<span class="bw-quant-row-avg">' + avgTxt + '</span>' +
        '</label>';
    }).join('');
  } else {
    /* 批量下架：参考主页 mkRow 风格（名称 + 单价 + 均价徽章 + 等级/数量 + 更新时间 + 复选框） */
    box.innerHTML = list.map(function(c) {
      var o = c.order;
      var name = _escHtml(c.zh || c.en || c.slug || '');
      var price = o.platinum + 'p';
      var avgBadge = _qAvgBadgeHtml(c.slug, o.mod_rank);
      var rankTxt = o.mod_rank ? '<span class="bw-order-extra"> 等级' + o.mod_rank + '</span>' : '';
      var qtyTxt  = (o.quantity_in_set && o.quantity_in_set > 1) ? '<span class="bw-per-trade">×' + o.quantity_in_set + '/套</span>' : '';
      var timeTxt = o.last_update ? '<span class="bw-order-ago">' + (typeof ago === 'function' ? ago(o.last_update) : o.last_update) + '</span>' : '';
      var checked = selSet.has(c.key) ? ' checked' : '';
      var dupTxt = c.isDuplicate ? '<span class="bw-quant-dup-badge">重复</span>' : '';
      return '<label class="bw-quant-row-delist' + (c.isDuplicate ? ' is-dup' : '') + '">' +
        '<input type="checkbox" class="bw-quant-row-cb" data-key="' + c.key + '"' + checked + '>' +
        '<span class="bw-quant-row-name">' + name + rankTxt + dupTxt + '</span>' +
        '<span class="bw-quant-row-price">' + price + '</span>' +
        '<span class="bw-quant-row-avg">' + avgBadge + '</span>' +
        '<span class="bw-quant-row-meta">' + qtyTxt + timeTxt + '</span>' +
        '</label>';
    }).join('');
  }
  box.querySelectorAll('.bw-quant-row-cb').forEach(function(cb) {
    cb.addEventListener('change', function() {
      if (cb.checked) selSet.add(cb.dataset.key); else selSet.delete(cb.dataset.key);
      _qUpdateSelCount();
      _qSyncSelAllCheckbox();
    });
  });
  _qUpdateSelCount();
  _qSyncSelAllCheckbox();
}
var _qCurList = [];

function _qSelectableList() {
  return _qCurList;
}
function _qSyncSelAllCheckbox() {
  var cb = document.getElementById('bw-quant-selall-cb');
  if (!cb) return;
  var selSet = _qSel[_qMode];
  var selectable = _qSelectableList();
  var all = selectable.length > 0 && selectable.every(function(c) { return selSet.has(c.key); });
  cb.checked = all;
}

function _qUpdateSelCount() {
  var n = _qSel[_qMode].size;
  var elList   = document.getElementById('bw-quant-list-sel-n');
  var elDelist = document.getElementById('bw-quant-delist-sel-n');
  if (elList)   elList.textContent   = n;
  if (elDelist) elDelist.textContent = n;
}

function _escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

/* ── 模式切换 ── */
function _qSwitchMode(mode) {
  if (_qMode === mode) return;
  _qMode = mode;
  _qSelectedTags.clear();
  document.querySelectorAll('.bw-quant-mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.qmode === mode);
  });
  document.getElementById('bw-quant-mode-label').textContent = mode === 'list' ? '还未上架的物品' : '当前出售订单';
  document.getElementById('bw-quant-action-list').style.display   = mode === 'list'   ? '' : 'none';
  document.getElementById('bw-quant-action-delist').style.display = mode === 'delist' ? '' : 'none';
  _qRenderTagbar();
  _qRenderList();
}

/* ── 通用确认框 ── */
function _qShowConfirm(title, sub, onOk) {
  var overlay = document.getElementById('bw-quant-confirm');
  document.getElementById('bw-quant-confirm-title').textContent = title;
  document.getElementById('bw-quant-confirm-sub').textContent   = sub;
  overlay.removeAttribute('aria-hidden');
  overlay.classList.add('show');
  function cleanup() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('show');
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    overlay.removeEventListener('click', handleOverlay);
  }
  function handleOk()      { cleanup(); onOk(); }
  function handleCancel()  { cleanup(); }
  function handleOverlay(e) { if (e.target === overlay) cleanup(); }
  var okBtn     = document.getElementById('bw-quant-confirm-ok');
  var cancelBtn = document.getElementById('bw-quant-confirm-cancel');
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  overlay.addEventListener('click', handleOverlay);
}

/* ── 批量上架确认 + 执行 ── */
function _qRunList() {
  var selSet = _qSel.list;
  var targets = _qCurList.filter(function(c) { return selSet.has(c.key); });
  if (!targets.length) { setStatusQ('请先勾选要上架的物品'); return; }
  var rankLabel = _qRankMode === '0' ? '0级' : '满级';
  if (_qPriceMode === 'fixed') {
    var fixed = Math.max(1, parseInt(document.getElementById('bw-quant-fixed-input').value) || 1);
    _qShowConfirm(
      '确认批量上架 ' + targets.length + ' 件物品？',
      '将以统一价 ' + fixed + 'p（' + rankLabel + '）逐条自动创建出售订单。',
      function() { _qDoRunList(targets, fixed, true); }
    );
  } else {
    var mult = parseFloat(document.getElementById('bw-quant-mult-input').value) || 1;
    _qShowConfirm(
      '确认批量上架 ' + targets.length + ' 件物品？',
      '将按均价 × ' + mult + ' 倍（' + rankLabel + '）逐条自动创建出售订单，请确认价格倍率无误。',
      function() { _qDoRunList(targets, mult, false); }
    );
  }
}
function _qDoRunList(targets, mult, isFixed) {
  var selSet = _qSel.list;
  var btn = document.getElementById('bw-quant-list-btn');
  btn.disabled = true;
  // 优先 batch 1次鉴权
  var creates=[];
  targets.forEach(function(c){
    var price;
    if (isFixed) price = mult;
    else {
      var avg = _qAvgOf(c.slug);
      var basis = avg;
      if (c.maxRank) {
        if (_qRankMode === '0') basis = (avg && avg.avg_zero && avg.avg_zero.avg != null) ? avg.avg_zero : avg;
        else basis = (avg && avg.avg_max && avg.avg_max.avg != null) ? avg.avg_max : avg;
      }
      price = Math.max(1, _qRoundPrice((basis && basis.avg || 1) * mult));
    }
    var body = { itemId: c.rec.id, type: 'sell', platinum: price, quantity: 1, visible: true };
    if (c.maxRank) body.rank = (_qRankMode === '0') ? 0 : c.maxRank;
    var tags = (c.rec && c.rec.tags) || [];
    var _needPerTrade = ['axi','lith','meso','neo','fish','ayatan_sculpture'];
    if (tags.some(function(t) { return _needPerTrade.indexOf(t) !== -1; })) body.perTrade = 1;
    if (c.rec && c.rec.subtypes && c.rec.subtypes.length) body.subtype = c.rec.subtypes[0];
    if (c.rec && c.rec.maxAmberStars) body.amberStars = 0;
    if (c.rec && c.rec.maxCyanStars)  body.cyanStars  = 0;
    creates.push(body);
  });
  // 尝试 batch
  apiFetch('/orders/batch', { method:'POST', body: JSON.stringify({ creates }) }).then(function(res){
    if (res.fails && res.fails.length) {
      // 部分失败回退单条
      var failCreates = res.fails.map(function(f){ return f.body; }).filter(Boolean);
      if (failCreates.length) {
        // 映射回 targets
        var failTargets = targets.filter(function(c,idx){ return res.fails.some(function(f){ return f.body && f.body.itemId===c.rec.id; }); });
        return runBatch(failTargets, function(c){
          var idx=targets.indexOf(c); return apiFetch('/order', { method:'POST', body: JSON.stringify(creates[targets.indexOf(c)]) });
        }, { idPrefix:'bw-quant-list', getLabel: function(c){ return {type:'上架', name:c.zh||c.en||c.slug}; }, onDone: function(){ btn.disabled=false; selSet.clear(); _qLoadOrders().then(_qRenderList); } });
      }
    }
    btn.disabled=false; selSet.clear(); _qLoadOrders().then(_qRenderList);
  }).catch(function(){
    // batch 不可用回退单条
    runBatch(targets, function(c) {
      var price;
      if (isFixed) price = mult;
      else {
        var avg = _qAvgOf(c.slug);
        var basis = avg;
        if (c.maxRank) {
          if (_qRankMode === '0') basis = (avg && avg.avg_zero && avg.avg_zero.avg != null) ? avg.avg_zero : avg;
          else basis = (avg && avg.avg_max && avg.avg_max.avg != null) ? avg.avg_max : avg;
        }
        price = Math.max(1, _qRoundPrice((basis && basis.avg || 1) * mult));
      }
      var body = { itemId: c.rec.id, type: 'sell', platinum: price, quantity: 1, visible: true };
      if (c.maxRank) body.rank = (_qRankMode === '0') ? 0 : c.maxRank;
      var tags = (c.rec && c.rec.tags) || [];
      var _needPerTrade = ['axi','lith','meso','neo','fish','ayatan_sculpture'];
      if (tags.some(function(t) { return _needPerTrade.indexOf(t) !== -1; })) body.perTrade = 1;
      if (c.rec && c.rec.subtypes && c.rec.subtypes.length) body.subtype = c.rec.subtypes[0];
      if (c.rec && c.rec.maxAmberStars) body.amberStars = 0;
      if (c.rec && c.rec.maxCyanStars)  body.cyanStars  = 0;
      return apiFetch('/order', { method: 'POST', body: JSON.stringify(body) });
    }, {
      idPrefix: 'bw-quant-list',
      getLabel: function(c) { return { type: '上架', name: c.zh || c.en || c.slug }; },
      onDone: function() {
        btn.disabled = false;
        selSet.clear();
        _qLoadOrders().then(_qRenderList);
      },
    });
  });
}

/* ── 批量下架执行 优先 batch 1次鉴权 ── */
function _qRunDelist() {
  var selSet = _qSel.delist;
  var targets = _qCurList.filter(function(c) { return selSet.has(c.key); });
  if (!targets.length) { setStatusQ('请先勾选要下架的订单'); return; }
  _qShowConfirm('确认批量下架 ' + targets.length + ' 条订单？', '此操作不可撤销，订单将永久关闭。', function() {
    var btn = document.getElementById('bw-quant-delist-btn');
    btn.disabled = true;
    var deletes = targets.map(function(c){ return c.order.id; });
    apiFetch('/orders/batch', { method:'POST', body: JSON.stringify({ deletes }) }).then(function(res){
      if (res.fails && res.fails.length) {
        var failIds=new Set(res.fails.map(function(f){return f.id;}));
        var failTargets=targets.filter(function(c){ return failIds.has(c.order.id); });
        if (failTargets.length) return runBatch(failTargets, function(c){ return apiFetch('/order/'+c.order.id,{method:'DELETE'}); }, { idPrefix:'bw-quant-delist', getLabel: function(c){return {type:'下架', name:c.zh||c.en||c.slug};}, onDone: function(){ btn.disabled=false; selSet.clear(); _qLoadOrders().then(_qRenderList); } });
      }
      btn.disabled=false; selSet.clear(); _qLoadOrders().then(_qRenderList);
    }).catch(function(){
      runBatch(targets, function(c) {
        return apiFetch('/order/' + c.order.id, { method: 'DELETE' });
      }, {
        idPrefix: 'bw-quant-delist',
        getLabel: function(c) { return { type: '下架', name: c.zh || c.en || c.slug }; },
        onDone: function() {
          btn.disabled = false;
          selSet.clear();
          _qLoadOrders().then(_qRenderList);
        },
      });
    });
  });
}

function setStatusQ(t) { var el = document.getElementById('bw-quant-status'); if (el) { el.textContent = t || ''; if (t) setTimeout(function(){ if (el.textContent === t) el.textContent = ''; }, 2500); } }

/* ── 主入口 ── */
async function main() {
  /* ── 1. 立即绑定所有 UI 事件（不依赖鉴权，确保即使 requireAuth() 挂起，
        登出按钮、模式切换、搜索、排序等仍可操作） ── */
  bindLogout();

  document.querySelectorAll('.bw-quant-mode-btn').forEach(function(b) {
    b.addEventListener('click', function() { _qSwitchMode(b.dataset.qmode); });
  });
  document.querySelectorAll('[data-qsort]').forEach(function(b) {
    b.addEventListener('click', function() {
      _qSort = b.dataset.qsort;
      document.querySelectorAll('[data-qsort]').forEach(function(x) { x.classList.toggle('active', x === b); });
      _qRenderList();
    });
  });
  var searchEl = document.getElementById('bw-quant-search');
  searchEl.addEventListener('input', function() { _qSearch = searchEl.value; _qRenderList(); });

  document.getElementById('bw-quant-selall-cb').addEventListener('change', function(e) {
    var selSet = _qSel[_qMode];
    var selectable = _qSelectableList();
    if (e.target.checked) selectable.forEach(function(c) { selSet.add(c.key); });
    else selectable.forEach(function(c) { selSet.delete(c.key); });
    _qRenderList();
  });

  document.getElementById('bw-quant-list-btn').addEventListener('click', _qRunList);
  document.getElementById('bw-quant-delist-btn').addEventListener('click', _qRunDelist);

  document.querySelectorAll('#bw-quant-round-pills .bw-round-pill').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.round === _qRoundMode);
    btn.addEventListener('click', function() {
      _qRoundMode = btn.dataset.round;
      localStorage.setItem('bw_price_round_mode', _qRoundMode);
      document.querySelectorAll('#bw-quant-round-pills .bw-round-pill').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  document.querySelectorAll('#bw-quant-rank-pills .bw-round-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _qRankMode = btn.dataset.rank;
      document.querySelectorAll('#bw-quant-rank-pills .bw-round-pill').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  /* 定价模式切换：按均价倍率 / 按指定价格 */
  document.querySelectorAll('#bw-quant-price-mode-pills .bw-round-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _qPriceMode = btn.dataset.pricemode;
      document.querySelectorAll('#bw-quant-price-mode-pills .bw-round-pill').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      var multWrap = document.getElementById('bw-quant-mult-wrap');
      var fixedWrap = document.getElementById('bw-quant-fixed-wrap');
      if (multWrap) multWrap.style.display = _qPriceMode === 'mult' ? '' : 'none';
      if (fixedWrap) fixedWrap.style.display = _qPriceMode === 'fixed' ? '' : 'none';
    });
  });

  /* 显示/隐藏稀缺物品开关 */
  var specialCb = document.getElementById('bw-quant-show-special');
  if (specialCb) {
    specialCb.addEventListener('change', function() {
      _qShowSpecial = specialCb.checked;
      _qRenderList();
    });
  }

  /* 批量失败面板：展开详情 / 一键重试 / 关闭（上架 + 下架各一组） */
  ['bw-quant-list', 'bw-quant-delist'].forEach(function(pfx) {
    var toggle = document.getElementById(pfx + '-fail-toggle');
    var retry  = document.getElementById(pfx + '-fail-retry');
    var close  = document.getElementById(pfx + '-fail-close');
    if (toggle) toggle.addEventListener('click', function() {
      var list = document.getElementById(pfx + '-fail-list');
      if (!list) return;
      var open = list.style.display === 'none';
      list.style.display = open ? '' : 'none';
      toggle.textContent = open ? '收起详情' : '展开详情';
    });
    if (retry) retry.addEventListener('click', function() { retryBatchFailures(pfx); });
    if (close) close.addEventListener('click', function() { hideBatchFail(pfx); });
  });

  /* ── 2. 鉴权 ── */
  setStatusQ('正在验证登录状态…');
  const sess = await requireAuth();
  if (!sess) return;

  /* ── 3. 加载数据 ── */
  setStatusQ('正在加载物品与订单数据…');
  var _loadErr = null;
  try {
    await Promise.all([
      _qLoadItems().catch(function(e) { _loadErr = _loadErr || '物品列表加载失败：' + (e.message || e); return []; }),
      _qLoadOrders().catch(function(e) { _loadErr = _loadErr || '订单数据加载失败：' + (e.message || e); return []; }),
      _qLoadAvg(),
    ]);
  } catch (e) {
    _loadErr = _loadErr || '数据加载异常：' + (e.message || e);
  }
  setStatusQ('');

  /* ── 4. 始终渲染（即使有错误也显示错误信息，不阻塞 UI） ── */
  _qRenderTagbar();
  if (_loadErr) {
    var box = document.getElementById('bw-quant-list');
    if (box) box.innerHTML = '<div class="bw-inv-empty" style="color:var(--c-warn,#c8963a)">' + _escHtml(_loadErr) + '<br><span style="font-size:.82rem;opacity:.7">请检查网络后刷新页面重试</span></div>';
    var nEl = document.getElementById('bw-quant-n');
    if (nEl) nEl.textContent = '0';
    return;
  }
  _qRenderList();
}

document.addEventListener('DOMContentLoaded', main);
