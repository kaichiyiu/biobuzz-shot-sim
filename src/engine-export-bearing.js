/*
 * BIOBUZZ Shot Sim - engine extension "export bearing" (#4): the bearing range over which an export row still scores.
 * E.bearingRange(params, row, opts{stepDeg = 2, maxDeg = 45}) -> { lo, hi } | null      degrees relative to the row's own bearing (lo <= 0 <= hi)
 *   The mouth is rotated about the target CELL mouth centroid at constant horizontal distance rho = row.dMouthIn. For each bearing offset b the shot
 *   keeps the row's launch angle and centre exit speed and is re-aimed: yaw = heading(new mouth -> centroid) + row.yawOffsetDeg. It scores when the
 *   mouth is inside the mouth limit (a clamped position ends the range) and classifyShot(...).rectHit (D10, same rectangle test as the windows).
 *   Per side: b = step, 2 step, ... <= maxDeg until the first failure, then bisection down to 0.5 deg; the result is the last bearing that passed.
 *   null when the row is unreachable or the row's own bearing (b = 0) does not pass. Assumes the passing bearings are contiguous.
 * Load after engine-export.js (not required by it). Maths: process_docs/issue-4/design.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal, RAD = Math.PI / 180, RES = 0.5;

  function bearingRange(params, row, opts) {
    if (!row || !row.reachable || row.launchDeg == null || !row.exitSpeedMps || !(row.dMouthIn > 0)) return null;
    opts = opts || {};
    var step = opts.stepDeg > 0 ? opts.stepDeg : 2, maxDeg = opts.maxDeg > 0 ? opts.maxDeg : 45;
    var p = I.normParams(params), L = p.mouthLimit, rho = row.dMouthIn, v = row.exitSpeedMps.c;
    var cen = I.mouthCentroid(p.target, p.hiveState[p.target]);
    var psi = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x);   // heading mouth -> centroid; the sweep ray keeps it

    function passes(b) {
      var a = psi + b * RAD, x = cen[0] - rho * Math.cos(a), y = cen[1] - rho * Math.sin(a);
      if (Math.abs(x) > L || Math.abs(y) > L) return false;   // clamped: stop here
      var at = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: x, y: y }) });
      return E.classifyShot(at, row.launchDeg, v, a / RAD + row.yawOffsetDeg).rectHit === true;
    }

    function side(sign) {
      var good = 0, b = 0, lo, hi, mid;
      while (good < maxDeg) {
        b = Math.min(good + step, maxDeg);
        if (!passes(sign * b)) break;
        good = b;
      }
      if (good >= maxDeg) return maxDeg;
      lo = good; hi = b;
      while (hi - lo > RES + 1e-9) {
        mid = (lo + hi) / 2;
        if (passes(sign * mid)) lo = mid; else hi = mid;
      }
      return lo;
    }

    if (!passes(0)) return null;
    var neg = side(-1), pos = side(1);
    return { lo: neg ? -neg : 0, hi: pos };
  }

  E.bearingRange = bearingRange;
  I.register('exportBearing', { bearingRange: bearingRange });
  return { bearingRange: bearingRange };
});
