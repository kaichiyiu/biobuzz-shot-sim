// L1: custom flywheel model (inertia formulas, applyToParams) and how the engine honours the overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const FC = createRequire(import.meta.url)(path.join(ROOT, 'src', 'flywheel-custom.js'));
const E = loadEngine();
const near = (a, b, rel = 1e-12) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} vs ${b}`);

test('inertiaOf: disc is 1/2 m r^2, rim is m r^2, direct value passes through', () => {
  near(FC.inertiaOf({ mode: 'mass', diameterMm: 96, massKg: 0.105, shape: 'disc' }), 0.5 * 0.105 * 0.048 ** 2);
  near(FC.inertiaOf({ mode: 'mass', diameterMm: 96, massKg: 0.105, shape: 'rim' }), 0.105 * 0.048 ** 2);
  assert.equal(FC.inertiaOf({ mode: 'inertia', diameterMm: 96, inertiaKgM2: 4e-4 }), 4e-4);
});

test('inertiaOf: missing or out-of-range fields give NaN', () => {
  for (const bad of [null, undefined, {}, { mode: 'inertia', diameterMm: 96 }, { mode: 'inertia', inertiaKgM2: -1 }, { mode: 'inertia', inertiaKgM2: 1 },
    { mode: 'mass', diameterMm: 96 }, { mode: 'mass', diameterMm: 5, massKg: 0.1, shape: 'disc' }, { mode: 'mass', diameterMm: 96, massKg: 'x' }]) assert.ok(Number.isNaN(FC.inertiaOf(bad)), JSON.stringify(bad));
});

test('check: reports the failing fields; ignores `on`', () => {
  assert.equal(FC.check({ on: false, diameterMm: 96, mode: 'inertia', inertiaKgM2: 4e-4 }).ok, true);
  const r = FC.check({ diameterMm: 1000, mode: 'mass', massKg: 0, shape: 'x' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['diameterMm', 'massKg', 'shape']);
  assert.deepEqual(Object.keys(FC.check({ diameterMm: 96, mode: 'inertia', inertiaKgM2: 'a' }).errors), ['inertiaKgM2']);
});

test('applyToParams: off / missing / invalid returns the SAME object', () => {
  const p = { ...BASE };
  const off = { on: false, diameterMm: 80, mode: 'inertia', inertiaKgM2: 1e-3 };
  assert.equal(FC.applyToParams(p, off), p);
  assert.equal(FC.applyToParams(p, null), p);
  assert.equal(FC.applyToParams(p, undefined), p);
  assert.equal(FC.applyToParams(p, { ...off, on: true, diameterMm: 'x' }), p);
  assert.equal(FC.applyToParams(p, { ...off, on: true, inertiaKgM2: 0 }), p);
  assert.equal(FC.applyToParams(null, { ...off, on: true }), null);
});

test('applyToParams: on overrides diameter and inertia on a copy; p and p.shooter are untouched', () => {
  const p = { ...BASE, shooter: { ...BASE.shooter } };
  const before = JSON.stringify(p);
  const q = FC.applyToParams(p, { on: true, diameterMm: 80, mode: 'mass', massKg: 0.2, shape: 'rim' });
  assert.notEqual(q, p);
  assert.equal(JSON.stringify(p), before);
  assert.equal(q.shooter.wheelDiameterMm, 80);
  near(q.shooter.inertiaKgM2, 0.2 * 0.04 ** 2);
  assert.equal(q.shooter.gear, p.shooter.gear);
  assert.equal(q.motorId, p.motorId);
});

test('the engine honours the overrides (shooterNorm) and they behave: inertia changes the dip, not the wheel rpm', () => {
  const I = E._internal;
  const q = FC.applyToParams(BASE, { on: true, diameterMm: 80, mode: 'inertia', inertiaKgM2: 1e-3 });
  const sh = I.shooterNorm(q.shooter);
  assert.equal(sh.wheelDiameterMm, 80);
  assert.equal(sh.inertiaKgM2, 1e-3);
  // same diameter, two inertias: identical rpm and headroom, the heavier wheel dips less
  const lo = E.evaluate(FC.applyToParams(BASE, { on: true, diameterMm: 96, mode: 'inertia', inertiaKgM2: 2e-4 }), 'full');
  const hi = E.evaluate(FC.applyToParams(BASE, { on: true, diameterMm: 96, mode: 'inertia', inertiaKgM2: 8e-4 }), 'full');
  assert.ok(lo.motor && hi.motor);
  assert.equal(lo.motor.motorRpm, hi.motor.motorRpm);
  assert.equal(lo.motor.wheelRpm, hi.motor.wheelRpm);
  assert.ok(hi.motor.dip < lo.motor.dip, `dip ${hi.motor.dip} < ${lo.motor.dip}`);
  assert.ok(hi.motor.recoveryMs !== lo.motor.recoveryMs);
  // a smaller wheel needs more rpm for the same exit speed
  const small = E.evaluate(FC.applyToParams(BASE, { on: true, diameterMm: 72, mode: 'inertia', inertiaKgM2: 4e-4 }), 'full');
  const big = E.evaluate(FC.applyToParams(BASE, { on: true, diameterMm: 96, mode: 'inertia', inertiaKgM2: 4e-4 }), 'full');
  assert.ok(small.motor.motorRpm > big.motor.motorRpm);
});
