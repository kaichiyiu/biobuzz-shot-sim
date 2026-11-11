/* BIOBUZZ Shot Sim - #12 entry rule: which ball entry into the CELL counts as a score (any / descending only / entry speed limit).
   A team setting, default 'any' (= the legacy behaviour). Entry speed and direction are always shown in "Reference data".
   Browser: window.ShotUI.entry and a hook on window.ShotUI.hooks. Node: module.exports (pure model; mount needs a DOM).
   Model: { rule: 'any' | 'descending' | 'maxSpeed', maxSpeedMps } (SI, whatever the display units are). */
(function (root) {
  'use strict';
  var KEY = 'biobuzz-shot-sim.entry';
  var DEFAULT_MAX = 6;   // m/s, first value offered when "Max speed" is picked
  var RULES = ['any', 'descending', 'maxSpeed'];
  var NAMES = { any: 'Any', descending: 'Descending', maxSpeed: 'Max speed' };
  var HINTS = {
    any: 'Every ball that drops into the CELL counts.',
    descending: 'Only a ball that is already falling when it crosses the mouth counts (the angle search then prefers steeper shots).',
    maxSpeed: 'Only a ball that enters slower than the limit counts.'
  };

  function norm(raw) {
    var rule = raw && RULES.indexOf(raw.rule) >= 0 ? raw.rule : 'any';
    var m = raw && typeof raw.maxSpeedMps === 'number' && isFinite(raw.maxSpeedMps) && raw.maxSpeedMps > 0 ? raw.maxSpeedMps : DEFAULT_MAX;
    return { rule: rule, maxSpeedMps: m };
  }
  function store(storage) {
    if (storage) return storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function load(storage) {
    try { return norm(JSON.parse(store(storage).getItem(KEY))); } catch (e) { return norm(null); }   // storage off, empty or corrupt
  }
  function save(v, storage) {
    try { store(storage).setItem(KEY, JSON.stringify(norm(v))); } catch (e) { /* storage off */ }
  }
  // engine params.entry: maxSpeedMps only travels with the maxSpeed rule
  function toParams(v) {
    var n = norm(v);
    return n.rule === 'maxSpeed' ? { rule: 'maxSpeed', maxSpeedMps: n.maxSpeedMps } : { rule: n.rule };
  }

  function fin(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  // Reference-data rows for a result r; u = ShotUnits, nf(n, digits) = number formatter.
  // Source: res.entry.best (the cell the scoring window sits on, rule-aware), else res.best (the engine gives it no angle today).
  function rows(r0, rule, u, nf) {
    var e = r0 && r0.entry && r0.entry.best, b = r0 && r0.best;
    var a = fin(e && e.angleDeg), s = fin(e && e.speedMps);
    if (a == null) a = fin(b && b.entryAngleDeg);
    if (s == null) s = fin(b && b.entrySpeed);
    var r = norm(rule), note = r.rule === 'descending' ? 'rule: descending only' : r.rule === 'maxSpeed' ? 'rule: at most ' + u.fmtSpeed(r.maxSpeedMps, 1) : '';
    return [
      { label: 'Entry speed', value: s == null ? '—' : u.fmtSpeed(s, 1), small: note && r.rule === 'maxSpeed' ? note : '' },
      { label: 'Entry direction', value: a == null ? '—' : (a < 0 ? 'Descending ' : 'Rising ') + nf(Math.abs(a), 1) + '°',
        small: note && r.rule === 'descending' ? note : (a == null ? '' : 'angle of the path at the mouth, vs horizontal') }
    ];
  }

  // appends rows to a <dl> of <div><dt/><dd/></div>; removes its own earlier rows first, so repeated calls never duplicate
  function appendRows(dl, items) {
    Array.prototype.slice.call(dl.querySelectorAll('[data-entry]')).forEach(function (n) { n.remove(); });
    items.forEach(function (it) {
      var d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      d.setAttribute('data-entry', '1');
      dt.textContent = it.label;
      dd.textContent = it.value;
      if (it.small) { var sm = document.createElement('small'); sm.textContent = it.small; dd.appendChild(sm); }
      d.appendChild(dt); d.appendChild(dd);
      dl.appendChild(d);
    });
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

  // deps = { get(): model, onRule(rule), onSpeed(mps), units }
  function mount(host, deps) {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'entry-l' }, RULES.map(function (r) {
      return el('button', { type: 'button', 'data-v': r, text: NAMES[r] });
    }));
    var input = el('input', { type: 'number', id: 'entryMax', step: '0.5', min: '0.1', 'aria-label': 'Entry speed limit' });
    var unit = el('span', { class: 'unit' });
    var limit = el('div', { class: 'ctl' }, [el('span', { class: 'label', text: 'Entry speed limit' }), el('div', { class: 'row' }, [input, unit])]);
    var hint = el('p', { class: 'hood-hint' });
    var wrap = el('div', { class: 'ctl', id: 'entryCtl' }, [el('span', { class: 'label', id: 'entry-l', text: 'Entry rule: which entry counts' }), seg, limit, hint]);
    host.replaceChildren(wrap);
    els = { wrap: wrap, seg: seg, input: input, unit: unit, limit: limit, hint: hint, deps: deps };
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) deps.onRule(b.getAttribute('data-v'));
    });
    input.addEventListener('change', function () {
      var v = deps.units.parseSpeed(input.value);
      if (isFinite(v) && v > 0) deps.onSpeed(v); else sync();   // junk keeps the old limit
    });
    sync();
  }

  function sync() {
    if (!els) return;
    var m = norm(els.deps.get()), u = els.deps.units;
    els.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === m.rule)); });
    els.limit.hidden = m.rule !== 'maxSpeed';
    els.input.value = String(Math.round(u.toSpeed(m.maxSpeedMps) * 100) / 100);   // display units
    els.unit.textContent = u.speedUnit();
    els.hint.textContent = HINTS[m.rule];
  }

  var api = { load: load, save: save, toParams: toParams, norm: norm, rows: rows, appendRows: appendRows, mount: mount, sync: sync, KEY: KEY };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var cur = load(), ctx = null, last = null, dl = null;
  function set(v) { cur = norm(v); save(cur); sync(); }
  // rows are re-added after every legacy Reference render (results, unit switch) and skipped in the hood error state
  function place() {
    if (!dl || !last || dl.querySelector('.err')) return;
    if (dl.querySelector('[data-entry]')) return;
    appendRows(dl, rows(last, cur, ctx.units, ctx.fmt.nf));
  }
  root.ShotUI = root.ShotUI || {};
  root.ShotUI.entry = api;
  root.ShotUI.hooks = (root.ShotUI.hooks || []).concat([{
    name: 'entry',
    onStart: function (c) {
      ctx = c;
      dl = document.getElementById('refReadout');
      if (dl && typeof MutationObserver === 'function') new MutationObserver(function () { sync(); place(); }).observe(dl, { childList: true });
      var host = document.getElementById('entryHost');
      if (!host) return;
      mount(host, {
        get: function () { return cur; }, units: c.units,
        onRule: function (r) { var m = norm(cur); m.rule = r; set(m); c.recalc(); },
        onSpeed: function (v) { var m = norm(cur); m.maxSpeedMps = v; set(m); if (m.rule === 'maxSpeed') c.recalc(); else sync(); }
      });
    },
    extendParams: function (p) {
      if (p) p.entry = toParams(cur);
      return p;
    },
    onResult: function (r) {
      last = r;
      if (dl) { dl.querySelectorAll('[data-entry]').forEach(function (n) { n.remove(); }); place(); }
    },
    configSlice: { key: 'entry', get: function () { return norm(cur); }, set: function (v) { set(v); if (ctx) ctx.recalc(); } }
  }]);
})(typeof window !== 'undefined' ? window : {});
