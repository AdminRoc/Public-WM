/* ═══════════════════════════════════════════════════════════
   shared.js —— 各页面共用的基础东西：鉴权、API 请求、背景特效、批量操作。
   必须在页面自己的脚本之前引入。
   ═══════════════════════════════════════════════════════════ */

/* 前端静态站跑在 market.wfspeed.run（EdgeOne Pages 纯静态），
   API 单独挂在 pwm-api.wfspeed.run（边缘函数）。这里定跨域基址，
   登录 Cookie 靠浏览器随跨域请求带过去（同站，SameSite 能带）。 */
const API = 'https://pwm-api.wfspeed.run/api/wm';

/* 受保护页面手动控制开机遮罩：先验 session 再让 revealPage() 淡出，
   免得没登录时内容闪一下。见 js/fui-core.js。
   例外：登录页用 __bwUtilsOnly 方式引这个文件（只借 bwWmErrorText 这些纯工具），
   不能接管开机遮罩——登录页没有 requireAuth/revealPage 那套流程，
   接管了遮罩要等 8s 兜底才淡出。 */
if (!window.__bwUtilsOnly) window.__fuiBootManual = true;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 可靠数据加载器：数据源挨个试，全挂了就反复重试直到成功或页面卸载。
   - 单源 7s 超时，避免慢网挂死单源
   - 密文包装 {v,ct,iv,sha256} 必须严密解密：无key/解密失败/sha256不匹配视为该源失败，自动试下一源，绝不把包装当明文
   - parseFn(json) 返回 truthy 就算"数据有效"，成了就自动停
   - 页面藏起来的时候降频重试（省流量），页面关了自然就停了
   返回 { promise, stop } */
function createReliableLoader(urls, parseFn, opts) {
  opts = opts || {};
  var retryDelay  = opts.retryDelay  != null ? opts.retryDelay  : 2500;
  var hiddenDelay = opts.hiddenDelay != null ? opts.hiddenDelay : 30000;
  var fetchTimeout = opts.fetchTimeout != null ? opts.fetchTimeout : 7000;
  var stopped = false;
  function fetchWithTimeout(url){
    var ctrl; try{ ctrl=new AbortController(); }catch(e){ return fetch(url, { cache: 'no-cache' }); }
    var t=setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, fetchTimeout);
    return fetch(url, { cache: 'no-cache', signal: ctrl.signal }).then(function(r){ clearTimeout(t); return r; }, function(e){ clearTimeout(t); throw e; });
  }
  async function tryDecryptWrapper(j){
    if(!j || !j.ct || !j.iv || j.v!==1) return j;
    var b64=(typeof window!=='undefined'&&window.__PRICE_KEY_B64)?window.__PRICE_KEY_B64:null;
    if(!b64) return null;
    try{
      var keyRaw=Uint8Array.from(atob(b64),function(c){return c.charCodeAt(0);});
      var key=await crypto.subtle.importKey('raw',keyRaw,'AES-GCM',false,['decrypt']);
      var iv=Uint8Array.from(atob(j.iv),function(c){return c.charCodeAt(0);});
      var ct=Uint8Array.from(atob(j.ct),function(c){return c.charCodeAt(0);});
      var pb=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,ct);
      var txt=new TextDecoder().decode(pb);
      if(j.sha256){
        var hb=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));
        var hx=Array.from(new Uint8Array(hb)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
        if(hx!==j.sha256) return null;
      }
      return JSON.parse(txt);
    }catch(e){ return null; }
  }
  async function attempt() {
    for (var i = 0; i < urls.length; i++) {
      if (stopped) return null;
      try {
        var r = await fetchWithTimeout(urls[i]);
        if (!r.ok) continue;
        var j = await r.json();
        if(j && j.ct && j.iv){
          var dec = await tryDecryptWrapper(j);
          if(dec===null) continue;
          j = dec;
        }
        if(j && j.ct) continue;
        var ok = parseFn(j);
        if (ok && typeof ok.then === 'function') ok = await ok;
        if (ok) return true;
      } catch (e) {}
    }
    return null;
  }
  async function loop() {
    while (!stopped) {
      if (await attempt()) return true;
      if (stopped) return false;
      var hidden = typeof document !== 'undefined' && document.hidden;
      await sleep(hidden ? hiddenDelay : retryDelay);
    }
    return false;
  }
  return { promise: loop(), stop: function () { stopped = true; } };
}

function ago(ts) {
  if (!ts) return '';
  const d = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60)    return d + '秒前';
  if (d < 3600)  return Math.floor(d/60) + '分钟前';
  if (d < 86400) return Math.floor(d/3600) + '小时前';
  return Math.floor(d/86400) + '天前';
}

function _escHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

/* 极简模式：星空/故障等纯装饰性动效一律不跑，省 CPU/电量（不涉及带宽，
   带宽消耗主要靠 fui-core.js 里跳过字体内联覆盖实现）。 */
function _isMinimal() {
  return document.documentElement.getAttribute('data-fui-theme') === 'minimal';
}
function _isEyecare() {
  return document.documentElement.getAttribute('data-fui-theme') === 'eyecare';
}
/* dark「碳素仪器」：装饰整体降级，色偏类 glitch 全部关掉 */
function _isDark() {
  return document.documentElement.getAttribute('data-fui-theme') === 'dark';
}

/* ── GSAP 初始化 ──────────────────────────────────────────
   注册免费插件 + 无障碍守卫 + 主题感知默认值。
   GSAP 在 <head> 之后、shared.js 之前已加载（vendor/gsap/gsap.min.js）。 */
if (typeof gsap !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);

  /* reduced-motion 降级：GSAP 直接操作 inline style，不受 CSS
     animation-duration:.01ms 覆盖，必须在 JS 层独立守卫。 */
  gsap.matchMedia().add({
    '(prefers-reduced-motion: reduce)': function () {
      gsap.globalTimeline.timeScale(100); // 极速完成所有动画=瞬间
    }
  });

  /* 主题感知默认值：不同主题的动画幅度/颜色从 CSS 变量读取 */
  gsap.defaults({
    ease: 'power2.out',
    duration: 0.4
  });
}

/* ── GSAP 工具函数 ────────────────────────────────────────
   读取 CSS 变量并转为可用格式，供 GSAP 动画使用。 */
function _gsapCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function _gsapRgb(name) {
  var v = _gsapCssVar(name);
  if (!v) return '0,0,0';
  /* 如果已经是 rgb/rgba 格式直接返回 */
  if (v.indexOf('rgb') === 0) return v;
  /* hex → rgb */
  if (v[0] === '#') {
    var h = v.slice(1);
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16);
  }
  return v;
}

/* ── 服务可用性监测（灾备）──────────────────────────────────
   连续 3 次网络级失败（非 HTTP 错误）视为 Worker 不可用，
   展示维护横幅，避免用户看到无意义的网络错误。
   HTTP 错误（4xx/5xx）不计入——那是正常的业务错误。 */
let _workerFailCount = 0;
let _workerDownShown = false;
function _recordWorkerFailure() {
  _workerFailCount++;
  if (_workerFailCount >= 3 && !_workerDownShown) {
    _workerDownShown = true;
    const bar = document.createElement('div');
    bar.id = 'bw-maintenance-bar';
    bar.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:9998',
      /* 横幅三色走 main.css 定义的系统告警变量（--c-alert-*），
         浅底主题下由主题块覆盖为可读配色；兜底为原有深红系 */
      'background:var(--c-alert-bg,#7c2d2d);color:var(--c-alert-text,#f8d7d7);font-size:.82rem',
      'padding:.45rem 1rem;text-align:center;display:flex',
      'align-items:center;justify-content:center;gap:.8rem',
    ].join(';');
    bar.innerHTML = '<span>⚠ Public WM 后端暂时不可用，请稍后刷新重试。</span>'
      + '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:inherit;cursor:pointer;font-size:1rem;line-height:1">✕</button>';
    document.body.prepend(bar);
  }
}
function _recordWorkerSuccess() {
  _workerFailCount = 0;
  const bar = document.getElementById('bw-maintenance-bar');
  if (bar) bar.remove();
  _workerDownShown = false;
}

let _sessionExpiredShown = false;
function _handleSessionExpired() {
  if (_sessionExpiredShown) return;
  _sessionExpiredShown = true;
  const overlay = document.createElement('div');
  /* 遮罩走 --c-mask：浅底主题（eyecare/minimal）下是暖棕而非死黑；
     卡片底色/文字用 --c-bg2/--c-text（各主题块均有定义），浅底主题下可读 */
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'display:flex;align-items:center;justify-content:center',
    'background:var(--c-mask,rgba(0,0,0,.7));backdrop-filter:blur(4px)',
  ].join(';');
  overlay.innerHTML = [
    '<div style="background:var(--c-bg2,#12122a);border:1px solid var(--c-warn,#c8963a)',
    /* --c-fg 全站从未定义（真 bug），正文色应为 --c-text */
    ';border-radius:10px;padding:2rem 2.5rem;max-width:380px;text-align:center;color:var(--c-text,#e8e0cc)">',
    '<p style="margin:0 0 .6rem;font-size:1.1rem;color:var(--c-warn,#c8963a);font-weight:600">WM 登录会话已过期</p>',
    '<p style="margin:0 0 1.2rem;font-size:.88rem;opacity:.8;line-height:1.6">',
    'Warframe.market 的登录状态失效（通常因长时间未操作或在其他设备重新登录），',
    '需要重新授权后才能继续使用。</p>',
    '<p style="margin:0;font-size:.78rem;opacity:.45">3 秒后自动跳转到登录页…</p>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
  setTimeout(function() { location.href = '/login'; }, 3000);
}

async function apiFetch(path, opts) {
  opts = opts || {};
  let r;
  try {
    r = await fetch(API + path, Object.assign({ credentials: 'include' }, opts, {
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
    }));
  } catch (netErr) {
    _recordWorkerFailure();
    throw netErr;
  }
  _recordWorkerSuccess();
  if (r.status === 401) { _handleSessionExpired(); throw new Error('会话已过期，请重新登录'); }
  if (!r.ok) throw new Error(await r.text());
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

/* ──────────────────────────────────────────────────────────
   WM 错误码 → 中文人话翻译（全站唯一出口）
   背景：worker 对 WM 的写操作（删单/改单/创建订单/拍卖操作）是透传代理，
   WM 返回的错误信封原样回到前端，形如：
     {"apiVersion":"0.25.0","data":null,"error":{"request":["app.auth.user.notVerified"]}}
   apiFetch 会把这段 body 文本整个塞进 Error.message，直接展示就是一坨
   用户完全看不懂的 raw JSON（真实案例：用户删订单时看到整段信封）。
   本函数把各种形态的错误（Error 对象 / WM 信封 JSON 文本 /
   worker 包装的 {"error": "..."} / 纯字符串）统一翻译成对用户友好的中文。
   各页面的展示位置和样式不变，只是把文案来源换成本函数。
─────────────────────────────────────────────────────────── */
window.bwWmErrorText = function(raw) {
  if (raw === null || raw === undefined) return '未知错误';

  /* 第一步：归一化。Error 对象取 message；对象留着后面拆结构；
     其余一律转成字符串——它常常就是 worker 响应体的 JSON 原文。 */
  var obj  = null;
  var text = '';
  if (raw instanceof Error) {
    text = raw.message || String(raw);
  } else if (typeof raw === 'object') {
    obj = raw;
  } else {
    text = String(raw);
  }

  /* message 是 JSON 文本时尝试解析（apiFetch 把响应 body 原文塞进
     Error.message，WM 信封和 worker 的 {"error": ...} 都走这条路） */
  if (!obj && text) {
    var trimmed = text.trim();
    if (trimmed.charAt(0) === '{') {
      try { obj = JSON.parse(trimmed); } catch (e) { /* 不是 JSON：按纯文本继续 */ }
    }
  }

  /* 第二步：拆结构。
     codes     —— WM 信封 error.request / error.<字段> 数组里的机器码
     workerMsg —— worker 自己包装的 {"error": "中文说明"}（已是人话） */
  var codes = [];
  var workerMsg = null;
  if (obj) {
    /* worker 在登录被 CF 人机验证拦截时返回的结构化标记 */
    if (obj.cf_challenge === true) {
      return '操作被 warframe.market 的安全验证（Cloudflare 人机校验）拦截了。'
        + '请稍后再试；如果反复出现，请回登录页改用 JWT 登录后再操作。';
    }
    var err = obj.error;
    if (typeof err === 'string') {
      workerMsg = err;
    } else if (err && typeof err === 'object') {
      Object.keys(err).forEach(function(k) {
        var v = err[k];
        if (Array.isArray(v)) { v.forEach(function(x) { codes.push(String(x)); }); }
        /* error.inputs = { fieldName: ["msg"] } 形式的嵌套对象：展开为 "field: msg" */
        else if (v !== null && v !== undefined && typeof v === 'object') {
          Object.keys(v).forEach(function(k2) {
            var v2 = v[k2];
            if (Array.isArray(v2)) v2.forEach(function(x) { codes.push(k2 + ': ' + String(x)); });
            else if (v2 !== null && v2 !== undefined) codes.push(k2 + ': ' + String(v2));
          });
        }
        else if (v !== null && v !== undefined) { codes.push(String(v)); }
      });
    }
    if (!workerMsg && typeof obj.message === 'string') workerMsg = obj.message;
  }

  /* 把机器码、worker 文案、原始文本合成一个小写检索串，
     下面的映射全部在这个串上做匹配（顺序 = 从最具体到最笼统，
     避免「502」之类的通用特征抢在精确 code 前面命中） */
  var codeStr  = codes.join(' | ');
  var haystack = (codeStr + ' || ' + (workerMsg || '') + ' || ' + text).toLowerCase();

  /* WM 账号未完成「游戏 ID 验证」：WM 不允许未验证账号管理订单，
     这是用户真实踩过的 case（删订单时报 app.auth.user.notVerified） */
  if (haystack.indexOf('app.auth.user.notverified') !== -1) {
    return '你的 warframe.market 账号还没有完成「游戏 ID 验证」，WM 不允许未验证账号管理订单。'
      + '请先在 warframe.market 官网登录并完成账号验证（设置页绑定游戏 ID），'
      + '完成后重新复制一次 JWT 再登录本站。';
  }

  /* CF 安全验证拦截：worker 拿到的是 CF 验证页（表现为非 JSON 响应），
     或显式的 cf_challenge / 403 质询 */
  if (haystack.indexOf('cf_challenge') !== -1 || haystack.indexOf('cf_chl') !== -1
      || haystack.indexOf('challenge') !== -1 || haystack.indexOf('非 json') !== -1
      || /(^|[^0-9])403([^0-9]|$)|forbidden/.test(haystack)) {
    return '操作被 warframe.market 的安全验证（Cloudflare 人机校验）拦截了。'
      + '请稍后再试；如果反复出现，请回登录页改用 JWT 登录后再操作。';
  }

  /* 登录状态失效：401 / unauthorized / token 失效或 JWT 过期 */
  if (/(^|[^0-9])401([^0-9]|$)|unauthorized|invalid_token|invalid token|authentication/.test(haystack)
      || /jwt.*(expired|过期|失效)/.test(haystack) || /(expired|过期|失效).*jwt/.test(haystack)
      || haystack.indexOf('会话已过期') !== -1) {
    return '登录状态已过期或失效，请回到登录页重新登录（JWT 登录需重新复制一次最新的 JWT）。';
  }

  /* WM 限流：429 / rate limit */
  if (/(^|[^0-9])429([^0-9]|$)|rate.?limit|too many requests/.test(haystack)) {
    return '操作太频繁，被 warframe.market 限流了。请稍等片刻再试。';
  }

  /* WM 服务端异常：5xx / 502 / 545 / upstream（正则带数字边界，
     防止把「1500」之类的普通数字误判成 5xx） */
  if (/(^|[^0-9])5\d\d([^0-9]|$)|upstream|bad gateway/.test(haystack)) {
    return 'warframe.market 服务暂时异常（WM 服务端错误），请稍后再试。';
  }

  /* 网络层错误：WM 连接超时（net_exception_connect_timeout 等）/ fetch 被中止 / 网络异常 */
  if (/net_exception|connect_timeout|failed to fetch|fetch failed|network|networkerror|abort|timeout|超时|连接|网络/.test(haystack)) {
    return 'WM 服务器连接超时或网络异常，请稍后重试。';
  }

  /* worker 自己包装的 {"error": "..."}、以及任何已含中文的纯文本，
     上游已经写过人话（如「WM 邮箱或密码错误」），直接采用，
     不要再套「无法识别」的壳（WM 机器码不含汉字，此规则不会误放行） */
  if (workerMsg) return workerMsg;
  if (/[一-鿿]/.test(text)) return text;

  /* 未知错误：不能静默吞掉，保留机器码 / 截断原文便于排查 */
  var detail = codeStr || text;
  if (detail.length > 120) detail = detail.slice(0, 120) + '…';
  return 'WM 返回了无法识别的错误' + (detail ? '（' + detail + '）' : '。');
};

/* ── 跨页面在线状态维持（WS 隧道版）────────────────────────
   通过持久 WebSocket 连接维持 WM 在线状态。
   连接由 shared.js 管理，页面切换时自动重连。

   localStorage key：
     bw_status_val   —— 当前状态（online / ingame / invisible）
     bw_maintain_end —— 维持到期时间戳（ms）；0 = 未维持
*/
const _BW_S_KEY = 'bw_status_val';
const _BW_E_KEY = 'bw_maintain_end';

/* EdgeOne 边缘函数不支持出站 WebSocket（WS 隧道废了），
   在线状态改成 HTTP PUT 设定/维持：设一次，main.js 的"开始维持"定时器
   每 20 分钟重设一下就能保持住（WM 服务端会记状态）。 */
function statusWsConnect(status) {
  if (!status) return;
  apiFetch('/status', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: status}) }).catch(function(){});
}
function statusWsDisconnect() {}

/* 兼容旧调用 */
function statusPingResume() { statusWsConnect(localStorage.getItem(_BW_S_KEY) || 'online'); }
function statusPingStop()   { statusWsDisconnect(); }

/* 存状态+期限，顺便开关对应的连接 */
function statusPersist(status, maintainEndMs) {
  if (status) localStorage.setItem(_BW_S_KEY, status);
  localStorage.setItem(_BW_E_KEY, String(maintainEndMs || 0));
  if (maintainEndMs && maintainEndMs > Date.now()) {
    statusWsConnect(status || localStorage.getItem(_BW_S_KEY));
  } else {
    statusWsDisconnect();
    localStorage.setItem(_BW_E_KEY, '0');
  }
}

/* 读存下来的维持状态（给 main.js 页面初始化恢复 UI 用） */
function statusPersistGet() {
  return {
    status:      localStorage.getItem(_BW_S_KEY) || null,
    maintainEnd: parseInt(localStorage.getItem(_BW_E_KEY) || '0', 10),
  };
}

/* 页面加载时自动恢复维持（如果维持期还没到）。
   登录页（__bwUtilsOnly）不跑：登录页没会话，恢复了也是白连，
   只会刷一堆没意义的报错。 */
(function _statusAutoResume() {
  if (window.__bwUtilsOnly) return;
  var end = parseInt(localStorage.getItem(_BW_E_KEY) || '0', 10);
  var s   = localStorage.getItem(_BW_S_KEY);
  if (s && end > Date.now()) { statusWsConnect(s); }
}());

/* ──────────────────────────────────────────────────────────
   Auth
─────────────────────────────────────────────────────────── */
async function checkSession() {
  try { const j = await apiFetch('/session'); if (j.ok && j.session?.slug) return j.session; } catch {}
  return null;
}

function showLogin() {
  location.href = '/login';
}

/* 等待自定义字体就绪（最多 1.5s，超时也继续），然后淡入页面 */
function revealPage() {
  Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise(function(r) { setTimeout(r, 1500); })
  ]).catch(function(){}).then(function() {
    document.body.style.opacity = '1';
    if (window.__fuiBoot) window.__fuiBoot.done(); // 淡出开机遮罩 + 触发内容错峰入场
  });
}

/* 受保护页面通用入口：先验 session，通过后等字体淡入，否则跳登录 */
async function requireAuth() {
  const sess = await checkSession();
  if (!sess) { showLogin(); return null; }
  revealPage();
  return sess;
}

/* 顶栏"登出账号"按钮 + 二次确认弹窗 —— 各页面
   的 header 标签页共用同一份 HTML 结构（#bw-logout-btn / #bw-logout-confirm /
   #bw-confirm-cancel / #bw-confirm-ok），每个页面的初始化流程里调用一次即可。 */
function bindLogout() {
  const logoutOverlay = document.getElementById('bw-logout-confirm');
  document.getElementById('bw-logout-btn')?.addEventListener('click', function() {
    logoutOverlay?.classList.add('show');
  });
  document.getElementById('bw-confirm-cancel')?.addEventListener('click', function() {
    logoutOverlay?.classList.remove('show');
  });
  logoutOverlay?.addEventListener('click', function(e) {
    if (e.target === logoutOverlay) logoutOverlay.classList.remove('show');
  });
  document.getElementById('bw-confirm-ok')?.addEventListener('click', async function() {
    await apiFetch('/signout', { method: 'POST' }).catch(function(){});
    // 直接跳登录页，不 reload 当前页（reload 会先重载当前页再跳，有可见的驻留延迟）
    location.href = '/login';
  });
}

/* ──────────────────────────────────────────────────────────
   星空背景
─────────────────────────────────────────────────────────── */
(function initStars() {
  const canvas = document.getElementById('star-canvas');
  /* 护眼主题同极简：纸面阅读感上不铺闪烁星点，纯装饰一律不跑 */
  if (!canvas || _isMinimal() || _isEyecare()) return;
  const ctx = canvas.getContext('2d');
  canvas._starField = canvas._starField || {};
  let W, H, stars = [], shoots = [];
  let _lastStarFrame = 0;
  let _mx = -9999, _my = -9999, _energyEnabled = false;

  /* 星点颜色跟随主题：缓存 hex → rgb 通道 */
  let _starTheme = null;
  let _starRgb = '180,210,255';
  function starColor() {
    const theme = document.documentElement.getAttribute('data-fui-theme') || 'gold';
    if (theme !== _starTheme) {
      _starTheme = theme;
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(
        getComputedStyle(document.documentElement).getPropertyValue('--c-text2').trim());
      if (m) {
        let h = m[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        _starRgb = parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16);
      }
    }
    return _starRgb;
  }

  /* 星点颜色集（多色调，复刻 Ws-Web StarField） */
  const _colorPool = ['#ffffff','#b8d8ff','#ffe8c8','#00d4ff'];
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function createStars(count) {
    stars = Array.from({ length: count }, function () {
      return { x: Math.random()*W, y: Math.random()*H,
               size: Math.random()*1.7+.2, base: Math.random()*.55+.2,
               speed: Math.random()*.025+.004, phase: Math.random()*Math.PI*2,
               color: _colorPool[Math.floor(Math.random()*_colorPool.length)] };
    });
  }
  function activateMeteor(m) {
    const angle = Math.PI*0.2 + Math.random()*0.18;
    const speed = 7 + Math.random()*6;
    m.active = true; m.x = Math.random()*W*0.75; m.y = -30 - Math.random()*90;
    m.dx = Math.cos(angle)*speed; m.dy = Math.sin(angle)*speed;
    m.len = 70 + Math.random()*70; m.op = 1;
  }
  function maybeShoot() {
    if (Math.random() > 0.004 || shoots.length >= 3) return;
    shoots.push({ x: Math.random()*W*0.75, y: Math.random()*H*0.35, active: false,
                  delay: Math.floor(Math.random()*500), dx: 0, dy: 0, len: 0, op: 1 });
  }

  function draw(ts) {
    if (_isMinimal() || _isEyecare()) return;
    if (ts - _lastStarFrame < 16) { requestAnimationFrame(draw); return; }
    _lastStarFrame = ts;

    /* 读取 GSAP quickTo 平滑坐标 */
    const gm = window._gsapMouse;
    if (gm) { _mx = gm.x; _my = gm.y; if (!_energyEnabled && _mx > -1000) _energyEnabled = true; }

    /* 背景渐变 */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07080f'); bg.addColorStop(0.45, '#090c18'); bg.addColorStop(1, '#070810');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const now = performance.now() * 0.001;

    /* ── 恒星渲染 + 能量场亮度增强 ── */
    stars.forEach(function (s) {
      let op = s.base * (0.72 + 0.28 * Math.sin(now * s.speed * 55 + s.phase));
      let sz = s.size;
      if (_energyEnabled) {
        const dx = s.x - _mx, dy = s.y - _my;
        const d2 = dx * dx + dy * dy;
        if (d2 < 14400) { /* 120px 半径 */
          const t = 1 - Math.sqrt(d2) / 120;
          op = Math.min(op + t * 0.55, 1);
          sz = s.size * (1 + t * 0.5);
        }
      }
      ctx.save(); ctx.globalAlpha = op;
      if (sz > 1.1) {
        const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sz * 3.5);
        gr.addColorStop(0, s.color); gr.addColorStop(0.4, s.color + '55'); gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, sz * 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, sz, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    /* ── 鼠标能量场光晕（金色径向渐变） ── */
    if (_energyEnabled && _mx > -1000) {
      const eg = ctx.createRadialGradient(_mx, _my, 0, _mx, _my, 200);
      eg.addColorStop(0, 'rgba(185,142,52,0.13)');
      eg.addColorStop(0.35, 'rgba(255,215,0,0.05)');
      eg.addColorStop(1, 'rgba(255,215,0,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = eg; ctx.fillRect(_mx - 200, _my - 200, 400, 400);
      ctx.restore();
    }

    /* ── 流星（渐变拖尾） ── */
    maybeShoot();
    shoots = shoots.filter(function (s) { return s.op > 0.02; });
    shoots.forEach(function (s) {
      if (!s.active) {
        if (s.delay > 0) { s.delay--; return; }
        activateMeteor(s);
      }
      const tail = s.len / Math.hypot(s.dx, s.dy);
      const gr = ctx.createLinearGradient(s.x, s.y, s.x - s.dx * tail, s.y - s.dy * tail);
      gr.addColorStop(0, 'rgba(255,255,255,' + s.op + ')');
      gr.addColorStop(0.25, 'rgba(0,212,255,' + (s.op * 0.6) + ')');
      gr.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = s.op; ctx.strokeStyle = gr; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.dx * tail, s.y - s.dy * tail);
      ctx.stroke(); ctx.restore();
      s.x += s.dx; s.y += s.dy; s.op -= 0.018;
    });

    requestAnimationFrame(draw);
  }

  /* 能量场开关：鼠标进出视口 */
  document.addEventListener('mouseenter', function () { _energyEnabled = true; });
  document.addEventListener('mouseleave', function () {
    _energyEnabled = false; _mx = -9999; _my = -9999;
  });

  window.addEventListener('resize', function () { resize(); createStars(120); });
  resize(); createStars(120); requestAnimationFrame(draw);
})();

/* ──────────────────────────────────────────────────────────
   巨型 Warframe 徽标呼吸背景 — 随机故障效果
─────────────────────────────────────────────────────────── */
(function initWfGlitch() {
  /* 登录页（__bwUtilsOnly）不跑：登录页已有内联的同款 glitch 脚本，
     重复排程会让故障效果触发频率翻倍 */
  if (window.__bwUtilsOnly) return;
  const img = document.querySelector('.bw-wf-bg img');
  /* dark 一并排除：碳素仪器定位要求彻底去色偏，glitch 色散全部关掉 */
  if (!img || _isMinimal() || _isEyecare() || _isDark()) return;
  function trigger() {
    if (_isMinimal() || _isEyecare() || _isDark()) return; /* 运行中途切到极简/护眼/dark：不再排程下一次故障效果 */
    img.classList.add('glitching');
    setTimeout(function() { img.classList.remove('glitching'); }, 560);
    setTimeout(trigger, 2000 + Math.random()*3000);
  }
  setTimeout(trigger, 2000 + Math.random()*3000);
})();

/* ──────────────────────────────────────────────────────────
   顶栏导航按钮 — 仅对当前悬停激活的按钮随机触发故障效果（CD 1.2~3s）
   未激活的按钮不触发；鼠标移出立即停止并清理定时器
─────────────────────────────────────────────────────────── */
(function initNavGlitch() {
  /* 登录页（__bwUtilsOnly）不跑：登录页顶栏没有 .bw-nav-link 导航，
     无需绑定（即使选择器命中不了任何东西，也明确跳过避免歧义） */
  if (window.__bwUtilsOnly) return;
  document.querySelectorAll('.bw-nav-link, a.bw-brand').forEach(function(link) {
    var glitchTimer = null;
    var clearTimer  = null;

    function stopLoop() {
      if (glitchTimer) { clearTimeout(glitchTimer); glitchTimer = null; }
      if (clearTimer)  { clearTimeout(clearTimer);  clearTimer  = null; }
      link.classList.remove('glitching');
    }

    function loopTick() {
      /* dark 同样不触发：navLabelGlitch 关键帧是红/青色散阴影，与徽标 glitch 一样属色偏装饰 */
      if (_isMinimal() || _isDark() || !link.matches(':hover')) return;
      var delay = 1200 + Math.random() * 1800; // 1.2s ~ 3s
      glitchTimer = setTimeout(function() {
        if (_isMinimal() || _isDark() || !link.matches(':hover')) return;
        link.classList.add('glitching');
        clearTimer = setTimeout(function() { link.classList.remove('glitching'); }, 440);
        loopTick();
      }, delay);
    }

    link.addEventListener('mouseenter', function() {
      stopLoop();
      loopTick();
    });
    link.addEventListener('mouseleave', stopLoop);
  });
})();

/* ──────────────────────────────────────────────────────────
   通用批量操作引擎：进度条 + 失败面板 + 一键重试
   由 idPrefix 决定绑定哪组 DOM（默认 'bw-batch'，对应
   #bw-batch-bar / #bw-batch-progress / #bw-batch-prog-text /
   #bw-batch-fail / #bw-batch-fail-n / #bw-batch-fail-list /
   #bw-batch-fail-toggle），一个页面可以有多组批量面板并存
   （例如同一页面内"批量上架"和"批量下架"两个功能区各用一组）。

   workFn(item) — 对单个 item 执行的异步操作；正常返回=成功，
                  抛出异常=失败（会被收进失败面板，可重试）。
   opts = {
     idPrefix: 'bw-batch',
     delayMs:  410,             // 每项之间的限速间隔
     onDone:   fn,              // 全部处理完后调用（无论有没有失败）
     getLabel: item => { type, name },  // 失败面板里怎么显示这一项
   }
─────────────────────────────────────────────────────────── */
const _batchState = {}; // idPrefix -> { failures, retryFn }
const _batchAbort = {}; // idPrefix -> { requested: bool }

/* 批量面板（bw-batch-panel）动态显示：默认隐藏，仅当批量操作激活时才出现
   （进度条 + 停止按钮 + 失败面板都在这层框体内），空闲时整块缩回。 */
function _batchPanelShow() { const p = document.getElementById('bw-batch-panel'); if (p) p.style.display = ''; }
function _batchPanelHide() { const p = document.getElementById('bw-batch-panel'); if (p) p.style.display = 'none'; }

async function runBatch(items, workFn, opts) {
  opts = opts || {};
  const idPrefix = opts.idPrefix || 'bw-batch';
  /* 333 ms ≈ 3 req/s；WM API 实测在此速率下极少触发限速，
     单项失败时自动重试 2 次（指数退避），彻底失败才记入失败面板。 */
  const delayMs  = opts.delayMs != null ? opts.delayMs : 333;
  const getLabel = opts.getLabel || function(item) { return { type: '', name: String(item) }; };

  const bar     = document.getElementById(idPrefix + '-bar');
  const prog    = document.getElementById(idPrefix + '-progress');
  const txt     = document.getElementById(idPrefix + '-prog-text');
  const abortBtn = document.getElementById(idPrefix + '-abort-btn');
  if (!bar || !prog || !txt) return;

  // 重置中止标志并绑定按钮
  _batchAbort[idPrefix] = { requested: false };
  if (abortBtn) {
    abortBtn.classList.remove('is-aborting');
    abortBtn.onclick = function() {
      _batchAbort[idPrefix].requested = true;
      abortBtn.classList.add('is-aborting');
      abortBtn.textContent = '中止中…';
    };
  }

  hideBatchFail(idPrefix);
  _batchPanelShow();
  prog.style.display = '';
  bar.style.width = '0%';
  txt.style.display = ''; txt.style.color = '';

  let done = 0;
  let aborted = false;
  const failures = [];
  for (const item of items) {
    if (_batchAbort[idPrefix] && _batchAbort[idPrefix].requested) {
      aborted = true; break;
    }
    try {
      /* 最多重试 2 次：先等固定间隔，再指数退避（1.5s / 3s）
         仅对网络/限速类错误重试；业务逻辑错误（如参数非法）直接失败 */
      let lastErr;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try { await workFn(item); lastErr = null; break; }
        catch (e) {
          lastErr = e;
          if (attempt >= 2) break;
          const isTransient = /429|502|503|504|network|timeout|failed to fetch/i.test(e.message || '');
          if (!isTransient) break;
          await sleep(1500 * (attempt + 1));
        }
      }
      if (lastErr) throw lastErr;
    }
    /* 失败原因统一过 bwWmErrorText：WM 透传的错误信封是 raw JSON，
       直接进失败面板用户看不懂（删单报 notVerified 的真实案例就发生在这里） */
    catch (e) { failures.push({ item: item, err: window.bwWmErrorText(e) }); }
    done++;
    bar.style.width = Math.round(done / items.length * 100) + '%';
    txt.textContent = done + ' / ' + items.length + (failures.length ? '  ✗' + failures.length : '');
    if (delayMs) await sleep(delayMs);
  }

  if (abortBtn) {
    abortBtn.classList.remove('is-aborting');
    abortBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg> 中止';
    abortBtn.onclick = null;
  }
  prog.style.display = 'none'; bar.style.width = '0%';
  txt.style.display = 'none';

  if (aborted) {
    txt.style.display = '';
    txt.style.color = 'var(--c-warn)';
    txt.textContent = '已中止（' + done + ' / ' + items.length + ' 完成）';
    setTimeout(function() { txt.style.display = 'none'; txt.style.color = ''; _batchPanelHide(); }, 3500);
  } else if (!failures.length) {
    /* 正常结束且无失败：整体缩回 */
    _batchPanelHide();
  }
  /* 有失败：保留面板显示失败列表（showBatchFail 内），关闭后由 hideBatchFail 收起 */

  if (opts.onDone) opts.onDone();
  if (failures.length) {
    showBatchFail(failures, idPrefix, getLabel, function() {
      return runBatch(failures.map(function(f) { return f.item; }), workFn, opts);
    });
  }
}

function showBatchFail(failures, idPrefix, getLabel, retryFn) {
  idPrefix = idPrefix || 'bw-batch';
  _batchState[idPrefix] = { failures: failures, retryFn: retryFn };
  const panel = document.getElementById(idPrefix + '-fail');
  const n     = document.getElementById(idPrefix + '-fail-n');
  const list  = document.getElementById(idPrefix + '-fail-list');
  const tgl   = document.getElementById(idPrefix + '-fail-toggle');
  if (!panel) return;
  n.textContent = failures.length;
  list.innerHTML = failures.map(function(f) {
    const lbl = getLabel(f.item);
    return '<div class="bw-batch-fail-row">' +
      '<span class="bw-batch-fail-name">' + (lbl.type ? '<em>' + _escHtml(lbl.type) + '</em>' : '') + _escHtml(lbl.name) + '</span>' +
      '<span class="bw-batch-fail-err">' + _escHtml(f.err) + '</span></div>';
  }).join('');
  list.style.display = 'none';
  if (tgl) tgl.textContent = '展开详情';
  panel.style.display = '';
  _batchPanelShow(); // 失败面板在批量面板框体内，确保框体可见
}

function hideBatchFail(idPrefix) {
  idPrefix = idPrefix || 'bw-batch';
  delete _batchState[idPrefix];
  const panel = document.getElementById(idPrefix + '-fail');
  if (panel) panel.style.display = 'none';
  const list = document.getElementById(idPrefix + '-fail-list');
  if (list) { list.style.display = 'none'; list.innerHTML = ''; }
  const toggle = document.getElementById(idPrefix + '-fail-toggle');
  if (toggle) toggle.textContent = '展开详情';
  const n = document.getElementById(idPrefix + '-fail-n');
  if (n) n.textContent = '0';
  _batchPanelHide(); // 失败面板关闭 → 批量面板整体缩回
}

async function retryBatchFailures(idPrefix) {
  idPrefix = idPrefix || 'bw-batch';
  const st = _batchState[idPrefix];
  if (!st || !st.retryFn) return;
  await st.retryFn();
}

/* ══════════════════════════════════════════════════════════
   P0 — 移动端抽屉导航
   ══════════════════════════════════════════════════════════ */
(function initDrawer() {
  var btn     = document.getElementById('bw-hamburger');
  var overlay = document.getElementById('bw-drawer-overlay');
  var drawer  = document.getElementById('bw-drawer');
  var dLogout = document.getElementById('bw-drawer-logout-btn');
  if (!btn || !drawer) return;

  function openDrawer() {
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    drawer.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('show');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', function() {
    drawer.classList.contains('show') ? closeDrawer() : openDrawer();
  });
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && drawer.classList.contains('show')) closeDrawer();
  });

  // 抽屉内登出按钮复用桌面登出逻辑
  if (dLogout) {
    dLogout.addEventListener('click', function() {
      closeDrawer();
      var desktopLogout = document.getElementById('bw-logout-btn');
      if (desktopLogout) desktopLogout.click();
    });
  }
}());

/* ══════════════════════════════════════════════════════════
   P1 — 暗金 Toast 通知系统
   ══════════════════════════════════════════════════════════ */
(function initToast() {
  var container = document.getElementById('bw-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'bw-toast-container';
    document.body.appendChild(container);
  }
  window._bwToastContainer = container;
}());

function bwToast(msg, type, title) {
  type = type || 'info';
  var container = window._bwToastContainer;
  if (!container) return;

  var icons = { info: '◆', success: '✓', warn: '⚠', error: '✕' };
  var titles = { info: '提示', success: '成功', warn: '注意', error: '错误' };

  var el = document.createElement('div');
  el.className = 'bw-toast bw-toast--' + type;
  el.style.position = 'relative';
  el.innerHTML =
    '<span class="bw-toast-icon">' + (icons[type] || '◆') + '</span>' +
    '<div class="bw-toast-body">' +
      '<div class="bw-toast-title">' + _escHtml(title || titles[type] || '提示') + '</div>' +
      '<div class="bw-toast-msg">'   + _escHtml(msg) + '</div>' +
    '</div>' +
    '<button class="bw-toast-close" aria-label="关闭">✕</button>' +
    '<div class="bw-toast-bar"></div>';

  container.appendChild(el);

  // 进度条动画
  var bar = el.querySelector('.bw-toast-bar');
  var duration = type === 'error' ? 6000 : 4000;
  bar.style.transition = 'transform ' + duration + 'ms linear';
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      bar.style.transform = 'scaleX(0)';
    });
  });

  // 入场
  requestAnimationFrame(function() { el.classList.add('show'); });

  function dismiss() {
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 380);
  }

  el.querySelector('.bw-toast-close').addEventListener('click', dismiss);
  var timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', function() { clearTimeout(timer); });
  el.addEventListener('mouseleave', function() { timer = setTimeout(dismiss, 1500); });
}

/* ═══════════════════════════════════════════════════════════
   GSAP 交互增强模块
   保留：quickTo鼠标平滑(0)、3D卡片倾斜(3)、ScrollTrigger背景(5)、面板揭示(6)、Cyber扫线(8)
   已迁移至CSS：磁吸按钮(4)、批量脉冲(7b)、Gold角标/微光(9)、Dark呼吸(10)
   已整合至initStars：星空能量场(2)
   不触碰任何 API/业务逻辑。
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* 守卫：GSAP 未加载 / 极简模式 / 护眼模式 → 不初始化 */
  if (typeof gsap === 'undefined') return;
  if (typeof _isMinimal === 'function' && _isMinimal()) return;
  if (typeof _isEyecare === 'function' && _isEyecare()) return;

  /* ═══════════════════════════════════════════════════════════
     0. GSAP quickTo 平滑鼠标坐标 → 驱动星空能量场
     复刻 Ws-Web gsapMouseEffects.js
     ═══════════════════════════════════════════════════════════ */
  var _isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (_isReducedMotion) {
    /* 降级：直接赋值，无 GSAP 插值 */
    document.addEventListener('mousemove', function (e) {
      window._gsapMouse = { x: e.clientX, y: e.clientY };
    });
  } else {
    var _mouse = { x: -9999, y: -9999 };
    window._gsapMouse = _mouse;
    var _xTo = gsap.quickTo(_mouse, 'x', { duration: 0.15, ease: 'power2.out', overwrite: 'auto' });
    var _yTo = gsap.quickTo(_mouse, 'y', { duration: 0.15, ease: 'power2.out', overwrite: 'auto' });
    document.addEventListener('mousemove', function (e) { _xTo(e.clientX); _yTo(e.clientY); });
    document.addEventListener('pointermove', function (e) { _xTo(e.clientX); _yTo(e.clientY); });
  }

  /* 当前主题 ID — 统一从 data-fui-theme 属性读取，与 _isMinimal/_isEyecare/_isDark 一致 */
  function _isGold() { return document.documentElement.getAttribute('data-fui-theme') === 'gold'; }
  function _isCyber() { return document.documentElement.getAttribute('data-fui-theme') === 'cyber'; }

  /* RAF 节流：将高频事件降到 ~30fps */
  var _rafTilt = 0;
  function _throttleTilt(fn) {
    return function (e) {
      if (_rafTilt) return;
      _rafTilt = requestAnimationFrame(function () {
        _rafTilt = 0;
        fn(e);
      });
    };
  }

  /* ═══════════════════════════════════════════════════════════
     2. 星空能量场 — 已整合至 initStars（read window._gsapMouse）
     ═══════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════
     3. 订单卡片 3D 交互 — RAF 节流 + will-change
     ═══════════════════════════════════════════════════════════ */
  var _tiltMul = _isDark() ? 0.4 : 1;
  var _hoveredRow = null;

  document.addEventListener('mousemove', _throttleTilt(function (e) {
    if (!_hoveredRow) return;
    var rect = _hoveredRow.getBoundingClientRect();
    var cx = (e.clientX - rect.left) / rect.width - 0.5;
    var cy = (e.clientY - rect.top) / rect.height - 0.5;
    _hoveredRow.style.transform = 'perspective(500px) rotateY(' + (cx * 10 * _tiltMul) + 'deg) rotateX(' + (-cy * 7 * _tiltMul) + 'deg) scale(1.012) translateY(-2px)';
  }));

  document.addEventListener('mouseenter', function (e) {
    var row = e.target.closest && e.target.closest('.bw-order-row');
    if (!row) return;
    _hoveredRow = row;
    row.style.willChange = 'transform';
    if (_isCyber()) {
      row.style.boxShadow = '0 0 24px rgba(0,210,255,0.35), 0 0 6px rgba(140,50,255,0.2)';
      row.style.borderColor = 'rgba(0,210,255,0.5)';
    } else if (_isGold()) {
      row.style.boxShadow = '0 0 28px rgba(212,175,55,0.3), inset 0 0 16px rgba(212,175,55,0.06)';
    }
  }, true);

  document.addEventListener('mouseleave', function (e) {
    var row = e.target.closest && e.target.closest('.bw-order-row');
    if (!row) return;
    _hoveredRow = null;
    row.style.willChange = '';
    row.style.transform = '';
    row.style.boxShadow = '';
    row.style.borderColor = '';
  }, true);

  /* ═══════════════════════════════════════════════════════════
     4. 磁吸按钮 — 已迁移至 CSS transition（.bw-nav-link:hover 等）
     ═══════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════
     5. 背景滚动视差（scrub 模式，性能友好）
     ═══════════════════════════════════════════════════════════ */
  var nebulaBg = document.querySelector('.nebula-bg');
  var wfBg = document.querySelector('.bw-wf-bg img');
  if (nebulaBg) {
    gsap.to(nebulaBg, {
      y: 100, ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1.5 }
    });
  }
  if (wfBg && !_isDark()) {
    gsap.to(wfBg, {
      y: 140, ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 2 }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     6. ScrollTrigger 面板揭示
     ═══════════════════════════════════════════════════════════ */
  gsap.utils.toArray('.bw-batch-panel, .bw-profile-card').forEach(function (el) {
    gsap.from(el, {
      y: 50, opacity: 0, scale: 0.96, duration: 0.8,
      ease: 'back.out(1.3)',
      scrollTrigger: { trigger: el, start: 'top 93%', toggleActions: 'play none none none' }
    });
  });

  /* ═══════════════════════════════════════════════════════════
     7. 微交互
     ═══════════════════════════════════════════════════════════ */

  /* pill 弹性切换 */
  document.addEventListener('click', function (e) {
    var pill = e.target.closest('.bw-filter-pill');
    if (!pill) return;
    gsap.fromTo(pill, { scale: 0.85 }, { scale: 1, duration: 0.55, ease: 'elastic.out(1.2, 0.3)' });
  });

  /* 批量完成脉冲 — 已迁移至 CSS @keyframes bwBatchPulse */

  /* ═══════════════════════════════════════════════════════════
     8. Cyber「深空协议」专属 — 仅触发式效果，无持续动画
     ═══════════════════════════════════════════════════════════ */
  if (_isCyber()) {
    /* 扫描线（单元素，CSS animation 替代 GSAP 持续动画） */
    var scanline = document.createElement('div');
    scanline.style.cssText = 'position:fixed;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 5%,rgba(0,210,255,0.5) 30%,rgba(140,50,255,0.5) 70%,transparent 95%);pointer-events:none;z-index:9998;opacity:0.7;will-change:transform;';
    document.body.appendChild(scanline);
    /* 用 CSS animation 替代 GSAP ticker，GPU 合成零 CPU 开销 */
    scanline.style.animation = 'bwCyberScanline 2.5s linear infinite';

    /* 导航/徽标 hover glitch — 触发式 timeline，不持续运行 */
    document.querySelectorAll('.bw-logo img, .bw-nav-link').forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        gsap.timeline({ repeat: 1 })
          .to(el, { x: -4, skewX: 3, filter: 'hue-rotate(40deg) saturate(1.5)', duration: 0.05 })
          .to(el, { x: 5, skewX: -3, filter: 'hue-rotate(-30deg) saturate(1.8)', duration: 0.05 })
          .to(el, { x: -3, skewX: 2, filter: 'hue-rotate(15deg)', duration: 0.05 })
          .to(el, { x: 0, skewX: 0, filter: 'none', duration: 0.08 });
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     9. Gold「帝金」专属 — 已迁移至 CSS
     角标: .bw-gold-order:hover::after + @keyframes bwGoldCornerIn
     导航微光: [data-fui-theme="gold"] .bw-nav-link:hover text-shadow
     ═══════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════
     10. Dark「碳素仪器」— 已迁移至 CSS @keyframes bwDarkBreath
     ═══════════════════════════════════════════════════════════ */

})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){ try{ navigator.serviceWorker.register('/sw.js').catch(function(){}); }catch(e){} });
}
