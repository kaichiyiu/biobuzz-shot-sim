/* BIOBUZZ Shot Sim - #2 hood configuration: model (load / save / validate / toParams) and the Robot-config controls.
   Browser: window.ShotUI.hood. Node: module.exports (the pure model; mount / sync need a DOM). */
(function (root) {
  'use strict';
  var KEY = 'biobuzz-shot-sim.hood';
  var MIN_DEG = 1;
  var MAX_DEG = 89;
  // the engine clamps an adjustable range to this span (engine-hood.js norm)
  var SPAN_LO = 10;
  var SPAN_HI = 89;
  var DEFAULTS = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };   // adjustable 45-80, no fixed angle yet (empty)

  function store(storage) {
    if (storage) return storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function finite(x, fallback) {
    return typeof x === 'number' && isFinite(x) ? x : fallback;
  }
  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  // defaults: data/shooter.json defaults.hood (optional); a saved config wins. angleText keeps what was typed.
  function load(defaults, storage) {
    var d = defaults || {};
    var cfg = {
      mode: d.mode === 'fixed' ? 'fixed' : DEFAULTS.mode,
      minDeg: finite(d.minDeg, DEFAULTS.minDeg),
      maxDeg: finite(d.maxDeg, DEFAULTS.maxDeg),
      angleText: d.angleDeg != null && isFinite(d.angleDeg) ? String(d.angleDeg) : ''
    };
    try {
      var o = JSON.parse(store(storage).getItem(KEY));
      if (o) {
        if (o.mode === 'fixed' || o.mode === 'adjustable') cfg.mode = o.mode;
        cfg.minDeg = finite(o.minDeg, cfg.minDeg);
        cfg.maxDeg = finite(o.maxDeg, cfg.maxDeg);
        if (typeof o.angleText === 'string') cfg.angleText = o.angleText;
      }
    } catch (e) { /* storage off, empty or corrupt: defaults */ }
    return cfg;
  }
  function save(cfg, storage) {
    try { store(storage).setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage off */ }
  }

  // '' -> NaN; a plain decimal ('62,5' allowed) -> number; anything else ('65abc', '1e1') -> NaN
  function parseAngle(text) {
    var s = String(text == null ? '' : text).trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s) ? Number(s) : NaN;
  }
  function isEmpty(text) {
    return String(text == null ? '' : text).trim() === '';
  }

  // mirrors the engine's norm() for the fixed hood; adjustable never errors (the engine clamps and swaps)
  function validate(cfg) {
    if (cfg.mode !== 'fixed') return null;
    var field = 'hood.angleDeg';
    if (isEmpty(cfg.angleText)) {
      return { code: 'HOOD_ANGLE_REQUIRED', message: 'Enter launch angle', field: field };
    }
    var a = parseAngle(cfg.angleText);
    if (!isFinite(a)) {
      return { code: 'HOOD_ANGLE_RANGE', message: 'Launch angle must be a number between ' + MIN_DEG + ' and ' + MAX_DEG + '°', field: field };
    }
    if (a < MIN_DEG || a > MAX_DEG) {
      return { code: 'HOOD_ANGLE_RANGE', message: 'Launch angle must be ' + MIN_DEG + '–' + MAX_DEG + '°', field: field };
    }
    return null;
  }

  function toParams(cfg) {
    if (cfg.mode === 'fixed') {
      var a = parseAngle(cfg.angleText);
      return { mode: 'fixed', angleDeg: isFinite(a) ? a : null };
    }
    return { mode: 'adjustable', minDeg: cfg.minDeg, maxDeg: cfg.maxDeg };
  }

  // the engine treats an adjustable range narrower than 1 degree (after clamping to 10-89) as a fixed angle
  function isNarrow(minDeg, maxDeg) {
    var lo = clamp(finite(minDeg, DEFAULTS.minDeg), SPAN_LO, SPAN_HI);
    var hi = clamp(finite(maxDeg, DEFAULTS.maxDeg), SPAN_LO, SPAN_HI);
    return Math.abs(hi - lo) < 1;
  }
  // HoodParams (or a HoodConfig) -> does the engine run it as a single fixed angle?
  function isFixedLike(h) {
    return !!h && (h.mode === 'fixed' || isNarrow(h.minDeg, h.maxDeg));
  }

  // ------------------------------------------------------------------ controls (browser)
  var els = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function numInput(id, label) {
    var input = el('input', { type: 'number', id: id, step: '1', min: '1', max: '89' });
    return el('label', { class: 'ctl' }, [el('span', { class: 'label', text: label }), input]);
  }

  function mount(host, get, onChange) {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'hood-l' }, [
      el('button', { type: 'button', 'data-v': 'adjustable', text: 'Adjustable' }),
      el('button', { type: 'button', 'data-v': 'fixed', text: 'Fixed' })
    ]);
    var adj = el('div', { class: 'ctl-row', id: 'hoodAdj' }, [numInput('hoodMin', 'Min angle (°)'), numInput('hoodMax', 'Max angle (°)')]);
    var angle = el('input', {
      type: 'text', id: 'hoodAngle', inputmode: 'decimal', autocomplete: 'off', placeholder: '1–89', 'aria-describedby': 'hoodHint'
    });
    var fixed = el('label', { class: 'ctl', id: 'hoodFixed' }, [el('span', { class: 'label', text: 'Launch angle (°)' }), angle]);
    var hint = el('p', { class: 'hood-hint', id: 'hoodHint' });
    host.replaceChildren(el('div', { class: 'hood' }, [el('span', { class: 'label', id: 'hood-l', text: 'Hood' }), seg, adj, fixed, hint]));
    els = { seg: seg, adj: adj, fixed: fixed, angle: angle, min: host.querySelector('#hoodMin'), max: host.querySelector('#hoodMax'), hint: hint };

    function push(patch) {
      var c = Object.assign({}, get(), patch);
      sync(c);
      onChange(c);
    }
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) push({ mode: b.getAttribute('data-v') });
    });
    angle.addEventListener('input', function () { push({ angleText: angle.value }); });
    [['min', 'minDeg'], ['max', 'maxDeg']].forEach(function (k) {
      els[k[0]].addEventListener('change', function () {
        var v = parseAngle(els[k[0]].value);
        if (!isFinite(v)) return sync(get());
        var patch = {};
        patch[k[1]] = v;
        push(patch);
      });
    });
    sync(get());
  }

  function hintText(cfg, bad) {
    if (cfg.mode === 'fixed') {
      if (bad) return bad.message + '. Degrees above the horizontal; not converted by the unit toggle.';
      return 'The angle your hood is set to, in degrees above the horizontal.';
    }
    if (isNarrow(cfg.minDeg, cfg.maxDeg)) return 'Range under 1° — treated as a fixed angle at the middle.';
    return 'The simulator picks the angle with the widest rpm window inside this range.';
  }

  function sync(cfg) {
    if (!els) return;
    var fixed = cfg.mode === 'fixed';
    var bad = fixed && validate(cfg);
    els.seg.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === cfg.mode));
    });
    els.adj.hidden = fixed;
    els.fixed.hidden = !fixed;
    if (document.activeElement !== els.angle) els.angle.value = cfg.angleText;
    if (document.activeElement !== els.min) els.min.value = cfg.minDeg;
    if (document.activeElement !== els.max) els.max.value = cfg.maxDeg;
    els.angle.setAttribute('aria-invalid', String(!!bad));
    els.hint.textContent = hintText(cfg, bad);
  }

  var api = {
    load: load, save: save, validate: validate, toParams: toParams, mount: mount, sync: sync,
    parseAngle: parseAngle, isNarrow: isNarrow, isFixedLike: isFixedLike, DEFAULTS: DEFAULTS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.hood = api; }
})(typeof window !== 'undefined' ? window : {});
