import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Public-WM revalidates unversioned local runtime assets without changing API policy', async () => {
  const config = JSON.parse(await readFile(new URL('../edgeone.json', import.meta.url), 'utf8'));
  const cacheFor = source => config.headers.find(rule => rule.source === source)?.headers[0].value;
  assert.equal(cacheFor('/'), 'no-cache, no-store, must-revalidate');
  assert.equal(cacheFor('/*.js'), 'public, no-cache, must-revalidate');
  assert.equal(cacheFor('/*.css'), 'public, no-cache, must-revalidate');
  assert.equal(cacheFor('/js/*'), 'public, no-cache, must-revalidate');
  assert.equal(cacheFor('/css/*'), 'public, no-cache, must-revalidate');
  assert.equal(cacheFor('/api/*'), 'no-store');
  assert.equal(cacheFor('/sw.js'), 'no-cache, no-store, must-revalidate');
});
