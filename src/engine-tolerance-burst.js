/*
 * BIOBUZZ Shot Sim - engine extension "toleranceBurst" (#9): burst helpers of the tolerance margin. Maths: process_docs/issue-9b/design.md (F1, Burst-aware setpoint).
 * erodeLow(H, dims, B) -> Uint8Array   rect-hit grid eroded along the speed axis: a cell stays 1 only if it and the B cells below it (b ascending = faster) are 1
 *                                       (below the view = unknown -> 0): the burst's speed deficit as a fixed, unscaled shift of the low side.
 * pick(view, S, K, cell, o) -> { b, bx, margin, al } | null
 *   keeps the angle and yaw of `cell` and searches only the speed axis of view.rectHits (the eroded grid) for the cell with the largest margin = min(largest box
 *   (same TC.largestBox call as the headline), o.along(b) margin, o.sMax); ties (1e-9) -> the cell closest to cell[1] + o.B / 2, then the lower one.
 *   o = { top (highest allowed b), B, sMax, ok(b) -> bool (reachable speed), along(b) -> { margin } | null }. null when no cell has a positive margin.
 * UMD: Node module.exports = factory(require('./engine.js'), require('./engine-tolerance-core.js')); browser / worker factory(root.ShotEngine, root.ShotToleranceCore).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./engine-tolerance-core.js'));
  else factory(root.ShotEngine, root.ShotToleranceCore);
})(typeof self !== 'undefined' ? self : this, function (E, TC) {
  'use strict';
  var I = E._internal;

  function erodeLow(H, dims, B) {
    var nA = dims[0], nB = dims[1], nC = dims[2], out = new Uint8Array(H.length), a, b, c, i, run;
    for (a = 0; a < nA; a++) for (c = 0; c < nC; c++) {
      for (run = 0, b = 0; b < nB; b++) { i = (a * nB + b) * nC + c; run = H[i] ? run + 1 : 0; out[i] = run > B ? 1 : 0; }
    }
    return out;
  }

  function pick(view, S, K, cell, o) {
    var H = view.rectHits, nB = view.nB, nC = view.nC, a = cell[0], c = cell[2], top = Math.min(o.top, nB - 1), cands = [], b, kb, best = -1, kept = [], j, cd, al, pick = null;
    for (b = 0; b <= top; b++) {
      if (H[(a * nB + b) * nC + c] !== 1 || !o.ok(b)) continue;
      kb = K.kB(b);
      cands.push({ b: b, bx: TC.largestBox({ H: H, dims: [view.nA, nB, nC], center: [a, b, c], neg: [K.kA, kb[0], K.kY], pos: [K.kA, kb[1], K.kY], sMax: o.sMax, S: S }) });
    }
    cands.sort(function (p, q) { return q.bx.s - p.bx.s || p.b - q.b; });
    for (j = 0; j < cands.length; j++) {   // a candidate whose box is already below the best combined margin cannot win: stop (sorted by box)
      cd = cands[j];
      if (cd.bx.s < best - 1e-9) break;
      al = o.along(cd.b); cd.al = al; cd.margin = Math.min(cd.bx.s, al ? al.margin : Infinity, o.sMax);
      kept.push(cd); if (cd.margin > best) best = cd.margin;
    }
    if (!(best > 0)) return null;
    var target = cell[1] + o.B / 2;
    kept.forEach(function (k) {
      if (k.margin < best - 1e-9) return;
      if (!pick || Math.abs(k.b - target) < Math.abs(pick.b - target) - 1e-12 || (Math.abs(k.b - target) === Math.abs(pick.b - target) && k.b < pick.b)) pick = k;
    });
    return pick;
  }

  var impl = { erodeLow: erodeLow, pick: pick };
  I.register('toleranceBurst', impl);
  return impl;
});
