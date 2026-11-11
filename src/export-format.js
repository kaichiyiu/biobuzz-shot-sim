/* BIOBUZZ Shot Sim - #4 export formats (pure: rows in, text out). Browser: window.ExportFormat. Node: module.exports.
   header(cfg, calib, rows, opts{version, createdAt}) -> ExportHeader   (cfg = ConfigV1, calib = CalibRecord | null, rows = ExportRow[])
   toCsv(table) -> string      '# ' comment lines (readable facts, notes, one '# header: {json}' line), the column row, one line per row, LF.
                               null / NaN -> empty cell, booleans true / false, numbers with 6 significant digits.
   toJson(table) -> string     { header, rows } exactly as built.
   toJavaArrays(table, className = 'ShooterTable') -> string   one Java class of static final double[] arrays over the REACHABLE rows.
   COLUMNS = ordered CSV column names. Maths and decisions: process_docs/issue-4/design.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExportFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function g(f) { return function (r) { try { return f(r); } catch (e) { return null; } }; }
  function rng(k, p) { return g(function (r) { return r[k] ? r[k][p] : null; }); }
  function plain(k) { return function (r) { return r[k]; }; }

  var COLS = [
    ['dMouthIn', plain('dMouthIn')], ['dRobotIn', plain('dRobotIn')], ['verdict', plain('verdict')], ['reachable', plain('reachable')],
    ['motorRpmC', rng('motorRpm', 'c')], ['motorRpmLo', rng('motorRpm', 'lo')], ['motorRpmHi', rng('motorRpm', 'hi')],
    ['ticksPerSecC', rng('ticksPerSec', 'c')], ['ticksPerSecLo', rng('ticksPerSec', 'lo')], ['ticksPerSecHi', rng('ticksPerSec', 'hi')],
    ['wheelRpmC', rng('wheelRpm', 'c')], ['wheelRpmLo', rng('wheelRpm', 'lo')], ['wheelRpmHi', rng('wheelRpm', 'hi')],
    ['exitSpeedMpsC', rng('exitSpeedMps', 'c')], ['exitSpeedMpsLo', rng('exitSpeedMps', 'lo')], ['exitSpeedMpsHi', rng('exitSpeedMps', 'hi')],
    ['windowPct', plain('windowPct')], ['launchDeg', plain('launchDeg')], ['servoPos', plain('servoPos')], ['yawOffsetDeg', plain('yawOffsetDeg')],
    ['tofS', plain('tofS')], ['aimZIn', plain('aimZIn')], ['entryAngleDeg', plain('entryAngleDeg')], ['entrySpeedMps', plain('entrySpeedMps')],
    ['margin', plain('margin')], ['bearingLoDeg', rng('bearingDeg', 'lo')], ['bearingHiDeg', rng('bearingDeg', 'hi')]
  ];
  var COLUMNS = COLS.map(function (c) { return c[0]; });

  function sig6(x) { return Number(x.toPrecision(6)); }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }

  function header(cfg, calib, rows, opts) {
    opts = opts || {};
    rows = rows || [];
    var calibrated = !!(calib && calib.calibrated === true), fit = (calib && calib.fit) || {};
    var ratios = [], marginSeen = false;
    rows.forEach(function (r) {
      if (r.reachable && r.motorRpm && r.exitSpeedMps && r.exitSpeedMps.c > 0) ratios.push(r.motorRpm.c / r.exitSpeedMps.c);
      if (num(r.margin) !== null) marginSeen = true;
    });
    var rpmPerMps = median(ratios), notes = [];
    notes.push('Accuracy: full. Every row is a full-resolution evaluation; coarse (preview) results are never exported.');
    notes.push('Rows are keyed by robot distance: dRobotIn = dMouthIn + the mouth-forward offset, dMouthIn = horizontal distance from the shooter mouth to the target CELL mouth centre.');
    notes.push('motorRpm is the motor output-shaft rpm (window centre c, lowest and highest rpm that still score); ticksPerSec = motorRpm / 60 x encoder counts per motor output revolution.');
    notes.push('Single-eta limitation: the flight model uses ONE exit-speed factor (eta) for the whole table. A per-rpm eta curve from the calibration is applied only when converting exit speed to rpm in these rows; the flight is not re-simulated with it.');
    notes.push('Retune constant: for a fixed eta, motor rpm = rpmPerMps x exit speed (m/s). Scale this one number at the field instead of editing every row.');
    if (ratios.length && Math.max.apply(null, ratios) - Math.min.apply(null, ratios) > 0.005 * rpmPerMps)
      notes.push('This table used a per-rpm eta curve, so rpm per m/s varies with rpm (' + sig6(Math.min.apply(null, ratios)) + ' to ' + sig6(Math.max.apply(null, ratios)) + '); rpmPerMps is the median.');
    notes.push('Bearing: bearingLoDeg..bearingHiDeg is the range of bearings (degrees relative to the line the table was made on, counter-clockwise from above positive) over which the row\'s launch angle and speed still score when the mouth stays at the same distance from the CELL centre and re-aims; the opening is tilted, so the window narrows off axis. Searched to +-45 deg at 0.5 deg resolution, assuming the scoring bearings are contiguous; empty when the row itself does not score.');
    notes.push('Hood: with an adjustable hood the launch angle is the simulator\'s pick for each distance. It ranks angles by the widest speed run over all yaws, which can pick an angle with a narrower window than the best fixed angle; check a fixed angle against this table before building the hood.');
    if (!marginSeen) notes.push('margin is empty until the tolerance model is available.');
    if (!calibrated) notes.push('NOT CALIBRATED: eta is the simulator default. Measure it with the calibration guide before relying on the rpm values at the field.');
    var h = {
      tool: 'biobuzz-shot-sim', version: opts.version || '1.0', createdAt: opts.createdAt || new Date().toISOString(), accuracy: 'full',
      config: cfg == null ? null : cfg, calibrated: calibrated, rpmPerMps: rpmPerMps === null ? null : sig6(rpmPerMps), notes: notes
    };
    if (calibrated) h.calibration = { factor: num(fit.factor), date: calib.date || null, mode: fit.mode || null };
    return h;
  }

  function cell(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
    if (typeof v === 'number') return String(sig6(v));
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function oneLine(s) { return String(s).replace(/\s*[\r\n]+\s*/g, ' '); }

  function toCsv(t) {
    var h = t.header, out = [];
    out.push('# BIOBUZZ Shot Sim export (' + h.tool + ' ' + h.version + ', ' + h.createdAt + ', accuracy ' + h.accuracy + ')');
    out.push('# calibrated: ' + (h.calibrated ? 'yes' : 'NO'));
    out.push('# rpmPerMps: ' + (h.rpmPerMps === null ? '' : h.rpmPerMps));
    h.notes.forEach(function (n) { out.push('# note: ' + oneLine(n)); });
    out.push('# header: ' + oneLine(JSON.stringify(h)));
    out.push(COLUMNS.join(','));
    t.rows.forEach(function (r) { out.push(COLS.map(function (c) { return cell(c[1](r)); }).join(',')); });
    return out.join('\n') + '\n';
  }

  function toJson(t) { return JSON.stringify({ header: t.header, rows: t.rows }, null, 2); }

  var JAVA = [   // name, comment, getter
    ['DIST_IN', 'robot distance to the target CELL mouth centre, inches (mouth distance + mouth-forward offset)', plain('dRobotIn')],
    ['RPM', 'motor output-shaft rpm, centre of the scoring window', rng('motorRpm', 'c')],
    ['RPM_LO', 'lowest rpm that still scores', rng('motorRpm', 'lo')], ['RPM_HI', 'highest rpm that still scores', rng('motorRpm', 'hi')],
    ['TICKS_PER_SEC', 'setVelocity value (encoder ticks per second), window centre', rng('ticksPerSec', 'c')],
    ['LAUNCH_DEG', 'launch (hood) angle, degrees', plain('launchDeg')], ['TOF_S', 'time of flight to the CELL, seconds', plain('tofS')],
    ['YAW_OFFSET_DEG', 'aim offset from the line to the CELL centre, degrees', plain('yawOffsetDeg')],
    ['BEARING_LO_DEG', 'lowest bearing offset that still scores (NaN: unknown)', rng('bearingDeg', 'lo')],
    ['BEARING_HI_DEG', 'highest bearing offset that still scores (NaN: unknown)', rng('bearingDeg', 'hi')]
  ];
  function jnum(v) { return v === null || v === undefined || !isFinite(v) ? 'Double.NaN' : String(sig6(v)); }

  function toJavaArrays(t, className) {
    var name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(className || '') ? className : 'ShooterTable', h = t.header;
    var use = t.rows.filter(function (r) { return r.reachable && r.motorRpm; }).sort(function (a, b) { return a.dRobotIn - b.dRobotIn; });
    var out = ['// Generated by BIOBUZZ Shot Sim (accuracy ' + h.accuracy + ', ' + h.createdAt + '). Calibrated: ' + (h.calibrated ? 'yes' : 'NO') + '.',
      '// ' + use.length + ' reachable rows' + (t.rows.length > use.length ? ' (' + (t.rows.length - use.length) + ' unreachable rows left out)' : '') + '. Arrays are sorted by DIST_IN.',
      '// Interpolate between rows; clamp outside DIST_IN. See the CSV / JSON header for notes and the full config.',
      'public final class ' + name + ' {'];
    JAVA.forEach(function (j) {
      out.push('    // ' + j[1]);
      out.push('    static final double[] ' + j[0] + ' = { ' + use.map(function (r) { return jnum(j[2](r)); }).join(', ') + ' };');
    });
    out.push('    // motor rpm per m/s of exit speed (single eta; retune this one number at the field)');
    out.push('    static final double RPM_PER_MPS = ' + jnum(h.rpmPerMps) + ';');
    out.push('    private ' + name + '() {}', '}');
    return out.join('\n') + '\n';
  }

  return { header: header, toCsv: toCsv, toJson: toJson, toJavaArrays: toJavaArrays, COLUMNS: COLUMNS };
});
