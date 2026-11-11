/* BIOBUZZ Shot Sim - #4 Java renderer for the on-robot flight solver. Browser: window.ExportJava. Node: module.exports.
   renderJava(c, template) -> string   c = SolverConstants (export-solver.js constantsFrom), template = src/templates/ShotSolver.java.txt text.
     Fills every {{NAME}} with a Java literal (doubles: shortest round-trip text, ".0" added to bare integers, NaN -> Double.NaN, +-Infinity ->
     Double.POSITIVE_INFINITY / NEGATIVE_INFINITY; booleans; comma separated double lists for the hood arrays). Throws for an unknown placeholder,
     a missing / non-numeric constant, or if any "{{" is left in the output.
   literal(x) -> string        PLACEHOLDERS = names the renderer can fill.   Maths and decisions: process_docs/issue-4/design.md section 11. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExportJava = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function literal(x) {
    if (typeof x !== 'number') throw new Error('renderJava: expected a number, got ' + typeof x);
    if (x !== x) return 'Double.NaN';
    if (x === Infinity) return 'Double.POSITIVE_INFINITY';
    if (x === -Infinity) return 'Double.NEGATIVE_INFINITY';
    if (x === 0 && 1 / x < 0) return '-0.0';
    var s = String(x);
    return /^-?\d+$/.test(s) ? s + '.0' : s;
  }

  var SCALARS = { MASS_KG: 'massKg', AREA_M2: 'areaM2', RHO: 'rho', CD: 'cd', CL_SLOPE: 'clSlope', CL_SMAX: 'clSMax', G: 'g', S0: 'S0', DT: 'dt',
    H0_M: 'h0M', AIM_Z_M: 'aimZM', RPM_PER_MPS: 'rpmPerMps', TICKS_PER_MOTOR_REV: 'ticksPerMotorRev', MOUTH_FORWARD_IN: 'mouthForwardIn' };
  var PLACEHOLDERS = Object.keys(SCALARS).concat(['HOOD_FIXED', 'HOOD_ANGLE_DEG', 'HOOD_D_IN', 'HOOD_DEG', 'AIM_D_IN', 'AIM_Z']).sort();

  function values(c) {
    var v = {}, h = c && c.hood;
    Object.keys(SCALARS).forEach(function (k) {
      if (typeof c[SCALARS[k]] !== 'number') throw new Error('renderJava: constant ' + SCALARS[k] + ' is missing');
      v[k] = literal(c[SCALARS[k]]);
    });
    if (!h || (h.mode !== 'fixed' && h.mode !== 'adjustable')) throw new Error('renderJava: hood.mode must be "fixed" or "adjustable"');
    v.HOOD_FIXED = h.mode === 'fixed' ? 'true' : 'false';
    v.HOOD_ANGLE_DEG = literal(h.mode === 'fixed' ? h.angleDeg : NaN);
    var t = h.mode === 'fixed' ? [] : h.table;
    v.HOOD_D_IN = t.map(function (p) { return literal(p[0]); }).join(', ');
    v.HOOD_DEG = t.map(function (p) { return literal(p[1]); }).join(', ');
    var aim = c.aim || [];
    v.AIM_D_IN = aim.map(function (p) { return literal(p[0]); }).join(', ');
    v.AIM_Z = aim.map(function (p) { return literal(p[1]); }).join(', ');
    return v;
  }

  function renderJava(c, template) {
    var v = values(c || {});
    var out = String(template).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (m, k) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) throw new Error('renderJava: unknown placeholder {{' + k + '}}');
      return v[k];
    });
    if (out.indexOf('{{') !== -1) throw new Error('renderJava: unfilled "{{" left in the output');
    return out;
  }

  return { renderJava: renderJava, literal: literal, PLACEHOLDERS: PLACEHOLDERS };
});
