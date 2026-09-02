/* Public-WM —— Warframe.market 交易工具（公版）Worker 入口
 *
 * 这玩意是 Private-WM（CSC·Alliance 的 Boss Tool）的公开版（已补回 Private 批量、量化等，保留无状态会话与 PWM_KV）：
 *   - 全部 KV（白名单 / 会话 / JWT 池 / 镜像登录）
 *   - 自动化批量（Cron 定时、GitHub Actions 均价流水线）
 *   - 吃内存的页面（量化、中英互译、OCR）
 * 保留：登录、订单、物品总表、均价、拍卖、在线状态、批量、量化。
 *
 * 认证是无状态的：用户拿自己的 WM 账号登录（或者贴 JWT），Worker 代做 signin，
 * 把 WM JWT 塞进 HttpOnly Cookie（bw_session），后面的请求就靠 cookie 里的 JWT
 * 直连 WM。没白名单、没会话表，任何有效 WM 账号都能登，登出就清 cookie。
 *
 * 部署：Cloudflare Workers / 腾讯 EdgeOne 边缘函数都能跑（module fetch 格式），
 * 不需要 KV / Assets 绑定，只处理 /api/* 动态请求。
 *
 * 网络：所有 WM 流量 Worker 直连 api.warframe.market，不用第三方付费透传。
 * 大陆直连能通但偏慢，统一走带超时的 fetchT + 断线重试；均价这类批量数据
 * 由前端经 jsDelivr 从本仓库直接拉，不占 Worker 流量。
 */

const SESSION_COOKIE = 'bw_session';  // 存 WM JWT（HttpOnly）
const CSRF_COOKIE    = 'bw_csrf';     // 存 WM CSRF token（HttpOnly）
const USER_COOKIE    = 'bw_user';     // 存 { email, ingame_name, wm_username }
const COOKIE_TTL     = 60 * 60 * 12;  // 12h，与 WM JWT 同步
const WM_API         = 'https://api.warframe.market';
const WM_DEVICE_ID   = '987d81b2-8a2c-425b-ae0e-cfba824548da';

/* ══ 跨域配置：前端静态站跑在 market.wfspeed.run（EdgeOne Pages 纯静态），
   API 单独挂在 pwm-api.wfspeed.run（本站边缘函数）。所以边缘函数得对前端
   放行 CORS，顺便透传登录 Cookie（都在 wfspeed.run 站点下，SameSite=Strict 就行）。 */
const CORS_ORIGIN = 'https://market.wfspeed.run';
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':      CORS_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type',
    'Access-Control-Max-Age':           '86400',
  };
}
function withCors(resp) {
  if (resp.status === 101) return resp; // WebSocket 升级无 CORS
  const h = new Headers(resp.headers);
  const c = corsHeaders();
  for (const k in c) h.set(k, c[k]);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

/* 均价 / 物品详情的进程内缓存（无 KV，纯内存，替代原 KV 缓存） */
const PRICE_CACHE_TTL = 60 * 5;    // 5min
const DETAIL_CACHE_TTL = 60 * 60;  // 1h
const CACHE_MAX_KEYS  = 500;       // 均价/详情缓存上限，超出清空（防内存膨胀）

/* ══ 通用工具 ═══════════════════════════════════════════════ */
function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* 带超时的 fetch：大陆直连 WM 网络一抖就快速失败，丢给 fetchRetry 去重试，
   免得单个请求挂死把边缘函数的时长上限耗光 */
function fetchT(url, opts, ms) {
  let done = false, c = null;
  try { c = new AbortController(); } catch (e) {}
  const t = setTimeout(function () { if (!done && c) { try { c.abort(); } catch (e) {} } }, ms || 8000);
  const p = Object.assign({}, opts || {});
  if (c) p.signal = c.signal;
  function fin(r) { done = true; clearTimeout(t); return r; }
  return fetch(url, p).then(fin, function (e) { fin(null); throw e; });
}

/* 直连 WM 的重试封装：GET 这类幂等请求失败就自动重试 2 次（隔 800ms），
   已经拿到响应（非 2xx）就不再重试，重试也没用 */
async function fetchRetry(url, opts, retries) {
  let lastErr = null;
  const attempts = (retries == null ? 2 : retries) + 1;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise(function (r) { setTimeout(r, 800); });
    try {
      const r = await fetchT(url, opts, 8000);
      if (r.status >= 200 && r.status < 300) return r;
      return r; // 有响应的失败状态码：直接返回，交给调用方按 status 处理
    } catch (e) { lastErr = e; /* 网络/超时：继续重试 */ }
  }
  throw lastErr || new Error('网络连接失败');
}

/* EdgeOne 边缘函数不会像 Cloudflare Workers 那样自动补 WebSocket 握手头，
   得手动带上 Sec-WebSocket-Version:13 和 Sec-WebSocket-Key，不然 WM 会
   回 400 "unsupported WebSocket protocol version"。
   extra 用来追加额外头（比如 handleWsStatus 要的 x-csrftoken）。 */
function wsHandshakeHeaders(wmJwt, extra) {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const key = btoa(String.fromCharCode.apply(null, b));
  const h = {
    'Upgrade':                'websocket',
    'Connection':             'Upgrade',
    'Sec-WebSocket-Version':  '13',
    'Sec-WebSocket-Key':      key,
    'Sec-WebSocket-Protocol': 'wfm',
    'Cookie':                 'JWT=' + wmJwt,
    'Authorization':          'JWT ' + wmJwt,
    'Platform':               'pc',
    'Language':               'en',
    'Origin':                 'https://warframe.market',
    'Referer':                'https://warframe.market/',
    'User-Agent':             'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function cookieHeader(name, value, maxAge) {
  return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;
}

function authCookies(jwt, csrf, user) {
  const headers = [
    cookieHeader(SESSION_COOKIE, jwt, COOKIE_TTL),
    cookieHeader(CSRF_COOKIE, csrf || '', COOKIE_TTL),
    cookieHeader(USER_COOKIE, encodeURIComponent(JSON.stringify(user)), COOKIE_TTL),
  ];
  return headers;
}

function clearCookies() {
  return [
    cookieHeader(SESSION_COOKIE, '', 0),
    cookieHeader(CSRF_COOKIE, '', 0),
    cookieHeader(USER_COOKIE, '', 0),
  ];
}

/* ══ 检测 Cloudflare 质询 ──────────────────────────── */
function isCfChallenge(resp, bodyText) {
  if (resp.headers.get('Cf-Mitigated') === 'challenge') return true;
  if (bodyText && bodyText.includes('_cf_chl_opt')) return true;
  return false;
}

/* ══ WM signin：用用户自己的凭据换取 WM JWT ══════════════ */
async function wmSigninWithCredentials(email, password, cfClearance, ua) {
  var cfCookie = cfClearance || '';
  // UA 可传入用户浏览器真实 UA：cf_clearance 若与 UA 绑定，代理验证通道里必须保持一致
  const UA = ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
  const wmPageHeaders = {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (cfCookie) wmPageHeaders['Cookie'] = 'cf_clearance=' + cfCookie;

  const pageResp = await fetchT('https://warframe.market/auth/signin', { headers: wmPageHeaders }, 15000);
  const html = await pageResp.text();

  // Cloudflare 质询 → 向上抛出特定错误，由 handleLogin 返回 challenge 信号
  if (isCfChallenge(pageResp, html)) throw new Error('CF_CHALLENGE_REQUIRED');

  const metaMatch = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  const csrfToken = metaMatch ? metaMatch[1] : null;
  if (!csrfToken) throw new Error('无法获取 CSRF token，请稍后重试');

  const rawSetCookie = pageResp.headers.get('Set-Cookie') || '';
  const preJwtMatch  = rawSetCookie.match(/JWT=([^;,\s]+)/);
  const postHeaders  = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    'Origin':       'https://warframe.market',
    'Referer':      'https://warframe.market/auth/signin',
    'Platform':     'pc',
    'Language':     'en',
    'User-Agent':   UA,
    'x-csrftoken':  csrfToken,
  };
  if (preJwtMatch) postHeaders['Cookie'] = 'JWT=' + preJwtMatch[1];

  const resp = await fetchT(`${WM_API}/v1/auth/signin`, {
    method: 'POST', headers: postHeaders,
    body: JSON.stringify({ email, password, device_id: WM_DEVICE_ID }),
  }, 15000);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error((resp.status === 401 || resp.status === 400) ? 'WM 邮箱或密码错误' : `WM 登录失败(${resp.status})`);
  }
  const postCookie = resp.headers.get('Set-Cookie') || '';
  const jwtMatch   = postCookie.match(/JWT=([^;,\s]+)/);
  if (!jwtMatch) throw new Error('WM 未返回 JWT，请重试');
  const newJwt = jwtMatch[1];

  // 用户名来源改为 v2/me（实测确认的真实响应结构，字段是驼峰命名 ingameName）
  // ingameName 为空字符串代表账号未完成 WM 论坛验证，属于正常情况，不是取值失败。
  let ingame_name = null;
  try {
    const meResp = await fetchRetry(`${WM_API}/v2/me`, {
      headers: {
        'Cookie':       'JWT=' + newJwt,
        'Authorization':'JWT ' + newJwt,
        'Accept':       'application/json',
        'Platform':     'pc',
        'Language':     'en',
        'User-Agent':   UA,
      },
    });
    if (meResp.ok) {
      const mj = await meResp.json();
      const data = mj && mj.data;
      ingame_name = (data && (data.ingameName || data.slug)) || null;
    }
  } catch {}

  // 获取与新 JWT 绑定的 CSRF token（用于后续 v1 写操作）
  let sessionCsrf = csrfToken; // 先用登录页的作为兜底
  try {
    const profileHeaders = {
      'Cookie':     'JWT=' + newJwt,
      'User-Agent': UA,
      'Accept':     'text/html',
    };
    if (cfCookie) profileHeaders['Cookie'] += '; cf_clearance=' + cfCookie;
    const profileResp = await fetchT('https://warframe.market', { headers: profileHeaders }, 8000);
    const profileHtml = await profileResp.text();
    const m = profileHtml.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
           || profileHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
    if (m && m[1]) sessionCsrf = m[1];
  } catch {}

  return { jwt: newJwt, ingame_name, csrf: sessionCsrf };
}

/* WM signin 包一层：碰到 WM 网络/超时类错误（net_exception_connect_timeout、
   连不上、5xx 之类）就自动重试 3 次——WM 对机房出口偶尔抽风，重试基本能成。
   signin 是幂等的（多登录一次没损失），可以放心重试。
   像 CF 质询、密码错了这种确定的错就不重试，直接抛。 */
async function wmSigninWithRetry(email, password, cfClearance, ua) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise(function (r) { setTimeout(r, 1200); });
    try {
      return await wmSigninWithCredentials(email, password, cfClearance, ua);
    } catch (e) {
      lastErr = e;
      const m = (e && e.message) || '';
      if (m === 'CF_CHALLENGE_REQUIRED' || m.indexOf('邮箱或密码错误') !== -1) throw e;
      const transient = /timeout|net_exception|connect|abort|network|upstream|5\d\d/i.test(m)
                     || m.indexOf('无法获取 CSRF') !== -1
                     || m.indexOf('未返回 JWT') !== -1;
      if (!transient) throw e;
      /* transient：继续重试 */
    }
  }
  throw lastErr || new Error('WM 连接超时，请稍后重试');
}

/* ══ JWT 辅助登录 ═══════════════════════════════
   用户从浏览器手动提取 WM JWT 贴入，同时提供邮箱密码，
   Worker 先用账号密码做 WM signin 获取独立 session，
   再用提供的 JWT 覆盖（JWT 优先级 > signin 返回的 JWT）。 */
/* 校验 WM JWT（调 /v2/me），返回 ingameName；无效就抛带 status 的错。
   大陆直连能通，走 fetchRetry 自动重试。 */
async function validateWmJwt(jwt) {
  const headers = {
    'Cookie':       'JWT=' + jwt,
    'Authorization':'JWT ' + jwt,
    'Accept':       'application/json',
    'Platform':     'pc',
    'Language':     'en',
    'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  };
  let lastStatus = 0;
  try {
    const meResp = await fetchRetry(`${WM_API}/v2/me`, { headers });
    if (!meResp.ok) lastStatus = meResp.status;
    else {
      const mj = await meResp.json();
      const data = mj && mj.data;
      return (data && (data.ingameName || data.slug)) || null;
    }
  } catch { lastStatus = 0; }
  const e = new Error('JWT 无效（WM 返回 ' + (lastStatus || '网络异常') + '），请检查后重试');
  e.status = lastStatus ? 401 : 502;
  throw e;
}

/* JWT + 账号密码 → 建立会话（纯 Cookie，无存储） */
async function handleLoginJwt(request) {
  const cookies = parseCookies(request);
  const cfClearance = cookies.cf_clearance || '';

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: '请求格式错误' }, 400); }
  const jwt = String((body && body.jwt) || '').trim();
  if (!jwt) return jsonResponse({ error: '请输入 JWT' }, 400);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!email || !password) return jsonResponse({ error: '请输入邮箱和密码' }, 400);

  // 验证 JWT 有效性：调一次 /v2/me
  let ingameName = null;
  try {
    ingameName = await validateWmJwt(jwt);
  } catch (e) {
    return jsonResponse({ error: (e && e.status) ? e.message : 'JWT 验证失败，网络异常' }, (e && e.status) || 502);
  }

  // 用账号密码做 signin 获取 csrf（若被 CF 阻挡则降级，仍可登录）
  let csrf = '';
  try {
    const result = await wmSigninWithRetry(email, password, cfClearance || '');
    csrf = result.csrf || '';
  } catch (e) {
    // CF 挑战/网络错误时降级：csrf 留空，后续 API 调用可能受限但不阻塞登录
  }

  const wm_username = ingameName || email.split('@')[0];
  const ingame_name = ingameName || wm_username;
  const resp = jsonResponse({ ok: true, email, ingame_name });
  authCookies(jwt, csrf, { email, ingame_name, wm_username }).forEach((c) => resp.headers.append('Set-Cookie', c));
  return resp;
}

/* ══ 直接登录：用 WM 账号验证身份 ═════════════════════ */
async function handleLogin(request) {
  const cookies = parseCookies(request);
  const cfClearance = cookies.cf_clearance || '';

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: '请求格式错误' }, 400); }

  const email    = String((body && body.email)    || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!email || !password) return jsonResponse({ error: '请输入邮箱和密码' }, 400);

  let wmJwt, wmIngameName, wmCsrf;
  try {
    const result = await wmSigninWithRetry(email, password, cfClearance);
    wmJwt = result.jwt; wmIngameName = result.ingame_name; wmCsrf = result.csrf;
  } catch (e) {
    if (e.message === 'CF_CHALLENGE_REQUIRED') {
      // 结构化标记：前端识别后自动把用户带进 JWT 手动粘贴指引
      return jsonResponse({ error: 'WM 当前要求人机验证，无法自动登录', cf_challenge: true }, 401);
    }
    return jsonResponse({ error: e.message }, 401);
  }

  // wm_username：WM 登录响应里的真实用户名，用于 API 路径（如 /v1/profile/{username}/auctions）
  const wm_username  = wmIngameName || email.split('@')[0];
  const ingame_name  = wmIngameName || wm_username;

  const resp = jsonResponse({ ok: true, email, ingame_name });
  authCookies(wmJwt, wmCsrf || '', { email, ingame_name, wm_username }).forEach((c) => resp.headers.append('Set-Cookie', c));
  return resp;
}

/* 动态响应防 CDN 缓存：登录/会话等响应必须显式声明 no-store，
   避免被边缘/CDN 节点缓存导致会话错乱 */
function noStore(resp) {
  resp.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  resp.headers.set('CDN-Cache-Control', 'no-store');
  resp.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return resp;
}

async function handleLogout() {
  const resp = jsonResponse({ ok: true });
  clearCookies().forEach((c) => resp.headers.append('Set-Cookie', c));
  return resp;
}

/* 返回 { email, ingame_name, wm_username, token } 或 null */
function getSession(request) {
  const cookies = parseCookies(request);
  const token   = cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const rec = JSON.parse(decodeURIComponent(cookies[USER_COOKIE] || '{}'));
    if (!rec || !rec.email) return null;
    return {
      email:       rec.email,
      ingame_name: rec.ingame_name,
      wm_username: rec.wm_username || rec.ingame_name || rec.email.split('@')[0],
      token,
    };
  } catch { return null; }
}

function getWmJwt(request) {
  const cookies = parseCookies(request);
  return cookies[SESSION_COOKIE] || null;
}

function getWmCsrf(request) {
  const cookies = parseCookies(request);
  return cookies[CSRF_COOKIE] || '';
}

async function handleMe(request) {
  const sess = getSession(request);
  if (!sess) return jsonResponse({ ok: false, error: '未登录' }, 401);
  const slug = sess.ingame_name || sess.email.split('@')[0];
  return jsonResponse({ ok: true, session: { slug, status: 'online', email: sess.email, avatar: null } });
}

/* ══ WM API fetch：直接接受 JWT，不再共享 ════════════════
   GET 走 fetchRetry（超时+断线重试，幂等安全）；
   写操作走 fetchT（仅超时不重试，避免重复提交）。 */
async function wmFetch(wmJwt, path, options, csrf) {
  const opts = Object.assign({ method: 'GET' }, options || {});
  const baseHeaders = { 'Cookie': 'JWT=' + wmJwt, 'Platform': 'pc', 'Language': 'en' };
  // v1 写操作需要 CSRF token
  if (csrf && path.startsWith('/v1') && ['POST','PUT','DELETE'].includes((opts.method || 'GET').toUpperCase())) {
    baseHeaders['x-csrftoken'] = csrf;
    baseHeaders['Origin']      = 'https://warframe.market';
    baseHeaders['Referer']     = 'https://warframe.market/';
  }
  opts.headers = Object.assign(baseHeaders, opts.headers || {});
  const method = (opts.method || 'GET').toUpperCase();
  const isGet = method === 'GET' || method === 'HEAD';
  return isGet
    ? fetchRetry(WM_API + path, opts)
    : fetchT(WM_API + path, opts, 10000);
}

/* 确保 v1 写操作有有效的 CSRF：cookie 里没有就从 WM 主页刷一个。
   返回 { csrf, fresh }；fresh=true 说明是新刷的，调用方记得把 csrf 种回 cookie。 */
async function ensureCsrf(wmJwt, csrf, request) {
  if (csrf) return { csrf, fresh: false };
  try {
    const cookies = parseCookies(request || {});
    const cfClearance = cookies.cf_clearance || '';
    const ua = (request && request.headers && request.headers.get('User-Agent')) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
    const wmHeaders = {
      'Cookie':     'JWT=' + wmJwt + (cfClearance ? '; cf_clearance=' + cfClearance : ''),
      'User-Agent': ua,
    };
    const pageResp = await fetchT('https://warframe.market', { headers: wmHeaders }, 8000);
    if (pageResp.ok) {
      const html = await pageResp.text();
      const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
      if (m && m[1]) return { csrf: m[1], fresh: true };
    }
  } catch {}
  return { csrf: '', fresh: false };
}

function wmJsonProxy(resp, text) {
  // WM 有时在 JWT 失效/端点不存在时返回 HTML，检测后转成可读错误
  if (text && text.trimStart().startsWith('<')) {
    const status = resp.status >= 400 ? resp.status : 502;
    return jsonResponse({ error: 'WM 返回非 JSON（status ' + resp.status + '），可能 JWT 已过期，请重新登录' }, status);
  }
  return new Response(text, {
    status:  resp.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ══ 小体积 KV 替代：内存 Map 缓存（上限 CACHE_MAX_KEYS，超出整体清空） ══ */
let _priceCache = new Map();
let _detailCache = new Map();
function memCacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl * 1000) { map.delete(key); return null; }
  return hit.value;
}
function memCachePut(map, key, value, ttl, maxKeys) {
  if (map.size >= (maxKeys || CACHE_MAX_KEYS)) map.clear();
  map.set(key, { value, at: Date.now(), ttl });
}

/* ══ WM API 代理：路由处理函数 ════════════════════════════ */

// GET /api/wm/orders —— 我方全部订单（含隐藏），使用 /v2/orders/my
// 注意：物品总表已改为前端经 jsDelivr 加载（data/wm-items.json），
// 本端点直接返回 WM 原始订单，由前端用本地物品表合并中文名/缩略图等，
// 边缘函数不再拉取大体积物品数据。
async function handleWmOrders(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const authResp = await wmFetch(wmJwt, '/v2/orders/my', {});
    const authJson = authResp.ok ? await authResp.json() : { data: [] };
    return jsonResponse({ data: authJson.data || [] });
  } catch (e) {
    return jsonResponse({ error: 'WM API 错误：' + e.message }, 502);
  }
}

// POST /api/wm/orders —— 创建订单
async function handleWmOrderCreate(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const body = await request.text();
    const resp = await wmFetch(wmJwt, '/v2/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    return wmJsonProxy(resp, await resp.text());
  } catch (e) {
    return jsonResponse({ error: 'WM API 错误：' + e.message }, 502);
  }
}

// PATCH /api/wm/orders/:id
async function handleWmOrderPatch(request, orderId) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const body = await request.text();
    const resp = await wmFetch(wmJwt, '/v2/order/' + orderId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return wmJsonProxy(resp, await resp.text());
  } catch (e) {
    return jsonResponse({ error: 'WM API 错误：' + e.message }, 502);
  }
}

// DELETE /api/wm/orders/:id
async function handleWmOrdersBatch(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: '请求格式错误' }, 400); }
  const patches = Array.isArray(body.patches) ? body.patches : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  const creates = Array.isArray(body.creates) ? body.creates : [];
  if (Array.isArray(body.ops)) {
    for (const o of body.ops) {
      if (o && o.method === 'DELETE' && o.id) deletes.push(o.id);
      else if (o && o.method === 'POST' && o.body) creates.push(o.body);
      else if (o && o.id && o.patch) patches.push({ id: o.id, patch: o.patch });
      else if (o && o.id && o.body) patches.push({ id: o.id, patch: o.body });
    }
  }
  const total = patches.length + deletes.length + creates.length;
  if (!total) return jsonResponse({ error: '空批量' }, 400);
  if (total > 300) return jsonResponse({ error: '批量上限300' }, 400);
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  const results = [];
  const fails = [];
  const delay = total > 120 ? 150 : 260;
  for (const p of patches) {
    const id = String(p.id||'').trim(); const patch = p.patch || p.body;
    if (!id || !patch) { fails.push({ id, error:'参数缺失' }); continue; }
    let lastErr=null;
    for (let attempt=0; attempt<=2; attempt++){
      try{
        const resp = await wmFetch(wmJwt, '/v2/order/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
        const txt = await resp.text();
        if (resp.ok) { results.push({ id, ok:true }); lastErr=null; break; }
        let msg=txt; try{ const j=JSON.parse(txt); msg=j.error?JSON.stringify(j.error):txt; }catch{}
        if (resp.status===429 || resp.status>=500) { lastErr=new Error(msg||('WM '+resp.status)); if(attempt<2) { await sleep(1500*(attempt+1)); continue; } }
        lastErr=new Error(msg); break;
      }catch(e){ lastErr=e; if(attempt<2 && /429|502|503|504|network|timeout|failed to fetch/i.test(e.message||'')) { await sleep(1500*(attempt+1)); continue; } break; }
    }
    if(lastErr) fails.push({ id, error: lastErr.message||String(lastErr) });
    if(delay) await sleep(delay);
  }
  for (const idRaw of deletes) {
    const id=String(idRaw).trim(); if(!id){ fails.push({id,error:'参数缺失'}); continue; }
    let lastErr=null;
    for(let attempt=0; attempt<=2; attempt++){
      try{
        const resp=await wmFetch(wmJwt, '/v2/order/'+id, { method:'DELETE' });
        if(resp.status===204 || resp.ok){ results.push({id, ok:true}); lastErr=null; break; }
        const txt=await resp.text(); if(resp.status===429||resp.status>=500){ lastErr=new Error(txt||('WM '+resp.status)); if(attempt<2){ await sleep(1500*(attempt+1)); continue; } } lastErr=new Error(txt); break;
      }catch(e){ lastErr=e; if(attempt<2 && /429|502|503/i.test(e.message||'')){ await sleep(1500*(attempt+1)); continue; } break; }
    }
    if(lastErr) fails.push({id, error:lastErr.message||String(lastErr)});
    if(delay) await sleep(delay);
  }
  for (const b of creates) {
    let lastErr=null;
    for(let attempt=0; attempt<=2; attempt++){
      try{
        const resp=await wmFetch(wmJwt, '/v2/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) });
        const txt=await resp.text();
        if(resp.ok){ let j={}; try{j=JSON.parse(txt);}catch{}; results.push({ ok:true, data:j.data||j }); lastErr=null; break; }
        if(resp.status===429||resp.status>=500){ lastErr=new Error(txt||('WM '+resp.status)); if(attempt<2){ await sleep(1500*(attempt+1)); continue; } } lastErr=new Error(txt); break;
      }catch(e){ lastErr=e; if(attempt<2 && /429|502/i.test(e.message||'')){ await sleep(1500*(attempt+1)); continue; } break; }
    }
    if(lastErr) fails.push({ error:lastErr.message||String(lastErr), body:b });
    if(delay) await sleep(delay);
  }
  return jsonResponse({ ok: fails.length===0, results, fails, total });
}

async function handleWmOrderDelete(request, orderId) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const resp = await wmFetch(wmJwt, '/v2/order/' + orderId, { method: 'DELETE' });
    if (resp.status === 204) return new Response(null, { status: 204 });
    return wmJsonProxy(resp, await resp.text());
  } catch (e) {
    return jsonResponse({ error: 'WM API 错误：' + e.message }, 502);
  }
}

/* WM 公开 API 请求头：直连 WM 时自报身份（不依赖任何第三方代理） */
const WM_PUBLIC_HEADERS = {
  'User-Agent':      'publicwm/1.0 (+https://github.com/AdminRoc/Public-WM; warframe market data tool)',
  'Accept':          'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Platform':        'pc',
  'Language':        'en',
  'Origin':          'https://warframe.market',
  'Referer':         'https://warframe.market/',
};

/* 直连 api.warframe.market 调 WM 公开接口（大陆可达，带超时 + 断线重试）。
 * overrideHeaders：可覆盖默认头（如 items 刷新需要 Language: zh-hans 取中文名）。 */
async function wmPublicFetch(path, overrideHeaders) {
  const headers = overrideHeaders ? Object.assign({}, WM_PUBLIC_HEADERS, overrideHeaders) : WM_PUBLIC_HEADERS;
  return fetchRetry(WM_API + path, { headers });
}

/* 均价计算通用函数（v2 订单字段：type/user.status/visible/platinum）
 * 口径：样本 = in-game + online 的卖单合在一起统计（offline 永远不算——挂机价失真）
 *   1. count>=3：去掉最低价（第 1 位），取第 2 和第 3 位价格的平均 = avg
 *   2. count 1~2：所有价格取平均
 *   3. count=0：avg=null（调用方/前端沿用上次的有效值）
 *   special = count<3（样本少，参考性弱） */
function calcAvg(allOrders) {
  const total = allOrders.length;
  const prices = allOrders
    .filter(function(o) {
      const type   = (o.type || o.order_type || o.orderType || '').toLowerCase();
      const status = ((o.user && (o.user.status || o.user.ingame_status)) || '').toLowerCase();
      return type === 'sell' && o.visible !== false && Number(o.platinum) > 0
             && (status === 'ingame' || status === 'online');
    })
    .map(function(o) { return Number(o.platinum); })
    .sort(function(a, b) { return a - b; });
  const count = prices.length;
  if (count === 0) {
    return { avg: null, count: 0, used: 0, total, source: 'combined', special: true };
  }
  let avg, used;
  if (count >= 3) { avg = Math.round((prices[1] + prices[2]) / 2); used = 2; }
  else            { avg = Math.round(prices.reduce(function(s, v) { return s + v; }, 0) / count); used = count; }
  const result = { avg, count, used, total, source: 'combined' };
  if (count < 3) result.special = true;
  return result;
}

// GET /api/wm/price/:slug —— 均价查询：内存缓存 → 实时拉取
async function handleWmPrice(request, slug) {
  if (!getSession(request)) return jsonResponse({ error: '请先登录' }, 401);

  const cacheKey = 'avg_price_v2_' + slug;
  const cached = memCacheGet(_priceCache, cacheKey);
  if (cached) return jsonResponse({ data: cached });

  // 实时拉取 v2 订单
  try {
    const resp = await wmPublicFetch('/v2/orders/item/' + encodeURIComponent(slug));
    if (!resp.ok) return jsonResponse({ data: { avg: null, count: 0, used: 0, _err: resp.status } });
    const json = await resp.json();
    const allOrders = json.data || [];
    const result = calcAvg(allOrders);
    if (result.avg !== null) {
      memCachePut(_priceCache, cacheKey, result, PRICE_CACHE_TTL, CACHE_MAX_KEYS);
    }
    return jsonResponse({ data: result });
  } catch (e) {
    return jsonResponse({ data: { avg: null, count: 0, used: 0, _err: e.message } });
  }
}

// GET /api/wm/item/:slug —— 物品详情
async function handleWmItemDetail(request, slug) {
  if (!getSession(request)) return jsonResponse({ error: '请先登录' }, 401);

  const cacheKey = 'item_detail_' + slug;
  const cached = memCacheGet(_detailCache, cacheKey);
  if (cached) return jsonResponse({ data: cached });

  try {
    const resp = await fetchRetry(`${WM_API}/v2/item/${encodeURIComponent(slug)}`, {
      headers: { 'Platform': 'pc', 'Language': 'zh-hans' },
    });
    if (!resp.ok) return jsonResponse({ data: null });
    const json = await resp.json();
    const data = json.data || null;
    if (data) {
      memCachePut(_detailCache, cacheKey, data, DETAIL_CACHE_TTL, CACHE_MAX_KEYS);
    }
    return jsonResponse({ data });
  } catch (e) {
    return jsonResponse({ data: null });
  }
}

/* ══ 静态资源代理（头像）═════════════════════════════════ */
async function handleAvatarProxy(request) {
  const url = new URL('/picture/avatar-csc-2026.svg', request.url);
  return fetch(url.toString());
}

/* ══ 在线状态：读取 & 设置 ══════════════════════════════════ */
async function handleGetStatus(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '未登录' }, 401);
  try {
    const resp = await wmFetch(wmJwt, '/v1/profile', {});
    if (!resp.ok) return jsonResponse({ status: 'offline' });
    const json = await resp.json();
    const profile = (json.payload && json.payload.profile) || json.data || {};
    return jsonResponse({ ok: true, status: profile.status || 'offline' });
  } catch { return jsonResponse({ status: 'offline' }); }
}

/* 在线状态设定：EdgeOne 边缘函数不支持出站 WebSocket（fetch wss 拿不到 webSocket），
   所以干脆复用 Private-WM 的 CF 出站 WS 能力（/api/wm/status-public 无状态端点，
   把用户自己的 WM JWT + 目标状态传过去，由 Private-WM worker 连 WM WS 做 status/set）。 */
const PRIVATE_WM_STATUS_URL = 'https://war-frame.com/api/wm/status-public';
async function handleSetStatus(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '未登录' }, 401);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: '参数错误' }, 400); }
  const status = body.status;
  if (!['online', 'ingame', 'invisible'].includes(status)) {
    return jsonResponse({ error: '无效状态值' }, 400);
  }
  try {
    const resp = await fetchRetry(PRIVATE_WM_STATUS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: wmJwt, status }),
    });
    const j = await resp.json().catch(() => ({}));
    const code = resp.ok ? (j && j.ok ? 200 : 502) : (resp.status || 502);
    return jsonResponse(j, code);
  } catch (e) {
    return jsonResponse({ error: '状态设定失败：' + e.message }, 502);
  }
}

/* ══ 在线状态：WebSocket 隧道 ══════════════════════════════════
   浏览器 ──WS──► Worker ──WS──► wss://ws.warframe.market/socket
   连接存活期间用户在线，浏览器关标签 → 两端 WS 均关闭 → 掉线。
   Worker 每 25s 向 WM WS 发 ping 保活。 */
async function handleWsStatus(request) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: '需要 WebSocket 连接' }, 426);
  }
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return new Response('未登录', { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'online';
  if (!['online', 'ingame', 'invisible'].includes(status)) {
    return new Response('无效状态值', { status: 400 });
  }

  // 读 CSRF（登录时种入 Cookie）
  const wmCsrf = getWmCsrf(request) || '';

  // 建立浏览器 ↔ Worker 的 WS 对
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  // 异步建立 Worker ↔ WM 的 WS 连接
  (async () => {
    let wmWs = null;
    let pingTimer = null;

    function cleanup() {
      if (pingTimer) clearInterval(pingTimer);
      try { wmWs && wmWs.close(); } catch {}
      try { server.close(); } catch {}
    }

    try {
      // 先用 JWT 刷一次 WM 主页取 fresh CSRF（确保 session 有效）
      let freshCsrf = wmCsrf;
      try {
        const pageResp = await fetchT('https://warframe.market', {
          headers: {
            'Cookie':     'JWT=' + wmJwt,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          },
        }, 8000);
        const html = await pageResp.text();
        const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
               || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
        if (m && m[1]) freshCsrf = m[1];
      } catch {}

      const wmResp = await fetchT('https://ws.warframe.market/socket', {
        headers: wsHandshakeHeaders(wmJwt, { 'x-csrftoken': freshCsrf }),
      }, 10000);

      // 把握手响应细节透传给浏览器（用于调试）
      const wsStatus = wmResp.status;
      const wsHeaders = {};
      for (const [k, v] of wmResp.headers.entries()) wsHeaders[k] = v;

      if (wsStatus !== 101) {
        const body = await wmResp.text().catch(() => '');
        server.send(JSON.stringify({ error: 'WM握手失败：' + wsStatus, headers: wsHeaders, body }));
        server.close();
        return;
      }

      wmWs = wmResp.webSocket;
      wmWs.accept();

      // WM WS 需要先发 auth/signIn（token 为空字符串，认证靠 HTTP 握手时的 JWT cookie）
      // 用状态机等待 auth/signIn:ok 再发 status/set，避免在 CF Workers WS 事件中使用 await
      let authDone = false;
      const authTimer = setTimeout(() => {
        if (!authDone) { server.send(JSON.stringify({ error: 'WM WS 认证超时' })); cleanup(); }
      }, 10000);

      wmWs.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (!authDone) {
            if (msg.route === '@wfm|cmd/auth/signIn:ok') {
              authDone = true;
              clearTimeout(authTimer);
              wmWs.send(JSON.stringify({ route: '@wfm|cmd/status/set', payload: { status, duration: null } }));
            } else if (msg.route === '@wfm|cmd/auth/signIn:error') {
              authDone = true;
              clearTimeout(authTimer);
              server.send(JSON.stringify({ error: 'WM WS 认证失败' }));
              cleanup();
            }
            return;
          }
          // 认证后：status/set:ok 通知前端，其余过滤广播心跳后透传
          if (msg.route === '@wfm|cmd/status/set:ok') {
            server.send(JSON.stringify({ ok: true, status }));
          } else if (msg.route && !msg.route.includes('reports/online')) {
            server.send(e.data);
          }
        } catch {}
      });

      wmWs.addEventListener('close', cleanup);
      wmWs.addEventListener('error', cleanup);

      // 浏览器关闭 → 关 WM WS
      server.addEventListener('close', cleanup);
      server.addEventListener('error', cleanup);

      // 发送 auth/signIn，触发状态机（认证成功后再发 status/set，{ok:true} 在 status/set:ok 时发）
      wmWs.send(JSON.stringify({ route: '@wfm|cmd/auth/signIn', payload: { token: '' } }));

      // 每 25s 发 ping 保活
      pingTimer = setInterval(() => {
        try { wmWs.send(JSON.stringify({ route: '@wfm|cmd/ping', payload: null })); } catch { cleanup(); }
      }, 25000);

    } catch (e) {
      try { server.send(JSON.stringify({ error: e.message })); } catch {}
      cleanup();
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}

/* ══ 拍卖（auctions.html）：裂罅Mod / 玄骸 / 姐妹 ═══════════════
   搜索、字典均为 WM 公开接口，经 Worker 代理（大陆不可直连 warframe.market）。
   我的拍卖 / 写操作走已存的 WM JWT。 */
const AUCTION_DICTS = {
  'riven/weapons':    '/v2/riven/weapons',
  'riven/attributes': '/v2/riven/attributes',
  'lich/weapons':     '/v2/lich/weapons',
  'lich/ephemeras':   '/v2/lich/ephemeras',
  'lich/quirks':      '/v2/lich/quirks',
  'sister/weapons':   '/v2/sister/weapons',
  'sister/ephemeras': '/v2/sister/ephemeras',
  'sister/quirks':    '/v2/sister/quirks',
};

async function handleAuctionDict(request, name) {
  if (!getSession(request)) return jsonResponse({ error: '请先登录' }, 401);
  const path = AUCTION_DICTS[name];
  if (!path) return jsonResponse({ error: '未知字典' }, 404);

  // 平台支持 Cache API 时用 CDN 缓存 24h；不支持则每次直拉（结果一致）
  let cache = null;
  try { cache = caches.default; } catch {}

  let cacheKey = null;
  if (cache) {
    const url = new URL(request.url);
    cacheKey = new Request(url.origin + url.pathname + '?v=zh3', { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    // 必须用 zh-hans，WM v2 API 在此语言下同时返回 en + zh-hans 两套 i18n
    const headers = Object.assign({}, WM_PUBLIC_HEADERS, { 'Language': 'zh-hans' });
    const resp = await wmPublicFetch(path, headers);
    const text = await resp.text();
    const out = new Response(text, { status: resp.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
    if (resp.ok && cache && cacheKey) cache.put(cacheKey, out.clone()).catch(function() {});
    return out;
  } catch (e) {
    return jsonResponse({ error: 'WM 字典拉取失败：' + (e.message || e) }, 502);
  }
}

async function handleAuctionSearch(request) {
  if (!getSession(request)) return jsonResponse({ error: '请先登录' }, 401);
  const url = new URL(request.url);
  const qs  = url.search || '';
  try {
    const resp = await wmPublicFetch('/v1/auctions/search' + qs);
    return wmJsonProxy(resp, await resp.text());
  } catch (e) {
    return jsonResponse({ error: 'WM 搜索失败：' + (e.message || e) }, 502);
  }
}

async function handleMyAuctions(request) {
  const sess = getSession(request);
  const wmJwt = getWmJwt(request);
  if (!wmJwt || !sess) return jsonResponse({ error: '请先登录' }, 401);
  const username = sess.wm_username || sess.ingame_name || sess.email.split('@')[0];
  try {
    const resp = await wmFetch(wmJwt, '/v1/profile/' + username + '/auctions');
    return wmJsonProxy(resp, await resp.text());
  } catch (e) {
    return jsonResponse({ error: 'WM 我的拍卖失败：' + (e.message || e) }, 502);
  }
}

async function handleAuctionClose(request, id) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const { csrf, fresh } = await ensureCsrf(wmJwt, getWmCsrf(request), request);
    const resp = await wmFetch(wmJwt, '/v1/auctions/entry/' + id + '/close', { method: 'PUT' }, csrf);
    const out = wmJsonProxy(resp, await resp.text());
    if (fresh && csrf) out.headers.append('Set-Cookie', cookieHeader(CSRF_COOKIE, csrf, COOKIE_TTL));
    return out;
  } catch (e) {
    return jsonResponse({ error: '下架失败：' + (e.message || e) }, 502);
  }
}

async function handleAuctionEdit(request, id) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const { csrf, fresh } = await ensureCsrf(wmJwt, getWmCsrf(request), request);
    const body = await request.text();
    const resp = await wmFetch(wmJwt, '/v1/auctions/entry/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, csrf);
    const out = wmJsonProxy(resp, await resp.text());
    if (fresh && csrf) out.headers.append('Set-Cookie', cookieHeader(CSRF_COOKIE, csrf, COOKIE_TTL));
    return out;
  } catch (e) {
    return jsonResponse({ error: '改价失败：' + (e.message || e) }, 502);
  }
}

async function handleAuctionCreate(request) {
  const wmJwt = getWmJwt(request);
  if (!wmJwt) return jsonResponse({ error: '请先登录' }, 401);
  try {
    const { csrf, fresh } = await ensureCsrf(wmJwt, getWmCsrf(request), request);
    const body = await request.text();
    const resp = await wmFetch(wmJwt, '/v1/auctions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, csrf);
    const out = wmJsonProxy(resp, await resp.text());
    if (fresh && csrf) out.headers.append('Set-Cookie', cookieHeader(CSRF_COOKIE, csrf, COOKIE_TTL));
    return out;
  } catch (e) {
    return jsonResponse({ error: '上架失败：' + (e.message || e) }, 502);
  }
}

async function handlePublicUserStatus(request) {
  const url = new URL(request.url);
  const names = (url.searchParams.get('users') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 100);
  const out = {};
  await Promise.all(names.map(async function (name) {
    try {
      const resp = await wmPublicFetch('/v1/profile/' + encodeURIComponent(name));
      if (!resp.ok) { out[name] = 'offline'; return; }
      const json = await resp.json();
      const profile = (json.payload && json.payload.profile) || json.data || {};
      out[name] = profile.status || 'offline';
    } catch (e) { out[name] = 'offline'; }
  }));
  return jsonResponse({ users: out });
}

async function handleFetch(request, env) {
    const url = new URL(request.url);
    const p   = url.pathname;

    if (p === '/api/wm/user-status' && request.method === 'GET') return handlePublicUserStatus(request);

    /* 拍卖：搜索 / 字典 / 我的拍卖（代理 WM 公开+JWT 接口，大陆经 Worker 可达） */
    if (p === '/api/wm/auctions/search' && request.method === 'GET')  return handleAuctionSearch(request);
    if (p === '/api/wm/auctions/mine'   && request.method === 'GET')  return handleMyAuctions(request);
    if (p === '/api/wm/auctions/create' && request.method === 'POST') return handleAuctionCreate(request);
    const dictMatch  = p.match(/^\/api\/wm\/auctions\/dict\/([a-z]+\/[a-z]+)$/);
    if (dictMatch && request.method === 'GET') return handleAuctionDict(request, dictMatch[1]);
    const closeMatch = p.match(/^\/api\/wm\/auctions\/close\/([^/]+)$/);
    if (closeMatch && request.method === 'PUT') return handleAuctionClose(request, closeMatch[1]);
    const editMatch  = p.match(/^\/api\/wm\/auctions\/edit\/([^/]+)$/);
    if (editMatch  && request.method === 'PUT') return handleAuctionEdit(request, editMatch[1]);

    /* auth 路由（旧名保留，同时支持 /api/wm/ 前缀别名）—— 响应一律 no-store，防 zone 缓存 */
    if ((p === '/api/auth/login'  || p === '/api/wm/signin')   && request.method === 'POST') return noStore(await handleLogin(request));
    if (p === '/api/auth/login-jwt' && request.method === 'POST') return noStore(await handleLoginJwt(request));
    if ((p === '/api/auth/logout' || p === '/api/wm/signout')  && request.method === 'POST') return noStore(await handleLogout());
    if ((p === '/api/auth/me'     || p === '/api/wm/session')  && request.method === 'GET')  return noStore(await handleMe(request));

    /* 静态代理 */
    if (p === '/api/wm/avatar' && request.method === 'GET') return handleAvatarProxy(request);

    if (p === '/api/wm/orders/batch'  && request.method === 'POST') return handleWmOrdersBatch(request);
    if (p === '/api/wm/orders'        && request.method === 'GET')  return handleWmOrders(request);
    if (p === '/api/wm/orders'        && request.method === 'POST') return handleWmOrderCreate(request);
    /* 单数别名 /api/wm/order（POST=创建，PATCH/DELETE 由下方 match 处理）*/
    if (p === '/api/wm/order' && request.method === 'POST') return handleWmOrderCreate(request);

    /* /api/wm/orders/:id 或 /api/wm/order/:id */
    const orderMatch = p.match(/^\/api\/wm\/orders?\/([^/]+)$/);
    if (orderMatch) {
      if (request.method === 'PATCH')  return handleWmOrderPatch(request, orderMatch[1]);
      if (request.method === 'DELETE') return handleWmOrderDelete(request, orderMatch[1]);
    }

    if (p === '/api/wm/status' && request.method === 'GET')  return handleGetStatus(request);
    if (p === '/api/wm/status' && request.method === 'PUT')  return handleSetStatus(request);
    /* WS 隧道已弃用：EdgeOne 边缘函数不支持出站 WebSocket，状态改 HTTP PUT 维持 */
    if (p === '/api/debug/me' && request.method === 'GET') {
      const jwt = getWmJwt(request);
      if (!jwt) return jsonResponse({ error: '未登录' }, 401);
      const r = await fetchRetry('https://api.warframe.market/v2/me', {
        headers: { 'Cookie': 'JWT=' + jwt, 'Authorization': 'JWT ' + jwt, 'Platform': 'pc', 'Language': 'en' },
      });
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }

    const priceMatch = p.match(/^\/api\/wm\/price\/([^/]+)$/);
    if (priceMatch && request.method === 'GET') return handleWmPrice(request, priceMatch[1]);

    const itemDetailMatch = p.match(/^\/api\/wm\/item\/([^/]+)$/);
    if (itemDetailMatch && request.method === 'GET') return handleWmItemDetail(request, itemDetailMatch[1]);

    /* 非 /api/* 的路径：有 ASSETS 绑定就交给 Cloudflare Static Assets；
       没有的话平台静态托管自己会处理（EdgeOne/CloudBase Pages 等），
       这函数一般只绑 /api/*，能走到这说明是未知 API 路径 → 404 */
    if (env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
}

// 边缘函数入口：兼容腾讯 EdgeOne Pages 事件函数 / Cloudflare Workers service-worker 格式
// 环境变量从全局读取（EdgeOne 事件函数无 env 形参；未配置时为空对象，代码内均有兜底）
addEventListener('fetch', function (event) {
  var env = (typeof globalThis !== 'undefined' && globalThis.env)
    || (typeof self !== 'undefined' && self.env) || {};
  var url = new URL(event.request.url);
  // 跨域预检（OPTIONS）：本站只服务 /api/*，直接放行并返回 CORS 头（省去进业务处理）
  if (event.request.method === 'OPTIONS' && url.pathname.indexOf('/api/') === 0) {
    event.respondWith(new Response(null, { status: 204, headers: corsHeaders() }));
    return;
  }
  // 业务响应统一附加 CORS 头（WebSocket 101 除外）
  event.respondWith(handleFetch(event.request, env).then(withCors));
});
