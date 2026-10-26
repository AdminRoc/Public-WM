import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../js/release-data.js', import.meta.url), 'utf8');

function createContext(fetch) {
  const window = { crypto: webcrypto };
  const context = vm.createContext({
    window, fetch, AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    atob: globalThis.atob,
  });
  vm.runInContext(source, context);
  return window.PWM_RELEASE_DATA;
}

const failedReads = [];
const unavailable = createContext(async (url) => {
  failedReads.push(String(url));
  return new Response('temporarily unavailable', { status: 503 });
});
await assert.rejects(unavailable.load('wm-items.json'), /pointer HTTP 503/);
assert.equal(failedReads.length, 1, 'a 503 pointer response must not fall back to stale KV or mutable main data');

const legacyReads = [];
const preCutover = createContext(async (url) => {
  const parsed = new URL(String(url));
  legacyReads.push(parsed.href);
  if (parsed.searchParams.get('key') === 'wm_release_meta') return new Response('not found', { status: 404 });
  if (parsed.searchParams.get('key') === 'wm_items_json') {
    return new Response(JSON.stringify({ data: [{ slug: 'pre-cutover' }] }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
});
assert.deepEqual(await preCutover.load('wm-items.json'), { data: [{ slug: 'pre-cutover' }] });
assert.deepEqual(legacyReads.map((url) => new URL(url).searchParams.get('key')), ['wm_release_meta', 'wm_items_json']);

console.log('Public-WM consumer only uses legacy compatibility after an explicit pointer 404');
