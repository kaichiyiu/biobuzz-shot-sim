/* BIOBUZZ Shot Sim - Show the derivation (#6, O3): the hood section. Browser: window.DeriveHood. Node: module.exports.
   hood(r, p, ctx) -> Section | null   null = no hood result or no scoring window. Fixed hood: states the angle, skips the search rows.
   Method read from engine-hood-core.js (widestWindows, pickOptimalAngle, setpointOf) and engine-hood.js (result, sensitivity): per angle the widest run of scoring speeds over all yaws; angles within one
   speed step of the widest tie; the angle is the middle of the tie range (on the lattice, toward the widest one); the setpoint is the middle of the run (rpm is proportional to v, so it is the middle in rpm too).
   Numbers: r.hood (angleDeg, rangeDeg, range, atLimit, preview, rpmWindow, sensitivity). Section shape and ctx: see derive-window.js. */
(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module === 'object' ? require('./derive-tex.js') : root.DeriveTex);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveHood = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  var n = D.n, fin = D.fin;
  var row = function (what, tex, num, res) { return { what: what, tex: tex, num: num, res: res }; };

  function hood(r, p, ctx) {
    var h = r && r.hood, rw = h && h.rpmWindow;
    if (!h || !rw || !r.best) return null;
    var adj = h.mode === 'adjustable', U = ctx && ctx.units, rows = [], notes = [], th = r.tolerance && r.tolerance.grid ? r.tolerance.grid.thStep : (h.preview ? 1 : 0.25);
    var wv = rw.vExit[1] - rw.vExit[0], lead;
    if (adj) {
      rows.push(row('Hood range searched', '\\theta \\in [\\theta_{min},\\ \\theta_{max}]', '[' + n(h.range[0], 1) + ',\\ ' + n(h.range[1], 1) + ']^\\circ', 'every ' + n(th, 2) + '° step'));
      rows.push(row('Speed window at an angle', 'w(\\theta) = \\max_{\\psi}\\,(v_{hi} - v_{lo})', 'w = ' + n(rw.vExit[1], 3) + ' - ' + n(rw.vExit[0], 3) + ' = ' + n(wv, 3) + '\\,\\text{m/s}',
        'widest run of scoring speeds over all yaws; ' + n(rw.widthPct, 2) + ' % at the chosen angle'));
      rows.push(row('Widest angles (tie)', 'w(\\theta) \\ge w_{max} - \\Delta v', h.rangeDeg ? '[' + n(h.rangeDeg[0], 2) + ',\\ ' + n(h.rangeDeg[1], 2) + ']^\\circ' : '\\theta = ' + n(h.angleDeg, 2) + '^\\circ',
        h.rangeDeg ? 'angles within one speed step of the widest window' : 'one angle has the widest window'));
      rows.push(row('Chosen angle', '\\theta^{*} = \\frac{\\theta_{lo} + \\theta_{hi}}{2}', h.rangeDeg ? '\\frac{' + n(h.rangeDeg[0], 2) + ' + ' + n(h.rangeDeg[1], 2) + '}{2} = ' + n((h.rangeDeg[0] + h.rangeDeg[1]) / 2, 3) : n(h.angleDeg, 2),
        n(h.angleDeg, 2) + '° (on the ' + n(th, 2) + '° lattice, toward the widest angle)'));
      lead = 'With an adjustable hood the engine looks at every angle in the range, finds at each the widest run of scoring speeds over all yaws, and takes the middle of the angles that tie for the widest.';
    } else {
      rows.push(row('Launch angle', '\\theta = \\theta_{hood}', n(h.angleDeg, 2) + '^\\circ', 'fixed by you, no angle search'));
      lead = 'With a fixed hood the launch angle is the hood angle; the window is read at that angle.';
    }
    rows.push(row('Setpoint rpm', 'n^{*} = \\frac{n_{lo} + n_{hi}}{2}', '\\frac{' + n(rw.motorRpm[0], 1) + ' + ' + n(rw.motorRpm[1], 1) + '}{2}', n(rw.centerMotorRpm, 1) + ' rpm (speed ' + D.spd((rw.vExit[0] + rw.vExit[1]) / 2, null, 3, U) + ')'));
    (h.sensitivity || []).filter(function (s) { return Math.abs(s.deltaDeg) === 1; }).forEach(function (s) {
      rows.push(row('Hood ' + n(Math.abs(s.deltaDeg), 1) + '° ' + (s.deltaDeg < 0 ? 'low' : 'high'), '\\frac{w(\\theta + \\delta)}{w(\\theta)},\\ \\Delta n_c',
        s.rpmWindow ? n(s.widthRatio, 3) + ',\\ ' + n(s.centerShiftRpm, 1) + '\\,\\text{rpm}' : '\\text{no window}', s.rpmWindow ? 'window ×' + n(s.widthRatio, 3) + ', centre ' + n(s.centerShiftRpm, 1) + ' rpm' + (s.nominalStillScores ? '; the setpoint still scores' : '; the setpoint no longer scores') : 'no scoring window at this angle'));
    });
    if (adj && h.atLimit) notes.push('The chosen angle is at the ' + (h.atLimit === 'min' ? 'lower' : 'upper') + ' end of the hood range; a wider range could change the pick.');
    if (rw.clippedByMotor) notes.push('The top of the speed window is the motor limit.');
    if (adj) notes.push('The pick maximises the width of the speed window; it does not look at the tolerance margin, so the angle with the largest margin can differ. The setpoint is the middle of the run found at the plateau of yaw angles.');
    if (h.preview) notes.push('Preview: the coarse grid (1° angle steps) gives a rough tie range; the full result refines it.');
    return { id: 'hood', title: 'Hood angle and setpoint', lead: lead, rows: rows, notes: notes };
  }

  return { hood: hood };
});
