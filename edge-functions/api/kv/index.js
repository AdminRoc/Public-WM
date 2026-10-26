/* Public-WM compatibility reader: KV stores the release pointer; artifact aliases
 * resolve and hash-check the immutable GitHub raw release for legacy callers. */
const RELEASE_FILES = {
  wm_items_json: 'wm-items.json',
  avg_prices_full_json: 'avg_prices_full.json',
  auction_dicts_json: 'auction-dicts.json',
};
const RELEASE_REPOSITORY = 'AdminRoc/Public-WM';

async function sha256(buffer) {
  const value = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(value)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function fetchVerifiedJson(urls, entry) {
  if (!entry || !/^[a-f0-9]{64}$/i.test(entry.sha256 || '') || !Number.isInteger(entry.bytes) || entry.bytes < 1) {
    throw new Error('invalid release manifest entry');
  }
  let lastError;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(url, { signal: controller.signal, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new Error('release fetch HTTP ' + response.status);
      const body = await response.arrayBuffer();
      if (body.byteLength !== entry.bytes || await sha256(body) !== entry.sha256.toLowerCase()) {
        throw new Error('release hash or length mismatch');
      }
      return JSON.parse(new TextDecoder().decode(body));
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('release artifact unavailable');
}
async function readReleaseArtifact(key, env) {
  const pointerText = await PWM_KV.get('wm_release_meta', { type: 'text' });
  if (pointerText == null) return null;
  const pointer = JSON.parse(pointerText);
  if (!pointer || pointer.schema_version !== 1 || pointer.repository !== RELEASE_REPOSITORY ||
      !/^[a-f0-9]{40}$/i.test(pointer.commit_sha || '') || pointer.manifest_path !== 'release-manifest.json' ||
      !/^[a-f0-9]{64}$/i.test(pointer.manifest_sha256 || '') || !Number.isInteger(pointer.manifest_bytes) || pointer.manifest_bytes < 1) {
    throw new Error('invalid current release pointer');
  }
  const base = 'https://raw.githubusercontent.com/' + RELEASE_REPOSITORY + '/' + pointer.commit_sha + '/data/';
  const cdn = 'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@' + pointer.commit_sha + '/data/';
  const manifest = await fetchVerifiedJson([base + 'release-manifest.json', cdn + 'release-manifest.json'], {
    sha256: pointer.manifest_sha256, bytes: pointer.manifest_bytes,
  });
  if (!manifest || manifest.schema_version !== 1 || manifest.repository !== RELEASE_REPOSITORY || manifest.release_id !== pointer.release_id) {
    throw new Error('release manifest does not match pointer');
  }
  const path = RELEASE_FILES[key];
  const entry = path && manifest.files && manifest.files[path];
  if (!entry) throw new Error('artifact missing from release manifest');
  let value = await fetchVerifiedJson([base + path, cdn + path], entry);
  if (key === 'avg_prices_full_json') value = await decryptWrapper(value, env.PRICE_DATA_SECRET);
  return JSON.stringify(value);
}
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
    const isReleasePointer = key === 'wm_release_meta';
    const isReleaseArtifact = Object.prototype.hasOwnProperty.call(RELEASE_FILES, key);
    if (isReleaseArtifact) {
      try {
        const resolved = await readReleaseArtifact(key, env);
        if (resolved !== null) return new Response(resolved, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (_) {
        return new Response('current release unavailable or invalid', {
          status: 502,
          headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }
    // Cache API 10min：同 Private src/worker.js:624 getItemsData 的 caches.default 60s+10min 三层，避免每次回源 PWM_KV
    let cache = null;
    let cacheKey = null;
    try { cache = caches.default; } catch {}
    if (cache && !isReleasePointer && !isReleaseArtifact) {
      try {
        cacheKey = new Request(url.toString(), { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      } catch {}
    }
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
    const resp = new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': isReleasePointer || isReleaseArtifact ? 'no-store' : 'public, max-age=60, s-maxage=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
    if (cache && cacheKey && !isReleasePointer && !isReleaseArtifact) {
      try { cache.put(cacheKey, resp.clone()).catch(function(){}); } catch {}
    }
    return resp;
  } catch (e) {
    return new Response('kv error: ' + (e && e.message ? e.message : String(e)), { status: 500 });
  }
}
