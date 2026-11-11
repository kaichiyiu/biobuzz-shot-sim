/* BIOBUZZ Shot Sim - #7 tolerance (owner decision 4): the team's +- errors (yaw, launch angle, motor rpm, position) -> margin verdict.
   Model (SI): { yawDeg, angleDeg, rpm, posIn, source: 'measured' | 'preset' }; all zero = no tolerance = the legacy hit-rate verdict, app unchanged.
   Browser: window.ShotUI.tolerance and a hook (configSlice 'tolerance'; I8: body.has-tolerance + a note under the motors table).
   Node: module.exports (the pure model). The inputs and the result text live in ui-tolerance-panel.js. */
(function (root) {
  'use strict';
  var KEYS = ['yawDeg', 'angleDeg', 'rpm', 'posIn'];
  var DEFAULT_POS_IN = 1;
  var MOTOR_NOTE = 'Verdicts in this table use the old hit-rate model.';

  function pos(x) { return typeof x === 'number' && isFinite(x) && x > 0 ? x : 0; }
  function norm(raw) {
    var o = {};
    KEYS.forEach(function (k) { o[k] = pos(raw && raw[k]); });
    o.source = raw && raw.source === 'preset' ? 'preset' : 'measured';
    return o;
  }
  function isActive(m) { return KEYS.some(function (k) { return pos(m && m[k]) > 0; }); }
  // engine params.tolerance: null when nothing is set (the key is then not added at all)
  function toParams(m) {
    var n = norm(m);
    if (!isActive(n)) return null;
    n.best = true;   // report the most forgiving setpoint too (the export turns it off)
    return n;
  }
  // Q2: starting values = 2 sigma of today's precision preset; rpm = 2 sigShooter x the current motor rpm (unknown rpm keeps the old value)
  function presetFor(prec, motorRpm, cur) {
    if (!prec) return norm(cur);
    var rpm = pos(motorRpm) > 0 ? Math.round(2 * prec.sigShooter * motorRpm) : pos(cur && cur.rpm);
    return { yawDeg: 2 * prec.sigYawDeg, angleDeg: 2 * prec.sigThetaDeg, rpm: rpm, posIn: DEFAULT_POS_IN, source: 'preset' };
  }
  // CalibRecord.fit.spreadRpm: a 90 % half-width of the measured motor-rpm scatter, or null
  function calibSpread(rec) {
    var s = rec && rec.fit && rec.fit.spreadRpm;
    return typeof s === 'number' && isFinite(s) && s > 0 ? Math.round(s * 10) / 10 : null;
  }
  function parseField(key, text, units) {
    if (text == null || String(text).trim() === '') return 0;
    var v = key === 'posIn' ? units.parseLen(text) : Number(text);
    return isFinite(v) ? v : NaN;   // NaN = junk: the caller keeps the old value
  }

  var api = { norm: norm, isActive: isActive, toParams: toParams, presetFor: presetFor, calibSpread: calibSpread, parseField: parseField, KEYS: KEYS, MOTOR_NOTE: MOTOR_NOTE };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var cur = norm(null), ctx = null, last = null, panel = null, note = null, UI = root.ShotUI = root.ShotUI || {};
  function calibRecord() {
    if (UI.calibReport && UI.calibReport.record) return UI.calibReport.record();
    var s = (UI.hooks || []).map(function (h) { return h.configSlice; }).filter(function (c) { return c && c.key === 'calibration'; })[0];
    try { return s ? s.get() : null; } catch (e) { return null; }
  }
  function refresh() {
    var on = isActive(cur);
    try { document.body.classList.toggle('has-tolerance', on); } catch (e) { /* no body */ }
    if (note) { note.hidden = !on; note.textContent = on ? MOTOR_NOTE : ''; }
    if (panel) panel.sync();
  }
  function set(m, recalc) { cur = norm(m); refresh(); if (recalc && ctx) ctx.recalc(); }
  function say(t) { if (panel) panel.say(t); }
  // the reason line under the badge drops its hit-rate wording while a margin is shown. Only the legacy sentences are replaced (never a hood error text).
  function fixReason() {
    var el = document.getElementById('reason'), txt = last && last.tolerance && UI.tolPanel ? UI.tolPanel.reason(last.tolerance, last) : null;
    if (el && txt && /^(Scores|Only) \d+% of shots/.test(el.textContent || '')) el.textContent = txt;
  }
  // the app re-renders results on a units switch without calling hooks: watch the reason line and the units buttons (same precedent as ui-entry)
  function watch() {
    if (typeof MutationObserver !== 'function') return;
    var rs = document.getElementById('reason'), us = document.querySelector('[data-key="units"]');
    if (rs) new MutationObserver(fixReason).observe(rs, { childList: true, characterData: true, subtree: true });
    if (us) new MutationObserver(function () { if (panel) { panel.sync(); panel.result(last); } }).observe(us, { attributes: true, attributeFilter: ['aria-pressed'], subtree: true });
  }

  UI.tolerance = api;
  UI.hooks = (UI.hooks || []).concat([{
    name: 'tolerance',
    onStart: function (c) {
      ctx = c;
      var cap = document.getElementById('motorsCaption');
      if (cap && cap.parentNode) {
        note = document.createElement('p'); note.id = 'tolMotorsNote'; note.className = 'help'; note.hidden = true;
        cap.parentNode.appendChild(note);
      }
      var host = document.getElementById('toleranceHost');
      if (host && UI.tolPanel) {
        panel = UI.tolPanel.mount(host, {
          get: function () { return cur; }, units: c.units,
          downgrade: c.engine && c.engine.constants ? (c.engine.constants().model || {}).downgrade : undefined,
          onField: function (k, text) {
            var v = parseField(k, text, c.units), m = norm(cur);
            if (!isFinite(v)) { refresh(); return; }   // junk keeps the old value
            m[k] = v; m.source = 'measured'; say(''); set(m, true);
          },
          onPreset: function (name) {
            var prec = c.data && c.data.shooter && c.data.shooter.precision && c.data.shooter.precision[name];
            var rpm = last && last.motor && last.motor.motorRpm;
            set(presetFor(prec, rpm, cur), true);
            say('Starting values for ' + name + ': a guess, not your robot.' + (pos(rpm) > 0 ? '' : ' No result yet, so the rpm value was left as it was.'));
          },
          onCalib: function () {
            var s = calibSpread(calibRecord());
            if (s == null) { say('No calibration yet: run the calibration section first.'); return; }
            var m = norm(cur); m.rpm = s; m.source = 'measured';
            set(m, true); say('Motor rpm ± set to ' + s + ' (the 90 % half-width of your measured spread).');
          },
          onClear: function () { say(''); set(null, true); }
        });
      }
      watch(); refresh();
    },
    extendParams: function (p) {
      var t = toParams(cur);
      if (p && t) p.tolerance = t;
      return p;
    },
    onChange: function () { if (panel) { panel.sync(); panel.result(last); } },   // units switch: values and result text in the new units (the legacy render redoes #reason)
    onResult: function (r) { last = r; if (panel) panel.result(r); fixReason(); },   // runs after the legacy render
    configSlice: {
      key: 'tolerance',
      get: function () { return isActive(cur) ? norm(cur) : null; },
      set: function (v) { set(v, false); if (ctx) ctx.recalc(); }
    }
  }]);
})(typeof window !== 'undefined' ? window : {});
