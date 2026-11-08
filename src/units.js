/*
 * BIOBUZZ Shot Sim - display units. The engine always works in inches, m/s and kg; this is the one
 * place the UI converts to and from what the user sees. UMD: module.exports (Node) / window.ShotUnits.
 *   imperial: length in, speed ft/s, mass oz      metric: length cm, speed m/s, mass g
 * RPM, degrees, seconds, volts and percentages are never converted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShotUnits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CM_PER_IN = 2.54, FTS_PER_MS = 1 / 0.3048, G_PER_KG = 1000, OZ_PER_KG = 1 / 0.028349523125;
  var SYSTEMS = {
    imperial: { len: 'in', lenK: 1, speed: 'ft/s', speedK: FTS_PER_MS, mass: 'oz', massK: OZ_PER_KG, lenStep: 0.5, lenDigits: 1 },
    metric: { len: 'cm', lenK: CM_PER_IN, speed: 'm/s', speedK: 1, mass: 'g', massK: G_PER_KG, lenStep: 1, lenDigits: 1 }
  };
  var current = 'imperial';

  function sys(u) { return SYSTEMS[u || current] || SYSTEMS.imperial; }
  function normalize(u) { return u === 'metric' ? 'metric' : 'imperial'; }
  function setSystem(u) { current = normalize(u); return current; }
  function getSystem() { return current; }

  function nf(n, d) {
    if (n == null || !isFinite(n)) return '—';
    d = d || 0;
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function num(text) {
    if (typeof text === 'number') return text;
    if (text == null) return NaN;
    var s = String(text).trim().replace(/,/g, '');
    return s === '' ? NaN : Number(s);
  }

  // internal -> display numbers
  function toLen(inches, u) { return inches * sys(u).lenK; }
  function toSpeed(ms, u) { return ms * sys(u).speedK; }
  function toMass(kg, u) { return kg * sys(u).massK; }
  // display numbers -> internal
  function fromLen(v, u) { return v / sys(u).lenK; }
  function fromSpeed(v, u) { return v / sys(u).speedK; }
  function fromMass(v, u) { return v / sys(u).massK; }

  // formatting with unit suffix; d = decimals in the display unit (defaults chosen per unit)
  function fmtLen(inches, d, u) { return inches == null || !isFinite(inches) ? '—' : nf(toLen(inches, u), d == null ? 0 : d) + ' ' + sys(u).len; }
  function fmtSpeed(ms, d, u) { return ms == null || !isFinite(ms) ? '—' : nf(toSpeed(ms, u), d == null ? (sys(u).speed === 'm/s' ? 2 : 1) : d) + ' ' + sys(u).speed; }
  function fmtMass(kg, d, u) { return kg == null || !isFinite(kg) ? '—' : nf(toMass(kg, u), d == null ? 1 : d) + ' ' + sys(u).mass; }
  // parse what the user typed (a bare number in the current unit) -> internal; NaN if not a number
  function parseLen(text, u) { var v = num(text); return isFinite(v) ? fromLen(v, u) : NaN; }
  function parseSpeed(text, u) { var v = num(text); return isFinite(v) ? fromSpeed(v, u) : NaN; }
  function parseMass(text, u) { var v = num(text); return isFinite(v) ? fromMass(v, u) : NaN; }

  // Engine messages are written in inches and m/s ("Needs at least 7.2 m/s", "29.0 in from").
  // Rewrite those quantities into the current system so every displayed string follows the toggle.
  function localizeText(text, u) {
    if (!text) return text;
    return String(text)
      .replace(/(-?\d[\d,]*(?:\.\d+)?)( ?)m\/s\b/g, function (_, n) {
        var d = (n.split('.')[1] || '').length; return nf(toSpeed(num(n), u), Math.max(1, d - 1)) + ' ' + sys(u).speed;
      })
      .replace(/(-?\d[\d,]*(?:\.\d+)?) in\b/g, function (_, n) {
        var d = (n.split('.')[1] || '').length; return nf(toLen(num(n), u), d) + ' ' + sys(u).len;
      });
  }

  return {
    SYSTEMS: SYSTEMS, setSystem: setSystem, getSystem: getSystem, normalize: normalize,
    lenUnit: function (u) { return sys(u).len; }, speedUnit: function (u) { return sys(u).speed; }, massUnit: function (u) { return sys(u).mass; },
    lenStep: function (u) { return sys(u).lenStep; },
    toLen: toLen, toSpeed: toSpeed, toMass: toMass, fromLen: fromLen, fromSpeed: fromSpeed, fromMass: fromMass,
    fmtLen: fmtLen, fmtSpeed: fmtSpeed, fmtMass: fmtMass, parseLen: parseLen, parseSpeed: parseSpeed, parseMass: parseMass,
    localizeText: localizeText, nf: nf
  };
});
