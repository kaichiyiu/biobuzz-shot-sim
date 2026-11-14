/*
 * BIOBUZZ Shot Sim - engine extension "export" (#4): one table row per distance along the current line.
 * E.exportRow(result, q{d,x,y}, params, xs, etaCurve?) -> ExportRow   throws unless result.mode === 'full' (D14) and result.error is unset.
 *   rpm comes from result.hood.rpmWindow, else best.scoringWindow (same rule as sweepRow); with an etaCurve the exit-speed window is converted by
 *   CalibCore.motorRpmFromExitSpeed (D7). ticks/s = rpm / 60 * ticksPerMotorRev. Unreachable spot -> numeric fields null, reachable false.
 * E.exportSettings(xs, params) -> { stepIn > 0 (4), ticksPerMotorRev (motor encoderPPR), mouthForwardIn (0), servo|null, formats }
 * E.exportPoints(params, xs) -> sweepPoints(params, stepIn)      E.exportPoint(params, q, xs, etaCurve) -> row (+ bearingDeg when E.bearingRange exists)
 * Needs engine-sweep.js; CalibCore (calib-core.js) only when an etaCurve is given. Maths: process_docs/issue-4/design.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal;

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function calibCore() {
    if (typeof module === 'object' && module.exports) return require('./calib-core.js');
    if (typeof self !== 'undefined' && self.CalibCore) return self.CalibCore;
    throw new Error('CalibCore is needed to apply an eta curve');
  }

  function exportSettings(xs, params) {
    xs = xs || {};
    var p = I.normParams(params), mo = I.motorById()[p.motorId], sv = xs.servo;
    var step = fin(xs.stepIn) && xs.stepIn > 0 ? xs.stepIn : 4;   // the UI's 2-12 range is enforced by its own normaliser
    var ticks = fin(xs.ticksPerMotorRev) && xs.ticksPerMotorRev > 0 ? xs.ticksPerMotorRev : (mo && mo.encoderPPR) || 28;
    var servo = sv && fin(sv.deg1) && fin(sv.pos1) && fin(sv.deg2) && fin(sv.pos2) && sv.deg1 !== sv.deg2 ? { deg1: sv.deg1, pos1: sv.pos1, deg2: sv.deg2, pos2: sv.pos2 } : null;
    return {
      stepIn: step, ticksPerMotorRev: ticks, mouthForwardIn: fin(xs.mouthForwardIn) ? xs.mouthForwardIn : 0, servo: servo,
      formats: Array.isArray(xs.formats) ? xs.formats.slice() : ['csv']
    };
  }

  function range3(lo, c, hi) { return { c: c, lo: lo, hi: hi }; }
  function scaled(r, k) { return range3(r.lo * k, r.c * k, r.hi * k); }

  // height of the path (points [x, y, z], z above the floor) where the horizontal distance from its first point equals rho; null if never reached
  function heightAt(path, rho) {
    if (!path || path.length < 2) return null;
    var x0 = path[0][0], y0 = path[0][1], prev = 0, i, r;
    for (i = 1; i < path.length; i++) {
      r = Math.hypot(path[i][0] - x0, path[i][1] - y0);
      if (r >= rho) {
        if (r - prev < 1e-12) return path[i][2];
        return path[i - 1][2] + (path[i][2] - path[i - 1][2]) * (rho - prev) / (r - prev);
      }
      prev = r;
    }
    return null;
  }

  function exportRow(res, q, params, xs, etaCurve) {
    if (!res || res.mode !== 'full') throw new Error('exportRow needs a full-accuracy result (got mode "' + (res && res.mode) + '")');
    if (res.error) throw new Error('exportRow: ' + (res.error.message || 'the evaluation returned an error'));
    var X = exportSettings(xs, params), best = res.best, h = res.hood;
    var sw = h ? h.rpmWindow : (best && res.code !== 'TOO_SLOW' ? best.scoringWindow : null);
    var row = {
      dMouthIn: q.d, dRobotIn: q.d + X.mouthForwardIn, verdict: res.verdict, reachable: !!(sw && best),
      motorRpm: null, ticksPerSec: null, wheelRpm: null, exitSpeedMps: null, windowPct: null, launchDeg: null, servoPos: null,
      yawOffsetDeg: null, tofS: null, aimZIn: null, entryAngleDeg: null, entrySpeedMps: null,
      margin: res.tolerance && fin(res.tolerance.margin) ? res.tolerance.margin : null, bearingDeg: null
    };
    if (!row.reachable) return row;
    var v = h ? sw.vExit : sw.v, vc = (v[0] + v[1]) / 2, motor, wheel;
    var bs = res.tolerance && res.tolerance.burstSetpoint;   // burst included in the margin: the first shot fires faster so the whole burst stays in the window (lo / hi stay the window)
    if (!(bs && bs.shiftPct > 0 && fin(bs.motorRpm) && fin(bs.exitSpeedMps))) bs = null; else vc = bs.exitSpeedMps;
    if (etaCurve) {
      var CC = calibCore(), sh = CC.shooterOf(E, params).sh;
      var m = function (s) { return CC.motorRpmFromExitSpeed(s, sh, etaCurve); };
      motor = range3(m(v[0]), m(vc), m(v[1]));   // vc is the burst setpoint's exit speed when it applies
      wheel = scaled(motor, sh.gear);
    } else {
      var mc = h ? h.rpmWindow.centerMotorRpm : (sw.motorRpm[0] + sw.motorRpm[1]) / 2, wc = (sw.wheelRpm[0] + sw.wheelRpm[1]) / 2;
      if (bs) { wc *= bs.motorRpm / mc; mc = bs.motorRpm; }
      motor = range3(sw.motorRpm[0], mc, sw.motorRpm[1]);
      wheel = range3(sw.wheelRpm[0], wc, sw.wheelRpm[1]);
    }
    row.motorRpm = motor; row.wheelRpm = wheel;
    row.ticksPerSec = scaled(motor, X.ticksPerMotorRev / 60);
    row.exitSpeedMps = range3(v[0], vc, v[1]);
    row.windowPct = h ? h.rpmWindow.widthPct : 100 * (v[1] / v[0] - 1);
    row.launchDeg = best.thetaDeg;
    if (X.servo) row.servoPos = X.servo.pos1 + (best.thetaDeg - X.servo.deg1) * (X.servo.pos2 - X.servo.pos1) / (X.servo.deg2 - X.servo.deg1);
    row.yawOffsetDeg = best.yawOffsetDeg;
    row.tofS = best.tToCell;
    row.aimZIn = heightAt(res.trajectory, res.distIn);
    if (res.entry && res.entry.best) { row.entryAngleDeg = res.entry.best.angleDeg; row.entrySpeedMps = res.entry.best.speedMps; }
    else {
      var at = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: q.x, y: q.y }) });
      row.entryAngleDeg = E.classifyShot(at, best.thetaDeg, best.v, best.yawDeg).entryAngleDeg;
      row.entrySpeedMps = best.entrySpeed;
    }
    return row;
  }

  function exportPoints(params, xs) { return E.sweepPoints(params, exportSettings(xs, params).stepIn); }

  function exportPoint(params, q, xs, etaCurve) {
    var at = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: q.x, y: q.y }) });
    var row = exportRow(E.evaluate(at, 'full'), q, at, xs, etaCurve);
    if (row.reachable && typeof E.bearingRange === 'function') row.bearingDeg = E.bearingRange(at, row);
    return row;
  }

  E.exportRow = exportRow; E.exportSettings = exportSettings; E.exportPoints = exportPoints; E.exportPoint = exportPoint;
  I.register('export', { exportRow: exportRow, exportSettings: exportSettings, exportPoints: exportPoints, exportPoint: exportPoint, heightAt: heightAt });
  return { exportRow: exportRow, exportSettings: exportSettings, exportPoints: exportPoints, exportPoint: exportPoint };
});
