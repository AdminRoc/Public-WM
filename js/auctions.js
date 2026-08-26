/* ═══════════════════════════════════════════════════════════
   auctions.js — 拍卖功能
   语言切换仅影响内容（武器名/词条名/元素名），UI 标签始终中文。
   ═══════════════════════════════════════════════════════════ */

let _aType = 'riven';
/* 裂罅二次精确筛选的特殊 token（不进 API，仅客户端过滤） */
const RIVEN_POS_NONE = '__POS_NONE__';   // 正词条③ 不存在（仅2正）
const RIVEN_POS_ANY  = '__POS_ANY__';    // 正词条③ 存在（任意第三正）
const RIVEN_NEG_NONE = '__NEG_NONE__';   // 无负词条
const RIVEN_NEG_ANY  = '__NEG_ANY__';    // 任意负词条
let _aLang = 'zh';
let _mode  = 'search'; // 'search' | 'manage'
const _dicts   = {};
const _dictArr = {};

let _lastResultList = null;
let _lastMineList   = null;
let _onlineFilter   = 'all'; // 'all' | 'online' | 'ingame'
let _sortBy         = 'price_asc'; // 'price_asc' | 'price_desc'
let _onlineFirst    = false;       // 是否叠加在线优先（可与价格排序复选）

/* 裂罅Mod均价 —— 不再依赖离线数据管线，改为对当次搜索结果里 ingame 状态的
   一口价样本当场统计（结果集本身已按武器/词条筛选，天然贴合当前搜索场景）：
   整体均价 —— 全部 ingame 一口价，按样本量分档裁剪极值后平均（口径与原算法一致）
   基准均价 —— 0洗(re_rolls=0) + ingame 一口价，按价格升序取最低 30% 取平均
              （防止极少数超高价 0洗裂罅污染基准价，用比例裁剪替代原来的"高于整体均价剔除"）*/
function _trimAvg(sortedPrices) {
  const count = sortedPrices.length;
  if (!count) return { avg: null, count: 0, used: 0, special: true };
  let lo = 0, hi = 0;
  // 样本数≥20：掐头去尾各裁3/5；10~19：各裁2；5~9：各裁1；<5：不裁剪，全部平均
  if (count >= 20) { lo = 3; hi = 5; }
  else if (count >= 10) { lo = 2; hi = 2; }
  else if (count >= 5) { lo = 1; hi = 1; }
  const trimmed = sortedPrices.slice(lo, hi ? count - hi : count);
  const used = trimmed.length;
  const avg = used ? Math.round(trimmed.reduce(function(s, p){ return s + p; }, 0) / used) : null;
  return { avg: avg, count: count, used: used, special: count < 3 };
}
function _baseAvgTop30(sortedPrices) {
  const count = sortedPrices.length;
  if (!count) return { avg: null, count: 0, used: 0, special: true };
  const n = Math.max(1, Math.round(count * 0.3));
  const trimmed = sortedPrices.slice(0, n);
  const used = trimmed.length;
  const avg = Math.round(trimmed.reduce(function(s, p){ return s + p; }, 0) / used);
  return { avg: avg, count: count, used: used, special: used < 3 };
}
function _rivenLiveStats(list) {
  const ingameBuyouts = list
    .filter(function(a){ return a.buyout_price != null && ((a.owner && a.owner.status) || '').toLowerCase() === 'ingame'; })
    .map(function(a){ return a.buyout_price; })
    .sort(function(a,b){ return a - b; });
  const zeroReroll = list
    .filter(function(a){ return a.buyout_price != null && ((a.owner && a.owner.status) || '').toLowerCase() === 'ingame' && (a.item && a.item.re_rolls) === 0; })
    .map(function(a){ return a.buyout_price; })
    .sort(function(a,b){ return a - b; });
  return { overall: _trimAvg(ingameBuyouts), base: _baseAvgTop30(zeroReroll) };
}
function renderRivenAvgBadge(list) {
  const el = document.getElementById('bw-auc-riven-avg');
  if (!el) return;
  if (_aType !== 'riven' || !list || !list.length) { el.style.display = 'none'; return; }
  const stats = _rivenLiveStats(list);
  const overall = stats.overall, base = stats.base;
  if (overall.avg == null) {
    el.style.display = '';
    el.className = 'bw-riven-avg-badge nodata';
    el.textContent = '暂无该武器一口价均价数据';
    return;
  }
  el.style.display = '';
  el.className = 'bw-riven-avg-badge ok' + (overall.special ? ' special' : '');
  const rightTxt = (base.avg != null) ? ('基准均价 ' + base.avg + ' 白金') : '暂无基准均价';
  el.innerHTML =
      '<span class="bw-riven-avg-half l">' + (overall.special ? '<span class="bw-avg-rare">稀缺</span>' : '') + '整体均价 ' + overall.avg + ' 白金</span>'
    + '<span class="bw-riven-avg-sep"></span>'
    + '<span class="bw-riven-avg-half r">' + rightTxt + '</span>';
}

const ELEMENTS = [
  { slug: 'impact',      zh: '冲击',   en: 'Impact' },
  { slug: 'heat',        zh: '火焰',   en: 'Heat' },
  { slug: 'cold',        zh: '冰冻',   en: 'Cold' },
  { slug: 'electricity', zh: '电击',   en: 'Electricity' },
  { slug: 'toxin',       zh: '毒素',   en: 'Toxin' },
  { slug: 'magnetic',    zh: '磁力',   en: 'Magnetic' },
  { slug: 'radiation',   zh: '辐射',   en: 'Radiation' },
];
const POLARITIES = [
  { slug: 'madurai', zh: '马杜莱', en: 'Madurai', icon: '/picture/Madurai.webp' },
  { slug: 'vazarin', zh: '瓦扎林', en: 'Vazarin', icon: '/picture/Vazarin.webp' },
  { slug: 'naramon', zh: '纳拉蒙', en: 'Naramon', icon: '/picture/Naramon.webp' },
];

function L(obj) { return _aLang === 'zh' ? (obj.zh || obj.en) : (obj.en || obj.zh); }
function i18nName(entry) {
  const i = entry && entry.i18n;
  if (!i) return (entry && entry.slug) || '';
  return _aLang === 'zh'
    ? (i['zh-hans'] && i['zh-hans'].name) || (i.en && i.en.name) || entry.slug
    : (i.en && i.en.name) || (i['zh-hans'] && i['zh-hans'].name) || entry.slug;
}
/* 兼容字典项（有 i18n）和 ELEMENTS/POLARITIES（有 zh/en） */
function acName(it) {
  if (it && it.i18n) return i18nName(it);
  if (!it) return '';
  return _aLang === 'zh' ? (it.zh || it.en || it.slug || '') : (it.en || it.zh || it.slug || '');
}

function setStatus(t) { const el = document.getElementById('bw-auc-status'); if (el) el.textContent = t || ''; }

/* WM v2 API 经代理时缺 zh-hans，以下均为官方中文站实际抓取，禁止臆造 */

/* 赤毒玄骸武器（21种）*/
const LICH_WEAPON_ZH = {
  'kuva_drakgoon':    '赤毒·龙骑兵',
  'kuva_brakk':       '赤毒·布拉克',
  'kuva_bramma':      '赤毒·布拉玛',
  'kuva_chakkhurr':   '赤毒·邪眼',
  'kuva_karak':       '赤毒·卡拉克',
  'kuva_twin_stubbas':'赤毒·双子史度巴',
  'kuva_nukor':       '赤毒·努寇微波枪',
  'kuva_tonkor':      '赤毒·征服榴炮',
  'kuva_kraken':      '赤毒·北海巨妖',
  'kuva_hind':        '赤毒·雌鹿',
  'kuva_ayanga':      '赤毒·怒雷',
  'kuva_seer':        '赤毒·预言者',
  'kuva_shildeg':     '赤毒·希尔德',
  'kuva_quartakk':    '赤毒·夸塔克',
  'kuva_kohm':        '赤毒·寇恩热能枪',
  'kuva_ogris':       '赤毒·食人女魔',
  'kuva_zarr':        '赤毒·沙皇',
  'kuva_grattler':    '赤毒·葛拉特勒',
  'kuva_hek':         '赤毒·海克',
  'kuva_sobek':       '赤毒·鳄神',
  'kuva_ghoulsaw':    '赤毒·尸鬼电锯',
};

/* 帕尔沃斯的姐妹武器（11种）*/
const SISTER_WEAPON_ZH = {
  'tenet_tetra':         '信条·特拉',
  'tenet_diplos':        '信条·纵横双枪',
  'tenet_arca_plasmor':  '信条·弧电离子枪',
  'tenet_envoy':         '信条·典客',
  'tenet_detron':        '信条·德特昂',
  'tenet_flux_rifle':    '信条·通量步枪',
  'tenet_cycron':        '信条·循环离子枪',
  'tenet_spirex':        '信条·斯派克斯',
  'tenet_plinx':         '信条·漫射者',
  'tenet_glaxion':       '信条·冷冻光束步枪',
  'tenet_quanta':        '信条·量子切割器',
};

/* riven/attributes zh-hans 映射 */
const ATTR_ZH = {
  'punch_through':                    '穿透',
  'slash_damage':                     '切割伤害',
  'impact_damage':                    '冲击伤害',
  'toxin_damage':                     '毒素伤害',
  'status_duration':                  '触发时间',
  'ammo_maximum':                     '弹药上限',
  'recoil':                           '后坐力',
  'zoom':                             '变焦',
  'channeling_damage':                '初始连击数',
  'channeling_efficiency':            '重击效率',
  'critical_chance':                  '暴击率',
  'critical_damage':                  '暴击伤害',
  'base_damage_/_melee_damage':       '基础伤害',
  'heat_damage':                      '火焰伤害',
  'multishot':                        '多重射击',
  'reload_speed':                     '装填速度',
  'range':                            '攻击范围',
  'damage_vs_corpus':                 '对Corpus伤害',
  'damage_vs_grineer':                '对Grineer伤害',
  'puncture_damage':                  '穿刺伤害',
  'damage_vs_infested':               '对Infested伤害',
  'electric_damage':                  '电击伤害',
  'finisher_damage':                  '处决伤害',
  'fire_rate_/_attack_speed':         '射速/攻击速度',
  'projectile_speed':                 '投射物飞行速度',
  'magazine_capacity':                '弹匣容量',
  'status_chance':                    '触发几率',
  'cold_damage':                      '冰冻伤害',
  'combo_duration':                   '连击持续时间',
  'critical_chance_on_slide_attack':  '滑行攻击暴击率',
  'chance_to_gain_extra_combo_count': '额外连击数获取',
  'chance_to_gain_combo_count':       '的几率来获得连击数',
};

/* ── 字典加载 ──
   拍卖字典由本仓库 .github/workflows/harvest-auction-dicts.yml 产出
   data/auction-dicts.json（格式 { name: [items] }，含 i18n 中英双语）。
   页面一次性从 jsDelivr 读取最新产物（带 raw 回退），不再经 Worker 逐个
   拉取——既省 Worker 流量，也避免腾讯云 Pages 手动低频部署导致快照过时。 */
let _dictsLoaded = false;
async function ensureDictsLoaded() {
  if (_dictsLoaded) return;
  /* 同源 EdgeOne KV（实时最新）→ jsDelivr → raw → 同源 Pages 快照（兜底）；
     持续重试直到成功，成功即自动停止 */
  await createReliableLoader(
    [
      '/api/kv?key=auction_dicts_json',
      'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/auction-dicts.json',
      'https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/auction-dicts.json',
      '/data/auction-dicts.json',
    ],
    function(grouped) {
      if (!grouped || typeof grouped !== 'object') return false;
      var any = false;
      for (var key in grouped) {
        var arr = Array.isArray(grouped[key]) ? grouped[key] : [];
        // 缺 zh-hans 时从硬编码表注入（兜底）
        var zhMap = key === 'riven/attributes' ? ATTR_ZH
                  : key === 'lich/weapons'     ? LICH_WEAPON_ZH
                  : key === 'sister/weapons'   ? SISTER_WEAPON_ZH
                  : null;
        if (zhMap) {
          arr.forEach(function(it) {
            if (it.i18n && !it.i18n['zh-hans'] && zhMap[it.slug]) {
              it.i18n['zh-hans'] = { name: zhMap[it.slug] };
            }
          });
        }
        var map = {};
        arr.forEach(function(it) { map[it.slug] = it; });
        _dicts[key] = map; _dictArr[key] = arr;
        if (arr.length) any = true;
      }
      if (!any) return false;
      _dictsLoaded = true;
      return true;
    },
    { retryDelay: 2500 }
  ).promise;
}

async function loadDict(name) {
  if (_dicts[name]) return _dicts[name];
  await ensureDictsLoaded();
  return _dicts[name] || {};
}

/* ══════════════════════════════════════════════════════
   自动补全组件
   每个 ac 字段由 <input data-slug=""> + <div.bw-ac-drop> 组成。
   选中后 data-slug 记录实际 slug，input.value 显示当前语言名。
   ══════════════════════════════════════════════════════ */

function initAc(inputId, getArr, allowEmpty) {
  var input = document.getElementById(inputId);
  var drop  = document.getElementById(inputId + '-drop');
  if (!input || !drop) return;

  /* .bw-tr-panel 有 transform + overflow:hidden，会破坏 fixed 定位。
     把 drop 移到 body 最底部，彻底脱离任何 transform 上下文。 */
  document.body.appendChild(drop);

  function positionDropFixed() {
    var r = input.getBoundingClientRect();
    drop.style.position = 'fixed';
    drop.style.top      = (r.bottom + 3) + 'px';
    drop.style.left     = r.left + 'px';
    drop.style.width    = r.width + 'px';
    drop.style.right    = 'auto';
    drop.style.zIndex   = '1100';
  }

  function showItems(arr) {
    var items = allowEmpty ? [{ slug: '', _empty: true }].concat(arr.slice(0, 50)) : arr.slice(0, 50);
    if (!items.length) { drop.style.display = 'none'; return; }
    drop.innerHTML = items.map(function(it) {
      return '<div class="bw-ac-item" data-slug="' + _escHtml(it.slug || '') + '">'
        + (it._empty ? '（不限）' : _escHtml(acName(it))) + '</div>';
    }).join('');
    drop.style.display = 'block';
    positionDropFixed();
    drop.querySelectorAll('.bw-ac-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var slug = el.dataset.slug;
        input.dataset.slug = slug;
        input.value = slug ? el.textContent : '';
        drop.style.display = 'none';
      });
    });
  }

  function doFilter(q) {
    q = (q || '').trim().toLowerCase();
    var arr = getArr();
    if (!q) return arr;
    return arr.filter(function(it) {
      var zh = (it.i18n && it.i18n['zh-hans'] && it.i18n['zh-hans'].name) || it.zh || '';
      var en = (it.i18n && it.i18n.en && it.i18n.en.name) || it.en || '';
      return zh.indexOf(q) !== -1
          || en.toLowerCase().indexOf(q) !== -1
          || (it.slug || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  input.addEventListener('input', function() {
    input.dataset.slug = '';
    showItems(doFilter(input.value));
  });
  input.addEventListener('compositionend', function() {
    input.dataset.slug = '';
    showItems(doFilter(input.value));
  });
  input.addEventListener('focus', function() { showItems(doFilter(input.value)); });
  input.addEventListener('blur',  function() { setTimeout(function() { drop.style.display = 'none'; }, 160); });
}

/* 生成 ac 字段 HTML */
function acFieldHtml(id, label, placeholder) {
  return '<div class="bw-auc-field">'
    + '<label>' + label + '</label>'
    + '<div class="bw-ac-wrap">'
    +   '<input class="bw-ac-input" id="' + id + '" data-slug="" placeholder="' + placeholder + '" autocomplete="off" spellcheck="false">'
    +   '<div class="bw-ac-drop" id="' + id + '-drop"></div>'
    + '</div></div>';
}
/* 自定义 select 组件：接受 opts=[{value,label,icon?}] 数组。
   Public-WM 不请求任何缩略图/图标，icon 一律忽略，下拉仅显示文字。 */
function selFieldHtml(id, label, opts) {
  var firstLabel = opts.length ? opts[0].label : '';
  var firstValue = opts.length ? opts[0].value : '';
  var itemsHtml = opts.map(function(o, i) {
    return '<div class="bw-csel-item' + (i === 0 ? ' active' : '') + '" data-value="' + _escHtml(o.value) + '">'
      + _escHtml(o.label) + '</div>';
  }).join('');
  return '<div class="bw-auc-field"><label>' + label + '</label>'
    + '<div class="bw-csel-wrap" id="' + id + '-wrap">'
    + '<button class="bw-csel-trigger" type="button">'
    + '<span class="bw-csel-label" id="' + id + '-lbl">' + _escHtml(firstLabel) + '</span>'
    + '<svg class="bw-csel-arrow" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 5,5 9,1"/></svg>'
    + '</button>'
    + '<div class="bw-csel-drop">' + itemsHtml + '</div>'
    + '<input type="hidden" id="' + id + '" value="' + _escHtml(firstValue) + '">'
    + '</div></div>';
}

function initSel(id) {
  var wrap = document.getElementById(id + '-wrap');
  if (!wrap || wrap._bwSelInit) return;
  wrap._bwSelInit = true;
  var trigger = wrap.querySelector('.bw-csel-trigger');
  var drop    = wrap.querySelector('.bw-csel-drop');
  var lbl     = document.getElementById(id + '-lbl');
  var hidden  = document.getElementById(id);
  if (!trigger || !drop) return;

  /* 移到 body，避免 .bw-tr-panel 的 transform/overflow 破坏 fixed 定位。
     把引用存到 wrap 上，供 rebuildSelOpts 使用。 */
  document.body.appendChild(drop);
  wrap._bwSelDrop = drop;

  function positionDropFixed() {
    var r = trigger.getBoundingClientRect();
    drop.style.position = 'fixed';
    drop.style.top      = (r.bottom + 3) + 'px';
    drop.style.left     = r.left + 'px';
    drop.style.width    = r.width + 'px';
    drop.style.right    = 'auto';
    drop.style.zIndex   = '1100';
  }

  function closeDrop() {
    wrap.classList.remove('is-open');
    drop.style.transform = '';
    drop.style.opacity = '';
    drop.style.pointerEvents = '';
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    var wasOpen = wrap.classList.contains('is-open');
    document.querySelectorAll('.bw-csel-wrap.is-open').forEach(function(w) {
      w.classList.remove('is-open');
      var d = w._bwSelDrop || w.querySelector('.bw-csel-drop');
      if (d) { d.style.transform = ''; d.style.opacity = ''; d.style.pointerEvents = ''; }
    });
    if (!wasOpen) {
      positionDropFixed();
      wrap.classList.add('is-open');
      drop.style.transform = 'scaleY(1)';
      drop.style.opacity = '1';
      drop.style.pointerEvents = 'all';
    }
  });

  drop.addEventListener('click', function(e) {
    var item = e.target.closest('.bw-csel-item');
    if (!item) return;
    var val = item.dataset.value;
    if (hidden) hidden.value = val;
    if (lbl) lbl.innerHTML = item.innerHTML;
    drop.querySelectorAll('.bw-csel-item').forEach(function(i) { i.classList.remove('active'); });
    item.classList.add('active');
    closeDrop();
  });
}

function rebuildSelOpts(id, opts) {
  var wrap = document.getElementById(id + '-wrap');
  if (!wrap) return;
  var drop   = wrap._bwSelDrop || wrap.querySelector('.bw-csel-drop');
  var lbl    = document.getElementById(id + '-lbl');
  var hidden = document.getElementById(id);
  if (!drop || !hidden) return;
  var currentVal = hidden.value;
  drop.innerHTML = opts.map(function(o) {
    return '<div class="bw-csel-item' + (o.value === currentVal ? ' active' : '') + '" data-value="' + _escHtml(o.value) + '">'
      + _escHtml(o.label) + '</div>';
  }).join('');
  var active = opts.find(function(o) { return o.value === currentVal; }) || opts[0];
  if (active && lbl) {
    lbl.innerHTML = _escHtml(active.label);
  }
}

/* ── 筛选器渲染 ── */
function renderFilters() {
  const box = document.getElementById('bw-auc-filters');
  if (!box) return;
  const weaponDict = _aType + '/weapons';
  var wPh = _aType === 'riven' ? '（必选武器）' : (_aType === 'lich' ? '（必选赤毒武器）' : '（必选姐妹武器）');
  var html = acFieldHtml('bw-auc-weapon', '武器 *', wPh);

  if (_aType === 'riven') {
    html += acFieldHtml('bw-auc-pos1', '正面词条①', '（不限）');
    html += acFieldHtml('bw-auc-pos2', '正面词条②', '（不限）');
    html += acFieldHtml('bw-auc-pos3', '正面词条③', '（不限）');
    html += acFieldHtml('bw-auc-neg',  '负面词条',  '（不限）');
    html += selFieldHtml('bw-auc-polarity', '极性',
      [{ value: '', label: '（不限）' }].concat(POLARITIES.map(function(p) { return { value: p.slug, label: L(p) }; })));
  } else {
    html += selFieldHtml('bw-auc-element', '元素',
      [{ value: '', label: '（不限）' }].concat(ELEMENTS.map(function(e) { return { value: e.slug, label: L(e) }; })));
    html += '<div class="bw-auc-field"><label>伤害%</label><div style="display:flex;gap:.4rem"><input class="bw-ac-input" id="bw-auc-dmg-min" type="number" min="25" max="60" placeholder="25"><input class="bw-ac-input" id="bw-auc-dmg-max" type="number" min="25" max="60" placeholder="60"></div></div>';
    html += selFieldHtml('bw-auc-ephemera', '幻纹',
      [{ value: '', label: '（不限）' }, { value: 'true', label: '有' }, { value: 'false', label: '无' }]);
  }

  html += selFieldHtml('bw-auc-buyout', '成交方式',
    [{ value: '', label: '全部' }, { value: 'direct', label: '一口价' }, { value: 'auction', label: '拍卖' }]);
  html += selFieldHtml('bw-auc-sort', '排序',
    [{ value: 'price_asc', label: '价格升序' }, { value: 'price_desc', label: '价格降序' }]);
  box.innerHTML = html;

  var wArr = function() { return _dictArr[weaponDict] || []; };
  var aArr = function() { return _dictArr['riven/attributes'] || []; };
  initAc('bw-auc-weapon', wArr, false);
  if (_aType === 'riven') {
    initAc('bw-auc-pos1', aArr, true);
    initAc('bw-auc-pos2', aArr, true);
    (function(){
      var _basePos3 = aArr;
      var _pos3Arr = function(){
        var base = _basePos3();
        return [
          { slug: RIVEN_POS_NONE, i18n: {'zh-hans':{name:'不存在（仅2正词条）'},en:{name:'No 3rd Positive'}}, zh:'不存在', en:'No 3rd Positive' },
          { slug: RIVEN_POS_ANY,  i18n: {'zh-hans':{name:'存在（任意第三正）'},en:{name:'Any 3rd Positive'}},  zh:'存在',  en:'Any 3rd Positive' }
        ].concat(base);
      };
      initAc('bw-auc-pos3', _pos3Arr, true);
    })();
    (function(){
      var _baseNeg = aArr;
      var _negArr = function(){
        var base = _baseNeg();
        return [
          { slug: RIVEN_NEG_NONE, i18n: {'zh-hans':{name:'不存在（无负词条）'},en:{name:'No Negative'}}, zh:'不存在', en:'No Negative' },
          { slug: RIVEN_NEG_ANY,  i18n: {'zh-hans':{name:'存在（任意负词条）'},en:{name:'Any Negative'}},  zh:'存在',  en:'Any Negative' }
        ].concat(base);
      };
      initAc('bw-auc-neg', _negArr, true);
    })();
    initSel('bw-auc-polarity');
  } else {
    initSel('bw-auc-element');
    initSel('bw-auc-ephemera');
  }
  initSel('bw-auc-buyout');
  initSel('bw-auc-sort');
}

/* 语言切换时刷新 ac 输入框显示文字（不清空已选 slug） */
function refreshAcLabels() {
  ['bw-auc-weapon', 'bw-auc-pos1', 'bw-auc-pos2', 'bw-auc-pos3', 'bw-auc-neg'].forEach(function(id) {
    var input = document.getElementById(id);
    if (!input) return;
    var slug = input.dataset.slug;
    if (!slug) return;
    var allArrs = [_dictArr[_aType + '/weapons'] || [], _dictArr['riven/attributes'] || []];
    for (var i = 0; i < allArrs.length; i++) {
      var found = allArrs[i].find(function(it) { return it.slug === slug; });
      if (found) { input.value = acName(found); break; }
    }
  });
  // 刷新自定义 select（element/polarity）的选项文本
  if (document.getElementById('bw-auc-polarity-wrap')) {
    rebuildSelOpts('bw-auc-polarity',
      [{ value: '', label: '（不限）' }].concat(POLARITIES.map(function(p) { return { value: p.slug, label: L(p) }; })));
  }
  if (document.getElementById('bw-auc-element-wrap')) {
    rebuildSelOpts('bw-auc-element',
      [{ value: '', label: '（不限）' }].concat(ELEMENTS.map(function(e) { return { value: e.slug, label: L(e) }; })));
  }
}

/* ── 查询构建 ── */
function acVal(id) {
  var el = document.getElementById(id);
  return el ? (el.dataset.slug || '') : '';
}
function selVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

function _isRealRivenAttr(slug){
  return !!slug && slug!==RIVEN_POS_NONE && slug!==RIVEN_POS_ANY && slug!==RIVEN_NEG_NONE && slug!==RIVEN_NEG_ANY;
}
function buildQuery() {
  const p = new URLSearchParams();
  p.set('type', _aType);
  const weapon = acVal('bw-auc-weapon');
  if (weapon) p.set('weapon_url_name', weapon);
  const buyout = selVal('bw-auc-buyout');
  if (buyout) p.set('buyout_policy', buyout);
  p.set('sort_by', selVal('bw-auc-sort') || 'price_asc');
  if (_aType === 'riven') {
    const p1 = acVal('bw-auc-pos1'), p2 = acVal('bw-auc-pos2'), p3 = acVal('bw-auc-pos3');
    const pos = [p1,p2].filter(Boolean);
    if (_isRealRivenAttr(p3)) pos.push(p3);
    if (pos.length) p.set('positive_stats', pos.join(','));
    const neg = acVal('bw-auc-neg');
    if (_isRealRivenAttr(neg)) p.set('negative_stats', neg);
    const pol = selVal('bw-auc-polarity');
    if (pol) p.set('polarity', pol);
  } else {
    const el = selVal('bw-auc-element');
    if (el) p.set('element', el);
    const eph = selVal('bw-auc-ephemera');
    if (eph) p.set('having_ephemera', eph);
    // 伤害% 1-60 仅客户端二次筛选，不进 API（25-60 大区间直发易 500，且单 damage 参被忽略）
  }
  return p.toString();
}

/* 裂罅/赤毒二次精确过滤（不进 API，仅客户端） */
function _rivenPasses(a){
  var p3 = acVal('bw-auc-pos3'), neg = acVal('bw-auc-neg');
  var needPos = null, needNeg = null;
  if (p3 === RIVEN_POS_NONE) needPos = 2;
  else if (_isRealRivenAttr(p3)) needPos = 3;
  else if (p3 === RIVEN_POS_ANY) needPos = 3;
  if (neg === RIVEN_NEG_NONE) needNeg = 0;
  else if (neg === RIVEN_NEG_ANY) needNeg = 1;
  else if (_isRealRivenAttr(neg)) needNeg = 1;
  var attrs = (a.item && a.item.attributes) || [];
  var pc = 0, nc = 0;
  for (var i=0;i<attrs.length;i++) attrs[i].positive ? pc++ : nc++;
  if (needPos !== null && pc !== needPos) return false;
  if (needNeg !== null && nc !== needNeg) return false;
  if (_isRealRivenAttr(p3)){
    var havePos = {};
    for (var i=0;i<attrs.length;i++) if(attrs[i].positive) havePos[attrs[i].url_name]=1;
    if (!havePos[p3]) return false;
  }
  if (_isRealRivenAttr(neg)){
    var haveNeg = {};
    for (var i=0;i<attrs.length;i++) if(!attrs[i].positive) haveNeg[attrs[i].url_name]=1;
    if (!haveNeg[neg]) return false;
  }
  return true;
}
function _lichPasses(a){
  var elSel = selVal('bw-auc-element');
  if (elSel && a.item && a.item.element !== elSel) return false;
  var ephSel = selVal('bw-auc-ephemera');
  if (ephSel){
    var want = ephSel === 'true';
    if (!a.item || !!a.item.having_ephemera !== want) return false;
  }
  var dminEl = document.getElementById('bw-auc-dmg-min');
  var dmaxEl = document.getElementById('bw-auc-dmg-max');
  var dmin = dminEl ? parseInt(dminEl.value,10) : NaN;
  var dmax = dmaxEl ? parseInt(dmaxEl.value,10) : NaN;
  var dmg = a.item ? a.item.damage : null;
  if (!isNaN(dmin) && dmin>=25 && dmin<=60 && dmg!=null && dmg < dmin) return false;
  if (!isNaN(dmax) && dmax>=25 && dmax<=60 && dmg!=null && dmg > dmax) return false;
  return true;
}


/* ── 结果排序 ── */
function auctionPrice(a) { return a.buyout_price != null ? a.buyout_price : (a.starting_price || 0); }
function onlineRank(a) {
  const s = (a.owner && a.owner.status || '').toLowerCase();
  return s === 'ingame' ? 0 : s === 'online' ? 1 : 2;
}
function sortResults(list) {
  const arr = list.slice();
  if (_sortBy === 'price_asc')    arr.sort(function(a,b){ return auctionPrice(a) - auctionPrice(b); });
  if (_sortBy === 'price_desc')   arr.sort(function(a,b){ return auctionPrice(b) - auctionPrice(a); });
  if (_sortBy === 'damage_desc')  arr.sort(function(a,b){ return ((b.item&&b.item.damage)||0) - ((a.item&&a.item.damage)||0); });
  // 在线优先：在已有价格顺序基础上做稳定分组（用 Array.prototype.sort 稳定性保留原序）
  if (_onlineFirst) arr.sort(function(a,b){ return onlineRank(a) - onlineRank(b); });
  return arr;
}
function bindSortControl() {
  // 价格升序 / 降序：互斥单选
  document.querySelectorAll('.bw-auc-sort-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _sortBy = btn.dataset.sort;
      document.querySelectorAll('.bw-auc-sort-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.sort === _sortBy);
      });
      if (_lastResultList) {
        renderResults(sortResults(filterByOnline(_lastResultList)), 'bw-auc-result-list', 'bw-auc-result-n');
      }
    });
  });
  // 在线优先：独立 toggle
  const ofBtn = document.getElementById('bw-auc-online-first-btn');
  if (ofBtn) {
    ofBtn.addEventListener('click', function() {
      _onlineFirst = !_onlineFirst;
      ofBtn.classList.toggle('active', _onlineFirst);
      if (_lastResultList) {
        renderResults(sortResults(filterByOnline(_lastResultList)), 'bw-auc-result-list', 'bw-auc-result-n');
      }
    });
  }
}

/* ── 在线状态过滤（客户端筛选） ── */
function filterByOnline(list) {
  if (_onlineFilter === 'all') return list;
  return list.filter(function(a) {
    return ((a.owner && a.owner.status) || '').toLowerCase() === _onlineFilter;
  });
}

function bindOnlineFilter() {
  document.querySelectorAll('.bw-auc-online-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _onlineFilter = btn.dataset.ostatus;
      document.querySelectorAll('.bw-auc-online-pill').forEach(function(b) {
        b.classList.toggle('active', b.dataset.ostatus === _onlineFilter);
      });
      if (_lastResultList) {
        renderResults(sortResults(filterByOnline(_lastResultList)), 'bw-auc-result-list', 'bw-auc-result-n');
      }
    });
  });
}

/* ── 搜索 ── */
async function doSearch() {
  /* 实测确认：riven/lich/sister 三种类型的 weapon_url_name 都是必填项（不填直接
     400 requirements_not_met），并非此前认为的"仅 riven 必填" */
  if (!acVal('bw-auc-weapon')) {
    setStatus('请先选择武器'); return;
  }
  const btn = document.getElementById('bw-auc-search-btn');
  btn.disabled = true;
  _onlineFilter = 'all';
  document.querySelectorAll('.bw-auc-online-pill').forEach(function(b) {
    b.classList.toggle('active', b.dataset.ostatus === 'all');
  });
  setStatus('搜索中...');
  var _lastErr = null;
  var _success = false;
  for (var _attempt = 0; _attempt < 6; _attempt++) {
    try {
      if (_attempt > 0) setStatus('搜索中... (重试 ' + _attempt + '/5)');
      const j = await apiFetch('/auctions/search?' + buildQuery());
      const auctions = (j.payload && j.payload.auctions) || [];
      var list = auctions.filter(function(a) { return !a.closed && a.visible !== false; });
      if (_aType === 'riven') list = list.filter(_rivenPasses);
      else list = list.filter(_lichPasses);
      _lastResultList = list;
      renderResults(sortResults(filterByOnline(list)), 'bw-auc-result-list', 'bw-auc-result-n');
      renderRivenAvgBadge(_aType === 'riven' ? list : null);
      setStatus('');
      _success = true;
      break;
    } catch (e) {
      _lastErr = e;
      var _msg = (e && e.message) || '';
      var _isTransient = /429|502|503|504|500|network|timeout|failed to fetch|Load failed|ETIMEDOUT|ECONNRESET|Internal Server Error/i.test(_msg) || (e && e.status >= 500);
      if (!_isTransient || _attempt >= 5) break;
      await new Promise(function(r){ setTimeout(r, 900 * (_attempt + 1) + Math.random()*400); });
    }
  }
  if (!_success) {
    setStatus('搜索超时，可能需要重新刷新页面后再试。' + (_lastErr ? window.bwWmErrorText(_lastErr) : ''));
  }
  btn.disabled = false;
}

/* ── WTB 求购语句（永远英文） ── */
function weaponEnName(weaponSlug) {
  const d = _dicts[_aType + '/weapons'];
  const it = d && d[weaponSlug];
  return (it && it.i18n && it.i18n.en && it.i18n.en.name) || weaponSlug;
}
function wtbMessage(a) {
  const owner = (a.owner && a.owner.ingame_name) || '';
  const price = a.buyout_price || a.starting_price || 0;
  const wEn = weaponEnName(a.item && a.item.weapon_url_name);
  let what = _aType === 'riven' ? wEn + "'s Riven Mod"
           : _aType === 'lich'  ? wEn + ' Lich' : wEn + ' Sister';
  return '/w ' + owner + ' Hi! I WTB your ' + what + ' in ' + price + ' platinum.';
}

/* ── 卡片渲染 ── */
function attrChips(item) {
  const dict = _dicts['riven/attributes'] || {};
  return (item.attributes || []).map(function(at) {
    const name = i18nName(dict[at.url_name] || { slug: at.url_name });
    const sign = at.value > 0 ? '+' : '';
    return '<span class="bw-auc-chip ' + (at.positive ? 'pos' : 'neg') + '">'
      + _escHtml(name) + ' ' + sign + at.value + '</span>';
  }).join('');
}

function renderResults(list, listId, countId) {
  const countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = list.length;
  const box = document.getElementById(listId);
  if (!box) return;
  if (!list.length) {
    box.innerHTML = '<div class="bw-empty-state">'
      + '<img src="/picture/warframe-logo-blue-black.svg" class="bw-empty-state-icon" alt="">'
      + '<div class="bw-empty-state-title">暂无匹配的拍卖</div>'
      + '<div class="bw-empty-state-sub">尝试调整搜索条件或词条筛选</div>'
      + '</div>';
    return;
  }

  box.innerHTML = list.map(function(a, idx) {
    const item = a.item || {};
    const wname = i18nName((_dicts[_aType + '/weapons'] || {})[item.weapon_url_name] || { slug: item.weapon_url_name });
    const price = a.buyout_price != null ? a.buyout_price : (a.starting_price || 0);
    const isBuyout = a.buyout_price != null;
    const owner = a.owner || {};
    const st = (owner.status || '').toLowerCase();
    const stCls = st === 'ingame' ? 'ingame' : (st === 'online' ? 'online' : 'offline');
    const stTxt = st === 'ingame' ? '游戏中' : (st === 'online' ? '在线' : '离线');
    let meta = '';
    if (_aType === 'riven') {
      meta = '<div class="bw-auc-chips">' + attrChips(item)
        + (item.re_rolls != null    ? '<span class="bw-auc-chip">循环 ' + item.re_rolls + '</span>' : '')
        + (item.mastery_level != null ? '<span class="bw-auc-chip">MR ' + item.mastery_level + '</span>' : '')
        + '</div>';
    } else {
      const el = ELEMENTS.find(function(e) { return e.slug === item.element; });
      meta = '<div class="bw-auc-chips">'
        + (el ? '<span class="bw-auc-chip pos">' + L(el) + '</span>' : '')
        + (item.damage != null ? '<span class="bw-auc-chip">伤害 ' + item.damage + '%</span>' : '')
        + (item.having_ephemera ? '<span class="bw-auc-chip">幻纹</span>' : '')
        + '</div>';
    }
    const priceSuffix = isBuyout ? '<span>p · 一口价</span>' : '<span>p 起拍</span>';
    return '<div class="bw-auc-card">'
      + '<div class="bw-auc-card-main">'
      +   '<div class="bw-auc-card-title">' + _escHtml(wname) + '</div>' + meta
      + '</div>'
      + '<div class="bw-auc-card-side">'
      +   '<div class="bw-auc-owner"><span class="bw-auc-dot ' + stCls + '"></span>'
      +     _escHtml(owner.ingame_name || '') + ' · ' + stTxt + '</div>'
      +   '<div class="bw-auc-price bw-price-val">' + price + ' ' + priceSuffix + '</div>'
      +   '<button class="bw-auc-wtb" data-idx="' + idx + '">复制求购</button>'
      + '</div></div>';
  }).join('');

  box.querySelectorAll('.bw-auc-wtb').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const a = list[+btn.dataset.idx];
      try { navigator.clipboard && navigator.clipboard.writeText(wtbMessage(a)); } catch (e) {}
      const orig = btn.textContent;
      btn.textContent = '✓ 已复制'; btn.classList.add('is-copied');
      setTimeout(function() { btn.textContent = orig; btn.classList.remove('is-copied'); }, 1500);
    });
  });
}

/* ── 我的拍卖 管理 ── */
let _mineFilter = { keyword: '', vis: 'all' };
let _editTarget  = null; // auction being edited

function mineFilteredList() {
  if (!_lastMineList) return [];
  return _lastMineList.filter(function(a) {
    const wname = i18nName((_dicts[_aType + '/weapons'] || {})[a.item && a.item.weapon_url_name] || { slug: (a.item && a.item.weapon_url_name) || '' });
    const kw = _mineFilter.keyword.trim().toLowerCase();
    if (kw && wname.toLowerCase().indexOf(kw) === -1 && (a.item && a.item.weapon_url_name || '').indexOf(kw) === -1) return false;
    if (_mineFilter.vis === 'visible' && !a.visible) return false;
    if (_mineFilter.vis === 'hidden'  && a.visible)  return false;
    return true;
  });
}

function renderMineCard(a, idx) {
  const item  = a.item || {};
  const wname = i18nName((_dicts[_aType + '/weapons'] || {})[item.weapon_url_name] || { slug: item.weapon_url_name });
  const price = a.buyout_price != null ? a.buyout_price : (a.starting_price || 0);
  const isBuyout = a.buyout_price != null;
  const priceLbl = isBuyout ? '一口价' : '起拍';
  const visLbl   = a.visible ? '<span class="bw-auc-vis-badge vis">显示中</span>' : '<span class="bw-auc-vis-badge hid">已隐藏</span>';
  let meta = '';
  if (_aType === 'riven') {
    meta = '<div class="bw-auc-chips">' + attrChips(item)
      + (item.re_rolls != null    ? '<span class="bw-auc-chip">循环 ' + item.re_rolls + '</span>' : '')
      + (item.mastery_level != null ? '<span class="bw-auc-chip">MR ' + item.mastery_level + '</span>' : '')
      + '</div>';
  } else {
    const el = ELEMENTS.find(function(e) { return e.slug === item.element; });
    meta = '<div class="bw-auc-chips">'
      + (el ? '<span class="bw-auc-chip pos">' + L(el) + '</span>' : '')
      + (item.damage != null ? '<span class="bw-auc-chip">伤害 ' + item.damage + '%</span>' : '')
      + (item.having_ephemera ? '<span class="bw-auc-chip">幻纹</span>' : '')
      + '</div>';
  }
  return '<div class="bw-auc-card bw-auc-mine-card">'
    + '<div class="bw-auc-card-main">'
    +   '<div class="bw-auc-card-title">' + _escHtml(wname) + ' ' + visLbl + '</div>' + meta
    + '</div>'
    + '<div class="bw-auc-card-side">'
    +   '<div class="bw-auc-price">' + price + ' <span>p · ' + priceLbl + '</span></div>'
    +   '<div class="bw-auc-mine-btns">'
    +     '<button class="bw-auc-mgmt-btn bw-auc-edit-btn" data-midx="' + idx + '">改价</button>'
    +     '<button class="bw-auc-mgmt-btn bw-auc-close-btn" data-midx="' + idx + '">下架</button>'
    +   '</div>'
    + '</div></div>';
}

function renderMineList() {
  const box = document.getElementById('bw-auc-mine-list');
  const nEl = document.getElementById('bw-auc-mine-n');
  const panel = document.getElementById('bw-auc-mine-panel');
  const filtered = mineFilteredList();
  if (nEl) nEl.textContent = _lastMineList ? _lastMineList.length : 0;
  if (!box) return;
  if (!_lastMineList) { if (panel) panel.style.display = 'none'; return; }
  if (panel) panel.style.display = '';
  if (!filtered.length) { box.innerHTML = '<div class="bw-inv-empty">' + (_lastMineList.length ? '无匹配的拍卖' : '暂无拍卖订单') + '</div>'; return; }
  box.innerHTML = filtered.map(function(a, i) { return renderMineCard(a, i); }).join('');
  box.querySelectorAll('.bw-auc-edit-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openEditModal(filtered[+btn.dataset.midx]); });
  });
  box.querySelectorAll('.bw-auc-close-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { doClose(filtered[+btn.dataset.midx]); });
  });
}

function setMineStatus(msg, isErr) {
  const el = document.getElementById('bw-auc-manage-status');
  if (el) { el.textContent = msg || ''; el.style.color = isErr ? '#e8a4cf' : ''; }
}

/* 改价弹窗 */
/* 弹窗打开期间锁住 body 滚动：之前没锁，长表单(上架赤毒玄骸/姐妹时字段较多)配合鼠标滚轮
   容易把背景页面一起滚动，fixed 定位的弹窗仍钉在视口原位，但背景的备案区设置栏/底栏
   会跟着露出来，看起来像跟弹窗错位重叠——实际是背景在弹窗后面偷偷滚动了。 */
var _bodyScrollLockCount = 0;
function _lockBodyScroll(lock) {
  _bodyScrollLockCount += lock ? 1 : -1;
  if (_bodyScrollLockCount < 0) _bodyScrollLockCount = 0;
  document.body.style.overflow = _bodyScrollLockCount > 0 ? 'hidden' : '';
}

function openEditModal(a) {
  _editTarget = a;
  const isBuyout = a.buyout_price != null;
  const price = a.buyout_price != null ? a.buyout_price : (a.starting_price || 0);
  const item  = a.item || {};
  const wname = i18nName((_dicts[_aType + '/weapons'] || {})[item.weapon_url_name] || { slug: item.weapon_url_name });
  document.getElementById('bw-auc-edit-title').textContent = '改价 — ' + wname;
  document.getElementById('bw-auc-edit-price').value = price;
  document.querySelector('input[name="bw-auc-edit-type"][value="' + (isBuyout ? 'buyout' : 'starting') + '"]').checked = true;
  document.getElementById('bw-auc-edit-err').textContent = '';
  const modal = document.getElementById('bw-auc-edit-modal');
  modal.style.display = '';
  modal.removeAttribute('aria-hidden');
  _lockBodyScroll(true);
  document.getElementById('bw-auc-edit-price').focus();
}

function closeEditModal() {
  const modal = document.getElementById('bw-auc-edit-modal');
  if (modal.style.display === 'none') return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  _lockBodyScroll(false);
  _editTarget = null;
}

async function doEditPrice(a, price, isBuyout) {
  const body = isBuyout ? { buyout_price: price } : { starting_price: price };
  await apiFetch('/auctions/edit/' + a.id, { method: 'PUT', body: JSON.stringify(body) });
  if (isBuyout) { a.buyout_price = price; a.starting_price = null; }
  else          { a.starting_price = price; a.buyout_price = null; }
}

async function onEditOk() {
  if (!_editTarget) return;
  const price = parseInt(document.getElementById('bw-auc-edit-price').value, 10);
  if (!price || price < 1) { document.getElementById('bw-auc-edit-err').textContent = '请输入有效价格'; return; }
  const isBuyout = document.querySelector('input[name="bw-auc-edit-type"]:checked').value === 'buyout';
  const okBtn = document.getElementById('bw-auc-edit-ok');
  okBtn.disabled = true;
  document.getElementById('bw-auc-edit-err').textContent = '';
  try {
    await doEditPrice(_editTarget, price, isBuyout);
    closeEditModal();
    renderMineList();
    setMineStatus('改价成功');
    setTimeout(function() { setMineStatus(''); }, 2500);
  } catch (e) {
    document.getElementById('bw-auc-edit-err').textContent = '改价失败：' + window.bwWmErrorText(e);
  } finally { okBtn.disabled = false; }
}

/* 通用自定义确认框 */
function showConfirm(title, sub, onOk) {
  const overlay = document.getElementById('bw-auc-confirm');
  document.getElementById('bw-auc-confirm-title').textContent = title;
  document.getElementById('bw-auc-confirm-sub').textContent   = sub;
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

  const okBtn     = document.getElementById('bw-auc-confirm-ok');
  const cancelBtn = document.getElementById('bw-auc-confirm-cancel');
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  overlay.addEventListener('click', handleOverlay);
}

/* 下架 */
async function doClose(a) {
  const item  = a.item || {};
  const wname = i18nName((_dicts[_aType + '/weapons'] || {})[item.weapon_url_name] || { slug: item.weapon_url_name });
  showConfirm(
    '确认下架「' + wname + '」？',
    '此操作不可撤销，订单将永久关闭。',
    async function() {
      try {
        await apiFetch('/auctions/close/' + a.id, { method: 'PUT' });
        _lastMineList = _lastMineList.filter(function(x) { return x.id !== a.id; });
        renderMineList();
        setMineStatus('已下架');
        setTimeout(function() { setMineStatus(''); }, 2500);
      } catch (e) { setMineStatus('下架失败：' + window.bwWmErrorText(e), true); }
    }
  );
}

/* 批量改价
   限速：每次 API 调用之间等 400ms（≈2.5 req/s，WM 实测安全线）。
   失败重试：遇到 429/502/503/504 或网络错误最多重试 2 次，
   退避 1.5s / 3s；业务逻辑错误（4xx 非 429）直接计失败，不重试。 */
async function doBulkPrice() {
  const price = parseInt(document.getElementById('bw-auc-bulk-price').value, 10);
  if (!price || price < 1) { setMineStatus('请输入有效价格', true); return; }
  const list = mineFilteredList();
  if (!list.length) { setMineStatus('没有可改价的拍卖', true); return; }
  const btn = document.getElementById('bw-auc-bulk-btn');
  btn.disabled = true;
  setMineStatus('批量改价中（0/' + list.length + '）…');
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    let lastErr = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        await doEditPrice(list[i], price, true);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt >= 2) break;
        const isTransient = /429|502|503|504|network|timeout|failed to fetch/i.test(e.message || '');
        if (!isTransient) break;
        await sleep(1500 * (attempt + 1));
      }
    }
    if (lastErr) { fail++; } else { ok++; }
    setMineStatus('批量改价中（' + (ok + fail) + '/' + list.length + '）…');
    if (i < list.length - 1) await sleep(400);
  }
  btn.disabled = false;
  renderMineList();
  setMineStatus('批量改价完成：' + ok + ' 成功' + (fail ? '，' + fail + ' 失败' : ''));
  setTimeout(function() { setMineStatus(''); }, 3500);
}


/* 上架弹窗 */
function openCreateModal() {
  const title = document.getElementById('bw-auc-create-title');
  const wrap  = document.getElementById('bw-auc-create-form-wrap');
  const errEl = document.getElementById('bw-auc-create-err');
  title.textContent = '上架新' + (_aType === 'riven' ? '裂罅Mod' : _aType === 'lich' ? '赤毒玄骸' : '帕尔沃斯的姐妹');
  errEl.textContent = '';

  if (_aType === 'riven') {
    wrap.innerHTML = `
      <div class="bw-auc-form-grid">
        <div class="bw-auc-form-field">
          <label>武器名称 <span class="req">*</span></label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-weapon" autocomplete="off" placeholder="搜索武器…"><div class="bw-ac-drop" id="bw-cf-weapon-drop"></div></div>
        </div>
        <div class="bw-auc-form-field">
          <label>极性</label>
          <div class="bw-csel-wrap" id="bw-cf-polarity-wrap">
            <button class="bw-csel-trigger bw-auc-modal-csel" type="button">
              <span class="bw-csel-label" id="bw-cf-polarity-lbl">${L(POLARITIES[0])}</span>
              <svg class="bw-csel-arrow" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 5,5 9,1"/></svg>
            </button>
            <div class="bw-csel-drop">
              ${POLARITIES.map(function(p,i) { return '<div class="bw-csel-item' + (i===0?' active':'') + '" data-value="' + p.slug + '">' + L(p) + '</div>'; }).join('')}
            </div>
            <input type="hidden" id="bw-cf-polarity" value="${POLARITIES[0].slug}">
          </div>
        </div>
        <div class="bw-auc-form-field">
          <label>裂罅名称 <span class="req">*</span></label>
          <input class="bw-auc-modal-input" id="bw-cf-rivname" placeholder="如 Heraton">
        </div>
        <div class="bw-auc-form-field">
          <label>MR段位</label>
          <input type="number" min="0" max="30" class="bw-auc-modal-input" id="bw-cf-mr" value="0">
        </div>
        <div class="bw-auc-form-field">
          <label>Mod段位</label>
          <input type="number" min="0" max="16" class="bw-auc-modal-input" id="bw-cf-rank" value="8">
        </div>
        <div class="bw-auc-form-field">
          <label>循环次数</label>
          <input type="number" min="0" class="bw-auc-modal-input" id="bw-cf-rerolls" value="0">
        </div>
        <div class="bw-auc-form-field">
          <label>最低声望</label>
          <input type="number" min="0" class="bw-auc-modal-input" id="bw-cf-rep" value="0">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>正词条1 <span class="req">*</span></label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-pos1" autocomplete="off" placeholder="搜索词条…"><div class="bw-ac-drop" id="bw-cf-pos1-drop"></div></div>
          <input type="number" class="bw-auc-modal-input bw-cf-val" id="bw-cf-pos1-val" placeholder="数值">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>正词条2</label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-pos2" autocomplete="off" placeholder="搜索词条…"><div class="bw-ac-drop" id="bw-cf-pos2-drop"></div></div>
          <input type="number" class="bw-auc-modal-input bw-cf-val" id="bw-cf-pos2-val" placeholder="数值">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>正词条3</label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-pos3" autocomplete="off" placeholder="搜索词条…"><div class="bw-ac-drop" id="bw-cf-pos3-drop"></div></div>
          <input type="number" class="bw-auc-modal-input bw-cf-val" id="bw-cf-pos3-val" placeholder="数值">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>负词条</label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-neg" autocomplete="off" placeholder="搜索词条…"><div class="bw-ac-drop" id="bw-cf-neg-drop"></div></div>
          <input type="number" class="bw-auc-modal-input bw-cf-val" id="bw-cf-neg-val" placeholder="数值（正数，自动取负）">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>价格 <span class="req">*</span></label>
          <div class="bw-auc-modal-radios">
            <label><input type="radio" name="bw-cf-price-type" value="buyout" checked> 一口价</label>
            <label><input type="radio" name="bw-cf-price-type" value="starting"> 起拍价</label>
          </div>
          <input type="number" min="1" class="bw-auc-modal-input" id="bw-cf-price" placeholder="价格（白金）">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>备注</label>
          <input class="bw-auc-modal-input" id="bw-cf-note" placeholder="（可选）">
        </div>
      </div>`;
    initAc('bw-cf-weapon', function() { return _dictArr['riven/weapons'] || []; }, false);
    initAc('bw-cf-pos1', function() { return _dictArr['riven/attributes'] || []; }, false);
    initAc('bw-cf-pos2', function() { return _dictArr['riven/attributes'] || []; }, false);
    initAc('bw-cf-pos3', function() { return _dictArr['riven/attributes'] || []; }, false);
    initAc('bw-cf-neg',  function() { return _dictArr['riven/attributes'] || []; }, false);
    initSel('bw-cf-polarity');
  } else {
    wrap.innerHTML = `
      <div class="bw-auc-form-grid">
        <div class="bw-auc-form-field">
          <label>武器名称 <span class="req">*</span></label>
          <div class="bw-ac-wrap"><input class="bw-auc-modal-input" id="bw-cf-weapon" autocomplete="off" placeholder="搜索武器…"><div class="bw-ac-drop" id="bw-cf-weapon-drop"></div></div>
        </div>
        <div class="bw-auc-form-field">
          <label>元素</label>
          <div class="bw-csel-wrap" id="bw-cf-element-wrap">
            <button class="bw-csel-trigger bw-auc-modal-csel" type="button">
              <span class="bw-csel-label" id="bw-cf-element-lbl">${L(ELEMENTS[0])}</span>
              <svg class="bw-csel-arrow" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 5,5 9,1"/></svg>
            </button>
            <div class="bw-csel-drop">
              ${ELEMENTS.map(function(e,i) { return '<div class="bw-csel-item' + (i===0?' active':'') + '" data-value="' + e.slug + '">' + L(e) + '</div>'; }).join('')}
            </div>
            <input type="hidden" id="bw-cf-element" value="${ELEMENTS[0].slug}">
          </div>
        </div>
        <div class="bw-auc-form-field">
          <label>伤害%</label>
          <input type="number" min="25" max="60" class="bw-auc-modal-input" id="bw-cf-damage" value="25">
        </div>
        <div class="bw-auc-form-field">
          <label>幻纹</label>
          <div class="bw-csel-wrap" id="bw-cf-ephemera-wrap">
            <button class="bw-csel-trigger bw-auc-modal-csel" type="button">
              <span class="bw-csel-label" id="bw-cf-ephemera-lbl">无</span>
              <svg class="bw-csel-arrow" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 5,5 9,1"/></svg>
            </button>
            <div class="bw-csel-drop">
              <div class="bw-csel-item active" data-value="">无</div>
              <div class="bw-csel-item" data-value="true">有</div>
            </div>
            <input type="hidden" id="bw-cf-ephemera" value="">
          </div>
        </div>
        <div class="bw-auc-form-field">
          <label>怪癖（可选）</label>
          <input class="bw-auc-modal-input" id="bw-cf-quirk" placeholder="如 loner">
        </div>
        <div class="bw-auc-form-field">
          <label>最低声望</label>
          <input type="number" min="0" class="bw-auc-modal-input" id="bw-cf-rep" value="0">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>价格 <span class="req">*</span></label>
          <div class="bw-auc-modal-radios">
            <label><input type="radio" name="bw-cf-price-type" value="buyout" checked> 一口价</label>
            <label><input type="radio" name="bw-cf-price-type" value="starting"> 起拍价</label>
          </div>
          <input type="number" min="1" class="bw-auc-modal-input" id="bw-cf-price" placeholder="价格（白金）">
        </div>
        <div class="bw-auc-form-field bw-auc-form-wide">
          <label>备注</label>
          <input class="bw-auc-modal-input" id="bw-cf-note" placeholder="（可选）">
        </div>
      </div>`;
    initAc('bw-cf-weapon', function() { return _dictArr[_aType + '/weapons'] || []; }, false);
    initSel('bw-cf-element');
    initSel('bw-cf-ephemera');
  }

  const modal = document.getElementById('bw-auc-create-modal');
  modal.style.display = '';
  modal.removeAttribute('aria-hidden');
  _lockBodyScroll(true);
}

function closeCreateModal() {
  const modal = document.getElementById('bw-auc-create-modal');
  if (modal.style.display === 'none') return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  _lockBodyScroll(false);
}

function cfVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function cfSlug(id) { const el = document.getElementById(id); return (el && el.dataset.slug) || ''; }
function cfNum(id, def) { const v = parseFloat(cfVal(id)); return isNaN(v) ? (def || 0) : v; }

async function onCreateOk() {
  const errEl = document.getElementById('bw-auc-create-err');
  errEl.textContent = '';
  const weaponSlug = cfSlug('bw-cf-weapon');
  if (!weaponSlug) { errEl.textContent = '请选择武器'; return; }
  const priceVal = cfNum('bw-cf-price');
  if (!priceVal || priceVal < 1) { errEl.textContent = '请输入有效价格'; return; }
  const priceType = (document.querySelector('input[name="bw-cf-price-type"]:checked') || {}).value || 'buyout';
  const isBuyout = priceType === 'buyout';

  let item;
  if (_aType === 'riven') {
    const rivName = (document.getElementById('bw-cf-rivname') || {}).value || '';
    if (!rivName.trim()) { errEl.textContent = '请填写裂罅名称'; return; }
    const pos1Slug = cfSlug('bw-cf-pos1');
    if (!pos1Slug) { errEl.textContent = '请至少填写正词条1'; return; }
    const attrs = [];
    const attrDict = _dicts['riven/attributes'] || {};
    [['bw-cf-pos1','bw-cf-pos1-val',true],['bw-cf-pos2','bw-cf-pos2-val',true],
     ['bw-cf-pos3','bw-cf-pos3-val',true],['bw-cf-neg','bw-cf-neg-val',false]].forEach(function(row) {
      const slug = cfSlug(row[0]);
      if (!slug) return;
      const v = cfNum(row[1]);
      /* 实测确认：极少数词条（如"后坐力"）在字典里带 positiveIsNegative 标记——
         作为正词条时数值本身必须是负数（如 -35% 后坐力才是好词条），其余词条按常规规则 */
      const inverted = !!(attrDict[slug] && attrDict[slug].positiveIsNegative);
      const wantNegative = row[2] ? inverted : !inverted;
      attrs.push({ url_name: slug, value: wantNegative ? -Math.abs(v) : Math.abs(v), positive: row[2] });
    });
    item = {
      type: 'riven',
      weapon_url_name: weaponSlug,
      name: rivName.trim(),
      attributes: attrs,
      polarity: cfVal('bw-cf-polarity') || 'naramon',
      mastery_level: cfNum('bw-cf-mr'),
      mod_rank: cfNum('bw-cf-rank', 8),
      re_rolls: cfNum('bw-cf-rerolls'),
    };
  } else {
    const quirk = (document.getElementById('bw-cf-quirk') || {}).value || '';
    item = {
      type: _aType,
      weapon_url_name: weaponSlug,
      element: cfVal('bw-cf-element') || ELEMENTS[0].slug,
      damage: cfNum('bw-cf-damage', 25),
      having_ephemera: cfVal('bw-cf-ephemera') === 'true',
    };
    if (quirk.trim()) item.quirk = quirk.trim();
  }

  /* 实测确认：官方 API 无论一口价还是竞价模式都要求 starting_price 存在——
     一口价(is_direct_sell)时 starting_price 必须与 buyout_price 相等一起提交，
     不能像之前那样只发 buyout_price 单独一个字段，否则 400 "starting_price
     field_required"。竞价模式则只发 starting_price，不带 buyout_price。 */
  const payload = {
    item,
    ...(isBuyout ? { starting_price: priceVal, buyout_price: priceVal } : { starting_price: priceVal }),
    minimal_reputation: cfNum('bw-cf-rep'),
    note: cfVal('bw-cf-note'),
    visible: true,
  };

  const okBtn = document.getElementById('bw-auc-create-ok');
  okBtn.disabled = true;
  try {
    await apiFetch('/auctions/create', { method: 'POST', body: JSON.stringify(payload) });
    closeCreateModal();
    setMineStatus('上架成功，刷新中…');
    await loadMine();
    setMineStatus('上架成功');
    setTimeout(function() { setMineStatus(''); }, 2500);
  } catch (e) {
    /* WM 上架接口透传的错误信封是 raw JSON，过翻译函数再展示 */
    errEl.textContent = '上架失败：' + window.bwWmErrorText(e);
  } finally { okBtn.disabled = false; }
}

function bindMineManage() {
  document.getElementById('bw-auc-mine-kw').addEventListener('input', function(e) {
    _mineFilter.keyword = e.target.value;
    renderMineList();
  });
  document.querySelectorAll('.bw-auc-mine-vis').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _mineFilter.vis = btn.dataset.mvis;
      document.querySelectorAll('.bw-auc-mine-vis').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mvis === _mineFilter.vis);
      });
      renderMineList();
    });
  });
  document.getElementById('bw-auc-bulk-btn').addEventListener('click', doBulkPrice);
  document.getElementById('bw-auc-create-btn').addEventListener('click', function() {
    /* 居中提醒弹窗（高斯模糊遮罩）—— 替代 bwToast，5 主题自适应 */
    var old = document.getElementById('bw-auc-notice-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'bw-auc-notice-overlay';
    overlay.className = 'bw-notice-overlay';
    overlay.innerHTML =
      '<div class="bw-notice-box">' +
        '<span class="bw-c bw-c-tl"></span><span class="bw-c bw-c-tr"></span>' +
        '<span class="bw-c bw-c-bl"></span><span class="bw-c bw-c-br"></span>' +
        '<div class="bw-notice-icon">⚠</div>' +
        '<div class="bw-notice-title">上架功能暂不可用</div>' +
        '<div class="bw-notice-msg">由于 WM 推出了新限制，上架拍卖功能暂不可用，仅能在此处管理已经上架好的拍卖订单。<br>您还可以使用 <b>AlecaFrame</b> 一键上架当前的紫卡。</div>' +
        '<button class="bw-notice-close" type="button">我知道了</button>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { requestAnimationFrame(function() { overlay.classList.add('show'); }); });
    function dismiss() {
      overlay.classList.remove('show');
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 320);
    }
    overlay.querySelector('.bw-notice-close').addEventListener('click', dismiss);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onEsc); }
    });
  });
  document.getElementById('bw-auc-edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('bw-auc-edit-ok').addEventListener('click', onEditOk);
  document.getElementById('bw-auc-create-cancel').addEventListener('click', closeCreateModal);
  document.getElementById('bw-auc-create-close')?.addEventListener('click', closeCreateModal);
  document.getElementById('bw-auc-create-ok').addEventListener('click', onCreateOk);
  document.getElementById('bw-auc-edit-modal').addEventListener('click', function(e) {
    if (e.target === this) closeEditModal();
  });
  /* "上架新拍卖"表单字段多，误点空白背景太容易连带关闭丢内容——改成只能点
     "取消"/"确认上架"按钮关闭，遮罩点击和 Esc 都不再触发关闭。 */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeEditModal(); }
  });
}

async function loadMine() {
  _mineFilter = { keyword: '', vis: 'all' };
  document.querySelectorAll('.bw-auc-mine-vis').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mvis === 'all');
  });
  const kw = document.getElementById('bw-auc-mine-kw');
  if (kw) kw.value = '';
  const box = document.getElementById('bw-auc-mine-list');
  if (box) box.innerHTML = '<div class="bw-inv-empty">加载中…</div>';
  let lastErr = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const j = await apiFetch('/auctions/mine');
      const all = (j.payload && j.payload.auctions) || [];
      const mine = all.filter(function(a) { return a.item && a.item.type === _aType && !a.closed; });
      _lastMineList = mine;
      renderMineList();
      return;
    } catch (e) {
      lastErr = e;
      const isTransient = /429|502|503|504|network|timeout|failed to fetch/i.test(e.message || '');
      if (!isTransient || attempt >= 2) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  _lastMineList = null;
  /* 我的拍卖加载失败：WM 信封翻译成人话再渲染，避免 raw JSON 占满列表区 */
  if (box) box.innerHTML = '<div class="bw-inv-empty">加载失败：' + _escHtml(window.bwWmErrorText(lastErr)) + '</div>';
}

function switchMode(mode) {
  _mode = mode;
  document.querySelectorAll('.bw-auc-mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const searchZone    = document.getElementById('bw-auc-search-zone');
  const manageZone    = document.getElementById('bw-auc-manage-zone');
  const resultSection = document.getElementById('bw-auc-result-section');
  const minePanel     = document.getElementById('bw-auc-mine-panel');
  if (mode === 'search') {
    if (searchZone)    searchZone.style.display    = '';
    if (manageZone)    manageZone.style.display    = 'none';
    if (resultSection) resultSection.style.display = '';
    if (minePanel)     minePanel.style.display     = 'none';
  } else {
    if (searchZone)    searchZone.style.display    = 'none';
    if (manageZone)    manageZone.style.display    = '';
    if (resultSection) resultSection.style.display = 'none';
    if (minePanel)     minePanel.style.display     = '';
    loadMine();
  }
}

/* ── 类型切换 ── */
async function switchType(t) {
  _aType = t; _lastResultList = null; _lastMineList = null; _onlineFilter = 'all';
  renderRivenAvgBadge(null);
  document.querySelectorAll('.bw-auc-tabs .bw-type-pill').forEach(function(b) {
    b.classList.toggle('active', b.dataset.atype === t);
  });
  document.querySelectorAll('.bw-auc-online-pill').forEach(function(b) {
    b.classList.toggle('active', b.dataset.ostatus === 'all');
  });
  const damBtn = document.querySelector('.bw-auc-sort-damage');
  if (damBtn) {
    damBtn.style.display = t === 'riven' ? 'none' : '';
    if (t === 'riven' && _sortBy === 'damage_desc') {
      _sortBy = 'price_asc';
      document.querySelectorAll('.bw-auc-sort-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.sort === _sortBy);
      });
    }
  }
  setStatus('加载字典…');
  try {
    await loadDict(_aType + '/weapons');
    if (_aType === 'riven') await loadDict('riven/attributes');
    setStatus('');
  } catch (e) { setStatus('字典加载失败：' + window.bwWmErrorText(e)); }
  renderFilters();
  const resultList = document.getElementById('bw-auc-result-list');
  if (resultList) resultList.innerHTML = '<div class="bw-inv-empty">选择条件后点「搜索拍卖」</div>';
  const resultN = document.getElementById('bw-auc-result-n');
  if (resultN) resultN.textContent = '0';
  if (_mode === 'manage') loadMine();
}


/* ── 主入口 ── */
async function main() {
  const sess = await requireAuth();
  if (!sess) return;
  bindLogout();

  document.querySelectorAll('.bw-auc-tabs .bw-type-pill').forEach(function(b) {
    b.addEventListener('click', function() { if (b.dataset.atype !== _aType) switchType(b.dataset.atype); });
  });

  const langBtn = document.getElementById('bw-auc-lang-btn');
  langBtn.addEventListener('click', function() {
    _aLang = _aLang === 'zh' ? 'en' : 'zh';
    langBtn.classList.toggle('is-en', _aLang === 'en');
    document.getElementById('bw-auc-lang-zh').classList.toggle('active', _aLang === 'zh');
    document.getElementById('bw-auc-lang-en').classList.toggle('active', _aLang === 'en');
    refreshAcLabels();
    if (_lastResultList) renderResults(sortResults(filterByOnline(_lastResultList)), 'bw-auc-result-list', 'bw-auc-result-n');
    if (_lastMineList && _lastMineList.length) renderMineList();
  });

  document.querySelectorAll('.bw-auc-mode-btn').forEach(function(b) {
    b.addEventListener('click', function() { if (b.dataset.mode !== _mode) switchMode(b.dataset.mode); });
  });

  document.getElementById('bw-auc-search-btn').addEventListener('click', doSearch);
  document.getElementById('bw-auc-mine-refresh').addEventListener('click', function() { loadMine(); });
  bindSortControl();
  bindOnlineFilter();
  bindMineManage();
  await switchType('riven');
}

document.addEventListener('click', function() {
  document.querySelectorAll('.bw-csel-wrap.is-open').forEach(function(w) {
    w.classList.remove('is-open');
    var d = w._bwSelDrop || w.querySelector('.bw-csel-drop');
    if (d) { d.style.transform = ''; d.style.opacity = ''; d.style.pointerEvents = ''; }
  });
});

document.addEventListener('DOMContentLoaded', main);
