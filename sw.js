/* Public-WM SW: 离线缓存静态资源，不代理 WM API/KV */
const CACHE = 'bw-public-v1';
const ASSETS = [
  '/css/main.css',
  '/css/fui-core.css',
  '/js/shared.js',
  '/js/main.js',
  '/js/quant.js',
  '/js/auctions.js',
  '/js/fui-core.js',
  '/js/price-key.js',
  '/picture/websitelogo.png',
  '/picture/WS-logo-2.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // cdn/raw 的 wm-items/avg 走 stale-while-revalidate（Public 1.8M/590k，Private 同）
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('raw.githubusercontent.com')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => { if(res.ok) c.put(e.request, res.clone()).catch(()=>{}); return res; }).catch(()=>cached);
      return cached || fetched;
    })));
    return;
  }
  // WM API 与 KV 走网络，不缓存（WM 需实时，KV 已有 10min 边缘缓存）
  if (url.pathname.startsWith('/api/') || url.hostname.includes('warframe.market') || url.hostname.includes('pwm-api')) return;
  // 静态资源 Cache First
  if (/\.(css|js|woff2|png|svg|webp)$/.test(url.pathname) || url.pathname.startsWith('/picture/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy).catch(()=>{}));
      return res;
    }).catch(()=>r)));
  }
});
