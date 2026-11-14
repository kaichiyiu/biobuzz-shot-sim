/*
 * BIOBUZZ Shot Sim - engine extension "burst" (#9): shot-by-shot flywheel speed in a burst, against the rpm window. Maths: process_docs/issue-9b/design.md.
 * E.burstPlan(result, params, { shots, intervalS?, setpointRpm? }) -> BurstPlan | null
 *   BurstPlan = { shots, intervalS, control: 'pid'|'power', steadyDeficitPct, perShot: [{ k, deficitPct, motorRpm, inWindow }], allIn, firstOut (k | null),
 *                 minIntervalS (null = not even 60 s keeps every shot in the window), setpointRpm, windowRpm: [lo, hi], dipPct, tauS }
 *   Reads result.motor (motorCore: dip, tauS, details.w0 / wFree / shotInterval) and the motor-rpm window of the result (hood.rpmWindow, else
 *   best.scoringWindow, as engine-export.js). Setpoint = the window centre (what the export table gives the robot). null: no result / window /
 *   reachable aim, shots < 1, or a setpoint above the motor's usable free speed.
 *   Per shot the wheel keeps (1 - dip) of its speed (shot energy ~ w^2); then it recovers for the interval:
 *     open loop (fixed power): x' = 1 - (1 - a) q            (the motorCore.residual law)         x = speed / setpoint speed, a = x (1 - dip)
 *     PID (full voltage until back): x' = min(1, r - (r - a) q)  (motorCore.wAfterInterval)        q = exp(-interval / tau), r = free / setpoint speed
 * planOf(res, opts) is the same without the unused params argument (engine-tolerance.js uses it).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal, MAX_SHOTS = 20, MAX_INTERVAL_S = 60, EPS = 1e-9;

  function fin(x) { return typeof x === 'number' && isFinite(x); }

  function windowOf(res) {
    var h = res.hood, sw = h && h.rpmWindow ? h.rpmWindow : (res.best && res.code !== 'TOO_SLOW' && res.best.scoringWindow ? res.best.scoringWindow : null);
    if (!sw || !sw.motorRpm || !fin(sw.motorRpm[0]) || !fin(sw.motorRpm[1])) return null;
    return [sw.motorRpm[0], sw.motorRpm[1]];
  }

  // speed before shot k = 1..n as a fraction of the setpoint speed (index 0 = shot 1)
  function fractions(n, dip, tau, r, pid, dt) {
    var q = Math.exp(-dt / tau), x = 1, out = [], a;
    for (var k = 0; k < n; k++) {
      out.push(x);
      a = x * (1 - dip);
      x = pid ? Math.min(1, r - (r - a) * q) : 1 - (1 - a) * q;
    }
    return out;
  }

  function planOf(res, opts) {
    opts = opts || {};
    var m = res && res.motor, win = res && windowOf(res), shots = Math.round(opts.shots);
    if (!m || !m.details || !win || !(shots >= 1) || !m.reachable) return null;
    shots = Math.min(shots, MAX_SHOTS);
    var d = m.details, sp = fin(opts.setpointRpm) && opts.setpointRpm > 0 ? opts.setpointRpm : (res.hood && res.hood.rpmWindow ? res.hood.rpmWindow.centerMotorRpm : (win[0] + win[1]) / 2);
    if (!fin(sp) || !(sp > 0) || sp >= m.usableFreeRpm) return null;
    var w0 = d.w0 * sp / m.motorRpm, r = d.wFree / w0, pid = m.control === 'pid', dip = m.dip, tau = m.tauS;
    var dt = fin(opts.intervalS) && opts.intervalS >= 0 ? Math.min(opts.intervalS, MAX_INTERVAL_S) : d.shotInterval;
    function inWin(x) { return sp * x >= win[0] * (1 - EPS) && sp * x <= win[1] * (1 + EPS); }
    function allIn(t) { return fractions(shots, dip, tau, r, pid, t).every(inWin); }
    var xs = fractions(shots, dip, tau, r, pid, dt), per = [], firstOut = null;
    xs.forEach(function (x, i) {
      var ok = inWin(x);
      per.push({ k: i + 1, deficitPct: 100 * (1 - x), motorRpm: sp * x, inWindow: ok });
      if (!ok && firstOut === null) firstOut = i + 1;
    });
    var steady = fractions(400, dip, tau, r, pid, dt), minI = null;
    if (allIn(MAX_INTERVAL_S)) {
      if (allIn(0)) minI = 0;
      else {
        var lo = 0, hi = MAX_INTERVAL_S;   // allIn is monotone in the interval (a longer wait never lowers any shot's speed)
        while (hi - lo > 1e-3) { var mid = (lo + hi) / 2; if (allIn(mid)) hi = mid; else lo = mid; }
        minI = Math.ceil(hi * 1000) / 1000;   // whole ms, rounded up so the interval itself passes
      }
    }
    return { shots: shots, intervalS: dt, control: m.control, steadyDeficitPct: 100 * (1 - steady[399]), perShot: per, allIn: firstOut === null,
      firstOut: firstOut, minIntervalS: minI, setpointRpm: sp, windowRpm: win, dipPct: 100 * dip, tauS: tau };
  }

  function burstPlan(res, params, opts) { return planOf(res, opts); }

  E.burstPlan = burstPlan;
  I.register('burst', { burstPlan: burstPlan, planOf: planOf });
  return { burstPlan: burstPlan, planOf: planOf };
});
