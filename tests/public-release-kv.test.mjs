import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const source = fs.readFileSync(new URL('../edge-functions/api/kv/index.js', import.meta.url), 'utf8');
const { default: onRequest } = await import('data:text/javascript,' + encodeURIComponent(source));

async function sha(raw) {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const commit = 'a'.repeat(40);
const itemText = JSON.stringify({ data: [{ id: 'stable-id', slug: 'current-item' }] });
const itemEntry = { bytes: Buffer.byteLength(itemText), sha256: await sha(itemText) };
const manifestText = JSON.stringify({
  schema_version: 1,
  repository: 'AdminRoc/Public-WM',
  release_id: 'release-1',
  files: { 'wm-items.json': itemEntry },
});
const pointer = {
  schema_version: 1,
  repository: 'AdminRoc/Public-WM',
  commit_sha: commit,
  manifest_path: 'release-manifest.json',
  manifest_sha256: await sha(manifestText),
  manifest_bytes: Buffer.byteLength(manifestText),
  release_id: 'release-1',
};

let rawFailure = false;
let storedArtifactReads = 0;
globalThis.fetch = async (url) => {
  const value = String(url);
  if (rawFailure && value.includes('raw.githubusercontent.com') && value.endsWith('/release-manifest.json')) {
    return new Response('bad manifest', { status: 200 });
  }
  if (rawFailure && value.includes('raw.githubusercontent.com') && value.endsWith('/wm-items.json')) {
    return new Response('bad item bytes', { status: 200 });
  }
  if (value.includes('/release-manifest.json')) return new Response(manifestText, { status: 200 });
  if (value.includes('/wm-items.json')) return new Response(itemText, { status: 200 });
  return new Response('not found', { status: 404 });
};

async function invoke(key, kv) {
  globalThis.PWM_KV = kv;
  return onRequest({
    request: new Request('https://local/api/kv?key=' + encodeURIComponent(key)),
    env: { PRICE_DATA_SECRET: '' },
  });
}

const kv = {
  get: async (key) => {
    if (key === 'wm_release_meta') return JSON.stringify(pointer);
    if (key === 'wm_items_json') { storedArtifactReads++; return JSON.stringify({ data: [{ slug: 'stale' }] }); }
    return null;
  },
};

let response = await invoke('wm_release_meta', kv);
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), pointer);

rawFailure = true;
response = await invoke('wm_items_json', kv);
assert.equal(response.status, 200, 'same-SHA jsDelivr fallback recovers raw errors and hash mismatches');
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), { data: [{ id: 'stable-id', slug: 'current-item' }] });
assert.equal(storedArtifactReads, 0, 'the current pointer release takes precedence over stale bulk KV values');

response = await invoke('wm_items_json', { get: async (key) => key === 'wm_release_meta' ? '{bad pointer' : JSON.stringify({ data: [{ slug: 'stale' }] }) });
assert.equal(response.status, 502, 'an invalid current pointer fails closed instead of serving old KV data');

response = await invoke('wm_items_json', { get: async (key) => key === 'wm_items_json' ? JSON.stringify({ data: [{ slug: 'pre-cutover' }] }) : null });
assert.equal(response.status, 200, 'pre-cutover clients can still read retained legacy values before a pointer exists');
assert.deepEqual(await response.json(), { data: [{ slug: 'pre-cutover' }] });

console.log('Public-WM release aliases verify immutable data and preserve pre-cutover reads');
