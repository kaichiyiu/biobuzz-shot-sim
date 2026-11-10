/*
 * BIOBUZZ Shot Sim - engine extension "hood" (#2): fixed / adjustable hood, deterministic widest-window angle,
 * setpoint, +-1 deg sensitivity, error result for an invalid fixed angle. Engine glue around engine-hood-core.js.
 * params.hood = { mode: 'fixed'|'adjustable', angleDeg?, minDeg?, maxDeg? }; absent -> legacy path (hook never runs).
 * Windows are read from view.rectHits (the same grid as res.best.scoringWindow, design D14).
 * res.hood = { mode, angleDeg, rangeDeg: [lo, hi]|null, rangeEdgesCoarse, range: [min, max]|null, atLimit: null|'min'|'max',
 *   preview, rpmWindow: RpmWindow|null, sensitivity: [{ deltaDeg, rpmWindow, widthRatio, centerShiftRpm, nominalStillScores }]|null }
 * Load order after engine.js: engine-rect, engine-hood-core, engine-hood, engine-sweep.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./engine-hood-core.js'));
  else factory(root.ShotEngine, root.ShotHoodCore);
})(typeof self !== 'undefined' ? self : this, function (E, HC) {
  'use strict';
  var I = E._internal, W = I.ext('window'), EPS = 1e-9;
  if (!W) throw new Error('engine-hood.js needs engine-rect.js loaded first');
  var MSG = { HOOD_ANGLE_REQUIRED: 'Enter launch angle', HOOD_ANGLE_RANGE: 'Launch angle must be 1–89°' };
  var DELTAS = [-4, 4, -8, 8];     // fine grid is 0.25 deg: -1, +1, -2, +2 deg

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function deg(x) { return String(+x.toFixed(2)); }

  function norm(raw) {
    raw = raw || {};
    if (raw.mode === 'fixed') {
      var a = raw.angleDeg, code = !isNum(a) ? 'HOOD_ANGLE_REQUIRED' : (a < 1 || a > 89 ? 'HOOD_ANGLE_RANGE' : null);
      return { mode: 'fixed', angleDeg: isNum(a) ? a : null, lo: isNum(a) ? a : NaN, hi: isNum(a) ? a : NaN,
        error: code ? { code: code, message: MSG[code], field: 'hood.angleDeg' } : null };
    }
    var lo = clamp(isNum(raw.minDeg) ? raw.minDeg : 45, 10, 89), hi = clamp(isNum(raw.maxDeg) ? raw.maxDeg : 80, 10, 89), t;
    if (lo > hi) { t = lo; lo = hi; hi = t; }
    if (hi - lo < 1) { t = (lo + hi) / 2; return { mode: 'fixed', angleDeg: t, lo: t, hi: t, error: null }; }   // narrower than 1 deg: fixed
    return { mode: 'adjustable', angleDeg: null, lo: lo, hi: hi, error: null };
  }

  // NO_ARC-shaped result: no verdict, no numbers (design 5.9)
  function errorResult(err, p, mode) {
    var pr = p.precision;
    return {
      verdict: null, code: err.code, hitRate: null, reason: err.message, error: err,
      psi0Deg: null, distIn: null, best: null, motor: null,
      sigma: { thetaDeg: pr.sigThetaDeg, yawDeg: pr.sigYawDeg, v: null, shooter: pr.sigShooter, motor: null, recovery: null },
      trajectory: null, ghosts: [], missCause: null, warnings: I.warningsFor(p),
      timings: { tableMs: 0, coarseMs: 0, fineMs: 0, totalMs: 0 }, mode: mode || 'coarse',
      mouth: { x: p.mouth.x, y: p.mouth.y, height: p.h0 }, launch: { x: p.launch.x, y: p.launch.y, z: p.h0 },
      aimHeadingDeg: null, h0: p.h0, S0: E.shooterSpin(p.shooter), gridHits: 0, closestMiss: null
    };
  }

  // grid angle indices [first, last] inside the hood; fixed -> the nearest grid angle (the exact one on the fine grid)
  function angleIndexRange(view, hn) {
    var th = view.thetas, i, lo = -1, hi = -1, best = -1, bd = Infinity;
    if (hn.mode === 'fixed') {
      for (i = 0; i < th.length; i++) if (Math.abs(th[i] - hn.angleDeg) < bd) { bd = Math.abs(th[i] - hn.angleDeg); best = i; }
      return bd <= view.thStep / 2 + EPS ? [best, best] : null;
    }
    for (i = 0; i < th.length; i++) if (th[i] >= hn.lo - EPS && th[i] <= hn.hi + EPS) { if (lo < 0) lo = i; hi = i; }
    return lo < 0 ? null : [lo, hi];
  }

  function capOf(view, mo, sh, bp, ignoreCap) {
    var vCap = I.motorCore(mo, sh, bp, 1).vCap, maxB = -1;
    for (var b = 0; b < view.nB; b++) if (view.speeds[b] <= vCap * (1 + 1e-12)) maxB = b;
    return { vCap: vCap, maxB: maxB, cellMaxB: ignoreCap ? view.nB - 1 : maxB };
  }

  // AimSel (same shape as selectAim's) at the given cell; rate from one rateField pass. Duplicates selectAim's setup (plan risk note).
  // set.v / set.yaw (optional) are exact centre values between grid nodes: the rate is interpolated linearly between the bracketing
  // nodes. Without this the 2 % coarse speed step would snap the advised aim by up to 1 %.
  function bracket(arr, x, i0) {   // [lower node, weight of the upper node] for x between two nodes (searched from node i0)
    if (x == null) return [i0, 0];
    var i = i0;
    while (i > 0 && arr[i] > x) i--;
    while (i + 1 < arr.length - 1 && arr[i + 1] <= x) i++;
    return i + 1 < arr.length && x > arr[i] ? [i, Math.min(1, (x - arr[i]) / (arr[i + 1] - arr[i]))] : [i, 0];
  }

  function aimAt(view, p, mo, sh, bp, set, ignoreCap) {
    var cap = capOf(view, mo, sh, bp, ignoreCap), sp = view.speeds, ys = view.yaws, KBs = [], b;
    var bw = bracket(sp, set.v, set.b), cw = bracket(ys, set.yaw, set.c), bTop = bw[0] + (bw[1] > 0 ? 1 : 0);
    for (b = 0; b <= bTop; b++) KBs[b] = I.kernel(view.lnStep, I.sigmaVOf(I.motorCore(mo, sh, bp, sp[b]), p.precision.sigShooter));
    var v = set.v != null ? set.v : sp[set.b], yaw = set.yaw != null ? set.yaw : ys[set.c];
    var mc = I.motorCore(mo, sh, bp, v), sigV = I.sigmaVOf(mc, p.precision.sigShooter);
    var KA = I.kernel(view.thStep, p.precision.sigThetaDeg), KC = I.kernel(view.yawStep, p.precision.sigYawDeg);
    var F = I.rateField(view, cap.cellMaxB, bTop, KA, KC, KBs, 'p'), rate = 0;
    function R(bb, cc) {
      var ok = F && set.a >= F.A0 && set.a <= F.A1 && bb >= F.B0 && bb <= F.B1 && cc >= F.C0 && cc <= F.C1;
      return ok ? F.R[(set.a * view.nB + bb) * view.nC + cc] : 0;
    }
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
      var w = (i ? bw[1] : 1 - bw[1]) * (j ? cw[1] : 1 - cw[1]);
      if (w > 0) rate += w * R(bw[0] + i, cw[0] + j);
    }
    return {
      rate: Math.max(0, Math.min(1, rate)), a: set.a, b: set.b, c: set.c,
      theta: view.thetas[set.a], v: v, yaw: yaw, sigV: sigV, mc: mc,
      vCap: cap.vCap, maxB: cap.maxB, cellMaxB: cap.cellMaxB, KA: KA, KC: KC, KB: I.kernel(view.lnStep, sigV)
    };
  }

  function aim(view, p, mo, sh, bp, hn, ignoreCap, hint) {   // hint: the coarse AimSel when refining on a fine view
    var cap = capOf(view, mo, sh, bp, ignoreCap), rg = angleIndexRange(view, hn);
    if (cap.cellMaxB < 0 || !rg || !view.rectHits) return null;
    var sp = view.speeds, dims = { nA: view.nA, nB: view.nB, nC: view.nC }, th = view.thetas;
    var list = HC.widestWindows(view.rectHits, dims, sp, cap.cellMaxB, rg[0], rg[1]), opt = null, aw = list[0];
    if (hn.mode === 'adjustable') {
      opt = HC.pickOptimalAngle(list, function (w) { return HC.stepAt(sp, w.bHi); });
      if (!opt) return null;
      aw = list[opt.a - rg[0]];
    }
    if (!aw || aw.bLo < 0) return null;
    var set = HC.centreAim(view.rectHits, dims, sp, HC.setpointOf(aw, sp), cap.cellMaxB), H = view.rectHits, yawC = null;
    var rb = HC.runAt(H, dims, set.a, set.c, set.b, cap.cellMaxB), nb = (rb.bLo + rb.bHi) >> 1, rc = HC.yawRunAt(H, dims, set.a, nb, set.c, cap.cellMaxB);
    if (hint && rc && (rc.cLo === 0 || rc.cHi === view.nC - 1)) {
      // the yaw run is cut by the fine view's yaw span, so its middle means nothing: keep the coarse centre, re-centre speed there
      var cn = 0, ci;
      for (ci = 1; ci < view.nC; ci++) if (Math.abs(view.yaws[ci] - hint.yaw) < Math.abs(view.yaws[cn] - hint.yaw)) cn = ci;
      var r2 = HC.runAt(H, dims, set.a, cn, nb, cap.cellMaxB);
      if (r2) { rb = r2; nb = (rb.bLo + rb.bHi) >> 1; yawC = hint.yaw; set = { a: set.a, b: nb, c: cn }; rc = null; }
    }
    // exact centres of the final runs (rpm = linear speed midpoint); the node indices only locate the run for windowsOf
    aw = { a: aw.a, width: sp[rb.bHi] - sp[rb.bLo], bLo: rb.bLo, bHi: rb.bHi, c: set.c, cLo: aw.cLo, cHi: aw.cHi };
    set = { a: set.a, b: nb, c: rc ? (rc.cLo + rc.cHi) >> 1 : set.c, v: (sp[rb.bLo] + sp[rb.bHi]) / 2, yaw: rc ? (view.yaws[rc.cLo] + view.yaws[rc.cHi]) / 2 : yawC };
    var sel = aimAt(view, p, mo, sh, bp, set, ignoreCap), h = { opt: opt, aw: aw, set: set, vLo: sp[aw.bLo], vHi: sp[aw.bHi] };
    if (opt) {
      var atLo = opt.aLo === rg[0] && th[rg[0]] - hn.lo < view.thStep + EPS, atHi = opt.aHi === rg[1] && hn.hi - th[rg[1]] < view.thStep + EPS;
      h.rangeDeg = [th[opt.aLo], th[opt.aHi]]; h.atLo = atLo; h.atHi = atHi;
      h.lowSpan = opt.aLo === rg[0] && !atLo; h.highSpan = opt.aHi === rg[1] && !atHi;   // run cut by the fine view, not by the hood
    }
    sel.hood = h;
    return sel;
  }

  function coarseAim(view, p, mo, sh, bp, hn, ignoreCap) { return aim(view, p, mo, sh, bp, hn, ignoreCap); }

  // fine view: exact fixed angle (or the coarse middle angle), speed span wide enough for the whole coarse window
  function fineOpts(sel, hn) {
    var h = sel.hood, fixed = hn.mode === 'fixed', span = Math.max(0.06, 0.5 * Math.log(h.vHi / h.vLo) + 0.02);
    // adjustable: the analysis span is fixed (+-6 deg angle, +-6 deg yaw, +-12 % speed) so it does not depend on the precision preset
    return { theta: fixed ? hn.angleDeg : sel.theta, vSpanLn: fixed ? span : Math.max(0.12, span), thSpan: fixed ? 0 : 6, yawSpan: 6, skipAim: true };
  }

  // null when the fine view has no window: evaluate then keeps the coarse aim (preview numbers)
  function fineAim(view, p, mo, sh, bp, hn, coarse) {
    var sel = aim(view, p, mo, sh, bp, hn, false, coarse);
    if (!sel || !sel.hood.opt) return sel;
    var h = sel.hood, c = coarse.hood.rangeDeg;   // an outer edge cut by the fine span keeps the 1 deg coarse value
    h.rangeDeg = [h.lowSpan ? Math.min(h.rangeDeg[0], c[0]) : h.rangeDeg[0], h.highSpan ? Math.max(h.rangeDeg[1], c[1]) : h.rangeDeg[1]];
    h.coarseEdges = h.lowSpan || h.highSpan;
    return sel;
  }

  function noWindowReason(hn) {
    return hn.mode === 'fixed' ? 'No arc scores at a launch angle of ' + deg(hn.angleDeg) + '° from here' :
      'No arc scores with the hood between ' + deg(hn.lo) + '° and ' + deg(hn.hi) + '° from here';
  }

  function result(view, sel, res, hn, mode, ctx) {
    var h = sel && sel.hood, adj = hn.mode === 'adjustable', ok = !!(h && res.best && res.code !== 'TOO_SLOW');
    var out = {
      mode: hn.mode, angleDeg: adj ? (sel ? sel.theta : null) : hn.angleDeg,
      rangeDeg: h && h.rangeDeg && h.rangeDeg[1] > h.rangeDeg[0] ? h.rangeDeg.slice() : null, rangeEdgesCoarse: !!(h && h.coarseEdges),
      range: adj ? [hn.lo, hn.hi] : null, atLimit: null, preview: mode === 'coarse' || view.thStep >= 1, rpmWindow: null, sensitivity: null
    };
    if (h && adj && (h.atLo || h.atHi)) out.atLimit = h.atLo && h.atHi ? (sel.theta - hn.lo <= hn.hi - sel.theta ? 'min' : 'max') : (h.atLo ? 'min' : 'max');
    if (!ok) return out;
    var sp = view.speeds, mk = function (bLo, bHi) { return W.rpmWindowOf(ctx.mo, ctx.sh, ctx.bp, sp[bLo], sp[bHi], bHi === sel.cellMaxB); };
    out.rpmWindow = mk(h.aw.bLo, h.aw.bHi);
    if (adj && mode === 'full' && view.thStep < 1) {
      var dims = { nA: view.nA, nB: view.nB, nC: view.nC };
      out.sensitivity = HC.sensitivity(view.rectHits, dims, sp, h.set, DELTAS, sel.cellMaxB).map(function (r) {
        var rw = r.bLo >= 0 ? mk(r.bLo, r.bHi) : null;
        return { deltaDeg: r.dIdx * view.thStep, rpmWindow: rw, widthRatio: r.widthRatio,
          centerShiftRpm: rw ? rw.centerMotorRpm - out.rpmWindow.centerMotorRpm : null, nominalStillScores: r.nominalStillScores };
      });
    }
    return out;
  }

  var impl = { norm: norm, errorResult: errorResult, angleIndexRange: angleIndexRange, aimAt: aimAt, coarseAim: coarseAim,
    fineOpts: fineOpts, fineAim: fineAim, result: result, noWindowReason: noWindowReason };
  I.register('hood', impl);
  return impl;
});
