/* Public-WM · EdgeOne Makers Pages 边缘函数：读 EdgeOne KV
 * 路由：market.wfspeed.run/api/kv?key=<key>
 * 作用：前端走这个同源接口读 GitHub Actions 写进 KV 的最新数据
 *      （物品总表 / 均价 / 拍卖字典），大陆能连、毫秒级、不用靠 jsDelivr。
 * 注意：KV 命名空间要在 EdgeOne Makers 控制台建好并绑到本项目，
 *       绑的时候注入的全局变量名 = KV 命名空间名（这里就是 PWM_KV）。
 */
async function hkdfKey(secret, info) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits']);
  return await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('wfspeed-price-v1'), info: enc.encode(info) }, base, 256);
}
async function decryptWrapper(wrapper, secret) {
  if (!wrapper || !wrapper.ct || !wrapper.iv) return wrapper;
  if (!secret) return wrapper;
  const keyRaw = await hkdfKey(secret, 'price-data-enc');
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
  const iv = Uint8Array.from(atob(wrapper.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(wrapper.ct), c => c.charCodeAt(0));
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const text = new TextDecoder().decode(plainBuf);
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (wrapper.sha256 && hashHex !== wrapper.sha256) throw new Error('sha256 mismatch');
  return JSON.parse(text);
}
export default async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    let key = url.searchParams.get('key');
    if (!key) {
      return new Response('missing key', { status: 400 });
    }
    key = key.replace(/[.-]/g, '_');
    const value = await PWM_KV.get(key, { type: 'text' });
    if (value == null) {
      return new Response('not found', { status: 404 });
    }
    let out = value;
    try {
      const parsed = JSON.parse(value);
      if (parsed && parsed.ct && parsed.iv) {
        const dec = await decryptWrapper(parsed, env.PRICE_DATA_SECRET);
        out = JSON.stringify(dec);
      }
    } catch (_) {}
    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response('kv error: ' + (e && e.message ? e.message : String(e)), { status: 500 });
  }
}
