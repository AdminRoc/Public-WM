/* Writes only the small pointer to the verified SHA-pinned Public-WM release. */
const MAX_POINTER_BYTES = 64 * 1024;

export default async function onRequest({ request, env }) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if ((request.headers.get('Authorization') || '') !== 'Bearer ' + env.KV_WRITE_TOKEN) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const body = await request.json();
    if (!body || body.key !== 'wm_release_meta' || typeof body.value !== 'string') {
      return new Response('only wm_release_meta pointer writes are accepted', { status: 410 });
    }
    const bytes = new TextEncoder().encode(body.value).byteLength;
    if (bytes < 1 || bytes > MAX_POINTER_BYTES) return new Response('release pointer exceeds 64 KiB', { status: 413 });
    const pointer = JSON.parse(body.value);
    if (!pointer || pointer.schema_version !== 1 || pointer.repository !== 'AdminRoc/Public-WM' ||
        !/^[a-f0-9]{40}$/i.test(pointer.commit_sha || '') || pointer.manifest_path !== 'release-manifest.json' ||
        !/^[a-f0-9]{64}$/i.test(pointer.manifest_sha256 || '') || !Number.isInteger(pointer.manifest_bytes) ||
        pointer.manifest_bytes < 1 || typeof pointer.release_id !== 'string' || !/^\d+$/.test(pointer.generation || '')) {
      return new Response('invalid PWM release pointer', { status: 400 });
    }
    const currentText = await PWM_KV.get('wm_release_meta', { type: 'text' });
    if (currentText) {
      const current = JSON.parse(currentText);
      if (/^\d+$/.test(current.generation || '') && BigInt(current.generation) > BigInt(pointer.generation)) {
        return new Response('refusing to move PWM pointer backwards', { status: 409 });
      }
    }
    await PWM_KV.put('wm_release_meta', body.value);
    return new Response(JSON.stringify({ key: 'wm_release_meta', bytes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (_) {
    return new Response('invalid PWM release pointer', { status: 400 });
  }
}
