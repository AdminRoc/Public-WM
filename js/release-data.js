(function (root) {
  'use strict';
  var API = 'https://market.wfspeed.run/api/kv?key=';
  var RAW = 'https://raw.githubusercontent.com/';
  var releasePromise = null;
  var releaseLoadedAt = 0;
  var releaseSeen = false;
  var RELEASE_POINTER_TTL_MS = 60 * 1000;

  function hash(buffer) {
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(new Error('WM release hash verification unavailable'));
    return root.crypto.subtle.digest('SHA-256', buffer).then(function (value) {
      return Array.from(new Uint8Array(value)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function verifiedJson(url, entry, fallbackUrl) {
    if (!entry || !/^[a-f0-9]{64}$/i.test(entry.sha256 || '') || !Number.isInteger(entry.bytes) || entry.bytes < 1) {
      return Promise.reject(new Error('WM release manifest entry missing'));
    }
    function read(candidate) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      return fetch(candidate, { cache: 'no-store', signal: controller.signal }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      }).then(function (body) {
        if (body.byteLength !== entry.bytes) throw new Error('WM release byte length mismatch');
        return hash(body).then(function (actual) {
          if (actual !== entry.sha256.toLowerCase()) throw new Error('WM release SHA-256 mismatch');
          return JSON.parse(new TextDecoder().decode(body));
        });
      }).finally(function () { clearTimeout(timer); });
    }
    return read(url).catch(function (error) {
      if (!fallbackUrl) throw error;
      return read(fallbackUrl);
    });
  }
  async function decryptIfWrapped(value) {
    if (!value || !value.ct || !value.iv || value.v !== 1) return value;
    var keyText = root.__PRICE_KEY_B64;
    if (!keyText) throw new Error('WM price decryption key unavailable');
    var keyRaw = Uint8Array.from(atob(keyText), function (char) { return char.charCodeAt(0); });
    var key = await root.crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
    var iv = Uint8Array.from(atob(value.iv), function (char) { return char.charCodeAt(0); });
    var cipher = Uint8Array.from(atob(value.ct), function (char) { return char.charCodeAt(0); });
    var plain = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
    var text = new TextDecoder().decode(plain);
    if (value.sha256) {
      var actual = await hash(new TextEncoder().encode(text).buffer);
      if (actual !== value.sha256) throw new Error('WM price plaintext SHA-256 mismatch');
    }
    return JSON.parse(text);
  }
  function currentRelease() {
    if (releasePromise && (!releaseLoadedAt || Date.now() - releaseLoadedAt < RELEASE_POINTER_TTL_MS)) return releasePromise;
    releaseLoadedAt = 0;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    releasePromise = fetch(API + 'wm_release_meta&v=' + Date.now(), { cache: 'no-store', signal: controller.signal }).then(function (response) {
      if (!response.ok) throw new Error('pointer HTTP ' + response.status);
      return response.json();
    }).then(function (pointer) {
      releaseSeen = true;
      if (!pointer || pointer.schema_version !== 1 || pointer.repository !== 'AdminRoc/Public-WM' ||
          !/^[a-f0-9]{40}$/i.test(pointer.commit_sha || '') || pointer.manifest_path !== 'release-manifest.json' ||
          !/^[a-f0-9]{64}$/i.test(pointer.manifest_sha256 || '') || !Number.isInteger(pointer.manifest_bytes)) {
        throw new Error('Invalid WM release pointer');
      }
      var manifestUrl = RAW + 'AdminRoc/Public-WM/' + pointer.commit_sha + '/data/' + pointer.manifest_path;
      var manifestCdn = 'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@' + pointer.commit_sha + '/data/' + pointer.manifest_path;
      return verifiedJson(manifestUrl, { sha256: pointer.manifest_sha256, bytes: pointer.manifest_bytes }, manifestCdn).then(function (manifest) {
        if (!manifest || manifest.schema_version !== 1 || manifest.repository !== pointer.repository ||
            manifest.release_id !== pointer.release_id || !manifest.files) throw new Error('WM release manifest mismatch');
        releaseLoadedAt = Date.now();
        return { pointer: pointer, manifest: manifest };
      });
    }).catch(function (error) {
      releasePromise = null;
      releaseLoadedAt = 0;
      throw error;
    }).finally(function () { clearTimeout(timer); });
    return releasePromise;
  }
  function legacy(name) {
    var keys = { 'wm-items.json': 'wm_items_json', 'avg_prices_full.json': 'avg_prices_full_json', 'auction-dicts.json': 'auction_dicts_json' };
    var key = keys[name];
    if (!key) return Promise.reject(new Error('Unknown WM artifact'));
    return fetch(API + encodeURIComponent(key) + '&v=' + Date.now(), { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('legacy KV HTTP ' + response.status);
      return response.json().then(decryptIfWrapped);
    }).catch(function () {
      return fetch('https://raw.githubusercontent.com/AdminRoc/Public-WM/main/data/' + encodeURIComponent(name) + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (response) { if (!response.ok) throw new Error('legacy raw HTTP ' + response.status); return response.json(); })
        .then(decryptIfWrapped);
    });
  }
  function load(name) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) return Promise.reject(new Error('Invalid WM release path'));
    return currentRelease().then(function (release) {
      var entry = release.manifest.files[name];
      if (!entry) throw new Error('WM release does not declare ' + name);
      var rawUrl = RAW + 'AdminRoc/Public-WM/' + release.pointer.commit_sha + '/data/' + encodeURIComponent(name);
      var cdnUrl = 'https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@' + release.pointer.commit_sha + '/data/' + encodeURIComponent(name);
      return verifiedJson(rawUrl, entry, cdnUrl)
        .then(decryptIfWrapped);
    }).catch(function (error) {
      if (releaseSeen || !/^pointer HTTP 404$/.test(error && error.message || '')) throw error;
      return legacy(name);
    });
  }
  root.PWM_RELEASE_DATA = { load: load };
})(window);
