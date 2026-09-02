/* ═══════════════════════════════════════════════════════════
   main.js —— CSC·Alliance：Public WM（index.html 专用逻辑）
   依赖 js/shared.js 先加载：API、apiFetch、checkSession、
   showLogin、ago、sleep、_escHtml、星空/故障背景特效、批量操作引擎
   （runBatch/showBatchFail/hideBatchFail/retryBatchFailures）均在那边。
   ═══════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────
   状态
─────────────────────────────────────────────────────────── */
let _session   = null;
let _orders    = [];
let _items     = [];
let _lang      = 'zh';
let _typeF     = 'all';
let _visF      = 'all';
let _filterSpecial = false;
let _filterExtra   = false;
let _filterAlert   = false;
let _batchType     = 'all';   // 批量操作类型：all / sell / buy
let _sort      = 'updated_desc';
let _priceMin  = 0;
let _priceMax  = Infinity;
let _searchQ   = '';
let _mult      = 1;
let _avgCache  = {};

/* 滚动增量渲染（虚拟列表务实实现）：只渲染前 N 条订单，滚近底部时追加一批，
   DOM 节点从几千降到数百，3000+ 订单不再卡顿。筛选/排序/搜索变化时自动重置。 */
let _visibleCount = 120;
const LIST_BATCH   = 120;
let _lastRenderKey = '';
let _atBottom = false; // 到底时窗口化渲最后N条，一键到底不堆68k
function _renderKey() {
  return [_typeF, _visF, _searchQ, _sort, _priceMin, _priceMax,
          _filterSpecial, _filterExtra, _filterAlert, _orders.length].join('|');
}

/* 物品类型特殊标记（与 quant.js _EXTRA_TAGS 保持一致） */
const _EXTRA_TAGS = {
  ayatan_sculpture: true, fish: true, arcane_enhancement: true, gem: true,
  axi: true, lith: true, meso: true, neo: true, veiled_riven: true, requiem: true,
};
function _isExtraOrder(o) {
  const tags = _itemTagIndex()[o._slug] || [];
  return tags.some(function(t) { return _EXTRA_TAGS[t]; });
}
/* 批量改价"向上取整"：'none' 不取整、'5'/'10' 向上取整到 5/10 的倍数（32 → 35 / 40）。
   全站共用一个 localStorage key，index.html 和 quant.html 的批量上架共享同一份偏好，
   不用每个页面各自重设一遍。 */
let _priceRoundMode = localStorage.getItem('bw_price_round_mode') || 'none';
function _roundPrice(p, mode) {
  mode = mode || _priceRoundMode;
  if (mode === '5')  return Math.ceil(p / 5) * 5;
  if (mode === '10') return Math.ceil(p / 10) * 10;
  return Math.round(p);
}
let _openRow   = null;
let _openEdit  = null;
let _activeTypeTags = new Set(); // 径向菜单已提交的类型筛选（tag 或 _RADIAL_OTHER_KEY）

/* 在线状态维持 */
let _wmStatus      = 'offline';   // 当前实际状态
let _maintainOn    = false;       // 是否正在维持
let _maintainDurMs = 60 * 60 * 1000; // 维持时长（ms），默认1h
let _maintainEnd   = 0;           // 维持到期时间戳
let _countdownTimer = null;       // setInterval handle（每秒更新倒计时）

/* ──────────────────────────────────────────────────────────
   工具（页面专属；通用工具见 shared.js）
─────────────────────────────────────────────────────────── */
function itemName(o) {
  if (_lang === 'zh') return o._zh || o._name || o._slug || '';
  return o._name || o.item?.en || o.item?.en_name || o.item?.name || o._slug || '';
}

/* ──────────────────────────────────────────────────────────
   加载物品总表（经 jsDelivr 读取本仓库 data/wm-items.json 产物，带 raw 回退；
   不再调用边缘函数，避免边缘函数拉取大体积物品表）
─────────────────────────────────────────────────────────── */
const WM_ITEMS_CDN = 'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/wm-items.json';
const WM_ITEMS_RAW = 'https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/wm-items.json';
/* 物品表浏览器强缓存 10分钟强制覆盖：PWM_KV 单key整包，Public 同 Private 三层 */
const _ITEMS_LS_KEY = 'bw_items_cache_json';
const _ITEMS_LS_TS  = 'bw_items_ts';
let _itemsPollTimer = null;
function _itemsLoadFromCache() {
  try {
    var raw = localStorage.getItem(_ITEMS_LS_KEY);
    var ts = parseInt(localStorage.getItem(_ITEMS_LS_TS) || '0', 10);
    if (!raw || !ts) return false;
    if (Date.now() - ts > 30*24*3600*1000) return false;
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return false;
    _items = arr;
    _radialItemTagIndex = null;
    return true;
  } catch(e) { try{ localStorage.removeItem(_ITEMS_LS_KEY); }catch(_){} return false; }
}
function _itemsSaveToCache(arr) {
  var run=function(){
    try {
      var s = JSON.stringify(arr);
      localStorage.setItem(_ITEMS_LS_KEY, s);
      localStorage.setItem(_ITEMS_LS_TS, String(Date.now()));
    } catch(e) { try{ localStorage.removeItem(_ITEMS_LS_KEY); localStorage.setItem(_ITEMS_LS_KEY, JSON.stringify(arr)); localStorage.setItem(_ITEMS_LS_TS, String(Date.now())); }catch(_){} }
  };
  if(typeof requestIdleCallback==='function') requestIdleCallback(run,{timeout:2000}); else setTimeout(run,0);
}
async function _itemsFetchOnce() {
  var ok=false;
  await createReliableLoader(
    ['/api/kv?key=wm_items_json', WM_ITEMS_CDN, WM_ITEMS_RAW, '/data/wm-items.json'],
    function(j){
      var arr = j && j.data ? j.data : j;
      if (!Array.isArray(arr) || !arr.length) return false;
      _items = arr;
      _radialItemTagIndex = null;
      _itemsSaveToCache(arr);
      ok=true;
      if (_orders && _orders.length) { try{ render(); }catch(_){} }
      return true;
    },
    { retryDelay: 2500, fetchTimeout: 7000 }
  ).promise;
  return ok;
}
async function loadItems() {
  var hadCache = _itemsLoadFromCache();
  if (hadCache) {
    setTimeout(function(){ _itemsFetchOnce(); }, 800);
  } else {
    while (true) {
      if (await _itemsFetchOnce()) break;
      const hidden = typeof document !== 'undefined' && document.hidden;
      await sleep(hidden ? 30000 : 2500);
    }
  }
  _radialItemTagIndex = null;
  if (_itemsPollTimer) clearInterval(_itemsPollTimer);
  _itemsPollTimer = setInterval(function(){ if(!document.hidden) _itemsFetchOnce(); }, 10*60*1000);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden){ try{ var ts=parseInt(localStorage.getItem(_ITEMS_LS_TS)||'0',10); if(Date.now()-ts>10*60*1000) _itemsFetchOnce(); }catch(_){} } });
}

/* ──────────────────────────────────────────────────────────
   刷新订单状态（重新拉取物品缓存含中文名 → 重新加载订单 → 重渲染）
   供按钮点击、以及首次进入/登录后自动触发共用同一套逻辑与视觉反馈
─────────────────────────────────────────────────────────── */
async function refreshItemsAndRerender(btn, alertOnError) {
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
  try {
    await loadItems();
    if (_orders.length) { try { await loadOrders(); } catch {} }
    render();
    if (btn) { btn.textContent = '✓ 刷新完成'; }
  } catch (e) {
    if (btn) { btn.textContent = originalText; }
    /* WM 透传错误信封是 raw JSON，过翻译函数再弹 toast */
    if (alertOnError) bwToast('刷新失败：' + window.bwWmErrorText(e), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      setTimeout(function() { btn.textContent = originalText; }, 1600);
    }
  }
}

/* ──────────────────────────────────────────────────────────
   加载订单
─────────────────────────────────────────────────────────── */
async function loadOrders() {
  while (true) {
    try {
      const j = await apiFetch('/orders');
      const raw = Array.isArray(j.data) ? j.data : [];
      // 3000单 O(N*M) find 会卡死，建 Map O(N) — 严格复刻原 find 语义 (url_name||slug||id)
      const _itemMap = new Map();
      for (var _mi=0; _mi<_items.length; _mi++) { var _it=_items[_mi]; var _k=_it.url_name||_it.slug||_it.id; if(_k) _itemMap.set(_k,_it); }
      _orders = raw.map(function(o) {
        const slug = o.item?.url_name || o.slug || o.item?.id || '';
        const itemObj = slug ? (_itemMap.get(slug) || null) : null;
        /* v2 API 用 camelCase，统一别名到 snake_case 供渲染层使用 */
        return Object.assign({}, o, {
          order_type:  o.order_type  || o.orderType  || o.type || 'sell',
          last_update: o.last_update || o.lastUpdate  || o.updatedAt || '',
          creation_date: o.creation_date || o.creationDate || o.createdAt || '',
          /* WM v2 订单字段实测为 rank / perTrade（非 mod_rank / quantity_in_set），做了实测校验，此处按官方字段名兜底 */
          mod_rank:    o.rank !== undefined ? o.rank : (o.mod_rank !== undefined ? o.mod_rank : (o.modRank !== undefined ? o.modRank : undefined)),
          quantity_in_set: o.perTrade || o.quantity_in_set || o.quantityInSet || undefined,
          _slug:  slug,
          _name:  itemObj?.en || o.item?.en || o.item?.en_name || o.item?.name || slug,
          _zh:    itemObj?.zh || o.item?.zh || '',
          _tags:  itemObj?.tags || [],
        });
      });
      return;
    } catch (e) {
      /* 会话过期等确定性错误不重试（页面会自动跳登录） */
      if (e && e.message && e.message.indexOf('会话已过期') !== -1) throw e;
      const hidden = typeof document !== 'undefined' && document.hidden;
      await sleep(hidden ? 30000 : 2500);
    }
  }
}

/* ──────────────────────────────────────────────────────────
   预加载全量均价（启动时经 jsDelivr 读取本仓库 static data 产物）
   jsDelivr 回源 GitHub 免费 CDN、带 Access-Control-Allow-Origin:*，
   浏览器同源直取，不占用 Worker 流量。产物由本仓库
   .github/workflows/refresh-avg-prices.yml 每小时刷新提交。
   新仓库刚创建时 jsDelivr 索引有延迟，自动回退 raw.githubusercontent。
─────────────────────────────────────────────────────────── */
const AVG_PRICES_CDN = 'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/avg_prices_full.json';
const AVG_PRICES_RAW = 'https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/avg_prices_full.json';
/* 均价长缓存 + 10分钟后台覆盖：内存 _avgCache → localStorage 30天 → KV/cdn/raw */
const _AVG_LS_KEY = 'bw_avg_cache_json';
const _AVG_LS_TS  = 'bw_avg_ts';
let _avgPollTimer = null;
function _avgLoadFromCache() {
  try {
    var raw = localStorage.getItem(_AVG_LS_KEY);
    var ts = parseInt(localStorage.getItem(_AVG_LS_TS) || '0', 10);
    if (!raw || !ts) return false;
    if (Date.now() - ts > 30*24*3600*1000) return false;
    var j = JSON.parse(raw);
    if (j && j.ct) return false;
    if (!j || typeof j !== 'object' || !Object.keys(j).length) return false;
    Object.assign(_avgCache, j);
    return true;
  } catch(e) { try{ localStorage.removeItem(_AVG_LS_KEY); }catch(_){} return false; }
}
function _avgSaveToCache(data) {
  var run = function(){
    try {
      var s = JSON.stringify(data);
      localStorage.setItem(_AVG_LS_KEY, s);
      localStorage.setItem(_AVG_LS_TS, String(Date.now()));
    } catch(e) {
      try { localStorage.removeItem(_AVG_LS_KEY); localStorage.setItem(_AVG_LS_KEY, JSON.stringify(data)); localStorage.setItem(_AVG_LS_TS, String(Date.now())); } catch(_){}
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, {timeout:2000}); else setTimeout(run, 0);
}
function _avgApplyAndRender(data, fromCache) {
  if (data && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) data = data.data;
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return false;
  if (data.ct) return false;
  var changed=false;
  var keys=Object.keys(data);
  for(var i=0;i<keys.length;i++){ var k=keys[i]; if(_avgCache[k]!==data[k]){ _avgCache[k]=data[k]; changed=true; } }
  if (changed || !fromCache) {
    _avgSaveToCache(_avgCache);
    if (_orders && _orders.length) setTimeout(function(){ try{ loadMissingAvg(filtered()); updateAlertBadges(); }catch(_){} }, 0);
  }
  return true;
}
async function _avgFetchOnce() {
  var ok = false;
  await createReliableLoader(
    ['/api/kv?key=avg_prices_full_json', AVG_PRICES_CDN, AVG_PRICES_RAW, '/data/avg_prices_full.json'],
    function(data){ var r=_avgApplyAndRender(data,false); if(r) ok=true; return r; },
    { retryDelay: 2500, fetchTimeout: 7000 }
  ).promise;
  return ok;
}
async function preloadAvgPrices() {
  var hadCache = _avgLoadFromCache();
  if (hadCache) {
    setTimeout(function(){ _avgFetchOnce(); }, 500);
  } else {
    await _avgFetchOnce();
  }
  if (_avgPollTimer) clearInterval(_avgPollTimer);
  _avgPollTimer = setInterval(function(){
    if (document.hidden) return;
    _avgFetchOnce();
  }, 10*60*1000);
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) {
      try{ var ts=parseInt(localStorage.getItem(_AVG_LS_TS)||'0',10); if(Date.now()-ts>10*60*1000) _avgFetchOnce(); }catch(_){}
    }
  });
}

/* ──────────────────────────────────────────────────────────
   均价获取（队列限速，用于静态文件未覆盖的物品）
─────────────────────────────────────────────────────────── */
const _avgQueue = [];
let _avgRunning = false;

async function _drainAvgQueue() {
  if (_avgRunning) return;
  _avgRunning = true;
  while (_avgQueue.length > 0) {
    const task = _avgQueue.shift();
    if (_avgCache[task.slug]) { task.resolve(_avgCache[task.slug]); continue; }
    try {
      const j = await apiFetch('/price/' + encodeURIComponent(task.slug));
      if (j.data) { _avgCache[task.slug] = j.data; task.resolve(j.data); }
      else task.resolve(null);
    } catch { task.resolve(null); }
    await sleep(80);
  }
  _avgRunning = false;
}

function fetchAvg(slug) {
  if (_avgCache[slug]) return Promise.resolve(_avgCache[slug]);
  return new Promise(function(resolve) {
    _avgQueue.push({ slug, resolve });
    _drainAvgQueue();
  });
}

/* ──────────────────────────────────────────────────────────
   个人资料卡
─────────────────────────────────────────────────────────── */
const STATUS_LABELS = { online: '在线', ingame: '游戏中', invisible: '隐身', offline: '离线' };
const STATUS_DOT_CLS = { online: 'online', ingame: 'ingame', invisible: 'invisible', offline: 'offline' };

function renderProfile(sess) {
  const card = document.getElementById('bw-profile-card');
  if (!card) return;
  const slug = sess.slug || sess.ingame_name || '—';
  card.innerHTML = `
<img class="bw-avatar" id="bw-avatar-img" src="/picture/csc-logo.png" alt="avatar">
<div class="bw-profile-info">
  <div class="bw-ign">${slug}</div>
  <div class="bw-meta">
    <span><span class="bw-status-dot offline" id="bw-sdot"></span><span id="bw-stxt">获取中…</span></span>
    <span>订单：<span id="bw-total-count">…</span></span>
  </div>
  <div class="bw-status-ctrl" id="bw-status-ctrl">
    <div class="bw-status-row">
      <span class="bw-status-label">状态</span>
      <button class="bw-status-btn" data-s="online">在线</button>
      <button class="bw-status-btn" data-s="ingame">游戏中</button>
      <button class="bw-status-btn" data-s="invisible">隐身</button>
    </div>
    <div class="bw-status-row">
      <span class="bw-status-label">并保持</span>
      <button class="bw-dur-btn" data-d="1800000">30分</button>
      <button class="bw-dur-btn active" data-d="3600000">1时</button>
      <button class="bw-dur-btn" data-d="7200000">2时</button>
      <button class="bw-dur-btn" data-d="14400000">4时</button>
      <button class="bw-maintain-toggle" id="bw-maintain-btn">开始维持</button>
      <span class="bw-status-timer" id="bw-status-timer"></span>
    </div>
  </div>
</div>
<div class="bw-profile-panel" id="bw-profile-panel">
  <span class="bw-panel-corner-tl"></span>
  <div class="bw-panel-grid">
    <div class="bw-panel-stat">
      <span class="bw-panel-label">出售订单</span>
      <span class="bw-panel-val sell" id="bw-panel-sell">—</span>
    </div>
    <div class="bw-panel-stat">
      <span class="bw-panel-label">求购订单</span>
      <span class="bw-panel-val buy" id="bw-panel-buy">—</span>
    </div>
    <div class="bw-panel-stat">
      <span class="bw-panel-label">平均利润</span>
      <span class="bw-panel-val" id="bw-panel-coverage">—</span>
    </div>
    <div class="bw-panel-stat">
      <span class="bw-panel-label">价格警报</span>
      <span class="bw-panel-val warn" id="bw-panel-alerts">—</span>
    </div>
    <div class="bw-panel-ticker">
      <span class="bw-panel-ticker-dot"></span>
      <span class="bw-panel-ticker-text" id="bw-panel-ticker">正在同步数据…</span>
    </div>
  </div>
</div>`;
  initStatusCtrl();
}

/* ── 初始化状态控制模块 ──────────────────────────────────── */
async function initStatusCtrl() {
  // 从 localStorage 恢复上次维持状态（跨页导航保持）
  const saved = statusPersistGet();
  if (saved.status) setStatusDisplay(saved.status);
  if (saved.maintainEnd > Date.now()) {
    _maintainOn  = true;
    _maintainEnd = saved.maintainEnd;
    _maintainDurMs = saved.maintainEnd - Date.now(); // 剩余时长
    const btn = document.getElementById('bw-maintain-btn');
    if (btn) { btn.textContent = '停止维持'; btn.classList.add('on'); }
    _countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  // 拉取真实状态（以服务器为准）
  try {
    const j = await apiFetch('/status');
    if (j.status) setStatusDisplay(j.status);
  } catch {}

  // 状态按钮（使用 HTTP PUT，WM 服务端会持久化状态，无需保持 WS 连接）
  document.querySelectorAll('.bw-status-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      const s = btn.dataset.s;
      btn.disabled = true;
      try {
        const resp = await apiFetch('/status', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: s}) });
        if (resp.ok) {
          setStatusDisplay(s);
          if (s !== 'invisible') {
            statusPersist(s, _maintainOn ? _maintainEnd : Date.now() + _maintainDurMs);
            if (!_maintainOn) startMaintain();
          } else {
            statusWsDisconnect();
            statusPersist('invisible', 0);
          }
        } else {
          /* worker 返回的结构化错误（如 WM WS 握手失败），过翻译函数统一口径 */
          bwToast('设置失败：' + window.bwWmErrorText(resp.error || '未知错误'), 'error');
        }
      } catch (e) {
        /* 网络层或 apiFetch 抛出的 WM 信封，统一翻译后再提示 */
        bwToast('设置失败：' + window.bwWmErrorText(e), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // 时长按钮
  document.querySelectorAll('.bw-dur-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.bw-dur-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _maintainDurMs = parseInt(btn.dataset.d, 10);
      // 如果正在维持，重置到期时间
      if (_maintainOn) { _maintainEnd = Date.now() + _maintainDurMs; }
    });
  });

  // 维持按钮
  document.getElementById('bw-maintain-btn').addEventListener('click', function() {
    _maintainOn ? stopMaintain() : startMaintain();
  });
}

function setStatusDisplay(status) {
  _wmStatus = status;
  const dot = document.getElementById('bw-sdot');
  const txt = document.getElementById('bw-stxt');
  if (dot) { dot.className = 'bw-status-dot ' + (STATUS_DOT_CLS[status] || 'offline'); }
  if (txt) { txt.textContent = STATUS_LABELS[status] || status; }
  // 高亮对应状态按钮
  document.querySelectorAll('.bw-status-btn').forEach(function(b) {
    b.className = 'bw-status-btn' + (b.dataset.s === status ? ' active-' + status : '');
  });
}

function startMaintain() {
  _maintainOn  = true;
  _maintainEnd = Date.now() + _maintainDurMs;
  const btn = document.getElementById('bw-maintain-btn');
  if (btn) { btn.textContent = '停止维持'; btn.classList.add('on'); }

  statusPersist(_wmStatus, _maintainEnd);

  // 每20分钟重发一次 HTTP PUT，确保 WM 状态保持（WM 服务端虽然持久化，但防御性刷新）
  if (window._maintainPingTimer) clearInterval(window._maintainPingTimer);
  window._maintainPingTimer = setInterval(function() {
    if (!_maintainOn || _wmStatus === 'invisible') return;
    apiFetch('/status', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: _wmStatus}) }).catch(function(){});
  }, 20 * 60 * 1000);

  // 每秒更新倒计时显示
  _countdownTimer = setInterval(updateCountdown, 1000);
  updateCountdown();
}

function stopMaintain() {
  _maintainOn = false;
  clearInterval(_countdownTimer);
  _countdownTimer = null;
  if (window._maintainPingTimer) { clearInterval(window._maintainPingTimer); window._maintainPingTimer = null; }
  statusWsDisconnect();
  statusPersist(null, 0);
  const btn = document.getElementById('bw-maintain-btn');
  if (btn) { btn.textContent = '开始维持'; btn.classList.remove('on'); }
  const timer = document.getElementById('bw-status-timer');
  if (timer) timer.textContent = '';
}

function updateCountdown() {
  const timer = document.getElementById('bw-status-timer');
  if (!timer) { stopMaintain(); return; }
  const left = Math.max(0, _maintainEnd - Date.now());
  if (left === 0) { stopMaintain(); return; }
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  timer.textContent = (h > 0 ? h + ':' : '') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

/* ──────────────────────────────────────────────────────────
   径向类型筛选菜单（与"量化操作·批量上架"共用同一份用户核对过的 tag 表）
─────────────────────────────────────────────────────────── */
const RADIAL_TAG_ZH = {
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
const RADIAL_TAG_ORDER = Object.keys(RADIAL_TAG_ZH);
const RADIAL_OTHER_KEY = '__other__';
let _radialPendingTags = new Set(); // 展开期间的暂存选择，点中心才提交进 _activeTypeTags
let _radialItemTagIndex = null;

function _itemTagIndex() {
  if (!_radialItemTagIndex) {
    _radialItemTagIndex = {};
    _items.forEach(function(it) { if (it.slug) _radialItemTagIndex[it.slug] = it.tags; });
  }
  return _radialItemTagIndex;
}
function _orderTagBucket(o) {
  const raw = (o._slug && _itemTagIndex()[o._slug]) || [];
  const hit = raw.filter(function(t) { return RADIAL_TAG_ZH.hasOwnProperty(t); });
  return hit.length ? hit : [RADIAL_OTHER_KEY];
}

/* 螺旋"蛇形"展开：按 tag 给定顺序，从中心逐个向外盘旋摆放，半径和角度
   都严格单调递增（阿基米德螺旋），不再分环——环形方案无论怎么调都要处理
   "同环挤/跨环撞"两件事，而螺旋天然只有"一条线"，规则简单得多：
   1) 每一步的角度增量 = 期望弧长间距 / 当前半径——半径越小角度跳得越大，
      从而保证同一条螺旋臂上相邻两个花瓣的实际弧长间距恒定，不会因为靠近
      中心而挤在一起。
   2) 每绕一整圈，半径固定增长"一个花瓣宽度+间距"，保证螺旋的上一圈和下一圈
      之间也留出足够间隙，不会"撞臂"。
   3) 最终半径如果超出真实视口的安全边界（不是名义 75%，是 window 实际
      宽高换算出来的安全半径），整条螺旋等比例缩小，形状不变，但保证
      每一个花瓣都落在屏幕可视范围内，不会跑到视口外面去。 */
function _renderRadialPetals() {
  const menu = document.getElementById('bw-radial-menu');
  if (!menu) return;
  menu.querySelectorAll('.bw-radial-petal').forEach(function(p) { p.remove(); });
  const keys = RADIAL_TAG_ORDER.concat([RADIAL_OTHER_KEY]);
  const total = keys.length;

  const centerEl = document.getElementById('bw-radial-center-btn');
  const centerRadius = centerEl ? Math.max(centerEl.offsetWidth, centerEl.offsetHeight) / 2 : 60;

  /* 第一步：先把按钮插入 DOM（菜单此时 visibility:hidden，不影响视觉）量出最大花瓣尺寸 */
  const btns = keys.map(function(key) {
    const label = key === RADIAL_OTHER_KEY ? '其他' : RADIAL_TAG_ZH[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bw-radial-petal' + (_radialPendingTags.has(key) ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', function() {
      if (_radialPendingTags.has(key)) _radialPendingTags.delete(key); else _radialPendingTags.add(key);
      btn.classList.toggle('active');
    });
    menu.appendChild(btn);
    return btn;
  });
  let maxPetal = 0;
  btns.forEach(function(b) { maxPetal = Math.max(maxPetal, b.offsetWidth, b.offsetHeight); });
  if (!maxPetal) maxPetal = 90;
  const gap = 10;
  const spacing = maxPetal + gap; // 同臂相邻花瓣、相邻圈之间统一用这个当安全间距

  /* 第二步：按等弧长间距模拟整条螺旋，先不考虑视口限制 */
  const dRatePerRad = spacing / (2 * Math.PI); // 每转一整圈半径要涨多少，才能保证圈间不撞
  const r0 = centerRadius + spacing * 0.6;
  const pts = [];
  let r = r0, theta = -Math.PI / 2; // 从正上方开始，顺时针盘旋，更符合直觉
  for (let i = 0; i < total; i++) {
    pts.push({ theta: theta, r: r });
    const dtheta = spacing / Math.max(r, spacing * 0.5);
    theta += dtheta;
    r += dRatePerRad * dtheta;
  }
  const finalR = pts[pts.length - 1].r;

  /* 第三步：换算真实视口的安全半径（不是菜单名义尺寸），超出就整体等比例缩小 */
  const safeMargin = 28;
  const limitR = Math.max(120, Math.min(window.innerWidth, window.innerHeight) / 2 - safeMargin);
  const scale = finalR > limitR ? (limitR / finalR) : 1;

  pts.forEach(function(p, i) {
    const rr = p.r * scale;
    const x = Math.cos(p.theta) * rr;
    const y = Math.sin(p.theta) * rr;
    btns[i].style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    btns[i].style.animationDelay = (i * 16) + 'ms';
  });
}

function openRadialMenu() {
  _radialPendingTags = new Set(_activeTypeTags);
  _renderRadialPetals();
  const overlay = document.getElementById('bw-radial-overlay');
  overlay.classList.add('show');
  overlay.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
}
function closeRadialMenu() {
  const overlay = document.getElementById('bw-radial-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
function commitRadialMenu() {
  _activeTypeTags = new Set(_radialPendingTags);
  _syncTypeFilterUi();
  closeRadialMenu();
  render();
}
/* 菜单展开期间转屏/改变窗口尺寸：重新按新的实际像素量一次半径，避免花瓣停留在旧尺寸算出的位置上 */
window.addEventListener('resize', function() {
  const overlay = document.getElementById('bw-radial-overlay');
  if (overlay && overlay.classList.contains('show')) _renderRadialPetals();
});

/* ──────────────────────────────────────────────────────────
   手机端类型筛选：花瓣径向菜单换成普通下拉复选列表
   （同一份 tag 数据、同一套 _activeTypeTags/_radialPendingTags 状态，
   只是交互形式换成更适合小屏触屏的竖排勾选，逻辑上跟桌面端花瓣完全等价）。
─────────────────────────────────────────────────────────── */
function _renderTypeDropdown() {
  const list = document.getElementById('bw-type-dd-list');
  if (!list) return;
  const keys = RADIAL_TAG_ORDER.concat([RADIAL_OTHER_KEY]);
  list.innerHTML = keys.map(function(key) {
    const label = key === RADIAL_OTHER_KEY ? '其他' : RADIAL_TAG_ZH[key];
    const checked = _radialPendingTags.has(key) ? ' checked' : '';
    return '<label class="bw-type-dd-item"><input type="checkbox" data-tag="' + key + '"' + checked + '><span>' + label + '</span></label>';
  }).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
    cb.addEventListener('change', function() {
      const t = cb.dataset.tag;
      if (cb.checked) _radialPendingTags.add(t); else _radialPendingTags.delete(t);
    });
  });
}
function openTypeDropdown() {
  _radialPendingTags = new Set(_activeTypeTags);
  _renderTypeDropdown();
  const wrap  = document.getElementById('bw-type-dd-wrap');   // 只控制箭头旋转
  const panel = document.getElementById('bw-type-dd-panel');  // 面板本体已挪到 <main> 外面，独立开合
  if (wrap)  wrap.classList.add('open');
  if (panel) { panel.classList.add('open'); panel.removeAttribute('aria-hidden'); }
}
function closeTypeDropdown() {
  const wrap  = document.getElementById('bw-type-dd-wrap');
  const panel = document.getElementById('bw-type-dd-panel');
  if (wrap)  wrap.classList.remove('open');
  if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
}
function _syncTypeFilterUi() {
  const n = _activeTypeTags.size;
  const fab = document.getElementById('bw-radial-fab');
  if (fab) fab.classList.toggle('active', n > 0);
  const trigger = document.getElementById('bw-type-dd-trigger');
  if (trigger) trigger.classList.toggle('active', n > 0);
  const countEl = document.getElementById('bw-type-dd-count');
  if (countEl) { countEl.textContent = n; countEl.style.display = n > 0 ? '' : 'none'; }
}
function applyTypeDropdown() {
  _activeTypeTags = new Set(_radialPendingTags);
  _syncTypeFilterUi();
  closeTypeDropdown();
  render();
}
function clearTypeDropdown() {
  _radialPendingTags.clear();
  _renderTypeDropdown();
}

/* ──────────────────────────────────────────────────────────
   筛选 & 排序
─────────────────────────────────────────────────────────── */
function filtered() {
  let list = _orders.filter(function(o) {
    const type  = o.order_type || o.orderType || '';
    const vis   = o.visible !== false;
    const price = o.platinum || 0;
    const name  = itemName(o).toLowerCase();
    const nameEn= (o._name || '').toLowerCase();
    const q     = _searchQ.toLowerCase();
    if (_typeF !== 'all' && type !== _typeF) return false;
    if (_visF === 'visible' && !vis) return false;
    if (_visF === 'hidden'  &&  vis) return false;
    if (_priceMin > 0 && price < _priceMin) return false;
    if (_priceMax < Infinity && price > _priceMax) return false;
    if (q && name.indexOf(q) === -1 && nameEn.indexOf(q) === -1) return false;
    if (_filterSpecial || _filterAlert || _filterExtra) {
      const c = _rankAvg(_avgCache[o._slug], o.mod_rank);
      let pass = false;
      if (_filterSpecial && _isSpecialAvg(c)) pass = true;
      if (_filterExtra && _isExtraOrder(o)) pass = true;
      if (_filterAlert  && !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg) pass = true;
      if (!pass) return false;
    }
    if (_activeTypeTags.size) {
      const itemTags = _orderTagBucket(o);
      const match = itemTags.some(function(t) { return _activeTypeTags.has(t); });
      if (!match) return false;
    }
    return true;
  });
  return sortOrders(list);
}

function filteredForBatch() {
  const base = filtered();
  if (_batchType === 'all') return base;
  return base.filter(function(o){ return (o.order_type||o.orderType) === _batchType; });
}

function sortOrders(list) {
  return list.slice().sort(function(a, b) {
    switch (_sort) {
      case 'updated_asc':  return new Date(a.last_update||0) - new Date(b.last_update||0);
      case 'name_asc':     return itemName(a).localeCompare(itemName(b), 'zh-Hans');
      case 'name_desc':    return itemName(b).localeCompare(itemName(a), 'zh-Hans');
      case 'price_asc':    return (a.platinum||0) - (b.platinum||0);
      case 'price_desc':   return (b.platinum||0) - (a.platinum||0);
      case 'created_desc': return new Date(b.creation_date||0) - new Date(a.creation_date||0);
      case 'created_asc':  return new Date(a.creation_date||0) - new Date(b.creation_date||0);
      case 'qty_desc':     return (b.quantity||0) - (a.quantity||0);
      case 'qty_asc':      return (a.quantity||0) - (b.quantity||0);
      default:             return new Date(b.last_update||0) - new Date(a.last_update||0);
    }
  });
}

/* ──────────────────────────────────────────────────────────
   按订单自身等级挑选均价
   可分级物品（mod/arcane等）零级/满级价差常常好几倍，笼统用不分等级的混合
   avg 去比较会严重失真（零级订单会被满级均价错判"低价警报"，反之亦然）。
   avg_prices_full.json 里可分级物品会带 avg_zero/avg_max/max_rank：
     - 订单等级 === 0        → 用 avg_zero
     - 订单等级 === max_rank → 用 avg_max
     - 中间等级（没有对应精确数据）→ 退化用满级均价兜底（多数在售挂单本就是满级）
   非可分级物品没有这三个字段，直接用原本的混合 avg（本身就没有等级歧义）。
─────────────────────────────────────────────────────────── */
function _rankAvg(c, rank) {
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

/* "稀缺"的唯一权威判定——跟 quant.js 的 _qIsSpecial 保持完全一致，避免两套标准：
   ① 该物品/该等级压根没有均价数据（c 为空，比如从没成功抓取过）
   ② avg 字段本身是 null（即使没被打 special 标记，没有数字也不该算"可靠均价"）
   ③ 数据源自己标记的 special:true（新口径下 = 样本数 < 3）
   任一条件满足即视为稀缺；不要在别处裸判断 c.special，一律走这个函数。 */
function _isSpecialAvg(c) {
  return !c || c.avg === null || c.avg === undefined || c.special === true;
}

/* ──────────────────────────────────────────────────────────
   均价 badge HTML
─────────────────────────────────────────────────────────── */
function avgBadgeHtml(slug, rank) {
  const raw = _avgCache[slug];
  if (!raw) return '<span class="bw-avg-badge loading" data-slug="' + slug + '">均价…</span>';
  const c = _rankAvg(raw, rank);
  if (!c || c.avg === null || c.avg === undefined) return '<span class="bw-avg-badge nodata" data-slug="' + slug + '">暂无其他卖家</span>';
  const tgt = _roundPrice(c.avg * _mult);
  const cls = _isSpecialAvg(c) ? 'special' : 'ok';
  /* stale：本次抓取窗口内该物品没有符合条件的挂单，沿用了上一次成功统计到的均价
     新口径 ingame+online 合并，不再有独立的"在线价"标签 */
  const tag = c.stale ? '<span class="bw-avg-rare">参考价</span>'
            : _isSpecialAvg(c) ? '<span class="bw-avg-rare">稀缺</span>' : '';
  return '<span class="bw-avg-badge ' + cls + '" data-slug="' + slug + '">' + tag + '均 ' + c.avg + 'p × ' + _mult + ' = ' + tgt + 'p</span>';
}

/* ──────────────────────────────────────────────────────────
   订单行 DOM
─────────────────────────────────────────────────────────── */
function mkRow(o) {
  const isHidden = o.visible === false;
  const type     = o.order_type || o.orderType || 'sell';
  // 个人订单列表不再加载物品缩略图，减少带宽占用。
  const pts      = o.mod_rank !== undefined ? ' 等级' + o.mod_rank : '';
  const perTrade = (o.quantity_in_set && o.quantity_in_set > 1) ? '×' + o.quantity_in_set + '/批' : '';
  const c        = _rankAvg(_avgCache[o._slug], o.mod_rank);
  const isAlert  = !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg;

  const div = document.createElement('div');
  div.className = 'bw-order-row' + (isHidden ? ' bw-order-hidden' : '') + (isAlert ? ' bw-alert-row' : '');
  div.dataset.id   = o.id;
  div.dataset.slug = o._slug;

  div.innerHTML = `
<div class="bw-order-main-row">
  <div class="bw-order-content">
    <span class="bw-order-item">${itemName(o)}${pts ? '<span class="bw-order-extra">' + pts + '</span>' : ''}</span>
    <div class="bw-order-submeta">
      ${perTrade ? '<span class="bw-per-trade">' + perTrade + '</span>' : ''}
      ${avgBadgeHtml(o._slug, o.mod_rank)}
      <span class="bw-order-ago">${ago(o.last_update)}</span>
    </div>
  </div>
  <div class="bw-order-right">
    ${isHidden ? '<span class="bw-hidden-badge">已隐藏</span>' : ''}
    <span class="bw-order-price">${o.platinum}p</span>
    <div class="bw-order-actions">
      <button class="bw-act-btn bw-act-vis${isHidden ? ' is-hidden' : ''}" data-id="${o.id}">${isHidden ? '显示' : '隐藏'}</button>
      <button class="bw-act-btn bw-act-edit" data-id="${o.id}">编辑</button>
      <button class="bw-act-btn bw-act-del" data-id="${o.id}">删</button>
    </div>
  </div>
</div>
<div class="bw-order-detail" id="bw-detail-${o.id}">
  <div class="bw-detail-inner" id="bw-detail-inner-${o.id}">
    <div class="bw-detail-loading">加载中…</div>
  </div>
</div>`;

  /* 卡片交互统一走事件委托（见 bindListDelegation），避免大列表逐卡绑定监听器 */
  return div;
}

/* ──────────────────────────────────────────────────────────
   事件委托：订单列表卡片交互（显示/隐藏/编辑/删除/展开详情）
   在列表容器上挂一次监听，避免大列表每张卡片绑定 4 个监听器
─────────────────────────────────────────────────────────── */
function getOrder(id) {
  for (var i = 0; i < _orders.length; i++) if (_orders[i].id === id) return _orders[i];
  return null;
}
function bindListDelegation(el) {
  if (!el || el.dataset.delegated) return;
  el.dataset.delegated = '1';
  el.addEventListener('click', function(e) {
    var vis = e.target.closest('.bw-act-vis');
    if (vis) { var o = getOrder(vis.dataset.id); if (o) toggleVisibility(o); return; }
    var edit = e.target.closest('.bw-act-edit');
    if (edit) { var o2 = getOrder(edit.dataset.id); if (o2) openEdit(o2, false); return; }
    var del = e.target.closest('.bw-act-del');
    if (del) { var o3 = getOrder(del.dataset.id); if (o3) openEdit(o3, true); return; }
    if (e.target.closest('.bw-order-actions')) return; // 操作区内非按钮点击不展开
    var main = e.target.closest('.bw-order-main-row');
    if (main) { var card = main.closest('.bw-order-row'); if (card) toggleDetail(card.dataset.id); }
  });
}

/* ──────────────────────────────────────────────────────────
   渲染列表
─────────────────────────────────────────────────────────── */
function render() {
  const rk = _renderKey();
  if (rk !== _lastRenderKey) { _visibleCount = LIST_BATCH; _atBottom=false; _lastRenderKey = rk; }

  const list     = filtered();
  const sellAll  = list.filter(function(o) { return (o.order_type || o.orderType) === 'sell'; });
  const buyAll   = list.filter(function(o) { return (o.order_type || o.orderType) !== 'sell'; });
  const sellList = _atBottom ? sellAll.slice(-_visibleCount) : sellAll.slice(0, _visibleCount);
  const buyList  = _atBottom ? buyAll.slice(-_visibleCount) : buyAll.slice(0, _visibleCount);

  const sellEl = document.getElementById('bw-sell-list');
  const buyEl  = document.getElementById('bw-buy-list');
  /* 大列表优化：订单多时跳过逐卡入场动画，并用 DocumentFragment 一次性插入，
     避免长列表反复 reflow 导致的严重卡顿 */
  const many = list.length > 60;

  if (sellList.length === 0) {
    sellEl.innerHTML = '<div class="bw-empty">暂无出售订单</div>';
  } else {
    const frag = document.createDocumentFragment();
    sellList.forEach(function(o, i) {
      const row = mkRow(o);
      if (!many) row.style.animationDelay = (i * 28) + 'ms';
      frag.appendChild(row);
    });
    sellEl.innerHTML = '';
    sellEl.appendChild(frag);
  }

  if (buyList.length === 0) {
    buyEl.innerHTML = '<div class="bw-empty">暂无求购订单</div>';
  } else {
    const frag = document.createDocumentFragment();
    buyList.forEach(function(o, i) {
      const row = mkRow(o);
      if (!many) row.style.animationDelay = (i * 28) + 'ms';
      frag.appendChild(row);
    });
    buyEl.innerHTML = '';
    buyEl.appendChild(frag);
  }

  bindListDelegation(sellEl);
  bindListDelegation(buyEl);

  const allSell = _orders.filter(function(o){ return (o.order_type||o.orderType) === 'sell'; });
  const allBuy  = _orders.filter(function(o){ return (o.order_type||o.orderType) !== 'sell'; });
  const alertCnt = _orders.filter(function(o){
    const c = _rankAvg(_avgCache[o._slug], o.mod_rank);
    return !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg;
  }).length;
  /* 平均利润率：仅统计有可靠均价数据的出售订单（排除"稀缺"），rate=(定价-均价)/均价 */
  var _profitRates = [];
  allSell.forEach(function(o) {
    var c = _rankAvg(_avgCache[o._slug], o.mod_rank);
    if (!_isSpecialAvg(c) && c.avg > 0) {
      _profitRates.push((o.platinum - c.avg) / c.avg);
    }
  });
  var avgProfitPct = _profitRates.length > 0
    ? Math.round(_profitRates.reduce(function(a, b){ return a + b; }, 0) / _profitRates.length * 100)
    : null;

  document.getElementById('bw-sell-count').textContent = '(' + sellAll.length + ')';
  document.getElementById('bw-buy-count').textContent  = '(' + buyAll.length + ')';
  document.getElementById('bw-order-stats').textContent = '共 ' + _orders.length + ' 条 · 显示 ' + list.length + ' 条';
  const tot = document.getElementById('bw-total-count');
  if (tot) tot.textContent = _orders.length;

  /* 更新 profile panel 统计 */
  const ps = document.getElementById('bw-panel-sell');
  const pb = document.getElementById('bw-panel-buy');
  const pc = document.getElementById('bw-panel-coverage');
  const pa = document.getElementById('bw-panel-alerts');
  const pt = document.getElementById('bw-panel-ticker');
  if (ps) ps.textContent = allSell.length;
  if (pb) pb.textContent = allBuy.length;
  if (pc) {
    if (avgProfitPct === null) {
      pc.textContent = '—';
      pc.className = 'bw-panel-val';
    } else {
      pc.textContent = (avgProfitPct >= 0 ? '+' : '') + avgProfitPct + '%';
      pc.className = 'bw-panel-val ' + (avgProfitPct >= 0 ? 'profit-pos' : 'profit-neg');
    }
  }
  if (pa) pa.textContent = alertCnt;
  if (pt) pt.textContent = alertCnt > 0
    ? alertCnt + ' 条订单价格低于均价'
    : '所有订单价格正常';

  document.getElementById('bw-batch-count').textContent = filteredForBatch().length;
  const typeTag = document.getElementById('bw-batch-type-label');
  if (typeTag) {
    typeTag.textContent = _typeF === 'sell' ? '出售' : _typeF === 'buy' ? '求购' : '全部';
    typeTag.className   = 'bw-batch-type-tag ' + (_typeF === 'sell' ? 'is-sell' : _typeF === 'buy' ? 'is-buy' : '');
  }

  /* 扫光动画：有稀缺/警报数据时激活 */
  const allOrders = _orders;
  const hasSpecial = allOrders.some(function(o) { const c = _rankAvg(_avgCache[o._slug], o.mod_rank); return _isSpecialAvg(c); });
  const hasAlert   = allOrders.some(function(o) { const c = _rankAvg(_avgCache[o._slug], o.mod_rank); return !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg; });
  document.getElementById('bw-filter-special')?.classList.toggle('has-data', hasSpecial);
  document.getElementById('bw-filter-alert')  ?.classList.toggle('has-data', hasAlert);

  updateAlertSection(list);
  loadMissingAvg(list);
}

/* ──────────────────────────────────────────────────────────
   均价异步加载
─────────────────────────────────────────────────────────── */
function loadMissingAvg(list) {
  const seen = {};
  const slugs = [];
  list.forEach(function(o) {
    if (o._slug && !_avgCache[o._slug] && !seen[o._slug]) { seen[o._slug]=1; slugs.push(o._slug); }
  });
  if (!slugs.length) return;
  // 去重后分片串行，避免 3000单瞬间并发
  var orderMap=new Map(_orders.map(function(x){return [x.id,x];}));
  var idx=0;
  function next(){
    if(idx>=slugs.length) return;
    var slug=slugs[idx++];
    fetchAvg(slug).then(function(data) {
      if (!data) { setTimeout(next, 0); return; }
      document.querySelectorAll('.bw-order-row[data-slug="' + slug + '"]').forEach(function(row) {
        const o = orderMap.get(row.dataset.id);
        const c = _rankAvg(data, o && o.mod_rank);
        const badge = row.querySelector('.bw-avg-badge');
        if (badge) {
          badge.classList.remove('loading');
          if (!c || c.avg === null || c.avg === undefined) {
            badge.textContent = '暂无其他卖家'; badge.classList.add('nodata');
          } else {
            const tgt = _roundPrice(c.avg * _mult);
            const cls = _isSpecialAvg(c) ? 'special' : 'ok';
            badge.classList.add(cls);
            const tag = c.stale                ? '<span class="bw-avg-rare">参考价</span>'
                      : _isSpecialAvg(c)      ? '<span class="bw-avg-rare">稀缺</span>' : '';
            badge.innerHTML = tag + '均 ' + c.avg + 'p × ' + _mult + ' = ' + tgt + 'p';
          }
        }
        if (_isSpecialAvg(c)) row.classList.add('bw-special-row');
        if (o && !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg) row.classList.add('bw-alert-row');
      });
      updateAlertBadges();
      setTimeout(next, 0);
    }).catch(function(){ setTimeout(next,0); });
  }
  next();
}

/* ──────────────────────────────────────────────────────────
   价格警报 FAB（只更新计数，不再置顶单独显示）
─────────────────────────────────────────────────────────── */
function updateAlertSection(visibleList) {
  const count = _orders.filter(function(o) {
    const c = _rankAvg(_avgCache[o._slug], o.mod_rank);
    return !_isSpecialAvg(c) && (o.order_type||o.orderType||o.type||'sell') === 'sell' && o.platinum < c.avg;
  }).length;
  const fab = document.getElementById('bw-alert-fab');
  const n   = document.getElementById('bw-alert-fab-n');
  if (fab) fab.style.display = count > 0 ? '' : 'none';
  if (n)   n.textContent = count;
}

function updateAlertBadges() { updateAlertSection(filtered()); }

/* ──────────────────────────────────────────────────────────
   订单详情展开面板
─────────────────────────────────────────────────────────── */
async function toggleDetail(id) {
  const el = document.getElementById('bw-detail-' + id);
  if (!el) return;
  const isOpen = el.classList.contains('is-open');
  if (_openRow && _openRow !== id) {
    const prev = document.getElementById('bw-detail-' + _openRow);
    if (prev) prev.classList.remove('is-open');
  }
  if (isOpen) { el.classList.remove('is-open'); _openRow = null; return; }
  el.classList.add('is-open');
  _openRow = id;

  const o = _orders.find(function(x) { return x.id === id; });
  if (!o) return;
  const inner = document.getElementById('bw-detail-inner-' + id);
  const avgData = _rankAvg(_avgCache[o._slug], o.mod_rank);
  let avgVal;
  if (!avgData) {
    avgVal = '加载中…';
  } else if (avgData.avg === null || avgData.avg === undefined) {
    avgVal = '暂无其他卖家';
  } else {
    avgVal = avgData.avg + 'p（' + avgData.count + ' 条' +
      (avgData.used < avgData.count ? '，取第 2/3 位均值' : '，直接取平均') +
      (avgData.stale ? '，本次未拉到新数据，沿用上次统计' : '') + '）';
  }
  const avgRow = '<div class="bw-detail-row"><div class="bw-detail-label">参考均价</div><div class="bw-detail-val">' + avgVal + '</div></div>';

  inner.innerHTML = avgRow + `
<div class="bw-detail-row"><div class="bw-detail-label">类型</div><div class="bw-detail-val">${(o.order_type||o.orderType)==='sell'?'出售':'求购'}</div></div>
<div class="bw-detail-row"><div class="bw-detail-label">价格</div><div class="bw-detail-val">${o.platinum}p</div></div>
<div class="bw-detail-row"><div class="bw-detail-label">数量</div><div class="bw-detail-val">${o.quantity||1}</div></div>
<div class="bw-detail-row"><div class="bw-detail-label">可见性</div><div class="bw-detail-val">${o.visible===false?'已隐藏':'显示中'}</div></div>
${o.mod_rank!==undefined?'<div class="bw-detail-row"><div class="bw-detail-label">等级</div><div class="bw-detail-val">'+o.mod_rank+'</div></div>':''}
<div class="bw-detail-row"><div class="bw-detail-label">最后更新</div><div class="bw-detail-val">${ago(o.last_update)}</div></div>`;

  if (o._slug) {
    /* 物品详情（稀有度/交易税/标签/简介）——交易统计图表已下线（WM v1 统计接口被 403，
       长期只能显示"暂无足够统计数据"，无实际价值；均价时效性由 avg_prices_full.json 保障）*/
    try {
      const detailResult = await apiFetch('/item/' + encodeURIComponent(o._slug));
      const it = detailResult.data;
      if (it) {
        const desc = (it.description || '').replace(/<[^>]+>/g, '').slice(0, 180);
        const extra = [
          it.rarity ? '<div class="bw-detail-row"><div class="bw-detail-label">稀有度</div><div class="bw-detail-val">'+it.rarity+'</div></div>' : '',
          it.trading_tax !== undefined ? '<div class="bw-detail-row"><div class="bw-detail-label">交易税</div><div class="bw-detail-val">'+it.trading_tax+'</div></div>' : '',
          it.tags && it.tags.length ? '<div class="bw-detail-row"><div class="bw-detail-label">标签</div><div class="bw-detail-val">'+it.tags.join(' · ')+'</div></div>' : '',
          desc ? '<div class="bw-detail-desc">'+desc+'</div>' : '',
        ].join('');
        if (extra) inner.insertAdjacentHTML('beforeend', extra);
      }
    } catch {}
  }
}

/* ──────────────────────────────────────────────────────────
   快速切换可见性
─────────────────────────────────────────────────────────── */
async function toggleVisibility(o) {
  const newVis = o.visible === false;
  try {
    await apiFetch('/order/' + o.id, { method: 'PATCH', body: JSON.stringify({ visible: newVis }) });
    o.visible = newVis; render();
  } catch(e) { console.error('visibility error', e); }
}

/* ──────────────────────────────────────────────────────────
   编辑抽屉
─────────────────────────────────────────────────────────── */
function openEdit(o, showDel) {
  _openEdit = o;
  document.getElementById('bw-drawer-item-name').textContent = itemName(o);
  const badge = document.getElementById('bw-drawer-type-badge');
  const type  = o.order_type || o.orderType || 'sell';
  badge.textContent = type === 'sell' ? '出售订单' : '求购订单';
  badge.className   = 'bw-drawer-type-badge is-' + type;
  document.getElementById('bw-pill-visible').classList.toggle('active', o.visible !== false);
  document.getElementById('bw-pill-hidden').classList.toggle('active', o.visible === false);
  document.getElementById('bw-drawer-price').value = o.platinum || '';
  document.getElementById('bw-drawer-qty').value   = o.quantity  || 1;

  const itemObj = o._slug ? _items.find(function(i) { return (i.url_name||i.slug||i.id) === o._slug; }) : null;

  /* 批量交易：以 WM 官方 item.bulkTradable 为准；已有 quantity_in_set>1 时即使字段暂缺也照常展示，避免用户看不到已设好的批量 */
  const bulkWrap = document.getElementById('bw-drawer-bulk-wrap');
  const ptWrap   = document.getElementById('bw-drawer-per-trade-wrap');
  const bulkOn   = document.getElementById('bw-drawer-bulk-on');
  const bulkOff  = document.getElementById('bw-drawer-bulk-off');
  const hasBulk  = (itemObj && itemObj.bulkTradable) || o.quantity_in_set > 1;
  bulkWrap.style.display = hasBulk ? '' : 'none';
  if (o.quantity_in_set > 1) {
    ptWrap.style.display = '';
    document.getElementById('bw-drawer-per-trade').value = o.quantity_in_set;
    bulkOn.classList.add('active'); bulkOff.classList.remove('active');
  } else {
    ptWrap.style.display = 'none';
    bulkOff.classList.add('active'); bulkOn.classList.remove('active');
  }

  /* 等级：以 WM 官方 item.maxRank 是否存在为准 */
  const rankWrap = document.getElementById('bw-drawer-rank-wrap');
  const maxRank  = itemObj && (itemObj.maxRank || itemObj.max_rank);
  if (maxRank) {
    document.getElementById('bw-drawer-rank-label').textContent = '等级（0–' + maxRank + '）';
    const rankInput = document.getElementById('bw-drawer-rank');
    rankInput.max = maxRank;
    rankInput.value = (o.mod_rank !== undefined ? o.mod_rank : maxRank);
    rankWrap.style.display = '';
  } else { rankWrap.style.display = 'none'; }
  refreshPriceHint(o._slug, +(document.getElementById('bw-drawer-price').value), _currentEditRank());
  document.getElementById('bw-drawer-confirm-del').classList.remove('is-open');
  setDrawerMsg('');
  if (showDel) document.getElementById('bw-drawer-confirm-del').classList.add('is-open');
  openDrawer('bw-edit-drawer', 'bw-edit-overlay');
}

/* 编辑抽屉里用户可能正在改等级输入框，价格提示要按当前输入框里的等级实时算，
   而不是订单原本的等级——否则用户刚把等级从0改到满级，提示还停在旧数字上 */
function _currentEditRank() {
  const wrap  = document.getElementById('bw-drawer-rank-wrap');
  const input = document.getElementById('bw-drawer-rank');
  if (wrap && input && wrap.style.display !== 'none') return +input.value || 0;
  return _openEdit ? _openEdit.mod_rank : undefined;
}

function refreshPriceHint(slug, price, rank) {
  const hint = document.getElementById('bw-drawer-price-hint');
  if (!hint) return;
  const c = _rankAvg(_avgCache[slug], rank);
  if (!c || c.avg === null || c.avg === undefined || !price) { hint.textContent = ''; return; }
  const target = c.avg * _mult;
  if (price < c.avg) {
    hint.className = 'bw-drawer-price-hint alert';
    hint.textContent = '价格偏低！均价 ' + c.avg + 'p，目标 ' + Math.round(target) + 'p';
  } else if (price < target) {
    hint.className = 'bw-drawer-price-hint warn';
    hint.textContent = '均价 ' + c.avg + 'p，目标 ' + Math.round(target) + 'p（当前低于倍率目标）';
  } else {
    hint.className = 'bw-drawer-price-hint good';
    hint.textContent = '均价 ' + c.avg + 'p，价格合理 ✓';
  }
}

function closeEdit() { closeDrawer('bw-edit-drawer', 'bw-edit-overlay'); _openEdit = null; }

function openDrawer(did, oid) {
  document.getElementById(did).classList.add('is-open');
  document.getElementById(oid).classList.add('is-open');
}
function closeDrawer(did, oid) {
  document.getElementById(did).classList.remove('is-open');
  document.getElementById(oid).classList.remove('is-open');
}
function setDrawerMsg(text, cls) {
  const el = document.getElementById('bw-drawer-msg'); if (!el) return;
  el.textContent = text; el.className = 'bw-drawer-msg' + (cls ? ' ' + cls : '');
}

/* ──────────────────────────────────────────────────────────
   创建抽屉
─────────────────────────────────────────────────────────── */
let _createType = 'sell', _createVis = true, _createItemId = '';

function openCreate() {
  _createType = 'sell'; _createVis = true; _createItemId = '';
  ['bw-create-item-q','bw-create-item-id','bw-create-price'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('bw-create-qty').value = 1;
  document.getElementById('bw-create-type-sell').classList.add('active');
  document.getElementById('bw-create-type-buy').classList.remove('active');
  document.getElementById('bw-create-vis-on').classList.add('active');
  document.getElementById('bw-create-vis-off').classList.remove('active');
  document.getElementById('bw-item-dropdown').innerHTML = '';
  ['bw-create-rank-wrap','bw-create-bulk-wrap','bw-create-per-trade-wrap','bw-create-subtype-wrap'
  ].forEach(function(id) { document.getElementById(id).style.display='none'; });
  document.getElementById('bw-create-bulk-off').classList.add('active');
  document.getElementById('bw-create-bulk-on').classList.remove('active');
  const msg = document.getElementById('bw-create-msg'); if (msg) msg.textContent = '';
  openDrawer('bw-create-drawer', 'bw-create-overlay');
  document.getElementById('bw-create-item-q').focus();
}
function closeCreate() { closeDrawer('bw-create-drawer', 'bw-create-overlay'); }

/* 物品搜索联想 */
function setupItemSearch() {
  const q   = document.getElementById('bw-create-item-q');
  const dd  = document.getElementById('bw-item-dropdown');
  const hid = document.getElementById('bw-create-item-id');

  q.addEventListener('input', function() {
    const text = q.value.trim().toLowerCase();
    hid.value = ''; _createItemId = '';
    if (!text) { dd.innerHTML = ''; return; }
    /* 字段：worker返回 { id, slug, zh, en, thumb, ... } */
    const matches = _items.filter(function(i) {
      const zh = (i.zh || '').toLowerCase();
      const en = (i.en || i.slug || '').toLowerCase();
      return zh.indexOf(text) !== -1 || en.indexOf(text) !== -1;
    }).slice(0, 40);
    if (matches.length === 0) { dd.innerHTML = '<div class="bw-item-drop-empty">无匹配结果</div>'; return; }
    dd.innerHTML = matches.map(function(i) {
      const zh = i.zh || '';
      const en = i.en  || i.slug || '';
      /* 区分：zh 和 en 相同说明没有中文名，只显示英文 */
      const showZh = zh && zh !== en;
      return '<div class="bw-item-drop-row" data-id="'+(i.slug||i.id)+'" data-oid="'+i.id+'" data-zh="'+zh+'" data-en="'+en+'">'
        +'<span class="bw-item-drop-zh">'+(showZh ? zh : en)+'</span>'
        +'<span class="bw-item-drop-en">'+(showZh ? en : '')+'</span></div>';
    }).join('');
    dd.querySelectorAll('.bw-item-drop-row').forEach(function(row) {
      row.addEventListener('click', function() {
        const zh = row.dataset.zh, en = row.dataset.en;
        const showZh = zh && zh !== en;
        q.value = (_lang === 'zh' && showZh) ? zh : en;
        hid.value = row.dataset.oid || row.dataset.id; _createItemId = row.dataset.oid || row.dataset.id;
        dd.innerHTML = '';
        const item = _items.find(function(i) { return i.id === _createItemId || (i.slug||i.id) === _createItemId; });
        if (item) updateCreateFields(item);
      });
    });
  });
  document.addEventListener('click', function(e) {
    if (!q.closest('.bw-item-search-wrap').contains(e.target)) dd.innerHTML = '';
  });
}

function _showField(id, show) { document.getElementById(id).style.display = show ? '' : 'none'; }

function updateCreateFields(item) {
  const tags     = item.tags || [];
  const urlName  = item.slug || item.url_name || item.id || '';
  const isRiven  = tags.includes('riven')  || urlName.includes('riven');
  const isMod    = tags.includes('mod') && !isRiven;
  const maxRank  = item.maxRank || item.max_rank || null;

  /* 等级：以 WM 官方 item.maxRank 是否存在为准（Mod、赋能等均适用），而非按物品类型猜测 */
  if (maxRank) {
    _showField('bw-create-rank-wrap', true);
    document.getElementById('bw-create-rank-label').textContent = '等级（0–' + maxRank + '）';
    document.getElementById('bw-create-rank').max = maxRank;
    document.getElementById('bw-create-rank').value = maxRank;
  } else { _showField('bw-create-rank-wrap', false); }

  /* 批量交易：以 WM 官方 item.bulkTradable 是否为 true 为准，与物品类型无关；提供手动开关，默认关闭 */
  const bulkOn = document.getElementById('bw-create-bulk-on');
  const bulkOff = document.getElementById('bw-create-bulk-off');
  _showField('bw-create-bulk-wrap', !!item.bulkTradable);
  bulkOff.classList.add('active'); bulkOn.classList.remove('active');
  _showField('bw-create-per-trade-wrap', false);
  document.getElementById('bw-create-per-trade').value = 1;

  /* Subtype 下拉：实测确认裂罅Mod的 subtype 是必填字段（不填直接 400 app.field.required），
     Mod 的镀层/墨染同理也是走这个字段，只是可选 */
  const itemSubtypes = Array.isArray(item.subtypes) ? item.subtypes : [];
  if ((isMod || isRiven) && itemSubtypes.length > 0) {
    _showField('bw-create-subtype-wrap', true);
    const SUBTYPE_ZH = { regular: '镀层（普通）', atragraph: '墨染', unrevealed: '未揭示', revealed: '已揭示' };
    document.getElementById('bw-create-subtype').innerHTML =
      itemSubtypes.map(function(v) {
        return '<option value="' + v + '">' + (SUBTYPE_ZH[v] || v) + '</option>';
      }).join('');
  } else {
    _showField('bw-create-subtype-wrap', false);
  }
}

/* ──────────────────────────────────────────────────────────
   批量操作 —— 薄封装：真正的进度条/失败面板/重试逻辑在 shared.js 的
   runBatch()，这里只负责把"PATCH 一个订单"包成 runBatch 认识的 workFn。
─────────────────────────────────────────────────────────── */
async function batchOp(orders, patchFn) {
  // 计算 patches
  var patches = [];
  orders.forEach(function(o){ var p=patchFn(o); if(p) patches.push({ id:o.id, patch:p }); });
  if (!patches.length) return;
  // 优先 batch 1次鉴权（200单=1 KV读），失败回退单条
  try {
    var res = await apiFetch('/orders/batch', { method:'POST', body: JSON.stringify({ patches }) });
    var okSet = new Set((res.results||[]).map(function(r){return r.id;}));
    patches.forEach(function(pr){ if(okSet.has(pr.id)){ var o=orders.find(function(x){return x.id===pr.id;}); if(o) Object.assign(o, pr.patch); } });
    if (res.fails && res.fails.length) {
      var failMap={}; res.fails.forEach(function(f){ failMap[f.id]=f.error; });
      var failItems = orders.filter(function(o){ return failMap[o.id]; });
      if (failItems.length) {
        // 失败项用单条重试，复用现有失败面板
        await runBatch(failItems, async function(o){ var p=patchFn(o); if(!p) return; await apiFetch('/orders/'+o.id,{method:'PATCH', body:JSON.stringify(p)}); Object.assign(o,p); }, {
          idPrefix:'bw-batch', onDone: render,
          getLabel: function(o){ return { type:(o.order_type==='buy')?'求购':'出售', name:o._zh||o._name||o._slug||'(未知物品)' }; }
        });
        return;
      }
    }
    render();
    return;
  } catch(e){
    // batch 不可用或整体失败，回退单条
  }
  await runBatch(orders, async function(o) {
    const patch = patchFn(o);
    if (!patch) return;
    await apiFetch('/orders/' + o.id, { method: 'PATCH', body: JSON.stringify(patch) });
    Object.assign(o, patch);
  }, {
    idPrefix: 'bw-batch',
    onDone: render,
    getLabel: function(o) {
      return { type: (o.order_type === 'buy') ? '求购' : '出售', name: o._zh || o._name || o._slug || '(未知物品)' };
    },
  });
}

async function visAllOrders(visible) {
  const targets = _orders.filter(function(o) { return (o.visible !== false) !== visible; });
  if (!targets.length) return;
  await batchOp(targets, function() { return { visible }; });
}

/* ──────────────────────────────────────────────────────────
   事件绑定
─────────────────────────────────────────────────────────── */
function bindEvents() {
  /* 退出（二次确认）—— 三个页面共用的绑定逻辑，见 shared.js */
  bindLogout();

  /* 侧边快捷导航：回顶部/到底部——滚动一定距离才出现，避免刚进页面就占地方；
     已经在最顶/最底时对应按钮变暗禁用，不做无意义的滚动 */
  (function bindScrollNav() {
    const nav = document.getElementById('bw-scrollnav');
    const topBtn = document.getElementById('bw-scroll-top-btn');
    const botBtn = document.getElementById('bw-scroll-bottom-btn');
    if (!nav || !topBtn || !botBtn) return;
    function syncState() {
      const y = window.scrollY || document.documentElement.scrollTop;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      nav.style.display = (maxY > 200) ? '' : 'none';
      topBtn.classList.toggle('is-disabled', y < 40);
      botBtn.classList.toggle('is-disabled', maxY - y < 40);
    }
    topBtn.addEventListener('click', function() {
      if (_visibleCount > LIST_BATCH || _atBottom) { _visibleCount = LIST_BATCH; _atBottom=false; render(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    botBtn.addEventListener('click', function() {
      // 一键到底：首次360，重复点按增量360，窗口化不堆68k，字体尺寸变化后双rAF必达底
      if (_atBottom) {
        _visibleCount = Math.min(_orders.length, _visibleCount + 360);
      } else {
        _atBottom = true;
        _visibleCount = Math.min(360, _orders.length);
      }
      render();
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          syncState();
        });
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); });
    });
    window.addEventListener('scroll', syncState, { passive: true });
    window.addEventListener('resize', syncState);
    syncState();
  })();

  /* 滚动增量渲染：滚近底部追加，滚回上方回收（rAF 节流） */
  let _incRaf = false;
  window.addEventListener('scroll', function() {
    if (_incRaf) return;
    _incRaf = true;
    requestAnimationFrame(function() {
      _incRaf = false;
      const d = document.documentElement;
      const y = window.scrollY;
      const h = window.innerHeight;
      const scrollH = d.scrollHeight;
      /* 向下：滚近底部时追加一批 */
      if (y + h >= scrollH - 800 && _visibleCount < _orders.length) {
        _visibleCount = Math.min(_orders.length, _visibleCount + LIST_BATCH);
        render();
        return;
      }
      /* 向上：滚到页面上方 25% 且有多余渲染时，逐步回收底部订单 */
      if (_visibleCount > LIST_BATCH && y < scrollH * 0.25) {
        _visibleCount = Math.max(LIST_BATCH, _visibleCount - LIST_BATCH);
        render();
      }
    });
  }, { passive: true });

  /* 语言切换 */
  const langBtn = document.getElementById('bw-lang-btn');
  langBtn?.addEventListener('click', function() {
    _lang = _lang === 'zh' ? 'en' : 'zh';
    langBtn.classList.toggle('is-en', _lang === 'en');
    document.getElementById('bw-lang-zh').classList.toggle('active', _lang === 'zh');
    document.getElementById('bw-lang-en').classList.toggle('active', _lang === 'en');
    render();
  });

  /* 刷新订单状态（重新拉取物品缓存，含中文名） */
  document.getElementById('bw-refresh-items-btn')?.addEventListener('click', function() {
    refreshItemsAndRerender(this, true);
  });

  /* 类型筛选 */
  document.querySelectorAll('.bw-type-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.bw-type-pill').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active'); _typeF = btn.dataset.type; render();
    });
  });

  /* 可见性筛选 */
  document.querySelectorAll('.bw-vis-f-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.bw-vis-f-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active'); _visF = btn.dataset.vis; render();
    });
  });

  /* 特殊 / 特殊物品 / 价格警报 筛选 */
  document.getElementById('bw-filter-special')?.addEventListener('click', function() {
    _filterSpecial = !_filterSpecial;
    this.dataset.active = _filterSpecial ? '1' : '0';
    this.classList.toggle('active', _filterSpecial);
    render();
  });
  document.getElementById('bw-filter-extra')?.addEventListener('click', function() {
    _filterExtra = !_filterExtra;
    this.dataset.active = _filterExtra ? '1' : '0';
    this.classList.toggle('active', _filterExtra);
    render();
  });
  document.getElementById('bw-filter-alert')?.addEventListener('click', function() {
    _filterAlert = !_filterAlert;
    this.dataset.active = _filterAlert ? '1' : '0';
    this.classList.toggle('active', _filterAlert);
    render();
  });

  /* 径向类型筛选菜单 */
  document.getElementById('bw-radial-fab')?.addEventListener('click', openRadialMenu);
  document.getElementById('bw-radial-center-btn')?.addEventListener('click', commitRadialMenu);
  document.getElementById('bw-radial-overlay')?.addEventListener('click', function(e) {
    if (e.target.id === 'bw-radial-overlay') closeRadialMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeRadialMenu(); closeTypeDropdown(); }
  });

  /* 手机端下拉复选（跟桌面花瓣菜单共用同一套状态，见上方 _renderTypeDropdown 等函数） */
  document.getElementById('bw-type-dd-trigger')?.addEventListener('click', function(e) {
    e.stopPropagation();
    const wrap = document.getElementById('bw-type-dd-wrap');
    if (wrap && wrap.classList.contains('open')) closeTypeDropdown(); else openTypeDropdown();
  });
  document.getElementById('bw-type-dd-apply')?.addEventListener('click', applyTypeDropdown);
  document.getElementById('bw-type-dd-clear')?.addEventListener('click', clearTypeDropdown);
  document.addEventListener('click', function(e) {
    const wrap  = document.getElementById('bw-type-dd-wrap');
    const panel = document.getElementById('bw-type-dd-panel');
    /* 面板已经挪到 <main> 外面、跟触发按钮不再是 DOM 父子关系，
       判断"点在外面"要同时排除触发按钮和面板两块 */
    if (wrap && wrap.classList.contains('open') &&
        !wrap.contains(e.target) && !(panel && panel.contains(e.target))) {
      closeTypeDropdown();
    }
  });

  /* 价格区间 */
  document.getElementById('bw-price-min')?.addEventListener('input', function(e) { _priceMin = +e.target.value || 0; render(); });
  document.getElementById('bw-price-max')?.addEventListener('input', function(e) { _priceMax = +e.target.value || Infinity; render(); });

  /* 搜索 */
  document.getElementById('bw-search-q')?.addEventListener('input', function(e) { _searchQ = e.target.value.trim(); render(); });

  /* 倍率 */
  document.getElementById('bw-multiplier')?.addEventListener('input', function(e) { _mult = parseFloat(e.target.value) || 2; render(); });

  /* 批量改价"向上取整"选项：跟 localStorage 共享偏好，跨页面（含 quant.html）记住选择 */
  document.querySelectorAll('#bw-round-pills .bw-round-pill').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.round === _priceRoundMode);
    btn.addEventListener('click', function() {
      _priceRoundMode = btn.dataset.round;
      localStorage.setItem('bw_price_round_mode', _priceRoundMode);
      document.querySelectorAll('#bw-round-pills .bw-round-pill').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      render();
    });
  });

  /* 自定义排序 */
  const sortWrap = document.getElementById('bw-sort-wrap');
  document.getElementById('bw-sort-trigger')?.addEventListener('click', function(e) {
    e.stopPropagation(); sortWrap.classList.toggle('is-open');
  });
  document.querySelectorAll('.bw-sort-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.querySelectorAll('.bw-sort-item').forEach(function(i) { i.classList.remove('active'); });
      item.classList.add('active'); _sort = item.dataset.sort;
      document.getElementById('bw-sort-label').textContent = item.textContent;
      sortWrap.classList.remove('is-open'); render();
    });
  });
  document.addEventListener('click', function() { sortWrap.classList.remove('is-open'); });

  /* 批量上下架 */
  document.getElementById('bw-vis-show-all')?.addEventListener('click', function() { visAllOrders(true); });
  document.getElementById('bw-vis-hide-all')?.addEventListener('click', function() { visAllOrders(false); });

  /* 创建抽屉 */
  document.getElementById('bw-create-btn')?.addEventListener('click', openCreate);
  document.getElementById('bw-create-close')?.addEventListener('click', closeCreate);
  document.getElementById('bw-create-overlay')?.addEventListener('click', closeCreate);

  document.getElementById('bw-create-type-sell')?.addEventListener('click', function() {
    _createType = 'sell';
    document.getElementById('bw-create-type-sell').classList.add('active');
    document.getElementById('bw-create-type-buy').classList.remove('active');
  });
  document.getElementById('bw-create-type-buy')?.addEventListener('click', function() {
    _createType = 'buy';
    document.getElementById('bw-create-type-buy').classList.add('active');
    document.getElementById('bw-create-type-sell').classList.remove('active');
  });
  document.getElementById('bw-create-vis-on')?.addEventListener('click', function() {
    _createVis = true;
    document.getElementById('bw-create-vis-on').classList.add('active');
    document.getElementById('bw-create-vis-off').classList.remove('active');
  });
  document.getElementById('bw-create-vis-off')?.addEventListener('click', function() {
    _createVis = false;
    document.getElementById('bw-create-vis-off').classList.add('active');
    document.getElementById('bw-create-vis-on').classList.remove('active');
  });
  document.getElementById('bw-create-bulk-on')?.addEventListener('click', function() {
    document.getElementById('bw-create-bulk-on').classList.add('active');
    document.getElementById('bw-create-bulk-off').classList.remove('active');
    _showField('bw-create-per-trade-wrap', true);
  });
  document.getElementById('bw-create-bulk-off')?.addEventListener('click', function() {
    document.getElementById('bw-create-bulk-off').classList.add('active');
    document.getElementById('bw-create-bulk-on').classList.remove('active');
    _showField('bw-create-per-trade-wrap', false);
  });
  document.getElementById('bw-create-submit')?.addEventListener('click', async function() {
    const msg = document.getElementById('bw-create-msg');
    if (!_createItemId) { msg.textContent = '请先选择物品'; msg.className = 'bw-drawer-msg err'; return; }
    const price = +document.getElementById('bw-create-price').value;
    const qty   = +document.getElementById('bw-create-qty').value || 1;
    if (!price || price < 1) { msg.textContent = '请输入有效价格'; msg.className = 'bw-drawer-msg err'; return; }
    const body = { itemId: _createItemId, type: _createType, platinum: price, quantity: qty, visible: _createVis };
    const vis = function(id) { return document.getElementById(id).style.display !== 'none'; };
    if (vis('bw-create-rank-wrap'))    body.rank           = +document.getElementById('bw-create-rank').value    || 0;
    if (vis('bw-create-per-trade-wrap')) body.perTrade = +document.getElementById('bw-create-per-trade').value || 1;
    if (vis('bw-create-subtype-wrap')) {
      const sub = document.getElementById('bw-create-subtype').value;
      if (sub) body.subtype = sub;
    }
    msg.textContent = '创建中…'; msg.className = 'bw-drawer-msg';
    try {
      await apiFetch('/order', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = '创建成功！'; msg.className = 'bw-drawer-msg ok';
      await loadOrders(); render();
      setTimeout(closeCreate, 900);
    } catch(e) { msg.textContent = window.bwWmErrorText(e); msg.className = 'bw-drawer-msg err'; }
  });

  /* 编辑抽屉 */
  document.getElementById('bw-drawer-close')?.addEventListener('click', closeEdit);
  document.getElementById('bw-edit-overlay')?.addEventListener('click', closeEdit);

  document.querySelectorAll('.bw-vis-pill[data-val]').forEach(function(p) {
    p.addEventListener('click', function() {
      document.querySelectorAll('.bw-vis-pill[data-val]').forEach(function(x) { x.classList.remove('active'); });
      p.classList.add('active');
    });
  });

  document.getElementById('bw-drawer-price')?.addEventListener('input', function(e) {
    if (_openEdit) refreshPriceHint(_openEdit._slug, +e.target.value, _currentEditRank());
  });
  document.getElementById('bw-drawer-rank')?.addEventListener('input', function() {
    if (_openEdit) refreshPriceHint(_openEdit._slug, +document.getElementById('bw-drawer-price').value, _currentEditRank());
  });

  document.getElementById('bw-drawer-bulk-on')?.addEventListener('click', function() {
    document.getElementById('bw-drawer-bulk-on').classList.add('active');
    document.getElementById('bw-drawer-bulk-off').classList.remove('active');
    _showField('bw-drawer-per-trade-wrap', true);
  });
  document.getElementById('bw-drawer-bulk-off')?.addEventListener('click', function() {
    document.getElementById('bw-drawer-bulk-off').classList.add('active');
    document.getElementById('bw-drawer-bulk-on').classList.remove('active');
    _showField('bw-drawer-per-trade-wrap', false);
  });

  document.getElementById('bw-drawer-update')?.addEventListener('click', async function() {
    if (!_openEdit) return;
    const price = +document.getElementById('bw-drawer-price').value;
    const qty   = +document.getElementById('bw-drawer-qty').value || 1;
    const vis   = document.getElementById('bw-pill-visible').classList.contains('active');
    const patch = { platinum: price, quantity: qty, visible: vis };
    if (document.getElementById('bw-drawer-per-trade-wrap').style.display !== 'none') {
      patch.perTrade = +document.getElementById('bw-drawer-per-trade').value || 1;
    } else if (_openEdit.quantity_in_set > 1) {
      /* 用户把批量交易开关关掉了，显式写回 1 以真正关闭，而不是保持旧值不变 */
      patch.perTrade = 1;
    }
    if (document.getElementById('bw-drawer-rank-wrap').style.display !== 'none') {
      patch.rank = +document.getElementById('bw-drawer-rank').value || 0;
    }
    setDrawerMsg('更新中…');
    try {
      await apiFetch('/order/' + _openEdit.id, { method: 'PATCH', body: JSON.stringify(patch) });
      Object.assign(_openEdit, patch);
      if (patch.rank !== undefined) _openEdit.mod_rank = patch.rank;
      if (patch.perTrade !== undefined) _openEdit.quantity_in_set = patch.perTrade;
      setDrawerMsg('更新成功！', 'ok'); render();
      setTimeout(closeEdit, 700);
    } catch(e) { setDrawerMsg(window.bwWmErrorText(e), 'err'); }
  });

  document.getElementById('bw-drawer-delete')?.addEventListener('click', function() {
    document.getElementById('bw-drawer-confirm-del').classList.add('is-open');
  });
  document.getElementById('bw-drawer-confirm-no')?.addEventListener('click', function() {
    document.getElementById('bw-drawer-confirm-del').classList.remove('is-open');
  });
  document.getElementById('bw-drawer-confirm-yes')?.addEventListener('click', async function() {
    if (!_openEdit) return;
    setDrawerMsg('删除中…');
    try {
      await apiFetch('/order/' + _openEdit.id, { method: 'DELETE' });
      _orders = _orders.filter(function(o) { return o.id !== _openEdit.id; });
      setDrawerMsg('已删除', 'ok'); render();
      setTimeout(closeEdit, 600);
    } catch(e) { setDrawerMsg(window.bwWmErrorText(e), 'err'); }
  });

  /* 批量操作 */
  /* 批量计数标签同步（含 batchType 筛选） */
  function updateBatchCount() {
    const cnt = document.getElementById('bw-batch-count');
    if (cnt) cnt.textContent = filteredForBatch().length;
  }

  /* 批量操作前置检查：0 条时给用户明确提示 */
  function batchGuard() {
    const items = filteredForBatch();
    if (items.length) return items;
    const txt = document.getElementById('bw-batch-prog-text');
    const prog = document.getElementById('bw-batch-progress');
    if (txt && prog) {
      prog.style.display = '';
      txt.style.display = ''; txt.style.color = 'var(--c-warn)';
      txt.textContent = '当前筛选无匹配订单，请检查类型/搜索条件';
      setTimeout(function() { prog.style.display = 'none'; txt.style.color = ''; txt.style.display = 'none'; }, 3000);
    }
    return null;
  }

  document.getElementById('bw-batch-price-btn')?.addEventListener('click', async function() {
    const val = +document.getElementById('bw-batch-price').value; if (!val||val<1) return;
    const items = batchGuard(); if (!items) return;
    await batchOp(items, function() { return { platinum: val }; });
  });
  document.getElementById('bw-batch-qty-btn')?.addEventListener('click', async function() {
    const val = +document.getElementById('bw-batch-qty').value; if (!val||val<1) return;
    const items = batchGuard(); if (!items) return;
    await batchOp(items, function() { return { quantity: val }; });
  });
  document.getElementById('bw-batch-mult-btn')?.addEventListener('click', async function() {
    const multInput = document.getElementById('bw-batch-mult-input');
    const batchMult = multInput ? (parseFloat(multInput.value) || _mult) : _mult;
    const items = batchGuard(); if (!items) return;
    await batchOp(items, function(o) {
      const c = _rankAvg(_avgCache[o._slug], o.mod_rank);
      if (!c || c.avg === null || c.avg === undefined) return null;
      const p = _roundPrice(c.avg * batchMult);
      return p >= 1 ? { platinum: p } : null;
    });
  });
  document.getElementById('bw-batch-refresh-btn')?.addEventListener('click', async function() {
    const items = batchGuard(); if (!items) return;
    /* 原样回填当前值，不做任何改动，仅借"更新"接口刷新订单的更新时间 */
    await batchOp(items, function(o) {
      return { platinum: o.platinum, quantity: o.quantity || 1, visible: o.visible !== false };
    });
  });

  /* 价格警报 FAB：点击即激活警报筛选 */
  document.getElementById('bw-alert-fab')?.addEventListener('click', function() {
    _filterAlert = true;
    const btn = document.getElementById('bw-filter-alert');
    if (btn) { btn.dataset.active = '1'; btn.classList.add('active'); }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* 批量操作类型 pills */
  document.querySelectorAll('.bw-batch-type-pill').forEach(function(pill) {
    pill.addEventListener('click', function() {
      document.querySelectorAll('.bw-batch-type-pill').forEach(function(p){ p.classList.remove('active'); });
      pill.classList.add('active');
      _batchType = pill.dataset.bt;
      updateBatchCount();
    });
  });

  /* 批量失败面板：展开详情 / 一键重试 / 关闭 */
  document.getElementById('bw-batch-fail-toggle')?.addEventListener('click', function() {
    const list = document.getElementById('bw-batch-fail-list');
    const open = list.style.display === 'none';
    list.style.display = open ? '' : 'none';
    this.textContent = open ? '收起详情' : '展开详情';
  });
  document.getElementById('bw-batch-fail-retry')?.addEventListener('click', function() {
    retryBatchFailures();
  });
  document.getElementById('bw-batch-fail-close')?.addEventListener('click', function(e) {
    e.stopPropagation();
    hideBatchFail();
  });

  setupItemSearch();
}

/* ──────────────────────────────────────────────────────────
   主流程
─────────────────────────────────────────────────────────── */
async function main() {
  const sess = await requireAuth();
  if (!sess) return;
  _session = sess;
  renderProfile(sess);
  bindEvents();
  await loadItems();
  /* 极简模式以最小化带宽为第一目标：均价数据集只用于价格提示/稀缺筛选这些
     非核心的辅助功能，直接跳过下载；核心的订单管理与在线状态维持完全不受影响。 */
  if (typeof _isMinimal !== 'function' || !_isMinimal()) preloadAvgPrices();
  try { await loadOrders(); }
  catch(e) {
    /* 首次加载订单失败：WM 信封翻译成人话再渲染，避免 raw JSON 占满列表区 */
    document.getElementById('bw-sell-list').innerHTML = '<div class="bw-empty">加载失败：' + _escHtml(window.bwWmErrorText(e)) + '</div>';
    document.getElementById('bw-buy-list').innerHTML = '';
  }
  render();

  /* 页面元素全部加载完毕后，自动发起一次「刷新订单状态」按钮的激活，
     确保首次进入 / 新登录时无需手动点击即可拿到完整中文名 */
  const refreshBtn = document.getElementById('bw-refresh-items-btn');
  if (refreshBtn) refreshItemsAndRerender(refreshBtn, false);
}

document.addEventListener('DOMContentLoaded', main);
