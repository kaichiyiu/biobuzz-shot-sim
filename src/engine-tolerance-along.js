/*
 * BIOBUZZ Shot Sim - engine extension "tolerance along" (#8): how far along the shooting line the mouth can move and still score.
 * E.alongRange(params, setpoint{ thetaDeg, v, yawOffsetDeg }, opts{ maxIn = 24, tolIn = 0.25, stepIn = 1 }) ->
 *   { minusIn, plusIn, minusEnd, plusEnd, limited }   inches >= 0; minus = towards the target, plus = away from it.
 *   Same ray as sweepPoints: from the target CELL mouth centroid through the current mouth (heading mouth -> centroid kept).
 *   The mouth is moved by D inches along it; the shot keeps thetaDeg and v (centre exit speed, m/s) and is re-aimed: yaw = heading +
 *   yawOffsetDeg. It scores when the mouth is inside the mouth limit and E.classifyShot(...).rectHit (D10, the windows' own rectangle test).
 *   Per side: steps of stepIn out to the first failure, then bisection to tolIn; the result is the last passing offset (the true edge lies
 *   in [result, result + tolIn]). Passing offsets are assumed contiguous. A real params.entry rule ('descending' / 'maxSpeed') is applied to
 *   every probe as well (same semantics as engine-entry cellOk), so the range is a subset of the 'any' range. Setpoint not scoring at D = 0 -> { 0, 0 }.
 *   minusEnd / plusEnd: 'fail' (a real edge), 'mouth' (stopped at the mouth limit or at the centroid), 'cap' (stopped at maxIn);
 *   limited = either end is not 'fail' (that side is only a lower bound).
 * Load after engine.js. Maths: process_docs/issue-7/design.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var I = E._internal, RAD = Math.PI / 180;

  function reach(cc, dc, L) {   // largest d for which cen - d * dir stays inside |coord| <= L
    if (dc > 1e-12) return (cc + L) / dc;
    if (dc < -1e-12) return (cc - L) / dc;
    return Infinity;
  }

  function alongRange(params, setpoint, opts) {
    var none = { minusIn: 0, plusIn: 0, minusEnd: 'fail', plusEnd: 'fail', limited: false };
    if (!setpoint || !(setpoint.v > 0) || typeof setpoint.thetaDeg !== 'number') return none;
    opts = opts || {};
    var maxIn = opts.maxIn > 0 ? opts.maxIn : 24, tolIn = opts.tolIn > 0 ? opts.tolIn : 0.25, step = opts.stepIn > 0 ? opts.stepIn : 1;
    var p = I.normParams(params), L = p.mouthLimit, off = setpoint.yawOffsetDeg || 0;
    var EN = I.ext('entry'), rule = EN ? EN.norm(params.entry) : { rule: 'any' };   // entry rule (D8): the probe must pass it too
    var cen = I.mouthCentroid(p.target, p.hiveState[p.target]);
    var psi = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x), c = Math.cos(psi), s = Math.sin(psi);
    var d0 = Math.hypot(cen[0] - p.launch.x, cen[1] - p.launch.y), yaw = psi / RAD + off;
    var plusGeo = Math.max(0, Math.min(reach(cen[0], c, L), reach(cen[1], s, L)) - d0);   // mouth limit on the far side

    function passes(D) {
      var x = cen[0] - (d0 + D) * c, y = cen[1] - (d0 + D) * s;
      if (Math.abs(x) > L + 1e-9 || Math.abs(y) > L + 1e-9) return false;
      var at = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: x, y: y }) });
      var c = E.classifyShot(at, setpoint.thetaDeg, setpoint.v, yaw);
      if (c.rectHit !== true) return false;
      if (rule.rule === 'descending') return c.entryAngleDeg < 0;   // same semantics as engine-entry cellOk (NaN fails)
      if (rule.rule === 'maxSpeed') return c.entrySpeed <= rule.maxSpeedMps;
      return true;
    }

    function side(sign, geo) {   // geo = distance to the geometric limit on this side
      var maxD = Math.min(maxIn, geo), good = 0, bad = -1, b, mid;
      while (good < maxD) {
        b = Math.min(good + step, maxD);
        if (!passes(sign * b)) { bad = b; break; }
        good = b;
      }
      if (bad < 0) return { d: good, end: geo <= maxIn ? 'mouth' : 'cap' };
      while (bad - good > tolIn + 1e-9) {
        mid = (good + bad) / 2;
        if (passes(sign * mid)) good = mid; else bad = mid;
      }
      return { d: good, end: 'fail' };
    }

    if (!passes(0)) return none;
    var m = side(-1, d0), q = side(1, plusGeo);
    return { minusIn: m.d, plusIn: q.d, minusEnd: m.end, plusEnd: q.end, limited: m.end !== 'fail' || q.end !== 'fail' };
  }

  E.alongRange = alongRange;
  I.register('toleranceAlong', { alongRange: alongRange });
  return { alongRange: alongRange };
});
