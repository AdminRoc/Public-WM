/* Public-WM SW: offline cache static, not WM API/KV */
const CACHE = 'bw-public-v5';
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
  if (url.hostname !== location.hostname && /\.(woff2|woff|ttf|otf)$/.test(url.pathname)) return;
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('raw.githubusercontent.com')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => { if(res.ok) c.put(e.request, res.clone()).catch(()=>{}); return res; }).catch(()=>cached);
      return cached || fetched;
    })));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.hostname.includes('warframe.market') || url.hostname.includes('pwm-api')) return;
  if (/\.(css|js|woff2|png|svg|webp)$/.test(url.pathname) || url.pathname.startsWith('/picture/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy).catch(()=>{}));
      return res;
    }).catch(() => caches.match(e.request)));
  }
});
