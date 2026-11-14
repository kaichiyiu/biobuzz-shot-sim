/* BIOBUZZ Shot Sim - #5 custom motor: any brushed DC motor from two numbers (free rpm, stall torque) plus the encoder counts per rev.
   Engine extension "motorCustom". Browser / worker: window.ShotMotorCustom (also registered on ShotEngine). Node: module.exports.
   params.motorId === 'custom' with params.customMotor = { freeRpm, stallTorqueNm, encoderPPR? } makes normParams use this motor
   (one guarded line in engine.js); 'custom' without a valid customMotor falls back to the default motor.
   Units: freeRpm = manufacturer no-load rpm at 12 V (the engine applies its 0.97 usable-speed factor and the battery voltage like for
   the goBILDA rows); stallTorqueNm = stall torque at 12 V in N.m; encoderPPR = encoder counts per MOTOR output-shaft revolution (default 28).
   norm(raw)    -> { freeRpm, stallTorqueNm, encoderPPR } | null          null when a number is missing or outside LIMITS
   make(raw)    -> motor row (same fields as data/motors.json, id 'custom') | undefined
   install(raw) sets / clears S.motorById.custom of the engine this module is registered on (the page engine keeps page-side
                E.motorModel('custom', ...) callers working while the worker gets the same numbers through params).
   Design: process_docs/issue-5/design.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShotMotorCustom = factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var KG_CM_PER_NM = 1 / 0.0980665;
  var DEFAULT_PPR = 28;
  var LIMITS = { freeRpm: [10, 30000], stallTorqueNm: [0.001, 50], encoderPPR: [1, 100000] };

  function within(x, r) { return typeof x === 'number' && isFinite(x) && x >= r[0] && x <= r[1]; }

  function norm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ppr = raw.encoderPPR == null ? DEFAULT_PPR : raw.encoderPPR;
    if (!within(raw.freeRpm, LIMITS.freeRpm) || !within(raw.stallTorqueNm, LIMITS.stallTorqueNm) || !within(ppr, LIMITS.encoderPPR)) return null;
    return { freeRpm: raw.freeRpm, stallTorqueNm: raw.stallTorqueNm, encoderPPR: ppr };
  }

  function make(raw) {
    var n = norm(raw);
    if (!n) return undefined;
    return {
      id: 'custom', sku: 'custom', label: 'Custom motor', ratio: 1, freeRpm: n.freeRpm,
      stallTorqueKgCm: n.stallTorqueNm * KG_CM_PER_NM, stallTorqueNm: n.stallTorqueNm,
      encoderPPR: n.encoderPPR, voltage: 12
    };
  }

  var I = E && E._internal;
  function install(raw) {
    if (!I) return false;
    var mo = make(raw), tbl = I.motorById();
    if (mo) tbl.custom = mo; else delete tbl.custom;
    return !!mo;
  }

  var impl = { norm: norm, make: make, install: install, LIMITS: LIMITS, DEFAULT_PPR: DEFAULT_PPR };
  if (I && typeof I.register === 'function') I.register('motorCustom', impl);
  return impl;
});
