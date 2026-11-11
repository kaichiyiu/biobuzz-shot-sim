/* BIOBUZZ Shot Sim - #11 optional video step: launch angle (and speed) from two ball positions in the shot plane.
   p1, p2: { x, y [, frame] } in metres, y up, x along the shot (a mirrored video is fine: only |dx| is used). p1 is the earlier one.
   fps (frames per second) with p.frame on both points (default: consecutive frames, gap 1) gives the speed |p2 - p1| / dt.
   launchDeg = atan2(dy, |dx|), the direction of the chord, i.e. of the velocity half-way between the two frames. Gravity bends the path, so
   the chord is below the release direction by ~ g dt / (2 v cos theta): reported as gravityBiasDeg (null without fps / speed), NOT applied;
   pick frames right after release. offsetDeg = launchDeg - hoodDeg.
   Browser: window.CalibVideo. Node: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalibVideo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var G = 9.80665, DEG = Math.PI / 180;

  function angleOffset(p1, p2, hoodDeg, fps) {
    var none = { launchDeg: null, offsetDeg: null, speedMps: null, gravityBiasDeg: null };
    if (!p1 || !p2 || ![p1.x, p1.y, p2.x, p2.y].every(isFinite)) return Object.assign(none, { error: 'Both positions need numeric x and y.' });
    var dx = Math.abs(p2.x - p1.x), dy = p2.y - p1.y, dist = Math.hypot(dx, dy);
    if (!(dist > 0)) return Object.assign(none, { error: 'The two positions are identical.' });
    var launch = Math.atan2(dy, dx) / DEG, speed = null, bias = null;
    if (fps > 0 && isFinite(fps)) {
      var gap = isFinite(p1.frame) && isFinite(p2.frame) ? Math.abs(p2.frame - p1.frame) : 1;
      if (gap > 0) {
        var dt = gap / fps; speed = dist / dt;
        bias = (Math.atan2(dy / dt + G * dt / 2, dx / dt) - Math.atan2(dy / dt, dx / dt)) / DEG;
      }
    }
    return { launchDeg: launch, offsetDeg: isFinite(hoodDeg) ? launch - hoodDeg : null, speedMps: speed, gravityBiasDeg: bias };
  }

  return { angleOffset: angleOffset };
});
