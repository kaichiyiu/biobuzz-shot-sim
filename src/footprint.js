/* BIOBUZZ Shot Sim - #15 robot-footprint feasibility of a shooter-mouth position. Browser: window.ShotFootprint. Node: module.exports.
   feasible(mouth{x,y}, headingDeg, robot{lengthIn,widthIn,mouthForwardIn}, field) -> {ok, reason:''|'wall'|'hive'}
   defaults() -> {lengthIn:18, widthIn:18, mouthForwardIn:0}
   Engine frame: inches, origin field centre, +x toward blue, heading in degrees CCW from +x. The robot is a rectangle (length along the
   heading) whose centre is mouthForwardIn behind the mouth. field = data/field.json content.
   HIVE parts that block a robot on the floor: the foot bars (capsules of footBars.radius) and the leg bases (circles of frame.tubeRadius at z=0).
   Legs lean inward above the floor, crossbar/corner blocks/arm/CELLs/logo panels are above z=30 in: ignored. Design: process_docs/issue-15/design.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShotFootprint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function defaults() { return { lengthIn: 18, widthIn: 18, mouthForwardIn: 0 }; }

  // distance from point (px,py) to the box [-hx,hx]x[-hy,hy]
  function ptBox(px, py, hx, hy) {
    var dx = Math.max(Math.abs(px) - hx, 0), dy = Math.max(Math.abs(py) - hy, 0);
    return Math.hypot(dx, dy);
  }
  function ptSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // does segment a-b touch the box? (Liang-Barsky)
  function segHitsBox(ax, ay, bx, by, hx, hy) {
    var t0 = 0, t1 = 1, d = [bx - ax, by - ay], p = [ax, ay], h = [hx, hy];
    for (var i = 0; i < 2; i++) {
      if (d[i] === 0) { if (Math.abs(p[i]) > h[i]) return false; continue; }
      var ta = (-h[i] - p[i]) / d[i], tb = (h[i] - p[i]) / d[i];
      if (ta > tb) { var s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return true;
  }
  // exact distance from segment a-b to the box [-hx,hx]x[-hy,hy] (0 when they touch)
  function segBox(ax, ay, bx, by, hx, hy) {
    if (segHitsBox(ax, ay, bx, by, hx, hy)) return 0;
    var d = Math.min(ptBox(ax, ay, hx, hy), ptBox(bx, by, hx, hy));
    var cs = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
    for (var i = 0; i < 4; i++) d = Math.min(d, ptSeg(cs[i][0], cs[i][1], ax, ay, bx, by));
    return d;
  }

  function feasible(mouth, headingDeg, robot, field) {
    var r = robot || defaults();
    var L = r.lengthIn, W = r.widthIn, mf = r.mouthForwardIn || 0;
    var th = headingDeg * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
    var cx = mouth.x - mf * ux, cy = mouth.y - mf * uy;
    var hl = L / 2, hw = W / 2, half = field.field.half;
    var sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (var i = 0; i < 4; i++) {
      var a = sg[i][0] * hl, b = sg[i][1] * hw;
      var x = cx + a * ux - b * uy, y = cy + a * uy + b * ux;
      if (Math.abs(x) > half + 1e-9 || Math.abs(y) > half + 1e-9) return { ok: false, reason: 'wall' };
    }
    function loc(px, py) { var dx = px - cx, dy = py - cy; return [dx * ux + dy * uy, -dx * uy + dy * ux]; }
    var fr = field.hive.frame, hit = false;
    // leg bases: circle of tubeRadius at the z = 0 end of each leg
    fr.legs.forEach(function (leg) {
      var base = leg[0][2] <= leg[1][2] ? leg[0] : leg[1], p = loc(base[0], base[1]);
      if (ptBox(p[0], p[1], hl, hw) <= fr.tubeRadius) hit = true;
    });
    // foot bars: capsules of their radius
    if (fr.footBars) fr.footBars.segments.forEach(function (s) {
      var p = loc(s[0][0], s[0][1]), q = loc(s[1][0], s[1][1]);
      if (segBox(p[0], p[1], q[0], q[1], hl, hw) <= fr.footBars.radius) hit = true;
    });
    return hit ? { ok: false, reason: 'hive' } : { ok: true, reason: '' };
  }

  return { feasible: feasible, defaults: defaults, _segBox: segBox };
});
