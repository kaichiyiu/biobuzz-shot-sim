/* BIOBUZZ Shot Sim - config UI (#14): hydrate the app state + every hook's configSlice on start (hash > stored v1 > legacy > defaults),
   debounced save, "Copy share link" / "Download config" / "Import config". Browser: window.ShotUI.config. Node: module.exports (pure parts).
   Hook order: must be pushed after the modules whose slices it reads (UI_FILES order). */
(function (root) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var S = node ? require('./config-schema.js') : (root.ShotConfig || {}).schema;
  var IO = node ? require('./config-io.js') : (root.ShotConfig || {}).io;
  var SHOOTER_KEYS = ['type', 'wheelId', 'motorsPerWheel', 'gear', 'topRatio', 'wheelCount', 'addOn', 'shotInterval', 'control', 'batteryV', 'etaSingle', 'etaDual'];
  var RESERVED = ['tolerance', 'calibration', 'export'];
  var SAVE_MS = 300;

  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function slice(slices, key) {
    for (var i = 0; i < (slices || []).length; i++) if (slices[i] && slices[i].key === key) return slices[i];
    return null;
  }
  function get(slices, key) {
    var s = slice(slices, key);
    if (!s || typeof s.get !== 'function') return undefined;
    try { return s.get(); } catch (e) { return undefined; }
  }

  // app state + slices -> ConfigV1 (not normalized; callers that need clean data run schema.normalize)
  function collect(state, slices, now) {
    var sh = {}, h = state.hood || {}, ext = {}, spin = get(slices, 'spin'), entry = get(slices, 'entry');
    SHOOTER_KEYS.forEach(function (k) { sh[k] = state.shooter[k]; });
    sh.spin = spin === 'top' ? 'top' : 'back';
    var cfg = {
      v: S.VERSION, savedAt: new Date(now == null ? Date.now() : now).toISOString(),
      field: { ballId: state.ballId, target: state.target, hive: { red: state.hive.red, blue: state.hive.blue }, mouth: { x: state.mouth.x, y: state.mouth.y }, h0: state.h0 },
      robot: { motorId: state.motorId, precision: state.precision, shooter: sh, hood: { mode: h.mode, angleText: h.angleText, minDeg: h.minDeg, maxDeg: h.maxDeg }, flywheelCustom: null },
      display: { units: state.units, origin: state.origin },
      entry: entry && typeof entry === 'object' ? copy(entry) : { rule: 'any', maxSpeedMps: 6 },
      tolerance: null, calibration: null, export: null
    };
    (slices || []).forEach(function (s) {
      if (!s || s.key === 'spin' || s.key === 'entry') return;
      var v = get(slices, s.key);
      if (v === undefined) return;
      if (RESERVED.indexOf(s.key) >= 0) cfg[s.key] = v == null ? null : copy(v); else ext[s.key] = copy(v);
    });
    if (Object.keys(ext).length) cfg.ext = ext;
    return cfg;
  }

  // ConfigV1 (already normalized) -> state in place + slices. env = { units: ShotUnits, hood: ShotUI.hood, mouthLimit: number }
  function apply(cfg, state, slices, env) {
    var f = cfg.field, r = cfg.robot, lim = env && env.mouthLimit != null ? env.mouthLimit : Infinity;
    state.ballId = f.ballId; state.target = f.target; state.hive = { red: f.hive.red, blue: f.hive.blue }; state.h0 = f.h0;
    state.mouth.x = Math.max(-lim, Math.min(lim, f.mouth.x));
    state.mouth.y = Math.max(-lim, Math.min(lim, f.mouth.y));
    state.motorId = r.motorId; state.precision = r.precision;
    SHOOTER_KEYS.forEach(function (k) { state.shooter[k] = r.shooter[k]; });
    state.hood = { mode: r.hood.mode, angleText: r.hood.angleText, minDeg: r.hood.minDeg, maxDeg: r.hood.maxDeg };
    if (env && env.hood && typeof env.hood.sync === 'function') env.hood.sync(state.hood);   // mounted hood controls only sync on user input
    var U = env && env.units;
    state.units = U ? U.setSystem(cfg.display.units) : cfg.display.units;
    state.origin = U ? U.setCorner(cfg.display.origin) : cfg.display.origin;
    function put(key, v) {
      var s = slice(slices, key);
      if (!s || typeof s.set !== 'function') return;
      try { s.set(copy(v)); } catch (e) { console.warn('config slice "' + key + '" failed:', e); }
    }
    put('spin', r.shooter.spin);
    put('entry', cfg.entry);
    RESERVED.forEach(function (k) { if (cfg[k] != null) put(k, cfg[k]); });
    Object.keys(cfg.ext || {}).forEach(function (k) { put(k, cfg.ext[k]); });
  }

  var api = { collect: collect, apply: apply, SAVE_MS: SAVE_MS };
  if (node) { module.exports = api; return; }

  // ------------------------------------------------------------------ browser glue
  var ctx = null, slices = [], timer = 0, msg = null, fileIn = null, baseline = '';

  // what would be saved, without the timestamp; hydration, results and re-renders that change nothing must not write or strip the share link
  function sig() { var c = collect(ctx.state, slices, 0); c.savedAt = ''; return JSON.stringify(c); }

  function storage() { try { return root.localStorage; } catch (e) { return null; } }
  function current() { return collect(ctx.state, slices); }
  function stripHash() {
    try { if (/^#cfg=/.test(root.location.hash)) root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) { /* sandboxed */ }
  }
  function saveNow() {
    clearTimeout(timer); timer = 0;
    stripHash();   // a copied link is a snapshot: once the user edits, a reload must use their stored config
    IO.save(current(), storage());
    baseline = sig();
  }
  function schedule() {
    if (!ctx || sig() === baseline) return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, SAVE_MS);
  }
  function say(t) { if (msg) msg.textContent = t; }

  function applyCfg(cfg) {
    apply(cfg, ctx.state, slices, { units: ctx.units, hood: root.ShotUI.hood, mouthLimit: ctx.data.field.field.half - ctx.engine.ballProps(cfg.field.ballId).rIn });
    ctx.recalc();
  }
  function copyLink() {
    var h = IO.toHash(current()), url = root.location.href.split('#')[0] + h;
    try { root.history.replaceState(null, '', root.location.pathname + root.location.search + h); } catch (e) { /* sandboxed */ }
    var done = function () { say('Link copied'); };
    var fail = function () { say('Link is in the address bar (copy it from there)'); };
    try { root.navigator.clipboard.writeText(url).then(done, fail); } catch (e) { fail(); }
  }
  function download() {
    var blob = new Blob([IO.toJson(current())], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'biobuzz-shot-config.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    say('Config downloaded');
  }
  function importFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var r = IO.fromJson(String(rd.result), ctx.data);
      if (!r.cfg) return say('Not a config file: ' + r.warnings[0]);
      applyCfg(r.cfg);
      saveNow();
      say('Config imported' + (r.warnings.length ? ' (' + r.warnings.length + ' value' + (r.warnings.length > 1 ? 's' : '') + ' adjusted)' : ''));
    };
    rd.onerror = function () { say('Could not read the file'); };
    rd.readAsText(file);
  }
  function button(label, title, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = label; b.title = title; b.addEventListener('click', fn);
    return b;
  }
  function mount(host) {
    fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.hidden = true;
    fileIn.addEventListener('change', function () { if (fileIn.files && fileIn.files[0]) importFile(fileIn.files[0]); fileIn.value = ''; });
    msg = document.createElement('span');
    msg.className = 'cfg-msg'; msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    var bar = document.createElement('div');
    bar.className = 'cfg-bar';
    [button('Share link', 'Copy a link that reproduces these settings', copyLink), button('Download', 'Download the settings as a JSON file', download),
      button('Import', 'Load settings from a JSON file', function () { fileIn.click(); }), fileIn, msg].forEach(function (n) { bar.appendChild(n); });
    host.replaceChildren(bar);
  }

  root.ShotUI = root.ShotUI || {};
  root.ShotUI.config = api;
  root.ShotUI.hooks = (root.ShotUI.hooks || []).concat([{
    name: 'config',
    onStart: function (c) {
      ctx = c;
      slices = (root.ShotUI.hooks || []).filter(function (h) { return h && h !== this && h.configSlice; }, this).map(function (h) { return h.configSlice; });
      var host = document.getElementById('configHost');
      if (host) mount(host);
      var keepUnits = /[?&]units=(metric|imperial)\b/.test(root.location.search) ? c.state.units : null;
      var keepOrigin = /[?&]origin=[a-z-]+/.test(root.location.search) ? c.state.origin : null;
      var r = IO.resolve(root.location.hash, storage(), c.data);
      if (r.source === 'defaults') { baseline = sig(); return; }   // nothing stored: the app already runs on the same defaults
      if (r.source !== 'hash') {   // explicit ?units= / ?origin= beat stored settings (not the share link, which is a full snapshot)
        if (keepUnits) r.cfg.display.units = keepUnits;
        if (keepOrigin) r.cfg.display.origin = keepOrigin;
      }
      applyCfg(r.cfg);
      baseline = sig();
    },
    onChange: function () { schedule(); },
    onResult: function () { schedule(); }   // dragging the mouth does not call onChange
  }]);
  // units and origin changes do not go through changed() in app.js: watch the controls (our listeners run after app.js's own)
  document.addEventListener('click', function (e) { if (ctx && e.target.closest && e.target.closest('.units-seg button')) schedule(); });
  document.addEventListener('change', function (e) { if (ctx && e.target && e.target.id === 'origin') schedule(); });
})(typeof window !== 'undefined' ? window : {});
