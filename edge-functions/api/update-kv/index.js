/* Public-WM · EdgeOne Makers Pages 边缘函数：写 EdgeOne KV（要 Bearer token）
 * 路由：market.wfspeed.run/api/update-kv  (POST {"key":"...","value":"..."})
 * 作用：GitHub Actions 把最新数据（物品总表/均价/拍卖字典）写进 KV。
 * 安全：校验 Authorization: Bearer <KV_WRITE_TOKEN>（环境变量，和 GitHub Secret 同值）。
 */
export default async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const auth = request.headers.get('Authorization') || '';
  if (auth !== 'Bearer ' + env.KV_WRITE_TOKEN) {
    return new Response('unauthorized', { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('bad json: ' + e.message, { status: 400 });
  }
  if (!body || typeof body.key !== 'string' || body.value == null) {
    return new Response('missing key/value', { status: 400 });
  }
  try {
    await PWM_KV.put(body.key, String(body.value));
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('kv put error: ' + (e && e.message ? e.message : String(e)), { status: 500 });
  }
}
