/* BIOBUZZ Shot Sim - config schema v1 (#14): defaults, normalize (clamp + warnings), v0 -> v1 migration. Pure, no DOM.
   Browser: window.ShotConfig.schema. Node: module.exports. See process_docs/issue-14/design.md. */
(function (root) {
  'use strict';
  var VERSION = 1;
  var TOP = ['v', 'savedAt', 'field', 'robot', 'display', 'entry', 'tolerance', 'calibration', 'export', 'ext'];
  var SLICES = ['tolerance', 'calibration', 'export'];   // reserved: opaque object or null (later blocks validate in their configSlice.set)
  var ORIGINS = ['red-audience', 'blue-audience', 'red-far', 'blue-far'];   // = units.js CORNERS (pinned by a test)
  var RULES = ['any', 'descending', 'maxSpeed'];
  var GEARS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];   // the options of the gear select

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function ids(list) { return (list || []).map(function (o) { return o.id; }); }

  function defaults(data) {
    var F = data.field, SH = data.shooter, d = SH.defaults || {}, M = SH.model || {};
    var motors = data.motors.motors;
    var m6 = motors.filter(function (m) { return m.freeRpm === 6000; })[0] || motors[0];
    var wheel = ids(SH.wheels).indexOf(d.wheelId) >= 0 ? d.wheelId : SH.wheels[0].id;
    var h = d.hood || {};
    return {
      v: VERSION, savedAt: '',
      field: {
        ballId: 'pollen', target: 'red', hive: { red: F.hive.upSideStart.red, blue: F.hive.upSideStart.blue },
        mouth: { x: F.hive.hiveX.red, y: -48 }, h0: d.h0 || 16
      },
      robot: {
        motorId: m6.id, precision: d.precision || 'typical',
        shooter: {
          type: d.type || 'single', wheelId: wheel, motorsPerWheel: d.motorsPerWheel || 1, gear: d.gear || 1,
          topRatio: d.topRatio != null ? d.topRatio : 0.6, wheelCount: d.wheelsPerShaft || 2, addOn: d.addOn || 'steel82',
          shotInterval: d.shotInterval || 0.5, control: d.control || 'pid', batteryV: d.batteryV || M.batteryV || 12,
          etaSingle: M.etaSingle, etaDual: M.etaDual, spin: 'back'
        },
        hood: {
          mode: h.mode === 'fixed' ? 'fixed' : 'adjustable', angleText: h.angleDeg != null ? String(h.angleDeg) : '',
          minDeg: fin(h.minDeg) ? h.minDeg : 45, maxDeg: fin(h.maxDeg) ? h.maxDeg : 80
        },
        flywheelCustom: null
      },
      display: { units: 'imperial', origin: 'red-audience' },
      entry: { rule: 'any', maxSpeedMps: 6 },
      tolerance: null, calibration: null, export: null
    };
  }

  // v0 = the legacy pieces ({units, origin, hood, spin, entry}, already parsed); v1 sections in the same object are merged on top
  function migrate(raw) {
    if (!isObj(raw) || raw.v != null) return raw;
    var out = {};
    Object.keys(raw).forEach(function (k) { if (TOP.indexOf(k) >= 0) out[k] = raw[k]; });
    out.v = VERSION;
    if (raw.units != null || raw.origin != null) out.display = Object.assign({ units: raw.units, origin: raw.origin }, isObj(raw.display) ? raw.display : {});
    if (isObj(raw.hood) || raw.spin != null) {
      var rb = isObj(out.robot) ? Object.assign({}, out.robot) : {};
      if (isObj(raw.hood) && !isObj(rb.hood)) rb.hood = raw.hood;
      if (raw.spin != null) rb.shooter = Object.assign({ spin: raw.spin }, isObj(rb.shooter) ? rb.shooter : {});
      out.robot = rb;
    }
    if (isObj(raw.entry) && !isObj(out.entry)) out.entry = raw.entry;
    return out;
  }

  function normalize(raw, data) {
    var warns = [], def = defaults(data);
    function warn(path, msg) { warns.push(path + ': ' + msg); }
    function num(v, lo, hi, d, path) {
      if (!fin(v)) { if (v != null) warn(path, 'not a number, using ' + d); return d; }
      if (v < lo) { warn(path, v + ' below ' + lo + ', clamped'); return lo; }
      if (v > hi) { warn(path, v + ' above ' + hi + ', clamped'); return hi; }
      return v;
    }
    function pick(v, list, d, path) {
      if (list.indexOf(v) >= 0) return v;
      if (v != null) warn(path, 'unknown value ' + JSON.stringify(v) + ', using ' + d);
      return d;
    }
    function snap(v, list, path) {
      var best = list.reduce(function (b, x) { return Math.abs(x - v) < Math.abs(b - v) ? x : b; }, list[0]);
      if (best !== v) warn(path, v + ' is not a selectable ratio, using ' + best);
      return best;
    }
    function sec(v, path) { if (v != null && !isObj(v)) warn(path, 'expected an object, using defaults'); return isObj(v) ? v : {}; }

    var src = migrate(raw);
    if (!isObj(src)) { warn('config', 'not an object, using defaults'); src = {}; }
    if (src.v != null && src.v !== VERSION) warn('v', src.v > VERSION ? 'newer config version ' + src.v + ', read best-effort' : 'unknown version ' + src.v);
    Object.keys(src).forEach(function (k) { if (TOP.indexOf(k) < 0) warn(k, 'unknown key dropped'); });

    var SH = data.shooter, M = SH.model || {}, half = data.field.field.half;
    var fi = sec(src.field, 'field'), fd = def.field;
    var ro = sec(src.robot, 'robot'), rd = def.robot, so = sec(ro.shooter, 'robot.shooter'), sd = rd.shooter;
    var mo = sec(fi.mouth, 'field.mouth'), ho = sec(ro.hood, 'robot.hood'), hd = rd.hood;
    var di = sec(src.display, 'display'), en = sec(src.entry, 'entry'), hv = sec(fi.hive, 'field.hive');
    var addOns = ['none'].concat(ids(SH.addOns).filter(function (i) { return i !== 'hubShaft'; }));
    var eS = M.etaSingleRange || [0.3, 0.5], eD = M.etaDualRange || [0.8, 0.95], bR = M.batteryRangeV || [11, 13.5];
    var hive = function (k) { return pick(hv[k], [-1, 1], fd.hive[k], 'field.hive.' + k); };
    var hmin = num(ho.minDeg, 1, 89, hd.minDeg, 'robot.hood.minDeg'), hmax = num(ho.maxDeg, 1, 89, hd.maxDeg, 'robot.hood.maxDeg');

    var cfg = {
      v: VERSION, savedAt: typeof src.savedAt === 'string' ? src.savedAt : '',
      field: {
        ballId: pick(fi.ballId, ['pollen', 'nectar'], fd.ballId, 'field.ballId'), target: pick(fi.target, ['red', 'blue'], fd.target, 'field.target'),
        hive: { red: hive('red'), blue: hive('blue') },
        mouth: { x: num(mo.x, -half, half, fd.mouth.x, 'field.mouth.x'), y: num(mo.y, -half, half, fd.mouth.y, 'field.mouth.y') },
        h0: num(fi.h0, 4, 29, fd.h0, 'field.h0')
      },
      robot: {
        motorId: pick(ro.motorId, ids(data.motors.motors), rd.motorId, 'robot.motorId'),
        precision: pick(ro.precision, Object.keys(SH.precision), rd.precision, 'robot.precision'),
        shooter: {
          type: pick(so.type, ['single', 'dual'], sd.type, 'robot.shooter.type'),
          wheelId: pick(so.wheelId, ids(SH.wheels), sd.wheelId, 'robot.shooter.wheelId'),
          motorsPerWheel: pick(so.motorsPerWheel, [1, 2], sd.motorsPerWheel, 'robot.shooter.motorsPerWheel'),
          gear: snap(num(so.gear, 0.5, 5, sd.gear, 'robot.shooter.gear'), GEARS, 'robot.shooter.gear'),
          topRatio: num(so.topRatio, 0, 1, sd.topRatio, 'robot.shooter.topRatio'),
          wheelCount: pick(so.wheelCount, [1, 2, 3, 4], sd.wheelCount, 'robot.shooter.wheelCount'),
          addOn: pick(so.addOn, addOns, sd.addOn, 'robot.shooter.addOn'),
          shotInterval: num(so.shotInterval, 0.2, 2, sd.shotInterval, 'robot.shooter.shotInterval'),
          control: pick(so.control, ['pid', 'power'], sd.control, 'robot.shooter.control'),
          batteryV: num(so.batteryV, bR[0], bR[1], sd.batteryV, 'robot.shooter.batteryV'),
          etaSingle: num(so.etaSingle, eS[0], eS[1], sd.etaSingle, 'robot.shooter.etaSingle'),
          etaDual: num(so.etaDual, eD[0], eD[1], sd.etaDual, 'robot.shooter.etaDual'),
          spin: pick(so.spin, ['back', 'top'], 'back', 'robot.shooter.spin')
        },
        hood: {
          mode: pick(ho.mode, ['fixed', 'adjustable'], hd.mode, 'robot.hood.mode'),
          angleText: typeof ho.angleText === 'string' ? ho.angleText.slice(0, 16) : hd.angleText,
          minDeg: Math.min(hmin, hmax), maxDeg: Math.max(hmin, hmax)
        },
        flywheelCustom: ro.flywheelCustom != null && isObj(ro.flywheelCustom) ? copy(ro.flywheelCustom) : null
      },
      display: { units: pick(di.units, ['imperial', 'metric'], 'imperial', 'display.units'), origin: pick(di.origin, ORIGINS, 'red-audience', 'display.origin') },
      entry: {
        rule: pick(en.rule, RULES, 'any', 'entry.rule'),
        maxSpeedMps: fin(en.maxSpeedMps) && en.maxSpeedMps > 0 ? en.maxSpeedMps : def.entry.maxSpeedMps
      }
    };
    SLICES.forEach(function (k) {
      if (src[k] != null && !isObj(src[k])) warn(k, 'expected an object or null, using null');
      cfg[k] = isObj(src[k]) ? copy(src[k]) : null;
    });
    if (src.ext != null) { if (isObj(src.ext)) cfg.ext = copy(src.ext); else warn('ext', 'expected an object, dropped'); }
    return { cfg: cfg, warnings: warns };
  }

  var api = { VERSION: VERSION, ORIGINS: ORIGINS, defaults: defaults, normalize: normalize, migrate: migrate };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShotConfig = root.ShotConfig || {};
  root.ShotConfig.schema = api;
})(typeof window !== 'undefined' ? window : {});
