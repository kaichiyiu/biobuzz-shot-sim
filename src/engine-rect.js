/*
 * BIOBUZZ Shot Sim - engine extension "window" (#3): rectangular scoring window.
 * A cell is a rect hit when it scores on the pentagon test AND the ball centre crosses the mouth plane with
 * clearance r inside the rectangle |w| <= W2, 0 <= B <= SH (the grid's rectHits array, filled by testTraj).
 * The window ranges are contiguous rect-hit runs through the aim; res.best.windows (pentagon) is untouched.
 *
 * ScoringWindow = { basis: 'rect', moved, thetaDeg: [lo, hi], v: [lo, hi] (m/s), yawDeg: [lo, hi],
 *   motorRpm: [lo, hi], wheelRpm: [lo, hi], clippedByMotor, opening: { widthIn, heightIn } }
 * RpmWindow    = { vExit: [lo, hi], wheelRpm: [lo, hi], motorRpm: [lo, hi], widthRpm (motor rpm),
 *   widthPct (PERCENT, 100 * (vHi / vLo - 1), e.g. 4.2 means 4.2 %), centerMotorRpm, clippedByMotor }
 *
 * UMD: Node module.exports = factory(require('./engine.js')); browser / worker factory(root.ShotEngine).
 * Load order after engine.js: engine-rect, engine-hood-core, engine-hood, engine-sweep.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal;

  // rectangle = the parallel-sided part of the CELL mouth in the engine's own geometry (design D18-10)
  function opening() {
    var G = I.geometry();
    return { widthIn: 2 * G.W2, heightIn: G.SH };
  }

  // rpm figures of an exit-speed window; `clipped` (optional) says the upper edge is the motor cap
  function rpmWindowOf(mo, sh, bp, vLo, vHi, clipped) {
    var a = I.motorCore(mo, sh, bp, vLo), b = I.motorCore(mo, sh, bp, vHi);
    return {
      vExit: [vLo, vHi], wheelRpm: [a.wheelRpm, b.wheelRpm], motorRpm: [a.motorRpm, b.motorRpm],
      widthRpm: b.motorRpm - a.motorRpm, widthPct: 100 * (vHi / vLo - 1),
      centerMotorRpm: (a.motorRpm + b.motorRpm) / 2, clippedByMotor: !!clipped
    };
  }

  // nearest rect-hit cell to the aim (distance in precision sigmas); ties -> lower speed index; null if none
  function nearestRectHit(view, sel, sig) {
    var H = view.rectHits, nA = view.nA, nB = view.nB, nC = view.nC;
    var top = Math.min(sel.cellMaxB, nB - 1), best = Infinity, out = null;
    for (var b = 0; b <= top; b++) {
      var db = (b - sel.b) * view.lnStep / sig.ln;
      for (var a = 0; a < nA; a++) {
        var da = (a - sel.a) * view.thStep / sig.theta, base = (a * nB + b) * nC;
        for (var c = 0; c < nC; c++) {
          if (!H[base + c]) continue;
          var dc = (c - sel.c) * view.yawStep / sig.yaw, d = da * da + db * db + dc * dc;
          if (d < best - 1e-12) { best = d; out = { a: a, b: b, c: c }; }
        }
      }
    }
    return out;
  }

  function scoringWindow(view, sel, p, mo, sh, bp) {
    var H = view.rectHits;
    if (!H) return null;
    var s = sel, moved = false;
    if (!(sel.b <= sel.cellMaxB && H[(sel.a * view.nB + sel.b) * view.nC + sel.c] === 1)) {
      var n = nearestRectHit(view, sel, { theta: p.precision.sigThetaDeg, ln: Math.max(1e-9, sel.sigV), yaw: p.precision.sigYawDeg });
      if (!n) return null;
      moved = true;
      s = { a: n.a, b: n.b, c: n.c, theta: view.thetas[n.a], v: view.speeds[n.b], yaw: view.yaws[n.c], cellMaxB: sel.cellMaxB };
    }
    var w = I.windowsOf(Object.assign({}, view, { hits: H }), s);
    var clipped = w.idx.b[1] === sel.cellMaxB, r = rpmWindowOf(mo, sh, bp, w.v[0], w.v[1], clipped);
    return {
      basis: 'rect', moved: moved, thetaDeg: w.thetaDeg.slice(), v: w.v.slice(), yawDeg: w.yawDeg.slice(),
      motorRpm: r.motorRpm, wheelRpm: r.wheelRpm, clippedByMotor: clipped, opening: opening()
    };
  }

  var impl = { scoringWindow: scoringWindow, nearestRectHit: nearestRectHit, rpmWindowOf: rpmWindowOf, opening: opening };
  I.register('window', impl);
  E.rectOpening = opening;
  return impl;
});
