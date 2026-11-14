/* BIOBUZZ Shot Sim - Show the derivation (#6, O5): the burst section. Browser: window.DeriveBurst. Node: module.exports.
   burst(r, p, ctx) -> Section | null   null = no burst in the margin (r.tolerance.bias absent). Section shape and ctx: see derive-window.js.
   Method read from engine-burst.js (fractions: each shot keeps 1 - dip of the wheel speed, then recovers for the interval; open loop or PID law), engine-tolerance.js (biasOf, result) and engine-tolerance-burst.js
   (erodeLow, pick): the largest per-shot deficit is a FIXED offset D = -ln(1 - d) in ln v (not scaled by s); B = ceil(D / lnStep) cells; a cell stays a scoring cell only if it and the B cells below it score;
   the burst-aware setpoint is the speed cell of the eroded grid with the largest margin (angle and yaw kept, the search runs along the speed axis only). Dual wheels: the dip is the exit-speed dip
   (d_B + k d_T) / (1 + k) of r.motor.dipExit (issue M2). Numbers: r.tolerance.bias / burstSetpoint / grid, r.motor. */
(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module === 'object' ? require('./derive-tex.js') : root.DeriveTex);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveBurst = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  var n = D.n, fin = D.fin;
  var row = function (what, tex, num, res) { return { what: what, tex: tex, num: num, res: res }; };

  function burst(r, p, ctx) {
    var t = r && r.tolerance, bs = t && t.bias, m = r && r.motor, d = m && m.details;
    if (!bs || !m || !d || !t.grid) return null;
    var rows = [], notes = [], dual = d.type === 'dual' && fin(m.dipExit), dm = Math.max.apply(null, bs.perShotPct.concat([0])) / 100, big = Math.min(bs.speedPct, 99.9) / 100;
    var Dl = bs.speedPct > 0 ? -Math.log(1 - big) : 0, ls = t.grid.lnStep, ratio = Dl / ls, rs = n(ratio, 4);
    if (Math.ceil(parseFloat(rs)) !== bs.cells) rs = n(ratio, 8);
    var dip = dual ? m.dipExit : m.dip, e = Math.exp(-bs.intervalS / m.tauS);
    if (dual) rows.push(row('Dip per shot (both wheels)', 'd_x = \\frac{d_B + k\\,d_T}{1 + k}', '\\frac{' + n(100 * m.dip, 2) + ' + ' + n(d.topRatio, 2) + '\\cdot ' + n(100 * m.dipTop, 2) + '}{1 + ' + n(d.topRatio, 2) + '}\\,\\%', n(100 * dip, 2) + ' % (bottom wheel ' + n(100 * m.dip, 2) + ' %, top wheel ' + n(100 * m.dipTop, 2) + ' %)'));
    else rows.push(row('Dip per shot', '\\text{dip} = 1 - \\frac{\\omega_1}{\\omega_0}', '1 - \\frac{' + n(d.w1, 2) + '}{' + n(d.w0, 2) + '}', n(100 * dip, 2) + ' %'));
    rows.push(row('Recovery between shots', bs.control === 'pid' ? 'x_{k+1} = \\min\\left(1,\\ r - (r - a_k)\\,e^{-\\Delta t/\\tau}\\right)' : 'x_{k+1} = 1 - (1 - a_k)\\,e^{-\\Delta t/\\tau}', 'a_k = x_k\\,(1 - ' + n(dip, 4) + '),\\ \\ e^{-' + n(bs.intervalS, 2) + '/' + n(m.tauS, 2) + '} = ' + n(e, 4),
      (bs.control === 'pid' ? 'PID' : 'open loop (fixed power)') + ', ' + bs.shots + ' shots every ' + n(bs.intervalS, 2) + ' s'));
    rows.push(row('Speed deficit before each shot', 'd_k = 1 - x_k', bs.perShotPct.map(function (x) { return n(x, 2); }).join(',\\ ') + '\\,\\%', 'x = wheel speed before the shot / setpoint speed; shot 1 is at the setpoint'));
    rows.push(row('Fixed offset', 'D = -\\ln(1 - d_{max})', '-\\ln(1 - ' + n(dm, 4) + ') = ' + n(Dl, 4), n(100 * (1 - Math.exp(-Dl)), 2) + ' % of speed, not scaled by s'));
    rows.push(row('Cells of erosion', 'B = \\left\\lceil \\frac{D}{\\Delta\\ln v}\\right\\rceil', '\\left\\lceil\\frac{' + n(Dl, 4) + '}{' + n(ls, 3) + '}\\right\\rceil = \\lceil ' + rs + '\\rceil = ' + bs.cells, bs.cells + ' cells on the low-speed side'));
    if (bs.cells > 0) rows.push(row('Eroded grid', 'H_B(b) = H(b)\\cdot H(b-1)\\cdots H(b-B)', '\\text{a cell scores only if it and the } ' + bs.cells + '\\text{ cells below it (slower) score}', 'every shot of the burst, up to ' + bs.cells + ' cells slower, then still scores'));
    var sp = t.burstSetpoint;
    if (bs.cells > 0 && sp) rows.push(row('Burst-aware setpoint', 'b^{*}:\\ \\max_b\\ \\min(\\text{box}_b,\\ s_{along,b},\\ 4)', 'n_1 = ' + n(sp.motorRpm, 1) + '\\,\\text{rpm}\\ (\\text{engine setpoint } ' + n(t.setpoint.motorRpm, 1) + ')',
      '+' + n(sp.shiftPct, 2) + ' % (' + sp.cells + ' cells), first-shot speed ' + D.spd(sp.exitSpeedMps, null, 3, ctx && ctx.units) + ', angle ' + n(sp.thetaDeg, 2) + '° and yaw ' + n(sp.yawDeg, 2) + '° kept'));
    if (bs.fits === false) notes.push('No speed cell keeps the whole burst inside the window at this angle and yaw: the margin is 0.');
    if (sp) notes.push('The first shot is set higher so that the later, slower shots stay inside the window; the margin above refers to this setpoint. The search runs along the speed axis only, with the angle and yaw of the setpoint kept; ties go to the cell closest to the middle of the burst\'s speed span.');
    notes.push('The deficit is a fixed offset, not a tolerance: it is applied in full at every scale s. Each shot loses its share of the wheel energy (energy ∝ speed²) and recovers for the interval by the motor model.');
    if (dual) notes.push('Dual wheels: the next ball leaves at the sum of the two surface speeds, so the burst follows the exit-speed dip, the weighted mean of the two wheels\' dips.');
    return { id: 'burst', title: 'Burst', lead: 'A burst fires ' + bs.shots + ' balls in a row. After each ball the flywheel has lost speed and has only the interval to recover, so later balls leave slower. The largest of these deficits is carried into the margin as a shift of the speed window.', rows: rows, notes: notes };
  }

  return { burst: burst };
});
