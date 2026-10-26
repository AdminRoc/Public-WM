import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_KEYS,
  MAX_REQUEST_BODY_BYTES,
  MAX_STORED_VALUE_BYTES,
  WM_ITEMS_FORMAT,
  buildPayload,
} from '../.github/scripts/kv_payload.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('current fixed-key sources fit and the BWM catalog round-trips', async () => {
  const sources = new Map([
    ['avg_prices_full_json', `${root}/data/avg_prices_full.json`],
    ['auction_dicts_json', `${root}/data/auction-dicts.json`],
    ['wm_items_json', `${root}/data/wm-items.json`],
  ]);
  assert.deepEqual(new Set(sources.keys()), ALLOWED_KEYS);
  for (const [key, path] of sources) {
    const raw = await readFile(path);
    const payload = await buildPayload(key, raw);
    assert.ok(payload.byteLength <= MAX_REQUEST_BODY_BYTES);
    const envelope = JSON.parse(payload.toString('utf8'));
    assert.equal(envelope.key, key);
    assert.ok(Buffer.byteLength(envelope.value, 'utf8') <= MAX_STORED_VALUE_BYTES);
    if (key === 'wm_items_json') {
      const wrapper = JSON.parse(envelope.value);
      assert.equal(wrapper.format, WM_ITEMS_FORMAT);
      const unpacked = gunzipSync(Buffer.from(wrapper.data, 'base64'));
      assert.deepEqual(unpacked, raw);
      assert.equal(wrapper.sha256, createHash('sha256').update(raw).digest('hex'));
      assert.equal(wrapper.uncompressedBytes, raw.byteLength);
      const document = JSON.parse(unpacked.toString('utf8'));
      const items = Array.isArray(document) ? document : document.data;
      assert.ok(items.length >= 1500);
      assert.equal(new Set(items.map((item) => item.id)).size, items.length);
      assert.equal(new Set(items.map((item) => item.slug)).size, items.length);
    } else {
      assert.equal(envelope.value, raw.toString('utf8'));
    }
  }
});

test('rejects unlisted keys and duplicate stable identities', async () => {
  await assert.rejects(buildPayload('user_session', Buffer.from('{}')), /allowlist/);
  const duplicate = Buffer.from(JSON.stringify({
    data: Array.from({ length: 1500 }, () => ({ id: 'duplicate', slug: 'one' })),
  }));
  await assert.rejects(buildPayload('wm_items_json', duplicate), /duplicate/);
});

test('rejects a fixed-key value above the provider request limit', async () => {
  const oversized = Buffer.from(JSON.stringify({ data: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }));
  await assert.rejects(buildPayload('auction_dicts_json', oversized), /900000-byte/);
});
