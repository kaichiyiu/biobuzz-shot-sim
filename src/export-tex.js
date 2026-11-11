/* BIOBUZZ Shot Sim - #4 LaTeX derivation of the on-robot flight solver (H1). Browser: window.ExportTex (needs window.ExportSolver). Node: module.exports.
   renderTex(c, cfg, template, opts?) -> string   c = SolverConstants (export-solver.js constantsFrom), cfg = ConfigV1 | null (names, calibration, eta, gear), template = src/templates/derivation.tex.txt text,
     opts = { wheelDiameterMm } (the page params carry it; cfg only has the wheel id). Fills every {{NAME}}; numbers come from c / cfg / ExportSolver.LIMITS (6 significant digits, LaTeX exponent form),
     text from cfg is escaped for LaTeX (and non-ASCII becomes '?'). A value that cannot be known prints as \text{n/a}; eta, wheel diameter or gear that are missing are derived from the others and
     rpmPerMps (kappa = 60 / (eta pi D g)). Throws for a bad template, an unknown placeholder or a leftover '{{'.
   inputs(c, cfg, opts) -> {dual, eta, etaDual, topRatio, wheelDiameterMm, gear, derived}   eta = the EXIT FACTOR (etaDual (1+k)/2 for dual wheels) used in kappa = 60/(eta pi D g); c.rpmMap (per-rpm calibration) prints the map form of the rpm section.
   esc(text) -> string   tn(x, sig?) -> LaTeX number text   PLACEHOLDERS = names the renderer fills.   Design: process_docs/issue-4/design.md section 14. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./export-solver.js'));
  else root.ExportTex = factory(root.ExportSolver);
})(typeof self !== 'undefined' ? self : this, function (Solver) {
  'use strict';
  var IN_M = 0.0254, LIM = Solver.LIMITS;
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  var NA = '\\text{n/a}';

  function tn(x, sig) {
    if (!fin(x)) return NA;
    if (x === 0) return '0';
    var s = Number(x.toPrecision(sig || 6)), a = Math.abs(s);
    if (a >= 1e6 || a < 1e-3) {
      var p = s.toExponential(), m = p.split('e');
      return m[0] + '\\times 10^{' + Number(m[1]) + '}';
    }
    return String(s);
  }
  var SPECIAL = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\&%$#_{}~^]/g, function (ch) { return SPECIAL[ch] || '\\' + ch; });
  }
  function txt(s, fallback) { return s == null || s === '' ? esc(fallback) : esc(s); }

  function table(head, rows) {
    var spec = head.map(function () { return 'r'; }).join('');
    return '\\begin{center}\n\\begin{tabular}{' + spec + '}\n\\hline\n' + head.join(' & ') + ' \\\\ \\hline\n' + rows.map(function (r) { return r.join(' & ') + ' \\\\'; }).join('\n') + '\n\\hline\n\\end{tabular}\n\\end{center}';
  }

  function calibSentence(cal, map) {
    if (!cal || cal.calibrated !== true) return 'The exit-speed factor $\\eta$ is the simulator default: \\textbf{this build is not calibrated}. Measure $\\eta$ with the calibration guide before relying on the rpm values at the field.';
    var fit = cal.fit || {}, how = cal.mode === 'perRpm' ? 'as a per-rpm curve $\\eta(n)$ (' + (map ? 'the table rows and the solver apply it; the solver through the piecewise-linear map $n(v)$ below' : 'the table rows apply it; the solver uses the single constant $\\kappa$ below') + ')' : 'as a single factor';
    return 'The exit-speed factor $\\eta$ was calibrated' + (cal.date ? ' on ' + esc(cal.date) : '') + ', ' + how + (fin(fit.factor) ? ' (fitted factor $' + tn(fit.factor) + '$)' : '') + '.';
  }

  function exampleBlock(c) {
    var aim = c.aim || [];
    if (!aim.length) return '';
    var d = aim[Math.floor(aim.length / 2)][0], s = Solver.solveSpeed(c, d);
    if (!s.ok) return '';
    return '\\section{Worked example}\nCheck your port against this: at $d = ' + tn(d, 5) + '$ in, $\\rho = ' + tn(IN_M * (d - c.mouthForwardIn), 5) + '$ m, $\\theta = ' + tn(s.thetaDeg, 5) + '^\\circ$ and $z_a = ' + tn(Solver.aimFor(c, d), 5) +
      '$ m, the solver returns $v = ' + tn(s.vMps, 6) + '$ m/s, $n = ' + tn(s.motorRpm, 6) + '$ rpm and $' + tn(s.ticksPerSec, 6) + '$ ticks/s (after ' + s.iterations + ' integrations).';
  }

  // The numbers behind kappa = 60 / (eta pi D g). eta is the engine's EXIT FACTOR: etaSingle, or etaDual (1 + k) / 2 for a dual shooter (k = topRatio). A single-mode calibration's applied value
  // replaces the matching eta (key etaSingle / etaDual; a value for the other wheel layout is ignored). Parts that are unknown are derived from the others and rpmPerMps.
  function inputs(c, cfg, opts) {
    var sh = (cfg && cfg.robot && cfg.robot.shooter) || {}, cal = cfg && cfg.calibration, dual = sh.type === 'dual', kap = c.rpmPerMps, D = opts && opts.wheelDiameterMm, gear = sh.gear;
    var ap = cal && cal.calibrated === true && cal.mode === 'single' && cal.applied && fin(cal.applied.value) && (!cal.applied.key || cal.applied.key === (dual ? 'etaDual' : 'etaSingle')) ? cal.applied.value : null;
    var base = ap != null ? ap : (dual ? sh.etaDual : sh.etaSingle), k = dual ? sh.topRatio : NaN;
    var eta = dual ? (fin(base) && fin(k) ? base * (1 + k) / 2 : NaN) : base, derived = false;
    if (!fin(eta) && fin(D) && fin(gear) && fin(kap)) { eta = 60 / (Math.PI * D / 1000 * gear * kap); derived = true; }
    if (!fin(D) && fin(eta) && fin(gear) && fin(kap)) D = 60 / (Math.PI * eta * gear * kap) * 1000;
    if (!fin(gear) && fin(eta) && fin(D) && fin(kap)) gear = 60 / (Math.PI * eta * D / 1000 * kap);
    return { dual: dual, eta: eta, etaDual: dual && !derived && fin(base) ? base : NaN, topRatio: k, wheelDiameterMm: D, gear: gear, derived: derived };
  }

  function etaRow(c, I) {
    if (c.rpmMap) return '$\\eta(n)$, calibrated per rpm (see the rpm section)';
    if (!I.dual || !fin(I.etaDual)) return '$\\eta' + (I.dual ? '_{\\mathrm{eff}}' : '') + ' = ' + tn(I.eta, 5) + '$' + (I.dual ? ' (derived from $\\kappa$, $D$, $g$)' : '');
    return '$\\eta_{\\mathrm{eff}} = \\eta_{\\mathrm{dual}}\\,(1+k)/2 = ' + tn(I.etaDual, 5) + '\\cdot(1+' + tn(I.topRatio, 4) + ')/2 = ' + tn(I.eta, 5) + '$ ($k$ = top / bottom wheel speed ratio; the ball leaves at $\\eta_{\\mathrm{eff}}$ times the bottom wheel surface speed)';
  }

  function rpmBlock(c, I, cal) {
    var f = fin(I.wheelDiameterMm) ? I.wheelDiameterMm / 1000 : NaN, m = c.rpmMap;
    if (!m) {
      return '\\begin{equation}\n  n = \\frac{60}{\\eta\\,\\pi D g}\\,v = \\kappa\\, v, \\qquad \\kappa = \\frac{60}{(' + tn(I.eta, 5) + ')\\,\\pi\\,(' + tn(f, 5) + '\\ \\text{m})\\,(' + tn(I.gear) + ')} = ' + tn(c.rpmPerMps) + '\\ \\frac{\\text{rpm}}{\\text{m/s}}.\n\\end{equation}\n' +
        (I.dual ? 'For a dual-wheel shooter $\\eta$ here is the effective factor $\\eta_{\\mathrm{eff}} = \\eta_{\\mathrm{dual}}(1+k)/2$ of the inputs table, not $\\eta_{\\mathrm{dual}}$ itself.\n' : '') +
        '$\\kappa$ is the one constant to retune at the field (\\texttt{RPM\\_PER\\_MPS} in the Java class).' +
        (cal && cal.calibrated === true && cal.mode === 'perRpm' ? ' With a per-rpm calibration the table rows use $\\eta(n)$; the solver uses the single value $\\kappa$ above (the median over the table).' : '');
    }
    var per = 3, i, j, rows = [], head = [];
    for (i = 0; i < m.length; i += per) { var r = []; for (j = 0; j < per; j++) r.push(i + j < m.length ? tn(m[i + j][0], 5) : '', i + j < m.length ? tn(m[i + j][1], 5) : ''); rows.push(r); }
    for (j = 0; j < per; j++) head.push('$v$ [m/s]', '$n$ [rpm]');
    return 'With the calibrated per-rpm factor $\\eta(n)$ the exit speed $v(n) = \\eta(n)\\,\\pi D g\\, n / 60$ is not proportional to $n$, so the solver replaces the constant $\\kappa$ by the inverse map $n(v)$, the motor rpm for an exit speed ' +
      '(obtained by inverting $v(n)$, the same inversion as the export table rows). It is piecewise linear: between two nodes $(v_j, n_j)$ and $(v_{j+1}, n_{j+1})$ of the table below\n\\begin{equation}\n  n(v) = n_j + (v - v_j)\\,\\frac{n_{j+1} - n_j}{v_{j+1} - v_j},\n\\end{equation}\n' +
      'and beyond the first or last node it continues with the slope of the end segment. The ' + m.length + ' nodes cover $v = ' + tn(m[0][0], 4) + '$ to $' + tn(m[m.length - 1][0], 4) + '$ m/s and were refined until linear interpolation matches the exact inverse to 0.05\\,\\% at three points per interval ' +
      '(measured maximum error below 0.1\\,\\%).\n' + table(head, rows);
  }

  function ticksBlock(c, I) {
    if (c.rpmMap) return '\\begin{equation}\n  \\text{ticks/s} = \\frac{n(v)}{60}\\,N_{\\mathrm{enc}},\n\\end{equation}\nwith $n(v)$ from the map of the previous section.';
    return '\\begin{equation}\n  \\text{ticks/s} = \\frac{n}{60}\\,N_{\\mathrm{enc}} = \\frac{\\kappa N_{\\mathrm{enc}}}{60}\\,v = ' + tn(c.rpmPerMps * c.ticksPerMotorRev / 60) + '\\ v.\n\\end{equation}';
  }

  function values(c, cfg, opts) {
    ['massKg', 'areaM2', 'rho', 'cd', 'clSlope', 'clSMax', 'g', 'S0', 'dt', 'h0M'].forEach(function (k) { if (!fin(c[k])) throw new Error('renderTex: constant ' + k + ' is missing'); });
    var sh = (cfg && cfg.robot && cfg.robot.shooter) || {}, cal = cfg && cfg.calibration, I = inputs(c, cfg, opts), D = I.wheelDiameterMm, gear = I.gear;
    var kd = 0.5 * c.rho * c.cd * c.areaM2 / c.massKg, kl0 = 0.5 * c.rho * c.areaM2 / c.massKg * c.clSlope, aim = c.aim || [], f = fin(c.mouthForwardIn) ? c.mouthForwardIn : 0, fixed = c.hood && c.hood.mode === 'fixed';
    var head = ['$d$ [in]', '$\\rho$ [m]'].concat(fixed ? [] : ['$\\theta$ [deg]'], ['$z_a$ [m]']);
    var rows = aim.map(function (p) { return [tn(p[0], 4), tn(IN_M * (p[0] - f), 4)].concat(fixed ? [] : [tn(Solver.angleFor(c, p[0]), 4)], [tn(p[1], 5)]); });
    return {
      DATE: txt(cfg && cfg.savedAt && String(cfg.savedAt).slice(0, 10), 'undated'), BALL_ID: txt(cfg && cfg.field && cfg.field.ballId, 'n/a'), MOTOR_ID: txt(cfg && cfg.robot && cfg.robot.motorId, 'n/a'),
      SHOOTER_TYPE: txt(sh.type, 'n/a'), MASS_KG: tn(c.massKg), AREA_M2: tn(c.areaM2), TICKS: tn(c.ticksPerMotorRev), WHEEL_D_MM: tn(D, 5), GEAR: tn(gear), ETA_ROW: etaRow(c, I), RPM_BLOCK: rpmBlock(c, I, cal), TICKS_BLOCK: ticksBlock(c, I),
      H0_M: tn(c.h0M), H0_IN: tn(c.h0M / IN_M, 5), FWD: tn(f), CALIB_SENTENCE: calibSentence(cal, c.rpmMap), KD: tn(kd), KL0: tn(kl0), RHO: tn(c.rho), CD: tn(c.cd), CL_SLOPE: tn(c.clSlope), G: tn(c.g), S0: tn(c.S0), CL_SMAX: tn(c.clSMax),
      DT: tn(c.dt), DT_MS: tn(c.dt * 1000), T_MAX: tn(LIM.T_MAX), V_LO: tn(LIM.V_LO), V_STEP: tn(LIM.V_STEP), V_HI: tn(LIM.V_HI), V_TOL: tn(LIM.V_TOL), MAX_IT: String(LIM.MAX_IT),
      SCAN_MAX: String(Math.ceil((LIM.V_HI - LIM.V_LO) / LIM.V_STEP)), BISECT_N: String(Math.ceil(Math.log(LIM.V_STEP / LIM.V_TOL) / Math.LN2)),
      ANGLE_BLOCK: fixed ? 'The hood is fixed: $\\theta = ' + tn(c.hood.angleDeg) + '^\\circ$ at every distance.' : 'The hood angle $\\theta(d)$ is the $\\theta$ column of the table below (adjustable hood, one row per reachable table distance).',
      AIM_COUNT: String(aim.length), AIM_Z_M: tn(c.aimZM, 5), AIM_BLOCK: aim.length ? table(head, rows) : '', EXAMPLE_BLOCK: exampleBlock(c)
    };
  }
  var PLACEHOLDERS = ['DATE', 'BALL_ID', 'MOTOR_ID', 'SHOOTER_TYPE', 'MASS_KG', 'AREA_M2', 'TICKS', 'WHEEL_D_MM', 'GEAR', 'ETA_ROW', 'H0_M', 'H0_IN', 'FWD', 'CALIB_SENTENCE', 'KD', 'KL0', 'RHO', 'CD', 'CL_SLOPE', 'G', 'S0', 'CL_SMAX',
    'DT', 'DT_MS', 'T_MAX', 'V_LO', 'V_STEP', 'V_HI', 'V_TOL', 'MAX_IT', 'SCAN_MAX', 'BISECT_N', 'ANGLE_BLOCK', 'AIM_COUNT', 'AIM_Z_M', 'AIM_BLOCK', 'RPM_BLOCK', 'TICKS_BLOCK', 'EXAMPLE_BLOCK'].sort();

  function renderTex(c, cfg, template, opts) {
    if (typeof template !== 'string' || !template) throw new Error('renderTex: the derivation template is not loaded');
    var v = values(c, cfg, opts);
    var out = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, function (m, name) {
      if (!Object.prototype.hasOwnProperty.call(v, name)) throw new Error('renderTex: unknown placeholder ' + name);
      return v[name];
    });
    if (out.indexOf('{{') >= 0) throw new Error('renderTex: unfilled "{{" left in the output');
    return out;
  }
  return { renderTex: renderTex, inputs: inputs, esc: esc, tn: tn, PLACEHOLDERS: PLACEHOLDERS };
});
