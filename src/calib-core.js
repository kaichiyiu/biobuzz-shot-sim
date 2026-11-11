/* BIOBUZZ Shot Sim - #11 eta calibration core: wheel rpm <-> exit speed (inverts engine exitFactor/motorCore) and
   the floor-landing model (flyFloat) with its inverse. Pure: no DOM, the engine is passed in.
   Browser: window.CalibCore. Node: module.exports. Maths: process_docs/issue-11/design.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalibCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var IN_M = 0.0254;
  var V_LO = 0.3, V_HI = 40, V_HI_MAX = 80;    // speed bracket for the inversion, m/s

  // ---- wheel kinematics. sh: normalised shooter {type, wheelDiameterMm, gear, topRatio, etaSingle, etaDual}
  // exit speed per unit bottom-wheel surface speed, exactly the engine's exitFactor(sh)
  function exitFactorOf(sh) {
    return sh.type === 'dual' ? sh.etaDual * (1 + sh.topRatio) / 2 : sh.etaSingle;
  }
  // factor = EtaCurve [[rpm, f], ...] (sorted, piecewise linear, flat beyond the ends) -> f at rpm
  function factorAt(curve, rpm) {
    var n = curve.length;
    if (rpm <= curve[0][0]) return curve[0][1];
    if (rpm >= curve[n - 1][0]) return curve[n - 1][1];
    for (var i = 1; i < n; i++) {
      if (rpm <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]);
      }
    }
    return curve[n - 1][1];
  }
  function surfacePerRpm(sh) { return Math.PI * (sh.wheelDiameterMm / 1000) * sh.gear / 60; }  // m/s per motor rpm
  // bottom-wheel surface speed (m/s) at motor rpm
  function wheelSurfaceSpeed(rpm, sh) { return surfacePerRpm(sh) * rpm; }

  // factor: number | EtaCurve | omitted (-> exitFactor(sh))
  function exitSpeedFromMotorRpm(rpm, sh, factor) {
    var f = factor == null ? exitFactorOf(sh) : (typeof factor === 'number' ? factor : factorAt(factor, rpm));
    return f * wheelSurfaceSpeed(rpm, sh);
  }

  function motorRpmFromExitSpeed(v, sh, factorOrCurve) {
    if (factorOrCurve == null || typeof factorOrCurve === 'number') {
      var fx = factorOrCurve == null ? exitFactorOf(sh) : factorOrCurve;
      var D = sh.wheelDiameterMm / 1000;
      return v / fx / (Math.PI * D) * 60 / sh.gear;       // same operation order as motorCore
    }
    var curve = factorOrCurve, k = surfacePerRpm(sh), r = v / (factorAt(curve, 0) * k), i, rn;
    if (!(v > 0)) return 0;
    for (i = 0; i < 200; i++) {       // damped fixed point: r <- v / (f(r) k); contraction when |r f'/f| < 1
      rn = v / (factorAt(curve, r) * k);
      rn = 0.5 * (r + rn);
      if (Math.abs(rn - r) <= 1e-12 * Math.abs(rn)) return rn;
      r = rn;
    }
    // bisection on v(rpm) - v (v(rpm) increasing)
    var lo = 0, hi = Math.max(r, 1);
    while (exitSpeedFromMotorRpm(hi, sh, curve) < v && hi < 1e9) hi *= 2;
    for (i = 0; i < 200; i++) {
      var mid = 0.5 * (lo + hi);
      if (exitSpeedFromMotorRpm(mid, sh, curve) < v) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // ---- landing model. Result in inches: horizontal distance from the mouth to where the ball first touches the floor.
  // The ball centre starts at the mouth (height h0In above the floor). A sphere touches a plane at the point directly beneath its
  // centre, at the instant the centre is at height r, so the crossing level is z = -h0 + r (default level 'contact');
  // opts.level = 'centre' uses z = -h0 (centre on the floor). Returns NaN when the level is never crossed.
  function landingIn(E, ballId, S0, thetaDeg, vMps, h0In, opts) {
    opts = opts || {};
    var r = E.ballProps(ballId).rIn;
    var zf = -(h0In - (opts.level === 'centre' ? 0 : r)) * IN_M;
    if (!(zf < 0) || !(vMps > 0)) return NaN;
    var tEnd = opts.tEnd || 1.5, tMax = opts.tMax || 6;
    for (;;) {
      var rows = E._internal.flyFloat(ballId, S0, thetaDeg, vMps, Object.assign({}, opts, { tEnd: tEnd }));   // opts may carry dt / aero overrides
      for (var i = 1; i < rows.length; i++) {
        var z0 = rows[i - 1][1], z1 = rows[i][1];
        if (z0 > zf && z1 <= zf) {
          var t = (z0 - zf) / (z0 - z1);
          return (rows[i - 1][0] + t * (rows[i][0] - rows[i - 1][0])) / IN_M;
        }
      }
      if (tEnd >= tMax) return NaN;
      tEnd = Math.min(tEnd * 2, tMax);
    }
  }

  // exit speed (m/s) whose landing distance is dIn; bracketed bisection (landing is increasing in v on the supported domain).
  // null when dIn is outside [landing(V_LO), landing(vHi)] or not finite.
  function speedForLanding(E, ballId, S0, thetaDeg, dIn, h0In, opts) {
    opts = opts || {};
    if (!(dIn > 0) || !isFinite(dIn)) return null;
    function d(v) { return landingIn(E, ballId, S0, thetaDeg, v, h0In, opts); }
    var lo = opts.vLo || V_LO, hi = opts.vHi || V_HI, dl = d(lo), dh = d(hi);
    while (dh < dIn && hi < V_HI_MAX) { hi = Math.min(hi * 2, V_HI_MAX); dh = d(hi); }
    if (!(dl <= dIn) || !(dh >= dIn)) return null;
    for (var i = 0; i < 60 && hi - lo > 1e-9; i++) {
      var mid = 0.5 * (lo + hi), dm = d(mid);
      if (dm < dIn) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // shooter of a ConfigV1 (cfg.robot.shooter) or a bare shooter, normalised through the engine (clamps, defaults).
  // Wheel diameter: sh.wheelDiameterMm, else opts.wheelDiameterMm, else opts.wheels [{id, diameterMm}] by wheelId, else engine default.
  function shooterOf(E, cfg, opts) {
    opts = opts || {};
    var raw = Object.assign({}, (cfg && cfg.robot && cfg.robot.shooter) || (cfg && cfg.shooter) || cfg || {});
    var note = null, w, i;
    if (!(raw.wheelDiameterMm > 0)) {
      if (opts.wheelDiameterMm > 0) raw.wheelDiameterMm = opts.wheelDiameterMm;
      else if (opts.wheels && raw.wheelId) {
        for (i = 0; i < opts.wheels.length; i++) if (opts.wheels[i].id === raw.wheelId) w = opts.wheels[i];
        if (w) raw.wheelDiameterMm = w.diameterMm;
      }
      if (!(raw.wheelDiameterMm > 0)) note = 'Wheel diameter not given: the engine default wheel was used.';
    }
    var sh = E._internal.shooterNorm(raw);
    return { sh: sh, S0: E.shooterSpin(raw), note: note };
  }

  return {
    exitFactorOf: exitFactorOf, factorAt: factorAt, wheelSurfaceSpeed: wheelSurfaceSpeed,
    exitSpeedFromMotorRpm: exitSpeedFromMotorRpm, motorRpmFromExitSpeed: motorRpmFromExitSpeed,
    landingIn: landingIn, speedForLanding: speedForLanding, shooterOf: shooterOf
  };
});
