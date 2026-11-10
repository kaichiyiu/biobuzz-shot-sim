/*
 * BIOBUZZ Shot Sim - hood core (#2): pure scans of a boolean window grid H[a, b, c] (angle, speed, yaw index).
 * No engine internals, no kernels, no precision scatter: the optimum is deterministic (design D1).
 * UMD: Node module.exports / browser + worker root.ShotHoodCore. Works standalone on synthetic grids.
 *
 * AngleWindow = { a, width, bLo, bHi, c, cLo, cHi }  width = widest run over all yaws (speeds[bHi]-speeds[bLo] at the
 *   argmax yaw, m/s, proportional to rpm); c = middle of the yaw plateau (cLo..cHi, widths within one speed step of the
 *   max); bLo..bHi = the run at c (can be one step narrower than width). No run at all: width 0, bLo = bHi = -1.
 * OptimalAngle = { a, aLo, aHi, width, others: [[lo, hi], ...], edgeAtSpan }  (indices into the list's angle axis)
 * Setpoint = { a, b, c }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShotHoodCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // speed step at speed index b (distance to the next grid speed; the previous one at the top)
  function stepAt(speeds, b) {
    return b + 1 < speeds.length ? speeds[b + 1] - speeds[b] : speeds[b] - speeds[Math.max(0, b - 1)];
  }

  // widest run of 1s along b (0..top) at (a, c) by speed width; ties -> the lower run
  function longestRun(H, dims, speeds, a, c, top) {
    var nB = dims.nB, nC = dims.nC, best = null, lo = -1;
    for (var b = 0; b <= top + 1; b++) {
      var on = b <= top && H[(a * nB + b) * nC + c] === 1;
      if (on && lo < 0) lo = b;
      if (!on && lo >= 0) {
        var w = speeds[b - 1] - speeds[lo];
        if (!best || w > best.width) best = { bLo: lo, bHi: b - 1, width: w };
        lo = -1;
      }
    }
    return best;
  }

  // run at (a, c) that contains bNear, else the run nearest to it (ties -> lower speed); null when the column has no run
  function runAt(H, dims, a, c, bNear, cellMaxB) {
    if (a < 0 || a >= dims.nA || c < 0 || c >= dims.nC) return null;
    var nB = dims.nB, top = Math.min(cellMaxB, nB - 1), best = null, bd = Infinity, lo = -1;
    for (var b = 0; b <= top + 1; b++) {
      var on = b <= top && H[(a * nB + b) * dims.nC + c] === 1;
      if (on && lo < 0) lo = b;
      if (!on && lo >= 0) {
        var hi = b - 1, d = bNear < lo ? lo - bNear : (bNear > hi ? bNear - hi : 0);
        if (d < bd) { bd = d; best = { bLo: lo, bHi: hi }; }
        lo = -1;
      }
    }
    return best;
  }

  // widest window per angle index a in [aLo, aHi] (clipped to the grid), capped at speed index cellMaxB
  function widestWindows(H, dims, speeds, cellMaxB, aLo, aHi) {
    var top = Math.min(cellMaxB, dims.nB - 1), out = [], nC = dims.nC;
    for (var a = Math.max(0, aLo); a <= Math.min(dims.nA - 1, aHi); a++) {
      var runs = [], wmax = 0, cm = -1, c;
      for (c = 0; c < nC; c++) {
        var r = longestRun(H, dims, speeds, a, c, top);
        runs.push(r);
        if (r && (cm < 0 || r.width > wmax)) { wmax = r.width; cm = c; }
      }
      if (cm < 0) { out.push({ a: a, width: 0, bLo: -1, bHi: -1, c: -1, cLo: -1, cHi: -1 }); continue; }
      var tol = stepAt(speeds, runs[cm].bHi), cLo = cm, cHi = cm;
      while (cLo > 0 && runs[cLo - 1] && runs[cLo - 1].width >= wmax - tol - 1e-12) cLo--;
      while (cHi < nC - 1 && runs[cHi + 1] && runs[cHi + 1].width >= wmax - tol - 1e-12) cHi++;
      var cMid = (cLo + cHi) >> 1;
      out.push({ a: a, width: wmax, bLo: runs[cMid].bLo, bHi: runs[cMid].bHi, c: cMid, cLo: cLo, cHi: cHi });
    }
    return out;
  }

  // angle(s) with the widest window; tolOf(aw) = one speed step at that window. null when no angle has a window
  function pickOptimalAngle(list, tolOf) {
    var m = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].bLo >= 0 && (m < 0 || list[i].width > list[m].width)) m = i;
    if (m < 0) return null;
    var floor = list[m].width - tolOf(list[m]) - 1e-12, runs = [];
    function tied(k) { return list[k].bLo >= 0 && list[k].width >= floor; }
    for (i = 0; i < list.length; ) {
      if (!tied(i)) { i++; continue; }
      var j = i;
      while (j + 1 < list.length && tied(j + 1) && list[j + 1].a === list[j].a + 1) j++;
      runs.push([i, j]); i = j + 1;
    }
    var rec = null, others = [];
    runs.forEach(function (r) { if (m >= r[0] && m <= r[1]) rec = r; else others.push([list[r[0]].a, list[r[1]].a]); });
    var lo = list[rec[0]].a, hi = list[rec[1]].a, mid = (lo + hi) / 2, am = list[m].a;
    return {
      a: Number.isInteger(mid) ? mid : (am >= mid ? Math.ceil(mid) : Math.floor(mid)),
      aLo: lo, aHi: hi, width: list[m].width, others: others,
      edgeAtSpan: rec[0] === 0 || rec[1] === list.length - 1
    };
  }

  // speed index nearest the middle of the window (rpm is proportional to speed, so the rpm midpoint too)
  function setpointOf(aw, speeds) {
    var mid = (speeds[aw.bLo] + speeds[aw.bHi]) / 2, b = aw.bLo;
    for (var i = aw.bLo; i <= aw.bHi; i++) if (Math.abs(speeds[i] - mid) < Math.abs(speeds[b] - mid) - 1e-12) b = i;
    return { a: aw.a, b: b, c: aw.c };
  }

  // yaw run at (a, b) containing cNear, else the nearest run; null when the row is empty or the speed is above the cap
  function yawRunAt(H, dims, a, b, cNear, cellMaxB) {
    if (b > cellMaxB || b < 0 || b >= dims.nB) return null;
    var base = (a * dims.nB + b) * dims.nC, best = null, bd = Infinity, lo = -1;
    for (var c = 0; c <= dims.nC; c++) {
      var on = c < dims.nC && H[base + c] === 1;
      if (on && lo < 0) lo = c;
      if (!on && lo >= 0) {
        var d = cNear < lo ? lo - cNear : (cNear > c - 1 ? cNear - c + 1 : 0);
        if (d < bd) { bd = d; best = { cLo: lo, cHi: c - 1 }; }
        lo = -1;
      }
    }
    return best;
  }

  // D15 advised aim: centre speed and yaw together at the fixed angle a. Repeat { speed <- middle of the speed run at the
  // current yaw; yaw <- middle of the yaw run at the current speed } until stable (<= 10 rounds); a 2-cycle keeps its first point.
  function centreAim(H, dims, speeds, set, cellMaxB) {
    var cur = { a: set.a, b: set.b, c: set.c }, seen = [cur];
    for (var round = 0; round < 10; round++) {
      var rb = runAt(H, dims, cur.a, cur.c, cur.b, cellMaxB);
      if (!rb) return cur;
      var b = setpointOf({ a: cur.a, bLo: rb.bLo, bHi: rb.bHi, c: cur.c }, speeds).b;
      var rc = yawRunAt(H, dims, cur.a, b, cur.c, cellMaxB);
      var nxt = { a: cur.a, b: b, c: rc ? (rc.cLo + rc.cHi) >> 1 : cur.c };
      for (var i = 0; i < seen.length; i++) if (seen[i].b === nxt.b && seen[i].c === nxt.c) return i === seen.length - 1 ? nxt : seen[i];
      seen.push(nxt); cur = nxt;
    }
    return cur;
  }

  // window at (a + dIdx, c) nearest the nominal speed, relative to the nominal window at (a, c)
  function sensitivity(H, dims, speeds, set, deltasIdx, cellMaxB) {
    var nom = runAt(H, dims, set.a, set.c, set.b, cellMaxB);
    var wNom = nom ? speeds[nom.bHi] - speeds[nom.bLo] : 0, nB = dims.nB, nC = dims.nC;
    return deltasIdx.map(function (d) {
      var a2 = set.a + d, r = runAt(H, dims, a2, set.c, set.b, cellMaxB);
      var w = r ? speeds[r.bHi] - speeds[r.bLo] : 0;
      return {
        dIdx: d, bLo: r ? r.bLo : -1, bHi: r ? r.bHi : -1,
        widthRatio: wNom > 0 ? w / wNom : (r ? 1 : 0),
        centerShiftIdx: r && nom ? (r.bLo + r.bHi) / 2 - (nom.bLo + nom.bHi) / 2 : null,
        nominalStillScores: a2 >= 0 && a2 < dims.nA && set.b <= cellMaxB && H[(a2 * nB + set.b) * nC + set.c] === 1
      };
    });
  }

  return { widestWindows: widestWindows, pickOptimalAngle: pickOptimalAngle, setpointOf: setpointOf, runAt: runAt, yawRunAt: yawRunAt, centreAim: centreAim,
    sensitivity: sensitivity, stepAt: stepAt };
});
