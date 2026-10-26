#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ALLOWED_KEYS = new Set([
  'avg_prices_full_json',
  'auction_dicts_json',
  'wm_items_json',
]);
export const WM_ITEMS_FORMAT = 'wfspeed-gzip-json-v1';
export const MAX_STORED_VALUE_BYTES = 900_000;
export const MAX_REQUEST_BODY_BYTES = 900_000;
const MAX_UNCOMPRESSED_BYTES = 8_000_000;
const MIN_WM_ITEMS = 1500;
const encoder = new TextEncoder();

function validateItems(document) {
  const items = Array.isArray(document) ? document : document?.data;
  if (!Array.isArray(items) || items.length < MIN_WM_ITEMS) {
    throw new Error('WM item manifest is incomplete');
  }
  const ids = new Set();
  const slugs = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('WM item manifest contains an invalid row');
    }
    const id = item.id == null ? '' : String(item.id).trim();
    const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
    if (!id || !slug || ids.has(id) || slugs.has(slug)) {
      throw new Error('WM item manifest has missing or duplicate stable identity');
    }
    ids.add(id);
    slugs.add(slug);
  }
  return items;
}

async function gzipBytes(sourceBytes) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('Node runtime does not provide CompressionStream');
  }
  const reader = new Blob([sourceBytes]).stream()
    .pipeThrough(new CompressionStream('gzip'))
    .getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_STORED_VALUE_BYTES) {
        await reader.cancel();
        throw new Error('WM item compressed value exceeds the conservative provider limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function buildPayload(key, raw) {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error('KV key is outside the fixed WM data allowlist');
  }
  const sourceBytes = raw instanceof Uint8Array ? raw : encoder.encode(String(raw));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  const document = JSON.parse(text);
  let value = text;
  if (key === 'wm_items_json') {
    validateItems(document);
    if (sourceBytes.byteLength > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('WM item catalog exceeds the decompressed size limit');
    }
    const compressed = await gzipBytes(sourceBytes);
    value = JSON.stringify({
      format: WM_ITEMS_FORMAT,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      uncompressedBytes: sourceBytes.byteLength,
      data: Buffer.from(compressed).toString('base64'),
    });
  }
  const valueBytes = encoder.encode(value);
  if (valueBytes.byteLength > MAX_STORED_VALUE_BYTES) {
    throw new Error('KV value exceeds the conservative 900000-byte limit');
  }
  const payload = Buffer.from(JSON.stringify({ key, value }), 'utf8');
  if (payload.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('Edge Function request exceeds the conservative 900000-byte limit');
  }
  return payload;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--key', '--source', '--output'].includes(name) || !value || args[name]) {
      throw new Error('Expected --key, --source, and --output arguments');
    }
    args[name] = value;
  }
  if (!args['--key'] || !args['--source'] || !args['--output'] || argv.length !== 6) {
    throw new Error('Expected --key, --source, and --output arguments');
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = await readFile(args['--source']);
    const payload = await buildPayload(args['--key'], raw);
    await writeFile(args['--output'], payload);
    const envelope = JSON.parse(payload.toString('utf8'));
    console.log(`${envelope.key}: body=${payload.byteLength} bytes, value=${encoder.encode(envelope.value).byteLength} bytes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'KV payload build failed');
    process.exitCode = 1;
  }
}
