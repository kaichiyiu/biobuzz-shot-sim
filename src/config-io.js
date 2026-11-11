/* BIOBUZZ Shot Sim - config I/O (#14): JSON, share-link hash, storage, legacy-key import. Storage is injected. No DOM.
   Browser: window.ShotConfig.io (needs config-schema.js first). Node: module.exports. */
(function (root) {
  'use strict';
  var S = typeof module === 'object' && module.exports ? require('./config-schema.js') : (root.ShotConfig || {}).schema;
  var KEY = 'biobuzz-shot-sim.config.v1';
  var LEGACY = { units: 'biobuzz-shot-sim.units', origin: 'biobuzz-shot-sim.origin', hood: 'biobuzz-shot-sim.hood', spin: 'biobuzz-shot-sim.spin', entry: 'biobuzz-shot-sim.entry' };
  var PREFIX = '#cfg=';
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function store(storage) {
    if (storage) return storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // ------------------------------------------------------------------ base64url over UTF-8 (no btoa / Buffer)
  function b64Encode(text) {
    var b = new TextEncoder().encode(text), out = '', i, n;
    for (i = 0; i < b.length; i += 3) {
      n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < b.length ? B64[n >> 6 & 63] : '') + (i + 2 < b.length ? B64[n & 63] : '');
    }
    return out;
  }
  function b64Decode(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64url');
    var bytes = [], acc = 0, bits = 0, i;
    for (i = 0; i < s.length; i++) {
      acc = (acc << 6) | B64.indexOf(s[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  }

  // ------------------------------------------------------------------ JSON and hash
  function toJson(cfg) { return JSON.stringify(cfg, null, 2); }
  function fromJson(text, data) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { cfg: null, warnings: ['not valid JSON: ' + e.message] }; }
    if (!isObj(raw)) return { cfg: null, warnings: ['not a config object'] };
    return S.normalize(raw, data);
  }
  function toHash(cfg) { return PREFIX + b64Encode(JSON.stringify(cfg)); }
  function fromHash(hash, data) {
    try {
      var h = String(hash == null ? '' : hash), i = h.indexOf('cfg=');
      if (i < 0 || (i > 0 && h[i - 1] !== '#' && h[i - 1] !== '&')) return null;
      var raw = JSON.parse(b64Decode(h.slice(i + 4).split('&')[0]));
      return isObj(raw) ? S.normalize(raw, data) : null;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ storage
  function load(storage, data) {
    try {
      var t = store(storage).getItem(KEY);
      return t == null ? null : (fromJson(t, data).cfg || null);
    } catch (e) { return null; }
  }
  function save(cfg, storage) {
    try { store(storage).setItem(KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; }
  }

  // read-only: units / origin are plain strings, hood / spin / entry are JSON. Returns only what is stored and valid.
  function importLegacy(storage, data) {
    var st = store(storage), out = {}, raw = {};
    function get(k) { try { return st.getItem(LEGACY[k]); } catch (e) { return null; } }
    function json(k) { try { return JSON.parse(get(k)); } catch (e) { return null; } }
    if (!st) return out;
    var u = get('units'), o = get('origin'), sp = json('spin'), h = json('hood'), en = json('entry');
    if (u === 'imperial' || u === 'metric') raw.units = u;
    if (S.ORIGINS.indexOf(o) >= 0) raw.origin = o;
    if (sp === 'top' || sp === 'back') raw.spin = sp;
    if (isObj(h)) raw.hood = h;
    if (isObj(en)) raw.entry = en;
    var c = S.normalize(raw, data).cfg;
    if (raw.units || raw.origin) out.display = {};
    if (raw.units) out.display.units = c.display.units;
    if (raw.origin) out.display.origin = c.display.origin;
    if (raw.hood || raw.spin) out.robot = {};
    if (raw.hood) out.robot.hood = c.robot.hood;
    if (raw.spin) out.robot.shooter = { spin: c.robot.shooter.spin };
    if (raw.entry) out.entry = c.entry;
    return out;
  }

  function merge(base, over) {
    var o = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over || {}).forEach(function (k) { o[k] = isObj(over[k]) && isObj(o[k]) ? merge(o[k], over[k]) : over[k]; });
    return o;
  }
  // precedence (design D6): URL hash > stored v1 > legacy keys over defaults > defaults
  function resolve(hash, storage, data) {
    var h = fromHash(hash, data);
    if (h) return { cfg: h.cfg, source: 'hash', warnings: h.warnings };
    var st = load(storage, data);
    if (st) return { cfg: st, source: 'stored', warnings: [] };
    var leg = importLegacy(storage, data);
    if (Object.keys(leg).length) return { cfg: S.normalize(merge(S.defaults(data), leg), data).cfg, source: 'legacy', warnings: [] };
    return { cfg: S.defaults(data), source: 'defaults', warnings: [] };
  }

  var api = { KEY: KEY, LEGACY_KEYS: LEGACY, toJson: toJson, fromJson: fromJson, toHash: toHash, fromHash: fromHash, load: load, save: save, importLegacy: importLegacy, resolve: resolve };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShotConfig = root.ShotConfig || {};
  root.ShotConfig.io = api;
})(typeof window !== 'undefined' ? window : {});
