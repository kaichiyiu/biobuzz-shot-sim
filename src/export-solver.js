/* BIOBUZZ Shot Sim - #4 on-robot flight solver, JS reference (same equations as src/templates/ShotSolver.java.txt). Browser: window.ExportSolver. Node: module.exports.
   Integrates EXACTLY the engine's flight model (engine.js aeroK + flyFloat): quadratic drag + lift perpendicular to the velocity, spin ratio Sr = S0 v0 / |v| clamped to
   +-clSMax, g, RK4 at the engine step dt. Frame: x horizontal from the mouth, z above the mouth, SI units. Maths: process_docs/issue-4/design.md sections 8-10.
   constantsFrom(params, rows, E, etaCurve?) -> SolverConstants   rows = ExportRow[], E = ShotEngine. No usable row -> NaN fields (solveSpeed then gives ok:false).
     etaCurve (per-rpm calibration, [[rpm, factor], ...]) -> rpmMap = [[vMps, motorRpm], ...] monotone piecewise-linear n(v) built from CalibCore.motorRpmFromExitSpeed (buildRpmMap); null without a curve (then rpmPerMps is used);
     rpmMapError (text) and rpmMap null when the curve makes exit speed non-monotone in rpm (no unique rpm per speed).
   rpmFor(c, v) -> motor rpm for exit speed v: map interpolation (linear extrapolation with the end slope outside), else v * rpmPerMps.
   buildRpmMap(E, params, curve, vLo, vHi) -> {map, error}   nodes at the curve's kink speeds, split to <= 1 m/s, refined until the chord is within RPM_TOL (5e-4) of the exact inverse at 1/4, 1/2, 3/4 of every interval.
   aim: [[dRobotIn, aimZM]] per reachable row = height of THIS integrator's path (row.launchDeg, v = row.exitSpeedMps.c) at rho = row.dMouthIn; aimZM = median (fallback only).
   aimFor(c, dRobotIn) -> m   linear in the aim table, flat beyond the ends (c.aimZM when the table is empty).
   angleFor(c, dRobotIn) -> deg       fixed hood: constant; adjustable (or no hood): linear interpolation in c.hood.table [[dRobotIn, deg]], flat beyond the ends.
   solveSpeed(c, dRobotIn) -> {vMps, motorRpm, ticksPerSec, iterations, ok, thetaDeg}   bisection on v so that z(rho = dMouth) = aimZ. NaN numbers when !ok.
   heightAt(c, thetaDeg, v0, rho) -> z at x = rho (-Infinity if never reached)   trajectory(c, thetaDeg, v0, tEnd) -> [[x, z, vx, vz], ...] like E._internal.flyFloat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExportSolver = factory(root);
})(typeof self !== 'undefined' ? self : this, function (ROOT) {
  'use strict';
  var IN_M = 0.0254, DEG = Math.PI / 180;
  var RPM_TOL = 5e-4, MAP_MAX_NODES = 160;   // per-rpm map: relative chord error aimed at (measured bound 1e-3, design 15), node cap
  var LIM = { T_MAX: 2.6, V_LO: 2, V_HI: 16, V_STEP: 0.25, V_TOL: 1e-6, MAX_IT: 80 };   // flight time cap = engine tMax; speed range = engine table range; scan step; bisection stop; flight cap (worst case 1 + 56 scan + 18 bisection = 75)

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
  }

  function kOf(c, v0) {
    return {
      kd: 0.5 * c.rho * c.cd * c.areaM2 / c.massKg, kl0: 0.5 * c.rho * c.areaM2 / c.massKg * c.clSlope,
      smax: c.clSMax, g: c.g, wr: c.S0 * v0, dt: c.dt
    };
  }

  function accel(K, ux, uz, out) {
    var V = Math.sqrt(ux * ux + uz * uz), Sr = V > 1e-9 ? K.wr / V : 0;
    if (Sr > K.smax) Sr = K.smax; else if (Sr < -K.smax) Sr = -K.smax;
    var kl = K.kl0 * Sr;
    out[0] = -K.kd * V * ux - kl * V * uz;
    out[1] = -K.g - K.kd * V * uz + kl * V * ux;
  }

  // one RK4 step of s = [x, z, vx, vz] (same stages and sums as flyFloat)
  function step(K, s, a) {
    var dt = K.dt, vx = s[2], vz = s[3];
    accel(K, vx, vz, a); var a1x = a[0], a1z = a[1];
    var b2x = vx + dt / 2 * a1x, b2z = vz + dt / 2 * a1z; accel(K, b2x, b2z, a); var a2x = a[0], a2z = a[1];
    var b3x = vx + dt / 2 * a2x, b3z = vz + dt / 2 * a2z; accel(K, b3x, b3z, a); var a3x = a[0], a3z = a[1];
    var b4x = vx + dt * a3x, b4z = vz + dt * a3z; accel(K, b4x, b4z, a); var a4x = a[0], a4z = a[1];
    s[0] += dt / 6 * (vx + 2 * b2x + 2 * b3x + b4x);
    s[1] += dt / 6 * (vz + 2 * b2z + 2 * b3z + b4z);
    s[2] += dt / 6 * (a1x + 2 * a2x + 2 * a3x + a4x);
    s[3] += dt / 6 * (a1z + 2 * a2z + 2 * a3z + a4z);
  }

  function trajectory(c, thetaDeg, v0, tEnd) {
    var K = kOf(c, v0), th = thetaDeg * DEG, s = [0, 0, v0 * Math.cos(th), v0 * Math.sin(th)], a = [0, 0];
    var n = Math.round((tEnd === undefined ? 1.0 : tEnd) / c.dt), out = [s.slice()];
    for (var i = 0; i < n; i++) { step(K, s, a); out.push(s.slice()); }
    return out;
  }

  function heightAt(c, thetaDeg, v0, rho) {
    var K = kOf(c, v0), th = thetaDeg * DEG, s = [0, 0, v0 * Math.cos(th), v0 * Math.sin(th)], a = [0, 0];
    var n = Math.round(LIM.T_MAX / c.dt), x0, z0, f;
    for (var i = 0; i < n; i++) {
      x0 = s[0]; z0 = s[1];
      step(K, s, a);
      if (s[0] >= rho) { f = (rho - x0) / (s[0] - x0); return z0 + f * (s[1] - z0); }
      if (s[1] < -c.h0M) return -Infinity;   // hit the floor before reaching rho
    }
    return -Infinity;
  }

  // linear interpolation in a table [[d, y], ...] sorted by d, flat beyond the ends; NaN for an empty table or non-finite d
  function interp(t, d) {
    var n = t.length, i;
    if (!n || !fin(d)) return NaN;
    if (d <= t[0][0]) return t[0][1];
    if (d >= t[n - 1][0]) return t[n - 1][1];
    for (i = 0; i < n - 1 && !(d < t[i + 1][0]); i++);
    return t[i][1] + (d - t[i][0]) * (t[i + 1][1] - t[i][1]) / (t[i + 1][0] - t[i][0]);
  }

  function angleFor(c, dRobotIn) {
    if (!fin(dRobotIn)) return NaN;
    return c.hood.mode === 'fixed' ? c.hood.angleDeg : interp(c.hood.table, dRobotIn);
  }

  function aimFor(c, dRobotIn) { return c.aim && c.aim.length ? interp(c.aim, dRobotIn) : c.aimZM; }

  function solveSpeed(c, dRobotIn) {
    var th = angleFor(c, dRobotIn), rho = (dRobotIn - c.mouthForwardIn) * IN_M, aim = aimFor(c, dRobotIn);
    var res = { vMps: NaN, motorRpm: NaN, ticksPerSec: NaN, iterations: 0, ok: false, thetaDeg: th };
    if (!(fin(th) && fin(rho) && rho > 0 && fin(aim) && fin(c.rpmPerMps) && fin(c.ticksPerMotorRev) && fin(c.h0M))) return res;
    function f(v) { return heightAt(c, th, v, rho) - aim; }
    var lo = LIM.V_LO, hi = lo, it = 1, mid;
    if (!(f(lo) < 0)) return res;
    // scan up in V_STEP m/s until the path first reaches the aim height: [lo, hi] then lies on the rising branch (z(rho) is not monotone for backspin at theta >= ~81 deg and v >~ 10 m/s)
    var found = false;
    while (!found && hi < LIM.V_HI) { lo = hi; hi = Math.min(hi + LIM.V_STEP, LIM.V_HI); found = f(hi) >= 0; it++; }
    if (!found) { res.iterations = it; return res; }   // aim point not reachable below V_HI: beyond reach
    while (hi - lo > LIM.V_TOL && it < LIM.MAX_IT) { mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; it++; }
    res.iterations = it;
    res.ok = hi - lo <= LIM.V_TOL;
    if (!res.ok) return res;
    res.vMps = (lo + hi) / 2;
    res.motorRpm = rpmFor(c, res.vMps);
    res.ticksPerSec = res.motorRpm / 60 * c.ticksPerMotorRev;
    return res;
  }

  // motor rpm for an exit speed: the piecewise-linear map when there is one (linear continuation with the end slope outside it), else the single factor
  function rpmFor(c, v) {
    var m = c.rpmMap, n = m ? m.length : 0, i = 0;
    if (n < 2) return v * c.rpmPerMps;
    if (v >= m[n - 1][0]) i = n - 2; else if (v > m[0][0]) while (i < n - 2 && v >= m[i + 1][0]) i++;
    return m[i][1] + (v - m[i][0]) * (m[i + 1][1] - m[i][1]) / (m[i + 1][0] - m[i][0]);
  }

  // rpm where v(n) = s F(n) n stops increasing, or -1. On a piece F = F0 + b (n - n0), v' = s (F + n F') is linear in n, so it is enough to test both ends of every piece (F flat and > 0 beyond the curve's ends)
  function nonMonotoneAt(curve) {
    var i, b;
    for (i = 0; i < curve.length; i++) if (!(curve[i][1] > 0)) return curve[i][0];
    for (i = 0; i + 1 < curve.length; i++) {
      if (!(curve[i + 1][0] > curve[i][0])) return curve[i][0];
      b = (curve[i + 1][1] - curve[i][1]) / (curve[i + 1][0] - curve[i][0]);
      if (!(curve[i][1] + curve[i][0] * b > 0 && curve[i + 1][1] + curve[i + 1][0] * b > 0)) return curve[i][0];
    }
    return -1;
  }

  function msg(rpm) { return 'The calibrated eta curve makes the exit speed fall as the rpm rises near ' + Math.round(rpm) + ' rpm (v(n) is not increasing), so one speed has no unique rpm. Check or re-fit the per-rpm curve; the on-robot algorithm is not offered for it.'; }

  // n(v) for a per-rpm eta curve: nodes at the kinks v(n_i) of the curve, intervals <= 1 m/s, adaptive bisection until the chord matches the exact inverse within RPM_TOL at 1/4, 1/2, 3/4
  function buildRpmMap(E, params, curve, vLo, vHi) {
    var CC = typeof module === 'object' && module.exports ? require('./calib-core.js') : ROOT.CalibCore, sh = CC.shooterOf(E, params).sh;
    function n(v) { return CC.motorRpmFromExitSpeed(v, sh, curve); }
    var bad0 = nonMonotoneAt(curve);
    if (bad0 >= 0) return { map: null, error: msg(bad0) };
    var cuts = [vLo, vHi], bounds = [vLo], nodes = [[vLo, n(vLo)]], i, j, k;
    curve.forEach(function (p) { var v = CC.exitSpeedFromMotorRpm(p[0], sh, curve); if (v > vLo && v < vHi) cuts.push(v); });
    cuts.sort(function (a, b) { return a - b; });
    for (i = 1; i < cuts.length; i++) { k = Math.ceil((cuts[i] - cuts[i - 1]) / 1); for (j = 1; j <= k; j++) bounds.push(cuts[i - 1] + (cuts[i] - cuts[i - 1]) * j / k); }
    function refine(a, na, b, nb, d) {
      var bad = false;
      [0.25, 0.5, 0.75].forEach(function (t) { var ex = n(a + t * (b - a)); if (!(Math.abs(ex - (na + t * (nb - na))) <= RPM_TOL * ex)) bad = true; });
      if (bad && d < 14 && nodes.length < MAP_MAX_NODES) { var m = (a + b) / 2, nm = n(m); refine(a, na, m, nm, d + 1); refine(m, nm, b, nb, d + 1); }
      else nodes.push([b, nb]);
    }
    for (i = 1; i < bounds.length; i++) refine(bounds[i - 1], nodes[nodes.length - 1][1], bounds[i], n(bounds[i]), 0);
    for (i = 0; i < nodes.length; i++) if (!(isFinite(nodes[i][1]) && (i === 0 || nodes[i][1] > nodes[i - 1][1]))) {
      return { map: null, error: msg(nodes[Math.max(i - 1, 0)][1]) };
    }
    return { map: nodes, error: '' };
  }

  function constantsFrom(params, rows, E, etaCurve) {
    var I = E._internal, np = I.normParams(params), bp = E.ballProps(np.ballId), A = E.constants().aero;
    var use = (rows || []).filter(function (r) { return r && r.reachable && r.motorRpm && r.exitSpeedMps && r.exitSpeedMps.c > 0; });
    var h0In = np.mouth.height, hd = params && params.hood;
    var table = use.filter(function (r) { return fin(r.launchDeg); }).map(function (r) { return [r.dRobotIn, r.launchDeg]; })
      .sort(function (p, q) { return p[0] - q[0]; });
    var hood = hd && hd.mode === 'fixed'
      ? { mode: 'fixed', angleDeg: fin(hd.angleDeg) ? hd.angleDeg : median(table.map(function (p) { return p[1]; })) }
      : { mode: 'adjustable', table: table };
    var c = {
      massKg: bp.massKg, areaM2: bp.areaM2, rho: A.rho, cd: A.cd, clSlope: A.clSlope, clSMax: A.clSMax, g: A.g,
      S0: E.shooterSpin(params && params.shooter), dt: I.tableSpec.dt, h0M: h0In * IN_M, aimZM: NaN, aim: [], hood: hood,
      rpmPerMps: median(use.map(function (r) { return r.motorRpm.c / r.exitSpeedMps.c; })),
      ticksPerMotorRev: median(use.filter(function (r) { return r.ticksPerSec && r.motorRpm.c > 0; }).map(function (r) { return r.ticksPerSec.c / r.motorRpm.c * 60; })),
      mouthForwardIn: use.length ? median(use.map(function (r) { return r.dRobotIn - r.dMouthIn; })) : 0
    };
    // per-distance aim: height of the centre-speed path at the mouth distance, with this module's own integrator (so solveSpeed inverts it exactly at the nodes)
    c.aim = use.filter(function (r) { return fin(r.launchDeg) && fin(r.dMouthIn); }).map(function (r) {
      return [r.dRobotIn, heightAt(c, r.launchDeg, r.exitSpeedMps.c, r.dMouthIn * IN_M)];
    }).filter(function (p) { return fin(p[1]); }).sort(function (p, q) { return p[0] - q[0]; });
    c.aimZM = median(c.aim.map(function (p) { return p[1]; }));
    c.rpmMap = null; c.rpmMapError = '';
    if (etaCurve && etaCurve.length && use.length) {   // per-rpm calibration: n(v) over the table's exit-speed range, 20 % / 25 % margin, inside the solver's own speed range
      var vl = Math.max(LIM.V_LO, 0.8 * Math.min.apply(null, use.map(function (r) { return r.exitSpeedMps.lo; }))), vh = Math.min(LIM.V_HI, 1.25 * Math.max.apply(null, use.map(function (r) { return r.exitSpeedMps.hi; })));
      var b = buildRpmMap(E, params, etaCurve, vl, vh);
      c.rpmMap = b.map; c.rpmMapError = b.error;
    }
    return c;
  }

  return { constantsFrom: constantsFrom, buildRpmMap: buildRpmMap, rpmFor: rpmFor, angleFor: angleFor, aimFor: aimFor, solveSpeed: solveSpeed, heightAt: heightAt, trajectory: trajectory, LIMITS: LIM };
});
