import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../edge-functions/api/update-kv/index.js', import.meta.url), 'utf8');
const { default: onRequest } = await import('data:text/javascript,' + encodeURIComponent(source));
const storage = new Map();
let puts = 0;
globalThis.PWM_KV = {
  get: async (key) => storage.get(key) ?? null,
  put: async (key, value) => { puts++; storage.set(key, value); },
};

async function invoke(body) {
  return onRequest({
    request: new Request('https://local/api/update-kv', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env: { KV_WRITE_TOKEN: 'test-token' },
  });
}

let response = await invoke({ key: 'wm_items_json', value: JSON.stringify({ data: [{ slug: 'item' }] }) });
assert.equal(response.status, 410, 'Public-WM no longer accepts bulk artifact KV writes');
assert.equal(puts, 0);

const pointer = {
  schema_version: 1,
  repository: 'AdminRoc/Public-WM',
  commit_sha: 'a'.repeat(40),
  manifest_path: 'release-manifest.json',
  manifest_sha256: 'b'.repeat(64),
  manifest_bytes: 100,
  release_id: 'r1',
  generation: '100',
};
response = await invoke({ key: 'wm_release_meta', value: JSON.stringify(pointer) });
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.equal(puts, 1);
assert.deepEqual(JSON.parse(storage.get('wm_release_meta')), pointer);

storage.set('wm_release_meta', JSON.stringify({ ...pointer, generation: '101' }));
response = await invoke({ key: 'wm_release_meta', value: JSON.stringify({ ...pointer, generation: '99' }) });
assert.equal(response.status, 409, 'an older run cannot move the pointer backwards');
assert.equal(puts, 1);

console.log('Public-WM writer stores only the small monotonic release pointer');
