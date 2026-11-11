/* BIOBUZZ Shot Sim - #11 calibration form helpers: grid <-> CalibRow[] (display units <-> inches), plan range, live messages.
   Grid row = { settingId, hoodDeg, setpointRpm, predictedIn, rpm: text, shots: [text x5], ballId?, h0In? }. Shot cells are text in DISPLAY units.
   Browser: window.ShotUI.calibGrid. Node: module.exports. Pure except el(). */
(function (root) {
  'use strict';
  var SHOTS = 5;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function num(t) { var s = String(t == null ? '' : t).trim().replace(/,/g, ''); return s === '' ? NaN : Number(s); }
  function r1(x) { return Math.round(x * 10) / 10; }

  // minimal ConfigV1 for CalibPlan / CalibFit: spin comes from the spin hook (state has none)
  function cfgOf(state, spin) {
    return { field: { ballId: state.ballId, h0: state.h0 }, robot: { shooter: Object.assign({}, state.shooter, { spin: spin === 'top' ? 'top' : 'back' }) } };
  }
  // [lo, hi] motor rpm: the export range when given, else the current setpoint +/- 15 % (hi kept under the usable free speed)
  function rangeOf(result, exportRange) {
    if (exportRange && exportRange[0] > 0 && exportRange[1] > exportRange[0]) return [exportRange[0], exportRange[1]];
    var m = result && result.motor, w = result && result.hood && result.hood.rpmWindow;
    var c = w && w.centerMotorRpm > 0 ? w.centerMotorRpm : (m && m.motorRpm > 0 ? m.motorRpm : 0);
    if (!c) return null;
    var hi = c * 1.15;
    if (m && m.usableFreeRpm > 0) hi = Math.min(hi, m.usableFreeRpm);
    return [Math.round(c * 0.85), Math.round(hi)];
  }
  // hood angles to test: a fixed hood's angle, else the recommended angle (adjustable); [] when unknown
  function hoodDegsOf(state, result) {
    var h = state.hood || {}, a = h.mode === 'fixed' ? num(h.angleText) : (result && result.hood && result.hood.angleDeg);
    return a >= 5 && a <= 85 ? [r1(a)] : [];
  }
  function makeGrid(settings) {
    return settings.map(function (s) {
      return { settingId: s.id, hoodDeg: s.hoodDeg, setpointRpm: s.motorRpmSet, predictedIn: s.predictedLandingIn, rpm: '', shots: ['', '', '', '', ''] };
    });
  }

  // env = { ballId, h0In, units, U: ShotUnits }. Rows with neither rpm nor shots are dropped; unparseable cells are dropped here and reported by messages().
  function toRows(grid, env) {
    var out = [];
    grid.forEach(function (g) {
      var shots = g.shots.map(function (t) { return env.U.parseLen(t, env.units); }).filter(function (x) { return isFinite(x); });
      var rpm = num(g.rpm);
      if (!isFinite(rpm) && !shots.length) return;
      out.push({ settingId: g.settingId, ballId: g.ballId || env.ballId, h0In: g.h0In || env.h0In, hoodDeg: g.hoodDeg, measuredMotorRpm: rpm, landingIn: shots });
    });
    return out;
  }
  // imported CalibRow[] -> grid (setpoints and predictions are kept for settings that exist in `old`)
  function fromRows(rows, old, env) {
    var by = {};
    (old || []).forEach(function (g) { by[g.settingId] = g; });
    return rows.map(function (r, i) {
      var o = by[r.settingId] || {}, shots = r.landingIn.map(function (d) { return String(r1(env.U.toLen(d, env.units))); });
      while (shots.length < SHOTS) shots.push('');
      return { settingId: r.settingId || 'row' + (i + 1), hoodDeg: r.hoodDeg, setpointRpm: o.setpointRpm == null ? null : o.setpointRpm, predictedIn: o.predictedIn == null ? null : o.predictedIn,
        rpm: String(r.measuredMotorRpm), shots: shots, ballId: r.ballId, h0In: r.h0In };
    });
  }
  // unit switch: re-express every shot cell
  function convert(grid, from, to, U) {
    grid.forEach(function (g) {
      g.shots = g.shots.map(function (t) { var v = U.parseLen(t, from); return isFinite(v) ? String(r1(U.toLen(v, to))) : t; });
    });
  }

  // live messages: [{ row, level, text }]; V = CalibValidate
  function messages(grid, env, V) {
    var out = [];
    grid.forEach(function (g, i) {
      var tag = g.settingId + ': ', cells = g.shots.filter(function (t) { return String(t).trim() !== ''; });
      var shots = cells.map(function (t) { return env.U.parseLen(t, env.units); });
      var rpm = num(g.rpm), good = shots.filter(function (x) { return isFinite(x); });
      if (!cells.length && !isFinite(rpm)) return;
      if (good.length < cells.length) out.push({ row: i, level: 'error', text: tag + 'a shot distance is not a number.' });
      if (!isFinite(rpm)) { out.push({ row: i, level: 'error', text: tag + 'enter the measured motor rpm (encoder telemetry at release).' }); return; }
      V.validateRow({ ballId: g.ballId || env.ballId, h0In: g.h0In || env.h0In, hoodDeg: g.hoodDeg, measuredMotorRpm: rpm, landingIn: good }, { setpointRpm: g.setpointRpm, units: env.units })
        .forEach(function (m) { out.push({ row: i, level: m.level, text: tag + m.text }); });
    });
    return out;
  }
  // Fit is allowed with at least 5 shots, every row with shots has an rpm, and no error message
  function ready(grid, env, V) {
    var rows = toRows(grid, env), n = rows.reduce(function (s, r) { return s + r.landingIn.length; }, 0);
    return n >= SHOTS && !messages(grid, env, V).some(function (m) { return m.level === 'error'; });
  }

  var api = { SHOTS: SHOTS, el: el, num: num, cfgOf: cfgOf, rangeOf: rangeOf, hoodDegsOf: hoodDegsOf, makeGrid: makeGrid, toRows: toRows, fromRows: fromRows, convert: convert, messages: messages, ready: ready };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShotUI = root.ShotUI || {};
  root.ShotUI.calibGrid = api;
})(typeof window !== 'undefined' ? window : {});
