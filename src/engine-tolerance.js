/*
 * BIOBUZZ Shot Sim - engine extension "tolerance" (#7, #8): margin = the largest box around the setpoint, sides proportional to the team's
 * +- tolerances, that scores everywhere inside (bounded errors, no distribution; PLAN 2.5, D9, D11). Maths: process_docs/issue-7/design.md.
 *
 * ToleranceInput = { yawDeg, angleDeg, rpm, posIn (all >= 0), source: 'measured' | 'preset', best, burstShots (2..20; key absent otherwise), burstIntervalS (optional) }
 *   burstShots > 1 (#9, needs engine-burst.js): bias.speedPct = the largest per-shot deficit of E.burstPlan; it is a FIXED offset (not scaled by s): the
 *   rect-hit grid is eroded along the speed axis by B = ceil(ln(1/(1 - speedPct/100)) / lnStep) cells (a cell stays a hit only if it and the B cells below hit;
 *   cells below the view = not hit) before the box search (the core is untouched); res.tolerance.bias = { speedPct, shots, intervalS, control, perShotPct, cells: B }.
 *   Burst-aware setpoint (engine-tolerance-burst.js): the headline refers to the speed cell (same angle / yaw) with the largest eroded margin; res.tolerance.burstSetpoint =
 *   { motorRpm, exitSpeedMps, v, shiftPct (vs the engine setpoint), cells, cell, thetaDeg, yawDeg } | null (bias.fits false: margin 0). setpoint stays the engine's.
 * norm(raw) -> ToleranceInput | null          junk -> 0 per field; all four 0 -> null. best = false switches the bestSetpoint search off.
 * verdictOf(margin, bands = BANDS) -> E.VERDICTS string   margin >= ok POSSIBLE, >= mid NOT CONSISTENT, else WON'T WORK (null -> WON'T WORK)
 * result(view, sel, res, tn, { p, mo, sh, bp }) -> ToleranceResult | null (null when tn is null)
 *   { margin, boxMargin, alongMargin, limitingAxis: 'yaw'|'angle'|'rpm'|'along'|null, limitingSide: -1|1|null, lowerBound, capped, sMax,
 *     perAxis: { yaw, angle, rpm }, position: { lateralIn (sideways move the aim window absorbs: perAxis.yaw x the position tolerance's yaw share; null without posIn), alongIn: [-minusIn, plusIn] | null }, verdict, bands, cappedBy: null|'unreachable'|'headroom',
 *     resolution, basis: 'rect', entryRule, mode: 'full'|'coarse', viewLimited, tolerance, setpoint, along, bestSetpoint }
 *   margin null = no aim, or the aim needs more speed than the motor has (cappedBy 'unreachable'; boxMargin / alongMargin then describe the uncapped aim).
 *   margin 1.0 = just fits; >= sMax (4) is reported as 4 with capped = true; lowerBound = the binding term only bounds the margin from below
 *   (box ran into the view edge / along range stopped at the mouth limit or the cap). (verdict WON'T WORK).
 *   setpoint = { thetaDeg, v, motorRpm, yawDeg, yawOffsetDeg, cell, moved }; bestSetpoint (full view only, else null) = the cell of the same view
 *   with the largest box margin { thetaDeg, v, motorRpm, yawDeg, yawOffsetDeg, boxMargin, alongMargin, margin, viewLimited, cell, evaluated, searchMs }.
 * UMD: Node module.exports = factory(require('./engine.js'), require('./engine-tolerance-core.js')); browser / worker factory(root.ShotEngine,
 * root.ShotToleranceCore). Load after engine-tolerance-core.js, engine-tolerance-along.js and engine-tolerance-burst.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./engine-tolerance-core.js'));
  else factory(root.ShotEngine, root.ShotToleranceCore);
})(typeof self !== 'undefined' ? self : this, function (E, TC) {
  'use strict';
  var I = E._internal, RAD = Math.PI / 180, SMAX = 4, SLACK = 1e-6, BANDS = { ok: 1.25, mid: 1.0 }, AXES = ['angle', 'rpm', 'yaw'];
  var clock = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };

  function fin(x) { return typeof x === 'number' && isFinite(x) && x > 0 ? x : 0; }

  function norm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var bs = Math.round(fin(raw.burstShots));
    var t = { yawDeg: fin(raw.yawDeg), angleDeg: fin(raw.angleDeg), rpm: fin(raw.rpm), posIn: fin(raw.posIn),
      source: raw.source === 'preset' ? 'preset' : 'measured', best: raw.best !== false };
    if (bs > 1) { t.burstShots = Math.min(bs, 20); if (fin(raw.burstIntervalS)) t.burstIntervalS = fin(raw.burstIntervalS); }   // keys only when asked: older callers see the old shape
    return t.yawDeg || t.angleDeg || t.rpm || t.posIn ? t : null;
  }

  function verdictOf(margin, bands) {
    var b = bands || BANDS, V = E.VERDICTS;
    if (typeof margin !== 'number' || margin !== margin) return V[2];
    return margin >= b.ok - SLACK ? V[0] : margin >= b.mid - SLACK ? V[1] : V[2];
  }

  // index units per s = 1: angle and yaw are the same for every cell, the speed pair depends on the cell's motor rpm
  function rates(view, tn, distIn, rpmC, vC) {
    var wY = tn.yawDeg + Math.atan(tn.posIn / Math.max(distIn || 0, 1e-9)) / RAD;
    return { wY: wY, kA: tn.angleDeg / view.thStep, kY: wY / view.yawStep, kB: function (b) {
      var x = tn.rpm / (rpmC * view.speeds[b] / vC);
      if (!(x > 0)) return [0, 0];
      return [Math.min(x >= 1 ? b + 1 : -Math.log(1 - x) / view.lnStep, b + 1), Math.log(1 + x) / view.lnStep];
    } };
  }

  function boxAt(view, S, K, cell, sMax) {
    var kb = K.kB(cell[1]);
    return TC.largestBox({ H: view.rectHits, dims: [view.nA, view.nB, view.nC], center: cell, neg: [K.kA, kb[0], K.kY], pos: [K.kA, kb[1], K.kY], sMax: sMax, S: S });
  }

  // the engine's aim cell (hood: sel.hood.set, same a, b, c as sel), else the nearest rect hit as scoringWindow does
  function setpointOf(view, sel, p) {
    var H = view.rectHits, top = sel.cellMaxB == null ? view.nB - 1 : sel.cellMaxB;
    if (sel.b <= top && H[(sel.a * view.nB + sel.b) * view.nC + sel.c] === 1) return { cell: [sel.a, sel.b, sel.c], theta: sel.theta, v: sel.v, yaw: sel.yaw, moved: false };
    var W = I.ext('window'), pr = p.precision;
    var n = W && W.nearestRectHit(view, { a: sel.a, b: sel.b, c: sel.c, cellMaxB: top }, { theta: pr.sigThetaDeg, ln: Math.max(1e-9, sel.sigV || 0), yaw: pr.sigYawDeg });
    return n ? { cell: [n.a, n.b, n.c], theta: view.thetas[n.a], v: view.speeds[n.b], yaw: view.yaws[n.c], moved: true } : null;
  }

  function wrap180(x) { return ((x + 180) % 360 + 360) % 360 - 180; }

  function alongOf(deps, tn, th, v, yawOff) {
    if (!(tn.posIn > 0) || !E.alongRange) return null;
    var r = E.alongRange(deps.p, { thetaDeg: th, v: v, yawOffsetDeg: yawOff });
    return { minusIn: r.minusIn, plusIn: r.plusIn, minusEnd: r.minusEnd, plusEnd: r.plusEnd, limited: r.limited, margin: Math.min(r.minusIn, r.plusIn) / tn.posIn };
  }

  // consecutive ones before (rn) / after (rp) every cell along each axis (strides st); a zero cell or the view edge ends a run
  function runs(H, dims, st) {
    var nA = dims[0], nB = dims[1], nC = dims[2], N = H.length, rn = [], rp = [], ax, i, a, b, c;
    for (ax = 0; ax < 3; ax++) { rn.push(new Uint16Array(N)); rp.push(new Uint16Array(N)); }
    for (i = 0, a = 0; a < nA; a++) for (b = 0; b < nB; b++) for (c = 0; c < nC; c++, i++) {
      if (a > 0 && H[i - st[0]]) rn[0][i] = rn[0][i - st[0]] + 1;
      if (b > 0 && H[i - st[1]]) rn[1][i] = rn[1][i - st[1]] + 1;
      if (c > 0 && H[i - 1]) rn[2][i] = rn[2][i - 1] + 1;
    }
    for (i = N - 1, a = nA - 1; a >= 0; a--) for (b = nB - 1; b >= 0; b--) for (c = nC - 1; c >= 0; c--, i--) {
      if (a < nA - 1 && H[i + st[0]]) rp[0][i] = rp[0][i + st[0]] + 1;
      if (b < nB - 1 && H[i + st[1]]) rp[1][i] = rp[1][i + st[1]] + 1;
      if (c < nC - 1 && H[i + 1]) rp[2][i] = rp[2][i + 1] + 1;
    }
    return { rn: rn, rp: rp };
  }

  // exact maximum of the box margin over the rect-hit cells; upper bound UB = first failing 1-D breakpoint (design.md), see I3 notes
  function bestCell(view, S, K, inc, cellMaxB, aRange) {
    var nA = view.nA, nB = view.nB, nC = view.nC, dims = [nA, nB, nC], H = view.rectHits, st = [nB * nC, nC, 1], N = H.length;
    var R = runs(H, dims, st), kb = [], b, a, c, i, ub, q, keys, cnt = 0, evaluated = 0, best = inc;
    for (b = 0; b < nB; b++) kb.push(K.kB(b));
    var pre = new Float64Array(N);
    function lim(r, k) { return k > 0 ? (r + 1) / k : Infinity; }
    for (i = 0, a = 0; a < nA; a++) for (b = 0; b < nB; b++) for (c = 0; c < nC; c++, i++) {
      if (!H[i] || b > cellMaxB || a < aRange[0] || a > aRange[1]) continue;
      ub = Math.min(SMAX, lim(R.rn[0][i], K.kA), lim(R.rp[0][i], K.kA), lim(R.rn[1][i], kb[b][0]), lim(R.rp[1][i], kb[b][1]), lim(R.rn[2][i], K.kY), lim(R.rp[2][i], K.kY));
      if (ub > inc.box.s + 1e-12) { pre[cnt++] = Math.floor(ub * 1e6) * 16777216 + i; }
    }
    keys = pre.subarray(0, cnt).sort();
    for (var j = cnt - 1; j >= 0; j--) {
      q = Math.floor(keys[j] / 16777216); i = keys[j] - q * 16777216;
      if (best.box.s >= (q + 1) / 1e6) break;
      var cell = [Math.floor(i / st[0]), Math.floor(i / st[1]) % nB, i % nC], bx = boxAt(view, S, K, cell, SMAX);
      evaluated++;
      if (bx.s > best.box.s + 1e-12) best = { cell: cell, box: bx };
    }
    return { cell: best.cell, box: best.box, evaluated: evaluated };
  }

  function angleRange(view, hood) {
    var th = view.thetas, lo = 0, hi = view.nA - 1, i, f = -1;
    if (!hood) return [lo, hi];
    var a0 = hood.mode === 'fixed' ? hood.angleDeg - view.thStep / 2 - 1e-9 : hood.range[0] - 1e-9, a1 = hood.mode === 'fixed' ? hood.angleDeg + view.thStep / 2 + 1e-9 : hood.range[1] + 1e-9;
    lo = -1; hi = -2;
    for (i = 0; i < th.length; i++) if (th[i] >= a0 && th[i] <= a1) { if (f < 0) { lo = i; f = i; } hi = i; }
    return [lo, hi];
  }

  function bestSetpoint(view, res, tn, deps, sel, S, K, sp, bx, rpmC) {
    var t0 = clock(), top = sel.cellMaxB == null ? view.nB - 1 : sel.cellMaxB;
    var r = bestCell(view, S, K, { cell: sp.cell, box: bx }, top, angleRange(view, res.hood)), c = r.cell;
    var th = view.thetas[c[0]], v = view.speeds[c[1]], yaw = view.yaws[c[2]], yo = wrap180(yaw - res.psi0Deg), al = alongOf(deps, tn, th, v, yo);
    var alongMargin = al ? al.margin : null;
    return { thetaDeg: th, v: v, motorRpm: rpmC * v / sp.v, yawDeg: yaw, yawOffsetDeg: yo, boxMargin: r.box.s, alongMargin: alongMargin,
      margin: Math.min(r.box.s, alongMargin == null ? Infinity : alongMargin, SMAX), viewLimited: r.box.viewLimited, cell: c, evaluated: r.evaluated, searchMs: clock() - t0 };
  }

  // burst (#9): the largest per-shot speed deficit of the burst, as a one-sided speed bias (math review issue 1); no plan (no burst module / aim) -> 0
  function biasOf(res, tn) {
    var B = I.ext('burst'), pl = B ? B.planOf(res, { shots: tn.burstShots, intervalS: tn.burstIntervalS || undefined }) : null;
    if (!pl) return { speedPct: 0, shots: tn.burstShots, intervalS: null, control: null, perShotPct: [] };
    var d = pl.perShot.map(function (s) { return Math.max(0, s.deficitPct); });
    return { speedPct: Math.max.apply(null, d), shots: pl.shots, intervalS: pl.intervalS, control: pl.control, perShotPct: d };
  }

  function result(view, sel, res, tn, deps) {
    if (!tn) return null;
    var V = E.VERDICTS, mc = res.motor, down = E.constants().model.downgrade, out = {
      margin: null, boxMargin: null, alongMargin: null, limitingAxis: null, limitingSide: null, lowerBound: false, capped: false, sMax: SMAX,
      perAxis: null, position: null, verdict: V[2], bands: { ok: BANDS.ok, mid: BANDS.mid }, cappedBy: null, resolution: null, basis: 'rect',
      entryRule: res.entry ? res.entry.rule : 'any', mode: res.mode === 'coarse' || (view && view.thStep >= 1) ? 'coarse' : 'full', viewLimited: false,
      tolerance: { yawDeg: tn.yawDeg, angleDeg: tn.angleDeg, rpm: tn.rpm, posIn: tn.posIn, source: tn.source }, setpoint: null, along: null, bestSetpoint: null
    };
    var unreachable = res.code === 'TOO_SLOW' || !!(res.best && res.best.reachable === false);
    var sp = sel && res.best && view && view.rectHits && mc ? setpointOf(view, sel, deps.p) : null;
    if (sel && res.best && view && view.rectHits && mc && !sp) out.margin = out.boxMargin = 0;   // no rect-hit cell at all
    if (sp) {
      var dims = [view.nA, view.nB, view.nC], yo = wrap180(sp.yaw - res.psi0Deg);
      var rpmC = I.motorCore(deps.mo, deps.sh, deps.bp, sp.v).motorRpm, bias = tn.burstShots > 1 ? biasOf(res, tn) : null, BS = I.ext('toleranceBurst');
      if (bias) {
        bias.cells = bias.speedPct > 0 ? Math.ceil(-Math.log(1 - Math.min(bias.speedPct, 99.9) / 100) / view.lnStep) : 0;
        if (bias.cells > 0 && BS) view = Object.assign({}, view, { rectHits: BS.erodeLow(view.rectHits, dims, bias.cells) });   // one grid for S, the box and bestSetpoint
        out.bias = bias;
      }
      var S = TC.summedVolume(view.rectHits, dims), K = rates(view, tn, res.distIn, rpmC, sp.v), bx0 = boxAt(view, S, K, sp.cell, SMAX), bx = bx0, vh = sp.v, bsp = null;
      if (bias && bias.cells > 0 && BS) {   // burst-aware setpoint: first-shot speed = the best cell along the speed axis of the eroded grid; the headline refers to it
        var pk = BS.pick(view, S, K, sp.cell, { top: sel.cellMaxB == null ? view.nB - 1 : sel.cellMaxB, B: bias.cells, sMax: SMAX, ok: function (b) { return rpmC * view.speeds[b] / sp.v < (mc.usableFreeRpm || Infinity); }, along: function (b) { return alongOf(deps, tn, sp.theta, view.speeds[b], yo); } });
        bias.fits = !!pk;
        if (pk) { bx = pk.bx; vh = view.speeds[pk.b]; bsp = { motorRpm: rpmC * vh / sp.v, exitSpeedMps: vh, v: vh, shiftPct: 100 * (vh / sp.v - 1), cells: pk.b - sp.cell[1], cell: [sp.cell[0], pk.b, sp.cell[2]], thetaDeg: sp.theta, yawDeg: sp.yaw }; }
        out.burstSetpoint = bsp;
      }
      var al = alongOf(deps, tn, sp.theta, vh, yo), alongMargin = al ? al.margin : null, useAlong = alongMargin != null && alongMargin < bx.s;
      out.boxMargin = bx.s; out.alongMargin = alongMargin; out.margin = Math.min(bx.s, alongMargin == null ? Infinity : alongMargin, SMAX);
      out.capped = out.margin >= SMAX; out.resolution = bx.resolution; out.viewLimited = bx.viewLimited; out.along = al;
      out.perAxis = { yaw: bx.perAxis[2], angle: bx.perAxis[0], rpm: bx.perAxis[1] };
      if (!out.capped) {
        if (useAlong) { out.limitingAxis = 'along'; out.limitingSide = al.minusIn <= al.plusIn ? -1 : 1; out.lowerBound = (al.minusIn <= al.plusIn ? al.minusEnd : al.plusEnd) !== 'fail'; }
        else { out.limitingAxis = bx.limitingAxis == null ? null : AXES[bx.limitingAxis]; out.limitingSide = bx.limitingSide; out.lowerBound = bx.viewLimited; }
      }
      // sideways position you can tolerate: the position share of the YAW axis margin alone (it rides on the aim window), so it does not move with the angle / rpm tolerances
      out.position = { lateralIn: tn.posIn > 0 ? res.distIn * Math.tan(Math.min(89, Math.min(bx.perAxis[2], SMAX) * Math.atan(tn.posIn / Math.max(res.distIn || 0, 1e-9)) / RAD) * RAD) : null, alongIn: al ? [-al.minusIn, al.plusIn] : null };
      out.setpoint = { thetaDeg: sp.theta, v: sp.v, motorRpm: rpmC, yawDeg: sp.yaw, yawOffsetDeg: yo, cell: sp.cell, moved: sp.moved };
      if (tn.best && view.thStep < 1 && !unreachable) out.bestSetpoint = bestSetpoint(view, res, tn, deps, sel, S, K, sp, bx0, rpmC);
    }
    out.verdict = verdictOf(out.margin, out.bands);
    if (unreachable) { out.verdict = V[2]; out.cappedBy = 'unreachable'; out.margin = null; out.capped = false; out.limitingAxis = out.limitingSide = null; out.lowerBound = false; }   // boxMargin / alongMargin stay: they describe the uncapped aim
    else if (out.verdict === V[0] && mc && mc.control === 'pid' && mc.headroom > down) { out.verdict = V[1]; out.cappedBy = 'headroom'; }
    return out;
  }

  var impl = { norm: norm, verdictOf: verdictOf, result: result, BANDS: BANDS, SMAX: SMAX };
  I.register('tolerance', impl);
  return impl;
});
