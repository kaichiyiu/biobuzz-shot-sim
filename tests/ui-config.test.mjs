// D3: ui-config pure parts - collect(state, slices) and apply(cfg, state, slices, env), round trips with the schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadData } from './load-data.mjs';

const req = createRequire(import.meta.url);
const S = req(path.join(ROOT, 'src', 'config-schema.js'));
const C = req(path.join(ROOT, 'src', 'ui-config.js'));
const U = req(path.join(ROOT, 'src', 'units.js'));
const data = loadData();

const mkState = () => ({
  ballId: 'pollen', target: 'red', hive: { red: -1, blue: 1 }, mouth: { x: -12.75, y: -48 }, h0: 16, units: 'imperial', origin: 'red-audience',
  precision: 'typical', motorId: 'yj6000', heat: true,
  shooter: { type: 'single', wheelId: 'gecko96', motorsPerWheel: 1, gear: 1, topRatio: 0.6, wheelCount: 2, addOn: 'steel82', shotInterval: 0.5, control: 'pid', batteryV: 12, etaSingle: 0.45, etaDual: 0.9 },
  hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80, angleText: '' }
});
const mkSlices = (init) => {
  const v = { spin: 'back', entry: { rule: 'any', maxSpeedMps: 6 }, ...(init || {}) }, calls = [];
  const sl = Object.keys(v).map((key) => ({ key, get: () => v[key], set: (x) => { v[key] = x; calls.push(key); } }));
  return { sl, v, calls };
};

test('collect from the default state equals the schema defaults (except the timestamp)', () => {
  const c = C.collect(mkState(), mkSlices().sl, Date.UTC(2026, 10, 11));
  assert.equal(c.savedAt, '2026-11-11T00:00:00.000Z');
  const d = S.defaults(data); d.savedAt = c.savedAt;
  assert.deepEqual(c, d);
  assert.deepEqual(S.normalize(c, data).warnings, []);
});

test('collect: reserved slices go to their keys, unknown slices to ext, spin and entry into the schema places', () => {
  const { sl } = mkSlices({ spin: 'top', entry: { rule: 'descending', maxSpeedMps: 5 }, calibration: { eta: 0.4 }, tolerance: null, mystery: [1, { a: 2 }] });
  const c = C.collect(mkState(), sl);
  assert.equal(c.robot.shooter.spin, 'top'); assert.deepEqual(c.entry, { rule: 'descending', maxSpeedMps: 5 });
  assert.deepEqual(c.calibration, { eta: 0.4 }); assert.equal(c.tolerance, null); assert.deepEqual(c.ext, { mystery: [1, { a: 2 }] });
  assert.ok(!('heat' in c.field) && !('heat' in c.robot));
});

test('collect survives a throwing slice and missing slices', () => {
  const sl = [{ key: 'spin', get() { throw new Error('x'); } }, { key: 'zzz', get() { throw new Error('y'); } }];
  const c = C.collect(mkState(), sl);
  assert.equal(c.robot.shooter.spin, 'back'); assert.ok(!c.ext);
  assert.doesNotThrow(() => C.collect(mkState(), []));
});

test('apply sets every user-set state field, slices, units and origin', () => {
  const cfg = S.defaults(data);
  Object.assign(cfg.field, { ballId: 'nectar', target: 'blue', h0: 20, mouth: { x: 30, y: -20 }, hive: { red: 1, blue: -1 } });
  Object.assign(cfg.robot, { motorId: 'yj435', precision: 'rough' });
  Object.assign(cfg.robot.shooter, { type: 'dual', gear: 2, topRatio: 0.8, wheelId: 'hogback72', spin: 'top', etaDual: 0.85, batteryV: 12.5 });
  cfg.robot.hood = { mode: 'fixed', angleText: '61', minDeg: 40, maxDeg: 70 };
  cfg.display = { units: 'metric', origin: 'blue-far' }; cfg.entry = { rule: 'maxSpeed', maxSpeedMps: 4 }; cfg.calibration = { a: 1 }; cfg.ext = { later: { b: 2 } };
  const st = mkState(), { sl, v } = mkSlices({ calibration: null, later: null });
  let synced = null;
  C.apply(cfg, st, sl, { units: U, hood: { sync: (h) => { synced = h; } }, mouthLimit: 70.5 - 1.4 });
  assert.equal(st.ballId, 'nectar'); assert.equal(st.target, 'blue'); assert.equal(st.h0, 20); assert.deepEqual(st.mouth, { x: 30, y: -20 });
  assert.deepEqual(st.hive, { red: 1, blue: -1 }); assert.equal(st.motorId, 'yj435'); assert.equal(st.precision, 'rough');
  assert.equal(st.shooter.type, 'dual'); assert.equal(st.shooter.gear, 2); assert.equal(st.shooter.wheelId, 'hogback72'); assert.equal(st.shooter.etaDual, 0.85);
  assert.deepEqual(st.hood, { mode: 'fixed', angleText: '61', minDeg: 40, maxDeg: 70 }); assert.deepEqual(synced, st.hood);
  assert.equal(st.units, 'metric'); assert.equal(U.getSystem(), 'metric'); assert.equal(st.origin, 'blue-far'); assert.equal(U.getCorner(), 'blue-far');
  assert.equal(v.spin, 'top'); assert.deepEqual(v.entry, { rule: 'maxSpeed', maxSpeedMps: 4 }); assert.deepEqual(v.calibration, { a: 1 }); assert.deepEqual(v.later, { b: 2 });
  U.setSystem('imperial'); U.setCorner('red-audience');
});

test('apply: mouth clamped to the field, null reserved slices not pushed, throwing slice does not stop the rest', () => {
  const cfg = S.defaults(data); cfg.field.mouth = { x: 70, y: -70 };
  const st = mkState(), { sl, calls } = mkSlices({ calibration: { keep: 1 } });
  sl.find((s) => s.key === 'spin').set = () => { throw new Error('boom'); };
  const warn = console.warn; console.warn = () => {};
  try { C.apply(cfg, st, sl, { mouthLimit: 69.1 }); } finally { console.warn = warn; }
  assert.deepEqual(st.mouth, { x: 69.1, y: -69.1 });
  assert.ok(calls.includes('entry')); assert.ok(!calls.includes('calibration'));
});

test('collect(apply(cfg)) round trips a customised config', () => {
  const cfg = S.defaults(data);
  cfg.field.mouth = { x: 12.5, y: 33.25 }; cfg.robot.hood = { mode: 'fixed', angleText: '58.5', minDeg: 45, maxDeg: 80 };
  cfg.robot.shooter.spin = 'top'; cfg.entry = { rule: 'descending', maxSpeedMps: 6 }; cfg.display.units = 'metric'; cfg.ext = { x: 1 };
  const st = mkState(), { sl } = mkSlices({ x: null });
  C.apply(cfg, st, sl, { units: U, mouthLimit: 69 });
  const back = C.collect(st, sl); back.savedAt = cfg.savedAt;
  assert.deepEqual(back, cfg);
  U.setSystem('imperial');
});
