/* BIOBUZZ Shot Sim - #5 custom wheel (diameter, inertia or mass + rim/disc) and custom motor (free rpm, stall torque, encoder counts).
   Browser: window.ShotUI.flywheel and a hook on window.ShotUI.hooks, mounted in #flywheelHost. Node: module.exports (model; mount needs a DOM).
   Model: { wheel: FlywheelCustom (SI: mm, kg, kg.m2), motor: { on, freeRpm, stallTorqueNm, encoderPPR } }.
   Wheel -> ShotFlywheelCustom.applyToParams; motor -> params.motorId 'custom' + params.customMotor (the engine reads it, workers too).
   Config slice 'flywheelCustom' (-> cfg.ext.flywheelCustom). Text fields accept a decimal comma. Design: process_docs/issue-5/design.md */
(function (root) {
  'use strict';
  var NODE = typeof module === 'object' && module.exports;
  var FC = NODE ? require('./flywheel-custom.js') : root.ShotFlywheelCustom;
  var MC = NODE ? require('./motor-custom.js') : root.ShotMotorCustom;
  var KEY = 'biobuzz-shot-sim.flywheelCustom';
  var NOTE = 'After η calibration, wheel diameter no longer affects rpm; inertia affects burst recovery and the speed dip per shot.';
  var DEF = {
    wheel: { on: false, diameterMm: 96, mode: 'inertia', inertiaKgM2: 4e-4, massKg: 0.105, shape: 'disc' },
    motor: { on: false, freeRpm: 6000, stallTorqueNm: 0.1442, encoderPPR: 28 }
  };
  // id, group, key, label, display scale (SI -> shown), allowed range (SI)
  var FIELDS = [
    ['fcDiameter', 'wheel', 'diameterMm', 'Wheel diameter (mm)', 1, FC.LIMITS.diameterMm],
    ['fcInertia', 'wheel', 'inertiaKgM2', 'Total inertia on the shaft (kg·m²)', 1, FC.LIMITS.inertiaKgM2],
    ['fcMass', 'wheel', 'massKg', 'Total mass on the shaft (g)', 1000, FC.LIMITS.massKg],
    ['fcFree', 'motor', 'freeRpm', 'Free speed at 12 V (rpm)', 1, MC.LIMITS.freeRpm],
    ['fcStall', 'motor', 'stallTorqueNm', 'Stall torque at 12 V (N·m)', 1, MC.LIMITS.stallTorqueNm],
    ['fcPpr', 'motor', 'encoderPPR', 'Encoder counts per motor rev', 1, MC.LIMITS.encoderPPR]
  ];

  // text -> number; "0,5" is 0.5, "1,234.5" is 1234.5, "4,5e-4" works
  function parse(text) {
    if (typeof text === 'number') return text;
    var s = String(text == null ? '' : text).trim().replace(/\s+/g, '');
    if (s === '') return NaN;
    s = s.indexOf(',') >= 0 && s.indexOf('.') >= 0 ? s.replace(/,/g, '') : s.replace(',', '.');
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }
  function inRange(v, r) { return typeof v === 'number' && isFinite(v) && v >= r[0] && v <= r[1]; }

  function norm(raw) {
    var w = raw && raw.wheel || {}, m = raw && raw.motor || {}, out = JSON.parse(JSON.stringify(DEF));
    out.wheel.on = w.on === true; out.motor.on = m.on === true;
    out.wheel.mode = w.mode === 'mass' ? 'mass' : 'inertia';
    out.wheel.shape = w.shape === 'rim' ? 'rim' : 'disc';
    FIELDS.forEach(function (f) { var src = f[1] === 'wheel' ? w : m; if (inRange(src[f[2]], f[5])) out[f[1]][f[2]] = src[f[2]]; });
    return out;
  }
  function store(storage) {
    if (storage) return storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function load(storage) {
    try { return norm(JSON.parse(store(storage).getItem(KEY))); } catch (e) { return norm(null); }
  }
  function save(v, storage) {
    try { store(storage).setItem(KEY, JSON.stringify(norm(v))); } catch (e) { /* storage off */ }
  }
  // the motor part that goes into params (null when off)
  function motorOf(v) { return v.motor.on ? MC.norm({ freeRpm: v.motor.freeRpm, stallTorqueNm: v.motor.stallTorqueNm, encoderPPR: v.motor.encoderPPR }) : null; }
  function extend(p, v, install) {
    if (!p) return p;
    var q = FC.applyToParams(p, v.wheel), cm = motorOf(v);
    if (install) install(cm);
    return cm ? Object.assign({}, q, { motorId: 'custom', customMotor: cm }) : q;
  }
  // set one field from typed text; { ok, value, error } (value = the new model, unchanged when not ok)
  function setField(v, id, text) {
    var f = FIELDS.filter(function (x) { return x[0] === id; })[0];
    if (!f) return { ok: false, value: v, error: 'unknown field' };
    var x = parse(text) / f[4];
    if (!inRange(x, f[5])) return { ok: false, value: v, error: f[3] + ' must be a number from ' + f[5][0] * f[4] + ' to ' + f[5][1] * f[4] };
    var n = norm(v);
    n[f[1]][f[2]] = x;
    return { ok: true, value: n, error: '' };
  }
  function show(f, x) { var d = x * f[4]; return f[0] === 'fcInertia' ? Number(d.toPrecision(3)).toExponential().replace('e+', 'e') : String(Number(d.toPrecision(6))); }

  var api = { norm: norm, load: load, save: save, parse: parse, extend: extend, setField: setField, motorOf: motorOf, FIELDS: FIELDS, KEY: KEY, NOTE: NOTE };
  if (NODE) { module.exports = api; return; }

  // ------------------------------------------------------------------ controls (browser)
  var cur = load(), ctx = null, els = {};
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function toggle(id, text) {
    var cb = el('input', { type: 'checkbox', id: id });
    return { cb: cb, box: el('label', { class: 'fc-toggle' }, [cb, el('span', { text: text })]) };
  }
  function seg(label, id, opts) {
    var s = el('div', { class: 'seg', role: 'group', 'aria-label': label, id: id }, opts.map(function (o) { return el('button', { type: 'button', 'data-v': o[0], text: o[1] }); }));
    return s;
  }
  function field(f) {
    var inp = el('input', { type: 'text', inputmode: 'decimal', id: f[0], class: 'fc-in', autocomplete: 'off', 'aria-label': f[3] });
    els[f[0]] = inp;
    return el('label', { class: 'fc-f' }, [el('span', { text: f[3] }), inp]);
  }
  function commit(next) { cur = norm(next); save(cur); sync(); if (ctx) ctx.recalc(); }
  function say(t) { if (els.msg) els.msg.textContent = t || ''; }

  function mount(host) {
    var tw = toggle('fcWheelOn', 'Custom wheel'), tm = toggle('fcMotorOn', 'Custom motor');
    els.wheelOn = tw.cb; els.motorOn = tm.cb;
    els.mode = seg('Inertia from', 'fcMode', [['inertia', 'Inertia'], ['mass', 'Mass + shape']]);
    els.shape = seg('Shape', 'fcShape', [['disc', 'Disc (½ m r²)'], ['rim', 'Rim (m r²)']]);
    els.computed = el('output', { class: 'fc-computed', id: 'fcComputed' });
    els.msg = el('p', { class: 'fc-msg', role: 'status', 'aria-live': 'polite' });
    var f = {}; FIELDS.forEach(function (x) { f[x[0]] = field(x); });
    els.wheel = el('div', { class: 'fc-sec' }, [f.fcDiameter, els.mode, f.fcInertia, f.fcMass, els.shape, els.computed]);
    els.motor = el('div', { class: 'fc-sec' }, [f.fcFree, f.fcStall, f.fcPpr]);
    host.replaceChildren(el('div', { class: 'fc', id: 'flywheelCustom' }, [tw.box, els.wheel, tm.box, els.motor, el('p', { class: 'hood-hint', text: NOTE }), els.msg]));
    FIELDS.forEach(function (x) {
      els[x[0]].addEventListener('change', function () {
        var r = setField(cur, x[0], this.value);
        say(r.error);
        if (r.ok) commit(r.value); else { this.value = show(x, cur[x[1]][x[2]]); this.setAttribute('aria-invalid', 'true'); }   // junk keeps the last good value
      });
    });
    els.wheelOn.addEventListener('change', function () { var n = norm(cur); n.wheel.on = this.checked; say(''); commit(n); });
    els.motorOn.addEventListener('change', function () { var n = norm(cur); n.motor.on = this.checked; say(''); commit(n); });
    els.mode.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { var n = norm(cur); n.wheel.mode = b.getAttribute('data-v'); commit(n); } });
    els.shape.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { var n = norm(cur); n.wheel.shape = b.getAttribute('data-v'); commit(n); } });
    sync();
  }
  function sync() {
    if (!els.wheel) return;
    var w = cur.wheel, mass = w.mode === 'mass';
    els.wheelOn.checked = w.on; els.motorOn.checked = cur.motor.on;
    els.wheel.hidden = !w.on; els.motor.hidden = !cur.motor.on;
    FIELDS.forEach(function (f) { if (document.activeElement !== els[f[0]]) els[f[0]].value = show(f, cur[f[1]][f[2]]); els[f[0]].setAttribute('aria-invalid', 'false'); });
    els.fcInertia.parentNode.hidden = mass; els.fcMass.parentNode.hidden = !mass; els.shape.hidden = !mass; els.computed.hidden = !mass;
    [els.mode, els.shape].forEach(function (s, i) {
      var v = i ? w.shape : w.mode;
      s.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
    });
    els.computed.textContent = 'Inertia = ' + show(FIELDS[1], FC.inertiaOf(w)) + ' kg·m²';
  }
  function install(cm) { var E = root.ShotEngine, x = E && E._internal && E._internal.ext && E._internal.ext('motorCustom'); if (x) x.install(cm); }

  root.ShotUI = root.ShotUI || {};
  root.ShotUI.flywheel = api;
  root.ShotUI.hooks = (root.ShotUI.hooks || []).concat([{
    name: 'flywheel',
    onStart: function (c) { ctx = c; var host = document.getElementById('flywheelHost'); if (host) mount(host); },
    extendParams: function (p) { return extend(p, cur, install); },
    onMathRender: function (body, r, p) {
      var parts = [];
      if (!p) return;
      if (cur.wheel.on) parts.push('custom wheel: ' + p.shooter.wheelDiameterMm + ' mm, ' + show(FIELDS[1], p.shooter.inertiaKgM2) + ' kg·m² (replaces the wheel and steel-flywheel choice above)');
      if (p && p.customMotor) parts.push('custom motor: ' + p.customMotor.freeRpm + ' rpm free, ' + p.customMotor.stallTorqueNm + ' N·m stall');
      if (parts.length) body.appendChild(el('p', { class: 'help', 'data-flywheel': '1', text: 'In use: ' + parts.join('; ') + '.' }));
    },
    configSlice: { key: 'flywheelCustom', get: function () { return norm(cur); }, set: function (v) { cur = norm(v); save(cur); sync(); if (ctx) ctx.recalc(); } }
  }]);
})(typeof window !== 'undefined' ? window : {});
