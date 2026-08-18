/* Public-WM · EdgeOne Makers Pages 边缘函数：读 EdgeOne KV
 * 路由：market.wfspeed.run/api/kv?key=<key>
 * 作用：前端走这个同源接口读 GitHub Actions 写进 KV 的最新数据
 *      （物品总表 / 均价 / 拍卖字典），大陆能连、毫秒级、不用靠 jsDelivr。
 * 注意：KV 命名空间要在 EdgeOne Makers 控制台建好并绑到本项目，
 *       绑的时候注入的全局变量名 = KV 命名空间名（这里就是 PWM_KV）。
 */
export default async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    let key = url.searchParams.get('key');
    if (!key) {
      return new Response('missing key', { status: 400 });
    }
    /* KV key 仅允许数字/字母/下划线：连字符与点号统一转下划线 */
    key = key.replace(/[.-]/g, '_');
    const value = await PWM_KV.get(key, { type: 'text' });
    if (value == null) {
      return new Response('not found', { status: 404 });
    }
    return new Response(value, {
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
