// D1: config schema v1 - defaults, clamping, unknown keys, ext preservation, idempotence, v0 migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadData } from './load-data.mjs';

const req = createRequire(import.meta.url);
const S = req(path.join(ROOT, 'src', 'config-schema.js'));
const U = req(path.join(ROOT, 'src', 'units.js'));
const data = loadData();
const clone = (x) => JSON.parse(JSON.stringify(x));

test('defaults are valid: normalize(defaults) is identical and silent', () => {
  const d = S.defaults(data), r = S.normalize(d, data);
  assert.deepEqual(r.cfg, d);
  assert.deepEqual(r.warnings, []);
  assert.equal(d.v, 1);
  assert.equal(d.robot.shooter.spin, 'back');
  assert.deepEqual(d.entry, { rule: 'any', maxSpeedMps: 6 });
  for (const k of ['tolerance', 'calibration', 'export']) assert.equal(d[k], null);
});

test('defaults mirror the legacy app state defaults', () => {
  const d = S.defaults(data);
  assert.equal(d.robot.motorId, 'yj6000');
  assert.deepEqual(d.field.mouth, { x: -12.75, y: -48 });
  assert.deepEqual(d.field.hive, { red: -1, blue: 1 });
  assert.deepEqual(d.robot.hood, { mode: 'adjustable', angleText: '', minDeg: 45, maxDeg: 80 });
  assert.equal(d.robot.shooter.etaSingle, 0.45);
  assert.equal(d.robot.shooter.wheelId, 'gecko96');
});

test('out-of-range numbers are clamped with a warning naming the path', () => {
  const x = clone(S.defaults(data));
  x.field.h0 = 99; x.robot.shooter.batteryV = 3; x.robot.shooter.topRatio = -2; x.field.mouth.x = 1e6;
  x.robot.hood.minDeg = 0; x.robot.hood.maxDeg = 200; x.robot.shooter.etaSingle = 0.99;
  const { cfg, warnings } = S.normalize(x, data);
  assert.equal(cfg.field.h0, 29); assert.equal(cfg.robot.shooter.batteryV, 11); assert.equal(cfg.robot.shooter.topRatio, 0);
  assert.equal(cfg.field.mouth.x, 70.5); assert.equal(cfg.robot.hood.minDeg, 1); assert.equal(cfg.robot.hood.maxDeg, 89);
  assert.equal(cfg.robot.shooter.etaSingle, 0.5);
  for (const p of ['field.h0', 'batteryV', 'topRatio', 'field.mouth.x', 'minDeg', 'maxDeg', 'etaSingle']) assert.ok(warnings.some((w) => w.includes(p)), p);
});

test('bad enums, NaN, wrong types fall back to defaults with warnings; gear snaps to a selectable ratio', () => {
  const d = S.defaults(data), x = clone(d);
  x.field.ballId = 'apple'; x.robot.motorId = 'nope'; x.robot.shooter.type = 3; x.robot.shooter.gear = 1.1;
  x.display.units = 'furlongs'; x.display.origin = 'moon'; x.entry.rule = 'sometimes'; x.field.h0 = 'tall'; x.robot.shooter.addOn = 'hubShaft';
  const { cfg, warnings } = S.normalize(x, data);
  assert.deepEqual(cfg.field, d.field); assert.equal(cfg.robot.motorId, d.robot.motorId);
  assert.equal(cfg.robot.shooter.type, 'single'); assert.equal(cfg.robot.shooter.gear, 1); assert.equal(cfg.robot.shooter.addOn, 'steel82');
  assert.equal(cfg.display.units, 'imperial'); assert.equal(cfg.display.origin, 'red-audience'); assert.equal(cfg.entry.rule, 'any');
  assert.ok(warnings.length >= 9);
});

test('swapped hood min / max are ordered; non-objects and junk input give defaults', () => {
  const x = S.defaults(data); x.robot.hood.minDeg = 70; x.robot.hood.maxDeg = 50;
  const h = S.normalize(x, data).cfg.robot.hood;
  assert.deepEqual([h.minDeg, h.maxDeg], [50, 70]);
  for (const junk of [null, undefined, 5, 'x', [], { field: 7, robot: [] }]) {
    const r = S.normalize(junk, data);
    assert.deepEqual(r.cfg, S.defaults(data), String(junk));
  }
});

test('unknown top-level keys are dropped; ext (and opaque slices) are preserved verbatim', () => {
  const ext = { future: { deep: [1, 2, { z: null }], s: 'x' }, other: 5 };
  const x = { ...S.defaults(data), bogus: 1, ext, calibration: { eta: 0.4, rows: [[1, 2]] }, tolerance: 'no' };
  const { cfg, warnings } = S.normalize(x, data);
  assert.ok(!('bogus' in cfg));
  assert.deepEqual(cfg.ext, ext); assert.notEqual(cfg.ext, ext);
  assert.deepEqual(cfg.calibration, { eta: 0.4, rows: [[1, 2]] });
  assert.equal(cfg.tolerance, null);
  assert.ok(warnings.some((w) => w.startsWith('bogus')) && warnings.some((w) => w.startsWith('tolerance')));
  assert.ok(!('ext' in S.normalize(S.defaults(data), data).cfg));
});

test('normalize is idempotent', () => {
  const x = clone(S.defaults(data));
  x.field.h0 = 500; x.robot.shooter.gear = 2.2; x.ext = { a: 1 }; x.bogus = 1; x.robot.hood.minDeg = 90;
  const once = S.normalize(x, data).cfg, twice = S.normalize(once, data);
  assert.deepEqual(twice.cfg, once); assert.deepEqual(twice.warnings, []);
});

test('migrate: v0 legacy pieces -> v1; v1 passes through; later versions warn but read', () => {
  const v0 = { units: 'metric', origin: 'blue-far', hood: { mode: 'fixed', angleText: '62.5', minDeg: 40, maxDeg: 70 }, spin: 'top', entry: { rule: 'maxSpeed', maxSpeedMps: 4.5 } };
  const m = S.migrate(v0);
  assert.equal(m.v, 1);
  const { cfg, warnings } = S.normalize(v0, data);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.display.units, 'metric'); assert.equal(cfg.display.origin, 'blue-far');
  assert.deepEqual(cfg.robot.hood, { mode: 'fixed', angleText: '62.5', minDeg: 40, maxDeg: 70 });
  assert.equal(cfg.robot.shooter.spin, 'top'); assert.deepEqual(cfg.entry, { rule: 'maxSpeed', maxSpeedMps: 4.5 });
  assert.deepEqual(S.migrate({ v: 1, a: 1 }), { v: 1, a: 1 });
  assert.equal(S.migrate(5), 5);
  const f = S.normalize({ ...S.defaults(data), v: 2 }, data);
  assert.ok(f.warnings.some((w) => w.startsWith('v:')));
});

test('ORIGINS equals the units.js corner list', () => {
  assert.deepEqual([...S.ORIGINS].sort(), Object.keys(U.CORNERS).sort());
});
