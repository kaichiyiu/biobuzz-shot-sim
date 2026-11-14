/* BIOBUZZ Shot Sim - Show the derivation (#6, O4): the margin section (box, along range, lateral equivalence). Browser: window.DeriveMargin. Node: module.exports.
   margin(r, p, ctx) -> Section | null   null = no tolerance entered (p.tolerance) or no tolerance result. Section shape and ctx: see derive-window.js.
   Method read from engine-tolerance.js (rates, result, alongOf) and engine-tolerance-core.js (largestBox): the tolerances become index units per s = 1 on the grid (angle / thStep, yaw / yawStep with the position
   as yaw equivalent, speed -ln(1 - t/n) / lnStep and ln(1 + t/n) / lnStep); the box at scale s covers [c - ceil(s k-), c + ceil(s k+)] on each axis; s = s_lo, the guaranteed end (resolution = s_hi - s_lo);
   along = move the mouth along the shooting line at fixed theta and v (steps of 1 in, then bisection to 0.25 in); margin = min(box, along), capped at 4. Numbers: r.tolerance (incl. grid, O0). */
(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module === 'object' ? require('./derive-tex.js') : root.DeriveTex);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveMargin = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  var n = D.n, fin = D.fin, RAD = Math.PI / 180;
  var row = function (what, tex, num, res) { return { what: what, tex: tex, num: num, res: res }; };
  var ext = function (s, k) { return k > 0 && s > 0 ? Math.ceil(s * k * (1 - 1e-12)) : 0; };   // the core's extent: ceil(s k), a product on a breakpoint counts as that integer
  function prod(s, k, e) { var t = n(s * k, 4); return Math.ceil(parseFloat(t)) === e ? t : n(s * k, 8); }
  function ceilTex(s, k, e) { return '\\lceil ' + n(s, 4) + '\\cdot ' + n(k, 3) + '\\rceil = \\lceil ' + prod(s, k, e) + '\\rceil = ' + e; }

  function margin(r, p, ctx) {
    var t = r && r.tolerance, tol = t && t.tolerance;
    if (!p || !p.tolerance || !t || !tol) return null;
    var U = ctx && ctx.units, sp = t.setpoint, bs = t.burstSetpoint, g = t.grid, d = r.distIn, rows = [], notes = [], s = t.boxMargin;
    var lead = 'The tolerances you entered are turned into a box around the setpoint in the scoring-cell grid. The margin is the largest scale s for which the box (every side s times the tolerance) contains only scoring cells.' + (t.mode === 'coarse' ? ' Preview: coarse grid steps.' : '');
    rows.push(row('Tolerances (±)', '\\delta_\\psi,\\ \\delta_\\theta,\\ \\delta_n,\\ \\delta_p', '\\pm ' + n(tol.yawDeg, 2) + '^\\circ,\\ \\pm ' + n(tol.angleDeg, 2) + '^\\circ,\\ \\pm ' + n(tol.rpm, 0) + '\\,\\text{rpm},\\ \\pm ' + n(tol.posIn, 2) + '\\,\\text{in}',
      (tol.source === 'preset' ? 'preset values (a starting guess); ' : '') + 'position ' + D.lng(tol.posIn, null, 2, U)));
    if (!sp || !g) {
      notes.push(sp ? 'The grid steps are not in this result.' : 'No scoring cell near the aim, so the box has no centre: the margin is 0.');
      return { id: 'margin', title: 'Margin', lead: lead, rows: rows, notes: notes };
    }
    var nC = bs ? bs.motorRpm : sp.motorRpm, cb = (bs ? bs.cell : sp.cell)[1], x = nC > 0 ? tol.rpm / nC : 0;
    var kn = x <= 0 ? 0 : Math.min(x >= 1 ? cb + 1 : -Math.log(1 - x) / g.lnStep, cb + 1), kp = x > 0 ? Math.log(1 + x) / g.lnStep : 0;
    rows.push(row('Yaw with position', 'w_Y = \\delta_\\psi + \\arctan\\frac{\\delta_p}{d}', n(tol.yawDeg, 2) + ' + \\arctan\\frac{' + n(tol.posIn, 2) + '}{' + n(d, 2) + '}', n(g.wY, 3) + '° (d = ' + D.lng(d, null, 1, U) + ' to the target)'));
    rows.push(row('Angle rate', 'k_A = \\frac{\\delta_\\theta}{\\Delta\\theta}', '\\frac{' + n(tol.angleDeg, 2) + '}{' + n(g.thStep, 2) + '}', n(g.kA, 3) + ' cells per s'));
    rows.push(row('Yaw rate', 'k_Y = \\frac{w_Y}{\\Delta\\psi}', '\\frac{' + n(g.wY, 3) + '}{' + n(g.yawStep, 2) + '}', n(g.kY, 3) + ' cells per s'));
    rows.push(row('Speed rates (low, high)', 'k_{n-} = \\frac{-\\ln(1 - \\delta_n/n)}{\\Delta\\ln v},\\ k_{n+} = \\frac{\\ln(1 + \\delta_n/n)}{\\Delta\\ln v}',
      '\\frac{-\\ln(1 - ' + n(tol.rpm, 0) + '/' + n(nC, 1) + ')}{' + n(g.lnStep, 3) + '},\\ \\frac{\\ln(1 + ' + n(tol.rpm, 0) + '/' + n(nC, 1) + ')}{' + n(g.lnStep, 3) + '}', n(kn, 3) + ', ' + n(kp, 3) + ' cells per s'));
    var eA = ext(s, g.kA), eY = ext(s, g.kY), eN = ext(s, kn), eP = ext(s, kp);
    if (s > 0) {
      rows.push(row('Box: angle', 'e_A = \\lceil s\\,k_A\\rceil', ceilTex(s, g.kA, eA), '±' + eA + ' cells = ±' + n(eA * g.thStep, 2) + '°'));
      rows.push(row('Box: speed', 'e_{n-} = \\lceil s\\,k_{n-}\\rceil,\\ e_{n+} = \\lceil s\\,k_{n+}\\rceil', ceilTex(s, kn, eN) + ',\\ ' + ceilTex(s, kp, eP), '−' + eN + ' / +' + eP + ' cells'));
      rows.push(row('Box: yaw', 'e_Y = \\lceil s\\,k_Y\\rceil', ceilTex(s, g.kY, eY), '±' + eY + ' cells = ±' + n(eY * g.yawStep, 2) + '°'));
    }
    var capped = t.capped, rs = t.resolution;
    rows.push(row('Box margin', 's = s_{lo}', capped ? 's = 4' : (s === 0 ? 's = 0' : 's \\in [' + n(s, 3) + ',\\ ' + n(s + (rs || 0), 3) + ')'), n(s, 3) + (capped ? ' (cap)' : '') + (!capped && fin(rs) ? ', resolution ' + n(rs, 3) : '')));
    if (t.limitingAxis && t.limitingAxis !== 'along') rows.push(row('Limiting axis', 'argmin_i\\ s_i', '\\text{' + t.limitingAxis + '}', t.limitingAxis + ', ' + (t.limitingSide < 0 ? 'low side' : 'high side')));
    if (t.perAxis) rows.push(row('Each axis alone', 's_\\psi,\\ s_\\theta,\\ s_n', n(t.perAxis.yaw, 3) + ',\\ ' + n(t.perAxis.angle, 3) + ',\\ ' + n(t.perAxis.rpm, 3), 'yaw ' + n(t.perAxis.yaw, 2) + ', angle ' + n(t.perAxis.angle, 2) + ', rpm ' + n(t.perAxis.rpm, 2) + ' (the other axes at the setpoint)'));
    if (t.along) {
      var a = t.along;
      rows.push(row('Along the shooting line', 's_{along} = \\frac{\\min(a_-,\\ a_+)}{\\delta_p}', '\\frac{\\min(' + n(a.minusIn, 2) + ',\\ ' + n(a.plusIn, 2) + ')}{' + n(tol.posIn, 2) + '}',
        n(a.margin, 3) + ' (toward the target ' + D.lng(a.minusIn, null, 2, U) + ', away ' + D.lng(a.plusIn, null, 2, U) + ')'));
      if (a.limited) notes.push('The along range stopped at the mouth limit or the 24 in search cap on one side, so that side only bounds it from below.');
    }
    if (t.position && fin(t.position.lateralIn)) rows.push(row('Sideways position', 'L = d\\,\\tan\\left(\\min(s_\\psi,\\ 4)\\,\\arctan\\frac{\\delta_p}{d}\\right)',
      n(d, 2) + '\\tan\\left(' + n(Math.min(t.perAxis.yaw, 4), 3) + '\\cdot ' + n(Math.atan(tol.posIn / Math.max(d, 1e-9)) / RAD, 3) + '^\\circ\\right)', D.lng(t.position.lateralIn, null, 2, U)));
    var al = t.along ? ',\\ ' + n(t.along.margin, 3) : '';
    rows.push(row('Margin', 'm = \\min(s,\\ s_{along},\\ 4)', fin(t.margin) ? '\\min(' + n(s, 3) + al + ',\\ 4)' : '\\text{n/a}', fin(t.margin) ? n(t.margin, 3) + (t.limitingAxis ? ', limited by ' + (t.limitingAxis === 'along' ? 'the along range' : 'the ' + t.limitingAxis + ' axis') : '') : 'n/a'));
    if (t.bestSetpoint) { var b = t.bestSetpoint; rows.push(row('Best setpoint in the view', '\\text{largest box margin over the scoring cells}', '\\theta = ' + n(b.thetaDeg, 2) + '^\\circ,\\ n = ' + n(b.motorRpm, 1) + '\\,\\text{rpm},\\ \\psi = ' + n(b.yawDeg, 2) + '^\\circ', 'margin ' + n(b.margin, 3) + ' (the hood and setpoint above are not changed)')); }
    notes.push('s is the guaranteed end: every point of the box at scale s lies in a checked scoring cell, so the continuous margin is in [s, s + resolution). The margin is a bound for errors that stay within the tolerances, not a probability.');
    if (t.along) notes.push('The along range is measured with the other errors at zero and combined by the minimum; along-line error together with angle, speed and yaw error is not tested jointly. A sideways position error is treated as extra yaw error (the arctan above), an approximation that ignores the change of mouth offset.');
    if (t.capped) notes.push('The margin is capped at 4; the real margin is at least that.');
    if (t.lowerBound && !t.capped) notes.push('The box or the along range reached the edge of the computed view, so the margin is a lower bound.');
    if (t.cappedBy === 'unreachable') notes.push('The aim needs more motor speed than the motor has; the margin is not available and the numbers above describe the aim without that limit.');
    if (bs) notes.push('With a burst included, the box is centred on the burst-aware setpoint (see the burst section).');
    return { id: 'margin', title: 'Margin', lead: lead, rows: rows, notes: notes };
  }

  return { margin: margin };
});
