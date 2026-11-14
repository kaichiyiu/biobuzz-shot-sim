/* BIOBUZZ Shot Sim - Show the derivation (#6, O2): the scoring-window and the exit-speed / rpm sections. Browser: window.DeriveWindow. Node: module.exports.
   window(r, p, ctx) -> Section | null    eta(r, p, ctx) -> Section | null   (null = nothing to show: no aim / no motor result)
   Section = { id, title, lead, rows: [{ what, tex, num, res }], notes: [] }; strings are TeX-subset text ($..$), tex / num are math only (derive-tex.js renders them).
   ctx = { E (engine, for the ball radius), units (ShotUnits, optional) }. Numbers come from the result: r.best.scoringWindow, r.entry, r.motor.details, r.hood.rpmWindow.
   Method read from engine.js (getGrid, testTraj), engine-rect.js (scoringWindow, rpmWindowOf), engine.js motorCore. No verdict words. */
(function (root, factory) {
  var api = factory(root, typeof require === 'function' && typeof module === 'object' ? require('./derive-tex.js') : root.DeriveTex);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveWindow = api;
})(typeof self !== 'undefined' ? self : this, function (root, D) {
  'use strict';
  var n = D.n, fin = D.fin;
  var row = function (what, tex, num, res) { return { what: what, tex: tex, num: num, res: res }; };
  var u = function (x, d, unit) { return n(x, d) + '\\,\\text{' + unit + '}'; };
  var deg = function (x, d) { return n(x, d) + '^\\circ'; };
  var rngDeg = function (a, d) { return '[' + n(a[0], d) + ',\\ ' + n(a[1], d) + ']^\\circ'; };

  function gridOf(r) {   // steps the engine used: the tolerance echo when present, else the documented defaults
    var g = r.tolerance && r.tolerance.grid, coarse = r.mode === 'coarse';
    return g ? { th: g.thStep, ln: g.lnStep, yaw: g.yawStep } : { th: coarse ? 1 : 0.25, ln: coarse ? 0.02 : 0.005, yaw: coarse ? null : 0.25 };
  }
  function ruleOf(entry) { var q = entry && entry.rule; return q && typeof q === 'object' ? q : { rule: q || 'any' }; }

  function window(r, p, ctx) {
    var b = r && r.best, sw = b && (b.scoringWindow || b.windows);
    if (!b || !sw) return null;
    var U = ctx && ctx.units, E = (ctx && ctx.E) || root.ShotEngine, g = gridOf(r), op = b.scoringWindow && b.scoringWindow.opening, rows = [], notes = [];
    var bp = E && E.ballProps && p ? E.ballProps(p.ballId) : null, rad = bp ? bp.rIn : null, w2 = op ? op.widthIn / 2 : null, sh = op ? op.heightIn : null;
    var yawS = g.yaw == null ? 'a step set by the distance (0.5° or more)' : n(g.yaw, 2) + '°';
    if (op) rows.push(row('Scoring cell: mouth opening', '|w| \\le W_2 - r,\\quad r \\le B \\le S_H - r',
      fin(rad) ? '|w| \\le ' + n(w2, 2) + ' - ' + n(rad, 2) + ' = ' + u(w2 - rad, 2, 'in') + ',\\quad ' + n(rad, 2) + ' \\le B \\le ' + n(sh, 2) + ' - ' + n(rad, 2) + ' = ' + u(sh - rad, 2, 'in')
        : 'W_2 = ' + u(w2, 2, 'in') + ',\\quad S_H = ' + u(sh, 2, 'in'), 'opening ' + n(op.widthIn, 2) + ' in wide × ' + n(op.heightIn, 2) + ' in high'));
    if (r.entry && ruleOf(r.entry).rule !== 'any') {
      var ru = ruleOf(r.entry), tot = (r.entry.kept || 0) + (r.entry.dropped || 0), eb = r.entry.best;
      rows.push(row('Entry rule: ' + (ru.rule === 'descending' ? 'descending entry only' : 'entry speed limit'), ru.rule === 'descending' ? '\\alpha_{in} < 0' : 'v_{in} \\le v_{max}',
        (ru.rule === 'descending' ? '' : 'v_{max} = ' + u(ru.maxSpeedMps, 2, 'm/s') + ',\\ ') + '\\text{kept}\\ ' + r.entry.kept + '\\ \\text{of}\\ ' + tot,
        n(tot ? 100 * r.entry.kept / tot : 0, 1) + ' % of the scoring cells kept, ' + r.entry.dropped + ' dropped'));
      if (eb) rows.push(row('Entry of the aim cell', '\\alpha_{in},\\ v_{in}', deg(eb.angleDeg, 1) + ',\\ ' + u(eb.speedMps, 2, 'm/s'), (eb.angleDeg < 0 ? 'descending' : 'rising') + ' entry'));
    }
    rows.push(row('Aim cell', '(\\theta_0,\\ v_0,\\ \\psi_0)', '(' + deg(b.thetaDeg, 2) + ',\\ ' + u(b.v, 3, 'm/s') + ',\\ ' + deg(b.yawDeg, 2) + ')', n(b.thetaDeg, 2) + '°, ' + D.spd(b.v, null, 3, U) + ', yaw ' + n(b.yawDeg, 2) + '°'));
    rows.push(row('Angle window', '\\theta \\in [\\theta_{lo},\\ \\theta_{hi}]', rngDeg(sw.thetaDeg, 2), 'width ' + n(sw.thetaDeg[1] - sw.thetaDeg[0], 2) + '°'));
    rows.push(row('Speed window', 'v \\in [v_{lo},\\ v_{hi}]', '[' + n(sw.v[0], 3) + ',\\ ' + n(sw.v[1], 3) + ']\\,\\text{m/s}', D.spd(sw.v[0], sw.v[1], 3, U) + ', ' + n(100 * (sw.v[1] / sw.v[0] - 1), 2) + ' % wide'));
    rows.push(row('Yaw window', '\\psi \\in [\\psi_{lo},\\ \\psi_{hi}]', rngDeg(sw.yawDeg, 2), 'width ' + n(sw.yawDeg[1] - sw.yawDeg[0], 2) + '°'));
    if (b.scoringWindow && b.scoringWindow.moved) notes.push('The aim cell was not a scoring cell of the rectangular opening; the window is built on the nearest scoring cell.');
    if (b.scoringWindow && b.scoringWindow.clippedByMotor) notes.push('The upper speed edge is the motor limit, not a miss.');
    if (!b.scoringWindow) notes.push('No rectangular-opening window for this aim; the ranges are those of the pentagon test.');
    notes.push('Each range is the contiguous run of scoring cells through the aim cell on that axis, the other two settings held at the aim; a run ends at the first cell that does not score.');
    return { id: 'window', title: 'Scoring window', lead: 'The engine flies one ball for every launch angle θ, exit speed v and yaw ψ on a grid (steps: θ ' + n(g.th, 2) + '°, speed ' + n(100 * g.ln, 1) + ' %, yaw ' + yawS +
      (r.mode === 'coarse' ? '; preview grid' : '') + '). A cell scores when the ball passes the full test into the HIVE mouth and its centre crosses the mouth plane inside the rectangle below: w is the sideways offset from the mouth centre-line, B the height above the lower edge, r the ball radius.',
      rows: rows, notes: notes };
  }

  function eta(r, p, ctx) {
    var m = r && r.motor, d = m && m.details, sw = r && r.best && (r.best.scoringWindow || r.best.windows), U = ctx && ctx.units;
    if (!m || !d || !r.best || !fin(m.vExit)) return null;
    var dual = d.type === 'dual', rw = (r.hood && r.hood.rpmWindow) || (sw && sw.motorRpm ? { vExit: sw.v, motorRpm: sw.motorRpm, widthRpm: sw.motorRpm[1] - sw.motorRpm[0], widthPct: 100 * (sw.v[1] / sw.v[0] - 1), clippedByMotor: !!sw.clippedByMotor } : null);
    var kap = 60 / (d.exitFactor * Math.PI * d.wheelDiameterM * d.gear), rows = [], notes = [];
    rows.push(row('Exit-speed factor', dual ? '\\eta_{exit} = \\eta_{dual}\\,\\frac{1+k}{2}' : '\\eta_{exit} = \\eta',
      dual ? n(d.etaDual, 3) + '\\cdot\\frac{1+' + n(d.topRatio, 2) + '}{2}' : n(d.etaSingle, 3), n(d.exitFactor, 4)));
    rows.push(row('Wheel speed for the exit speed', 'n_w = \\frac{60\\,v}{\\eta_{exit}\\,\\pi D}', '\\frac{60\\cdot ' + n(m.vExit, 3) + '}{' + n(d.exitFactor, 3) + '\\cdot\\pi\\cdot ' + n(d.wheelDiameterM, 3) + '}', n(m.wheelRpm, 1) + ' rpm'));
    rows.push(row('Motor speed', 'n = \\frac{n_w}{G}', '\\frac{' + n(m.wheelRpm, 1) + '}{' + n(d.gear, 2) + '}', n(m.motorRpm, 1) + ' rpm'));
    rows.push(row('Rpm per m/s', '\\kappa = \\frac{60}{\\eta_{exit}\\,\\pi D\\,G}', '\\frac{60}{' + n(d.exitFactor, 3) + '\\cdot\\pi\\cdot ' + n(d.wheelDiameterM, 3) + '\\cdot ' + n(d.gear, 2) + '}', n(kap, 1) + ' rpm per m/s'));
    if (rw) {
      rows.push(row('Rpm window', 'n \\in [\\kappa v_{lo},\\ \\kappa v_{hi}]', '[' + n(kap, 1) + '\\cdot ' + n(rw.vExit[0], 3) + ',\\ ' + n(kap, 1) + '\\cdot ' + n(rw.vExit[1], 3) + ']', n(rw.motorRpm[0], 1) + '–' + n(rw.motorRpm[1], 1) + ' rpm'));
      rows.push(row('Window width', '100\\,\\left(\\frac{v_{hi}}{v_{lo}} - 1\\right)', '100\\left(\\frac{' + n(rw.vExit[1], 3) + '}{' + n(rw.vExit[0], 3) + '} - 1\\right)', n(rw.widthPct, 2) + ' % = ' + n(rw.widthRpm, 1) + ' rpm'));
      if (rw.clippedByMotor) notes.push('The upper edge of the rpm window is the motor limit.');
    }
    if (fin(m.usableFreeRpm)) rows.push(row('Share of the usable free speed', 'h = \\frac{n}{n_{free}}', '\\frac{' + n(m.motorRpm, 1) + '}{' + n(m.usableFreeRpm, 0) + '}', n(100 * m.motorRpm / m.usableFreeRpm, 1) + ' %'));
    notes.push('Speeds in m/s' + (U && U.speedUnit && U.speedUnit() !== 'm/s' ? ' (the panels use ' + U.speedUnit() + ')' : '') + '; $n_{free}$ = free rpm × free-speed factor × battery V / rated V. η is the Shooter setting (the calibration form writes its fitted value there); a per-rpm η curve is used in the export table, not here.');
    if (dual) notes.push('Dual wheels: k = top / bottom wheel speed ratio; the ball leaves at η_exit times the bottom wheel surface speed.');
    return { id: 'eta', title: 'Exit speed to motor rpm', lead: 'The ball leaves at a fixed fraction of the wheel surface speed, $v = \\eta_{exit}\\,\\pi D\\,n_w / 60$, and the wheel turns $G$ times per motor turn, $n_w = G\\,n$. The rpm window is the speed window times $\\kappa$.', rows: rows, notes: notes };
  }

  return { window: window, eta: eta };
});
