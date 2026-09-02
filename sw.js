/* Public-WM SW: 绂荤嚎缂撳瓨闈欐€佽祫婧愶紝涓嶄唬鐞?WM API/KV */
const CACHE = 'bw-public-v2';
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
  // 璺ㄧ珯瀛椾綋锛坵fspeed.run 鈫?market/boss锛夌敱娴忚鍣?CORS 澶勭悊锛屼笉缁?SW锛岄伩鍏?Failed to convert
  if (url.hostname !== location.hostname && /\.(woff2|woff|ttf|otf)$/.test(url.pathname)) return;
  // cdn/raw 鐨?wm-items/avg 璧?stale-while-revalidate锛圥ublic 1.8M/590k锛孭rivate 鍚岋級
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('raw.githubusercontent.com')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => { if(res.ok) c.put(e.request, res.clone()).catch(()=>{}); return res; }).catch(()=>cached);
      return cached || fetched;
    })));
    return;
  }
  // WM API 涓?KV 璧扮綉缁滐紝涓嶇紦瀛橈紙WM 闇€瀹炴椂锛孠V 宸叉湁 10min 杈圭紭缂撳瓨锛?
  if (url.pathname.startsWith('/api/') || url.hostname.includes('warframe.market') || url.hostname.includes('pwm-api')) return;
  // 闈欐€佽祫婧?Cache First
  if (/\.(css|js|woff2|png|svg|webp)$/.test(url.pathname) || url.pathname.startsWith('/picture/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy).catch(()=>{}));
      return res;
    }).catch(()=>r)));
  }
});
