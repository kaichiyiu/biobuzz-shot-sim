/*
 * BIOBUZZ Shot Sim - tolerance core (#7): the largest all-ones box around a setpoint on a boolean grid H[a, b, c].
 * Pure; works on synthetic grids. UMD: Node module.exports / browser + worker root.ShotToleranceCore. Maths: process_docs/issue-7/design.md.
 * Layout H[(a * nB + b) * nC + c] = angle, speed, yaw (the engine fine view). Cells outside the grid are UNKNOWN, not misses.
 *
 * largestBox({ H, dims: [nA, nB, nC], center: [a, b, c], neg: [3], pos: [3], sMax = Infinity, S? }) ->
 *   { s, resolution, limitingAxis: 0|1|2|null, limitingSide: -1|1|null, perAxis: [3], viewLimited, sLo, sHi }
 *   Box at scale s = index ranges [c_i - ceil(s * neg_i), c_i + ceil(s * pos_i)] (neg / pos = index units per s = 1, asymmetric allowed):
 *   CONSERVATIVE, the cells covered include the first cell at or beyond s * k on every side, so every point of the continuous box at
 *   scale s (reaching s * k cells from the centre) lies in a cell that is checked. Scale 0 = the centre cell only.
 *   neg_i or pos_i = 0: that side never extends; both 0: axis i is not constrained (tolerance 0 = a one-cell axis).
 *   s = the largest scale whose box is all ones. The integer box is constant on ((m-1)/k, m/k] and grows just after each point m / k, so the
 *   answer is found by exact bisection over the finite breakpoint set m / k (+ sMax; no float tolerance). A clean interval is closed on the
 *   right, so the supremum IS attained at the last good breakpoint: s = sLo (guaranteed: everything inside the scale-s box scores on the
 *   grid). sHi = the first failing breakpoint, the optimistic end: the true continuous margin lies in [sLo, sHi); resolution = sHi - sLo.
 *   s = sMax (not limited) when the whole range up to sMax is clean (Infinity without sMax and without constraints). Centre cell 0 -> s = 0.
 *   viewLimited = the box ran into the grid edge before any zero cell: the margin is then only a LOWER BOUND. limitingAxis / limitingSide name
 *   the side that hit the zero cell (or the edge); ties go to the lowest axis, low side first. null when s = 0 or s = sMax.
 *   perAxis[i] = the same margin along axis i alone (the other axes at the centre).
 * summedVolume(H, dims) -> Int32Array of (nA+1)(nB+1)(nC+1); boxSum(S, dims, lo[3], hi[3]) -> ones in the inclusive index box.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShotToleranceCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function dimArr(d) { return Array.isArray(d) || ArrayBuffer.isView(d) ? [d[0], d[1], d[2]] : [d.nA, d.nB, d.nC]; }

  function summedVolume(H, dims) {
    var d = dimArr(dims), nA = d[0], nB = d[1], nC = d[2], sB = nC + 1, sA = (nB + 1) * sB;
    var S = new Int32Array((nA + 1) * sA), a, b, c, i;
    for (a = 1; a <= nA; a++) for (b = 1; b <= nB; b++) for (c = 1; c <= nC; c++) {
      i = a * sA + b * sB + c;
      S[i] = (H[((a - 1) * nB + (b - 1)) * nC + (c - 1)] ? 1 : 0) + S[i - sA] + S[i - sB] + S[i - 1]
        - S[i - sA - sB] - S[i - sA - 1] - S[i - sB - 1] + S[i - sA - sB - 1];
    }
    return S;
  }

  function boxSum(S, dims, lo, hi) {
    var d = dimArr(dims), sB = d[2] + 1, sA = (d[1] + 1) * sB;
    var a0 = lo[0] * sA, a1 = (hi[0] + 1) * sA, b0 = lo[1] * sB, b1 = (hi[1] + 1) * sB, c0 = lo[2], c1 = hi[2] + 1;
    return S[a1 + b1 + c1] - S[a0 + b1 + c1] - S[a1 + b0 + c1] - S[a1 + b1 + c0]
      + S[a0 + b0 + c1] + S[a0 + b1 + c0] + S[a1 + b0 + c0] - S[a0 + b0 + c0];
  }

  function kOf(x) { return x > 0 && isFinite(x) ? x : 0; }
  function upper(list, x) {   // number of entries <= x in a sorted list
    var lo = 0, hi = list.length, mid;
    while (lo < hi) { mid = (lo + hi) >> 1; if (list[mid] <= x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // One solve. k[j], j = 2 * axis + (0 low side, 1 high side) = index units per s of that side.
  function solve(S, dims, cen, k, sMax) {
    var out = { s: 0, resolution: 0, limitingAxis: null, limitingSide: null, viewLimited: false, sLo: 0, sHi: 0 };
    var sides = [], all = [], i, m, lo, hi, mid, x, eNew, eOld, pick = -1, cand = [];
    if (cen.some(function (v, q) { return !(v >= 0 && v < dims[q] && v === Math.floor(v)); })) { out.viewLimited = true; return out; }
    if (boxSum(S, dims, cen, cen) === 0) return out;   // centre cell is a miss
    for (i = 0; i < 6; i++) {
      sides.push({ room: (i & 1) ? dims[i >> 1] - 1 - cen[i >> 1] : cen[i >> 1], k: k[i], L: [] });
      for (m = 1; k[i] > 0 && m <= sides[i].room + 1 && m / k[i] <= sMax; m++) { sides[i].L.push(m / k[i]); all.push(m / k[i]); }
    }
    if (sMax > 0 && sMax < Infinity) all.push(sMax);   // the extents step just after the last m / k below sMax, so sMax itself is checked
    all.sort(function (p, q) { return p - q; });
    all = all.filter(function (v, q) { return q === 0 || v !== all[q - 1]; });

    // ceil(v * k) per side, from the exact breakpoint list: (# m / k < v) + 1; the (1 - 1e-12) keeps v = m / k from counting itself
    function ext(v) { return sides.map(function (sd) { return v > 0 && sd.k > 0 ? upper(sd.L, v * (1 - 1e-12)) + 1 : 0; }); }
    function status(e) {   // 0 clean, 1 a zero cell inside the view, 2 clean inside the view but the box left it
      var l = [0, 1, 2].map(function (q) { return cen[q] - Math.min(e[2 * q], sides[2 * q].room); });
      var h = [0, 1, 2].map(function (q) { return cen[q] + Math.min(e[2 * q + 1], sides[2 * q + 1].room); });
      var edge = e.some(function (v, q) { return v > sides[q].room; });
      var full = (h[0] - l[0] + 1) * (h[1] - l[1] + 1) * (h[2] - l[2] + 1);
      return boxSum(S, dims, l, h) < full ? 1 : (edge ? 2 : 0);
    }

    lo = -1; hi = all.length;   // largest clean breakpoint index in [-1, all.length)
    while (hi - lo > 1) { mid = (lo + hi) >> 1; if (status(ext(all[mid])) === 0) lo = mid; else hi = mid; }
    out.sLo = lo >= 0 ? all[lo] : 0;
    if (hi >= all.length) {   // clean all the way to sMax
      out.s = sMax;
      out.sHi = Math.min.apply(null, sides.map(function (sd) { return sd.k > 0 ? (sd.L.length + 1) / sd.k : Infinity; }));
      out.resolution = out.sHi - out.sLo;
      return out;
    }
    x = all[hi]; eNew = ext(x); eOld = ext(out.sLo);
    out.sHi = x; out.resolution = x - out.sLo; out.s = out.sLo;
    for (i = 0; i < 6; i++) if (eNew[i] > eOld[i]) cand.push(i);   // sides that step at x, lowest axis / low side first
    if (status(eNew) === 1) {   // a real zero cell: the margin is exact
      pick = cand.filter(function (q) { return eNew[q] <= sides[q].room; }).filter(function (q) {
        var e = eOld.slice(); e[q] = eNew[q];
        return status(e) === 1;
      })[0];
      if (pick === undefined) pick = cand.filter(function (q) { return eNew[q] <= sides[q].room; })[0];   // zero in a corner of several steps
    } else {   // the view ended first: lower bound
      pick = cand.filter(function (q) { return eNew[q] > sides[q].room; })[0];
      out.viewLimited = true;
    }
    out.limitingAxis = pick >> 1; out.limitingSide = (pick & 1) ? 1 : -1;
    return out;
  }

  function largestBox(q) {
    var dims = dimArr(q.dims), cen = [q.center[0], q.center[1], q.center[2]], neg = q.neg || [0, 0, 0], pos = q.pos || [0, 0, 0];
    var sMax = q.sMax > 0 ? q.sMax : (q.sMax === 0 ? 0 : Infinity), S = q.S || summedVolume(q.H, dims), k = [], i, r, pa = [];
    for (i = 0; i < 3; i++) k.push(kOf(neg[i]), kOf(pos[i]));
    r = solve(S, dims, cen, k, sMax);
    for (i = 0; i < 3; i++) pa.push(solve(S, dims, cen, k.map(function (v, j) { return (j >> 1) === i ? v : 0; }), sMax).s);
    r.perAxis = pa;
    return r;
  }

  return { largestBox: largestBox, summedVolume: summedVolume, boxSum: boxSum };
});
