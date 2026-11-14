/* BIOBUZZ Shot Sim - #5 custom flywheel: wheel diameter plus total shaft inertia (typed directly, or from mass + rim / disc shape).
   Browser: window.ShotFlywheelCustom. Node: module.exports. Pure functions, no DOM.
   FlywheelCustom = { on: boolean, diameterMm: number, mode: 'inertia' | 'mass', inertiaKgM2?: number, massKg?: number, shape?: 'rim' | 'disc' }
   inertiaOf(fc) -> kg.m^2 (disc 1/2 m r^2, rim m r^2, or the typed inertia); NaN when the fields are missing or out of range
   check(fc)     -> { ok, errors: { <field>: message } } (range checks, see LIMITS; ignores `on`)
   applyToParams(p, fc) -> p                 fc off or invalid: the SAME object p. Else a copy of p whose shooter carries
                                             wheelDiameterMm and inertiaKgM2 (engine shooterNorm honours both numbers; p is never mutated).
   Design: process_docs/issue-5/design.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShotFlywheelCustom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = {
    diameterMm: [20, 250],
    inertiaKgM2: [1e-6, 0.05],
    massKg: [0.005, 5]
  };

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function within(x, r) { return fin(x) && x >= r[0] && x <= r[1]; }

  function inertiaOf(fc) {
    if (!fc || typeof fc !== 'object') return NaN;
    if (fc.mode === 'mass') {
      if (!within(fc.massKg, LIMITS.massKg) || !within(fc.diameterMm, LIMITS.diameterMm)) return NaN;
      var r = fc.diameterMm / 2000;   // radius in m
      return (fc.shape === 'rim' ? 1 : 0.5) * fc.massKg * r * r;
    }
    return within(fc.inertiaKgM2, LIMITS.inertiaKgM2) ? fc.inertiaKgM2 : NaN;
  }

  function check(fc) {
    var errors = {};
    fc = fc && typeof fc === 'object' ? fc : {};
    if (!within(fc.diameterMm, LIMITS.diameterMm)) errors.diameterMm = 'Diameter must be between ' + LIMITS.diameterMm[0] + ' and ' + LIMITS.diameterMm[1] + ' mm';
    if (fc.mode === 'mass') {
      if (!within(fc.massKg, LIMITS.massKg)) errors.massKg = 'Mass must be between ' + LIMITS.massKg[0] * 1000 + ' and ' + LIMITS.massKg[1] * 1000 + ' g';
      if (fc.shape !== 'rim' && fc.shape !== 'disc') errors.shape = 'Shape must be rim or disc';
    } else if (!within(fc.inertiaKgM2, LIMITS.inertiaKgM2)) {
      errors.inertiaKgM2 = 'Inertia must be between ' + LIMITS.inertiaKgM2[0] + ' and ' + LIMITS.inertiaKgM2[1] + ' kg.m2';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  function applyToParams(p, fc) {
    if (!p || !fc || fc.on !== true || !check(fc).ok) return p;
    var I = inertiaOf(fc);
    if (!(I > 0)) return p;
    var q = Object.assign({}, p);
    q.shooter = Object.assign({}, p.shooter, { wheelDiameterMm: fc.diameterMm, inertiaKgM2: I });
    return q;
  }

  return { inertiaOf: inertiaOf, check: check, applyToParams: applyToParams, LIMITS: LIMITS };
});
