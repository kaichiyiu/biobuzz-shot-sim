/*
 * BIOBUZZ Shot Sim - engine extension "entry" (#12): entry-direction / entry-speed rule on the rect-hit grid.
 * The grid always holds the raw entry data (view.entry, Float32Array 2 N: [2i] angle deg, < 0 = descending, [2i+1] speed m/s, NaN
 * outside rect hits; see testTraj). The rule is applied on a COPY of the view, so the grid cache stays rule-independent (D8).
 *
 * EntryRule = { rule: 'any' | 'descending' | 'maxSpeed', maxSpeedMps?: number }   ('any' = legacy path, nothing is filtered)
 * norm(raw) -> EntryRule                      junk or an incomplete rule -> { rule: 'any' }
 * cellOk(view, i, rule) -> boolean            does cell i satisfy the rule (a cell without entry data fails a real rule)
 * filterView(view, rule) -> View              rule 'any' -> the SAME view object; else a shallow copy with a NEW rectHits (only the cells that
 *                                             pass) and `unfiltered` = the input view. Never mutates the input.
 * summary(before, after) -> { kept, dropped } rect-hit cell counts
 * result(view, sel, p, rule, coarse) -> res.entry   { rule, kept, dropped, best: { angleDeg, speedMps } | null, coarse: { kept, dropped } };
 *                                             best = entry data of the cell the scoring window is built on (the aim cell, else the nearest
 *                                             rect hit); `view` is the final view. kept / dropped: final view (fine in full mode) after vs
 *                                             before the rule - 0 dropped when the rule already moved the coarse aim. `coarse` (optional 5th
 *                                             arg, the possibly filtered coarse view; evaluate passes it): same counts on the coarse view,
 *                                             i.e. what the rule removed from the any-solution's grid. Omitted when no coarse view is passed.
 * UMD: Node module.exports = factory(require('./engine.js')); browser / worker factory(root.ShotEngine). Load after engine-sweep.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal;

  function norm(raw) {
    if (!raw || typeof raw !== 'object') return { rule: 'any' };
    if (raw.rule === 'descending') return { rule: 'descending' };
    if (raw.rule === 'maxSpeed' && typeof raw.maxSpeedMps === 'number' && isFinite(raw.maxSpeedMps) && raw.maxSpeedMps > 0) {
      return { rule: 'maxSpeed', maxSpeedMps: raw.maxSpeedMps };
    }
    return { rule: 'any' };
  }

  function cellOk(view, i, rule) {
    var r = norm(rule);
    if (r.rule === 'any') return true;
    var e = view.entry;
    if (!e) return false;
    if (r.rule === 'descending') return e[2 * i] < 0;   // NaN fails
    return e[2 * i + 1] <= r.maxSpeedMps;
  }

  function count(h) {
    var n = 0;
    for (var i = 0; i < h.length; i++) n += h[i];
    return n;
  }

  function filterView(view, rule) {
    var r = norm(rule);
    if (r.rule === 'any') return view;
    var H = view.rectHits, out = new Uint8Array(H.length);
    for (var i = 0; i < H.length; i++) if (H[i] && cellOk(view, i, r)) out[i] = 1;
    var f = Object.assign({}, view, { rectHits: out });
    f.unfiltered = view;
    return f;
  }

  function summary(before, after) {
    var kept = count(after.rectHits);
    return { kept: kept, dropped: count(before.rectHits) - kept };
  }

  function result(v, sel, p, rule, coarse) {
    var s = summary(v.unfiltered || v, v), best = null;
    if (sel && v.rectHits && v.entry) {
      var i = (sel.a * v.nB + sel.b) * v.nC + sel.c;
      if (!(sel.b <= sel.cellMaxB && v.rectHits[i] === 1)) {   // same fallback as the scoring window
        var W = I.ext('window'), pr = p && p.precision;
        var n = W && pr ? W.nearestRectHit(v, sel, { theta: pr.sigThetaDeg, ln: Math.max(1e-9, sel.sigV), yaw: pr.sigYawDeg }) : null;
        i = n ? (n.a * v.nB + n.b) * v.nC + n.c : -1;
      }
      if (i >= 0 && isFinite(v.entry[2 * i])) best = { angleDeg: v.entry[2 * i], speedMps: v.entry[2 * i + 1] };
    }
    var res = { rule: norm(rule), kept: s.kept, dropped: s.dropped, best: best };
    if (coarse && coarse.rectHits) res.coarse = summary(coarse.unfiltered || coarse, coarse);
    return res;
  }

  var impl = { norm: norm, cellOk: cellOk, filterView: filterView, summary: summary, result: result };
  I.register('entry', impl);
  return impl;
});
