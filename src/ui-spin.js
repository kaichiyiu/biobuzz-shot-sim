/* BIOBUZZ Shot Sim - #10 spin direction: backspin (wheel below the ball) / topspin (wheel above), single wheel only.
   Browser: window.ShotUI.spin and a hook on window.ShotUI.hooks. Node: module.exports (the pure model; mount needs a DOM). */
(function (root) {
  'use strict';
  var KEY = 'biobuzz-shot-sim.spin';
  var LABEL = 'Spin: Backspin (wheel below) / Topspin (wheel above)';
  var HINT = 'Topspin presses the ball down from above: it needs a little more speed, and lands flatter. Single wheel only.';

  function store(storage) {
    if (storage) return storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  // anything but 'top' is the default backspin
  function norm(v) { return v === 'top' ? 'top' : 'back'; }

  function load(storage) {
    try { return norm(JSON.parse(store(storage).getItem(KEY))); } catch (e) { return 'back'; }   // storage off, empty or corrupt
  }
  function save(v, storage) {
    try { store(storage).setItem(KEY, JSON.stringify(norm(v))); } catch (e) { /* storage off */ }
  }
  function toParams(v) { return norm(v); }

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

  // deps = { get(): 'back'|'top', onChange(v): void }
  function mount(host, deps) {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'spin-l' }, [
      el('button', { type: 'button', 'data-v': 'back', text: 'Backspin' }),
      el('button', { type: 'button', 'data-v': 'top', text: 'Topspin' })
    ]);
    var wrap = el('div', { class: 'ctl', id: 'spinCtl' }, [el('span', { class: 'label', id: 'spin-l', text: LABEL }), seg, el('p', { class: 'hood-hint', text: HINT })]);
    host.replaceChildren(wrap);
    els = { wrap: wrap, seg: seg };
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var v = norm(b.getAttribute('data-v'));
      sync(v);
      deps.onChange(v);
    });
    sync(deps.get());
  }

  function sync(v) {
    if (!els) return;
    v = norm(v);
    els.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  // only a single wheel can carry a top / back spin choice
  function setVisible(shooterType) {
    if (els) els.wrap.hidden = shooterType === 'dual';
  }

  var api = { load: load, save: save, toParams: toParams, mount: mount, sync: sync, setVisible: setVisible, norm: norm, KEY: KEY, LABEL: LABEL };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var cur = load(), ctx = null;
  function set(v) {
    cur = norm(v);
    save(cur);
    sync(cur);
  }
  root.ShotUI = root.ShotUI || {};
  root.ShotUI.spin = api;
  root.ShotUI.hooks = (root.ShotUI.hooks || []).concat([{
    name: 'spin',
    onStart: function (c) {
      ctx = c;
      var host = document.getElementById('spinHost');
      if (!host) return;
      mount(host, { get: function () { return cur; }, onChange: function (v) { set(v); ctx.recalc(); } });
      setVisible(c.state.shooter.type);
    },
    extendParams: function (p) {
      if (p && p.shooter) p.shooter.spin = toParams(cur);
      return p;
    },
    onChange: function (state) { setVisible(state.shooter.type); },
    configSlice: { key: 'spin', get: function () { return cur; }, set: function (v) { set(v); if (ctx) ctx.recalc(); } }
  }]);
})(typeof window !== 'undefined' ? window : {});
