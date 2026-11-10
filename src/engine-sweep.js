/*
 * BIOBUZZ Shot Sim - engine extension "sweep" (#2): RPM-vs-distance support.
 * E.sweepPoints(params, stepIn = 4) -> [{ d, x, y }]   mouth positions on the ray from the CELL mouth centroid through the current
 *   mouth (bearing kept), d = horizontal distance to the centroid in inches, from 10 in out to the farthest point inside the mouth clamp.
 * E.sweepRow(result, d) -> { d, verdict, hitRate, motorRpm: [lo, hi]|null, wheelRpm: [lo, hi]|null }   (null rpm = no window here)
 * The worker runs one full evaluate per point (src/worker.js 'sweep' / 'cancelSweep').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal;

  // largest d for which cen - d * dir stays inside |coord| <= L
  function reach(cc, dc, L) {
    if (dc > 1e-12) return (cc + L) / dc;
    if (dc < -1e-12) return (cc - L) / dc;
    return Infinity;
  }

  function sweepPoints(params, stepIn) {
    var step = typeof stepIn === 'number' && stepIn > 0 ? stepIn : 4, p = I.normParams(params), L = p.mouthLimit;
    var cen = I.mouthCentroid(p.target, p.hiveState[p.target]);
    var psi = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x), c = Math.cos(psi), s = Math.sin(psi);
    var dMax = Math.min(reach(cen[0], c, L), reach(cen[1], s, L)), pts = [], d;
    function add(dd) {
      pts.push({ d: dd, x: Math.max(-L, Math.min(L, cen[0] - dd * c)), y: Math.max(-L, Math.min(L, cen[1] - dd * s)) });
    }
    for (d = 10; d <= dMax + 1e-9; d += step) add(d);
    if (dMax >= 10 && dMax - pts[pts.length - 1].d > 0.5) add(dMax);   // the farthest clamped point
    return pts;
  }

  function sweepRow(result, d) {
    var h = result.hood, sw = h ? h.rpmWindow : (result.best && result.code !== 'TOO_SLOW' ? result.best.scoringWindow : null);
    return {
      d: d, verdict: result.verdict, hitRate: result.hitRate || 0,
      motorRpm: sw ? sw.motorRpm.slice() : null, wheelRpm: sw ? sw.wheelRpm.slice() : null
    };
  }

  E.sweepPoints = sweepPoints;
  E.sweepRow = sweepRow;
  I.register('sweep', { sweepPoints: sweepPoints, sweepRow: sweepRow });
  return { sweepPoints: sweepPoints, sweepRow: sweepRow };
});
