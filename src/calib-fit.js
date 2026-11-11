/* BIOBUZZ Shot Sim - #11 eta fit: raw landing distances -> exit-speed factor (single or per rpm), outlier marks, +/- rpm spread.
   Inverts the engine's drag model per shot (CalibCore.speedForLanding). Pure; engine passed as opts.engine.
   Browser: window.CalibFit. Node: module.exports. Maths: process_docs/issue-11/design.md sections 2-3. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calib-core.js'));
  else root.CalibFit = factory(root.CalibCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var K_MAD = 3.5, MAD_SIGMA = 1.4826, FLOOR_IN = 0.25, SPREAD_RATIO = 3;
  var ETA_RANGE = { single: [0.01, 1], dual: [0.01, 1.5] };      // engine clamps (shooterNorm)

  function sorted(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function median(a) { var s = sorted(a), n = s.length; return !n ? NaN : (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])); }
  function quantile(a, p) {             // linear-interpolated sample quantile (type 7)
    var s = sorted(a), h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  }
  var Z90 = 1.6449;                      // z_0.95: half-width of a two-sided 90 % normal interval in sigmas
  function ss(a) { var m = mean(a); return a.reduce(function (t, x) { return t + (x - m) * (x - m); }, 0); }   // sum of squared deviations
  function c4(m) { return 1 - 1 / (4 * m) - 7 / (32 * m * m); }   // E[s]/sigma for m degrees of freedom (approx., < 0.1 % off for m >= 1): removes the low bias of a sample sd
  function halfRange90(a) { return a.length < 2 ? 0 : (quantile(a, 0.95) - quantile(a, 0.05)) / 2; }
  function mad(a) { var m = median(a); return median(a.map(function (x) { return Math.abs(x - m); })); }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function lin(x, a, b) { return a + (b - a) * x; }
  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }

  // v(rpm) = f(rpm) * k * rpm must increase over the curve so that rpm <-> speed is a bijection
  function speedMapIncreasing(curve, k) {
    var prev = -Infinity;
    for (var i = 1; i < curve.length; i++) {
      for (var j = i === 1 ? 0 : 1; j <= 50; j++) {   // segment ends are shared: visit each knot once
        var r = lin(j / 50, curve[i - 1][0], curve[i][0]);
        var v = Core.factorAt(curve, r) * k * r;
        if (!(v > prev)) return false;
        prev = v;
      }
    }
    return true;
  }

  function shotsOf(E, S0, k, row, theta) {
    var u = k * row.measuredMotorRpm;
    return (row.landingIn || []).map(function (d) {
      var v = u > 0 ? Core.speedForLanding(E, row.ballId, S0, theta, d, row.h0In) : null;
      return { d: d, v: v, f: v == null ? null : v / u, out: false };
    });
  }

  // Outliers in landing space (inches). e = d_j - median of the other shots of the row (leave-one-out: median-centred residuals of 5
  // shots are deflated). Landing scatter is partly tape reading (constant in inches) and partly speed scatter (proportional to
  // distance), so e is divided by (row median distance / typical distance)^0.5, halfway between the two. Pooled over all rows,
  // sigma = max(1.4826 MAD(z), FLOOR_IN); shot j is an outlier if |z_j| > K_MAD sigma (see design.md 2.1 for the false-flag simulation).
  function flagOutliers(infos, K) {
    var meds = [], zs = [];
    infos.forEach(function (ri) {
      ri.us = ri.shots.filter(function (s) { return s.f != null; });
      if (ri.us.length) meds.push(median(ri.us.map(function (s) { return s.d; })));
    });
    var dm = median(meds);
    infos.forEach(function (ri) {
      var c = ri.us.length ? Math.sqrt(median(ri.us.map(function (s) { return s.d; })) / dm) : 1;
      ri.us.forEach(function (s, j) {
        s.z = ri.us.length < 2 ? 0 : (s.d - median(ri.us.filter(function (t, i) { return i !== j; }).map(function (t) { return t.d; }))) / c;
        if (ri.us.length >= 2) zs.push(s.z);
      });
    });
    var sigma = Math.max(zs.length >= 3 ? MAD_SIGMA * mad(zs) : 0, FLOOR_IN);
    infos.forEach(function (ri) {
      ri.shots.forEach(function (s) { if (s.f != null && Math.abs(s.z) > K * sigma) s.out = true; });
      ri.inl = ri.shots.filter(function (s) { return s.f != null && !s.out; });
    });
    return sigma;
  }

  // rows: CalibRow[]; cfg: ConfigV1 (or bare shooter); opts: { engine, mode: 'single'|'perRpm', angleOffsetDeg, madK, wheelDiameterMm | wheels }
  function fit(rows, cfg, opts) {
    opts = opts || {};
    var E = opts.engine || (typeof ShotEngine !== 'undefined' ? ShotEngine : null);
    if (!E) throw new Error('calib-fit: engine missing (opts.engine)');
    var so = Core.shooterOf(E, cfg, opts), sh = so.sh, S0 = so.S0, k = Core.wheelSurfaceSpeed(1, sh);
    var offset = isFinite(opts.angleOffsetDeg) && opts.angleOffsetDeg !== null ? Number(opts.angleOffsetDeg) : null;
    var fld = (cfg && cfg.field) || {}, a = [];
    var infos = (rows || []).map(function (row, i) {
      var r = Object.assign({}, row, { ballId: row.ballId || fld.ballId || 'pollen', h0In: row.h0In || fld.h0 || 16 });
      var th = r.hoodDeg + (offset || 0);
      return { i: i, row: r, theta: th, shots: shotsOf(E, S0, k, r, th) };
    });
    var sigma = flagOutliers(infos, opts.madK > 0 ? opts.madK : K_MAD);
    var allIn = [];
    infos.forEach(function (ri) { ri.inl.forEach(function (s) { allIn.push(s.f); }); ri.fRow = ri.inl.length ? median(ri.inl.map(function (s) { return s.f; })) : null; });
    if (!allIn.length) throw new Error('calib-fit: no usable shots');

    var mode = opts.mode === 'perRpm' ? 'perRpm' : 'single', curve = null, fHat = median(allIn), factor = fHat;
    if (mode === 'perRpm') {
      var knots = {};
      infos.forEach(function (ri) {
        if (ri.fRow == null) return;
        var key = round(ri.row.measuredMotorRpm, 6);
        (knots[key] = knots[key] || []).push(ri.fRow);
      });
      var c = Object.keys(knots).map(Number).sort(function (x, y) { return x - y; }).map(function (r) { return [r, mean(knots[round(r, 6)])]; });
      if (c.length < 2) { mode = 'single'; a.push('Per-rpm fit needs at least 2 distinct measured rpm values: a single factor was fitted.'); }
      else if (!speedMapIncreasing(c, k)) { mode = 'single'; a.push('The per-rpm curve makes exit speed fall as rpm rises (not physical): a single factor was fitted.'); }
      else { curve = c; factor = Core.factorAt(c, (c[0][0] + c[c.length - 1][0]) / 2); }
    }
    var fAt = function (rpm) { return curve ? Core.factorAt(curve, rpm) : fHat; };

    // per-row report, spreads in rpm-equivalents
    var spreadRpm = 0, ssSum = 0, dof = 0;   // spreadRpm = 1.645 x pooled within-setting sd (Bessel) of per-shot rpm-equivalents
    var out = infos.map(function (ri) {
      var r = ri.row, f = fAt(r.measuredMotorRpm), pred = null, why = [];
      var d = Core.landingIn(E, r.ballId, S0, ri.theta, f * k * r.measuredMotorRpm, r.h0In);
      if (isFinite(d)) pred = d;
      var inl = ri.inl, lands = inl.map(function (s) { return s.d; });
      var nOut = ri.shots.filter(function (s) { return s.out; }).length, nBad = ri.shots.filter(function (s) { return s.f == null; }).length;
      if (nOut) why.push(nOut + ' outlier shot(s)');
      if (nBad) why.push(nBad + ' shot(s) the model cannot reach');
      if (!inl.length) why.push('no usable shots');
      var xs = inl.map(function (s) { return s.v / (f * k); }), sp = 0;
      if (xs.length >= 2) { var q = ss(xs); sp = Z90 * Math.sqrt(q / (xs.length - 1)) / c4(xs.length - 1); ssSum += q; dof += xs.length - 1; }
      ri.sf = inl.length >= 3 ? halfRange90(inl.map(function (s) { return s.f; })) : null;
      var mean_ = lands.length ? mean(lands) : null;
      return { i: ri.i, settingId: r.settingId, rpm: r.measuredMotorRpm, nShots: ri.shots.length, nUsed: inl.length,
        predictedIn: pred, meanIn: mean_, residualIn: mean_ != null && pred != null ? mean_ - pred : null,
        spreadIn: halfRange90(lands), spreadRpm: sp, factor: ri.fRow, flag: why.length ? 'repeat' : 'ok', reason: why.join('; ') };
    });
    if (dof > 0) spreadRpm = Z90 * Math.sqrt(ssSum / dof) / c4(dof);
    var sfs = infos.map(function (ri) { return ri.sf; }).filter(function (x) { return x != null; }), msf = median(sfs);
    if (sfs.length >= 3 && msf > 0) infos.forEach(function (ri, j) {
      if (ri.sf > SPREAD_RATIO * msf) { out[j].flag = 'repeat'; out[j].reason += (out[j].reason ? '; ' : '') + 'spread more than ' + SPREAD_RATIO + 'x the typical row'; }
    });

    var k2 = sh.topRatio, eta = sh.type === 'dual' ? { dual: factor * 2 / (1 + k2) } : { single: factor };
    var rng = sh.type === 'dual' ? ETA_RANGE.dual : ETA_RANGE.single, ev = sh.type === 'dual' ? eta.dual : eta.single;
    a.unshift(offset === null ? 'Actual launch angle = hood angle (no angle offset measured).' : 'Launch angle = hood angle + ' + offset + ' deg (offset from video).',
      'Landing = where the ball first touches the floor (ball centre at z = -h0 + r), measured from the point under the mouth; h0 = height of the ball centre at release.',
      mode === 'perRpm' ? 'Per-rpm curve applies only where speed is converted to rpm (export, report); the engine keeps one eta, the curve value at the middle of the tested rpm range.'
        : 'One exit-speed factor for all rpm (median of per-shot factors).');
    if (ev < rng[0] || ev > rng[1]) a.push('Fitted eta ' + round(ev, 4) + ' is outside the engine range ' + rng.join('-') + ': it will be clamped; check the measurements.');
    if (so.note) a.push(so.note);
    return { mode: mode, factor: factor, curve: curve, eta: eta, rows: out, spreadRpm: spreadRpm,
      angleOffsetDeg: offset, assumptions: a, factorSe: 1.2533 * MAD_SIGMA * mad(allIn) / Math.sqrt(allIn.length), sigmaIn: sigma, nUsed: allIn.length };
  }

  return { fit: fit, median: median, quantile: quantile, halfRange90: halfRange90 };
});
