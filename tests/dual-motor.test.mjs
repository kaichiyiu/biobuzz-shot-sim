// Issue M2 (N4): motorCore dual branch vs the pre-split snapshot (tests/fixtures/baseline-motor-pre-m2.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadBareEngine, BASE } from './load-data.mjs';
import { DUALS, SPOTS, load, motorRow } from './fixtures/make-baseline-dual.mjs';

const E = loadEngine(), B = loadBareEngine(), PRE = load('pre');
const CHANGED = ['dip', 'residual', 'sigmaRecovery', 'shotEnergyJ', 'recoveryMs'], CHANGED_D = ['share', 'w1', 'wAfterInterval'];
const NEW = ['dipTop', 'dipExit'], NEW_D = ['w0Top', 'w1Top', 'shareTop', 'shotEnergyTopJ', 'inertiaTopKgM2', 'cBall', 'splitModel'];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const num = (x) => (typeof x === 'string' ? Number(x) : x);

test('bare engine (no dualSplit extension) keeps the legacy dual formula exactly', () => {
  DUALS.forEach((c, i) => assert.deepEqual(motorRow(B, c), PRE.dual[i], c.id));
});

test('dual: only the planned fields change, every other field equals the pre-split snapshot', () => {
  DUALS.forEach((c, i) => {
    const pre = PRE.dual[i].out, now = motorRow(E, c).out;
    for (const key of Object.keys(now)) {
      if (CHANGED.includes(key) || NEW.includes(key) || key === 'details') continue;
      assert.deepEqual(now[key], pre[key], `${c.id}.${key}`);
    }
    assert.deepEqual(Object.keys(now).filter((x) => NEW.includes(x)).sort(), [...NEW].sort());
    for (const key of Object.keys(now.details)) {
      if (CHANGED_D.includes(key) || NEW_D.includes(key)) continue;
      if (key === 'w0') near(now.details.w0, pre.details.w0, 1e-12 * pre.details.w0, c.id + ' w0');   // recomputed from vBottom / R
      else assert.deepEqual(now.details[key], pre.details[key], `${c.id}.details.${key}`);
    }
    assert.deepEqual(Object.keys(now.details).filter((x) => NEW_D.includes(x)).sort(), [...NEW_D].sort());
    assert.equal(now.details.splitModel, 'impulse');
    near(now.sigmaRecovery, now.residual / 2, 1e-15);
  });
});

test('dual: energy is only split (E_B + E_T = lambda E_ball), bottom share rises for k < 1, k = 1 unchanged', () => {
  DUALS.forEach((c, i) => {
    const pre = PRE.dual[i].out, m = motorRow(E, c).out, d = m.details, k = c.shooter.topRatio;
    near(m.shotEnergyJ + d.shotEnergyTopJ, d.lossFactor * (d.keLinJ + d.keRotJ), 1e-12, c.id);
    near(d.share + d.shareTop, 1, 1e-12);
    near(m.dipExit, (m.dip + k * m.dipTop) / (1 + k), 1e-15);
    if (k < 1) { assert.ok(d.share > pre.details.share && m.dip > pre.dip, c.id); assert.ok(m.dipTop > m.dip); }
    else { near(m.dip, pre.dip, 1e-12); near(m.dipTop, m.dip, 1e-12); near(num(m.recoveryMs), num(pre.recoveryMs), 1e-9 * num(pre.recoveryMs)); }
  });
});

test('dual: expected dip change (POLLEN yj6000 I 4e-4): +0.3 to +0.7 pp on the bottom wheel for k 0.2 to 0.6, exit dip about 6 %', () => {
  DUALS.filter((c) => c.shooter.topRatio < 1 && c.v === 9 && c.shooter.control === 'pid').forEach((c) => {
    const i = DUALS.indexOf(c), dd = 100 * (motorRow(E, c).out.dip - PRE.dual[i].out.dip), k = c.shooter.topRatio;
    if (k <= 0.6) assert.ok(dd > 0.3 && dd < 0.7, `${c.id} ${dd}`);
    near(100 * motorRow(E, c).out.dipExit, 6.0, 0.05, c.id);
  });
});

test('single wheels never get dual fields; custom motor and custom inertia work for dual', () => {
  const s = E.motorModel('yj6000', { type: 'single' }, 'pollen', 9);
  assert.ok(!('dipExit' in s) && !('dipTop' in s));
  const sh = { type: 'dual', topRatio: 0.45, inertiaKgM2: 6e-4, shotInterval: 0.4, control: 'pid' };
  const m = E.motorModel('yj6000', sh, 'pollen', 7);
  assert.equal(m.details.inertiaTopKgM2, 6e-4);
  for (const v of [m.dip, m.dipTop, m.dipExit, m.residual, m.recoveryMs, m.shotEnergyJ]) assert.ok(Number.isFinite(v));
  const r = E.evaluate({ ...BASE, motorId: 'custom', customMotor: { freeRpm: 6000, stallTorqueNm: 0.1442 }, shooter: { ...BASE.shooter, ...sh } }, 'full');
  assert.equal(r.motor.motorId, 'custom');   // custom motor row goes through the same dual branch
  assert.equal(r.motor.details.splitModel, 'impulse');
  assert.ok(Number.isFinite(r.motor.dipExit) && Number.isFinite(r.sigma.recovery));
});

test('evaluate: dual result carries the new motor fields; sigma.recovery follows the exit-weighted residual', () => {
  for (const [name, p] of Object.entries(SPOTS)) {
    const r = E.evaluate(p, 'full'), pre = PRE.evalDual.find((x) => x.spot === name);
    assert.equal(r.motor.details.splitModel, 'impulse', name);
    assert.equal(r.sigma.recovery, r.motor.sigmaRecovery);
    assert.ok(r.motor.dip > pre.motor.dip, name + ': bottom dip up');
    near(r.hitRate, pre.hitRate, 0.1, name + ' hit rate moves only slightly');
  }
});

test('compareMotors (motors table) and the coarse mode still run for a dual shooter', () => {
  const p = { ...BASE, shooter: { ...BASE.shooter, type: 'dual', topRatio: 0.45, control: 'pid' } };
  const rows = E.compareMotors(p);
  assert.ok(rows.length >= 8 && rows.every((r) => r.verdict && typeof r.hitRate === 'number'));
  assert.ok(Number.isFinite(E.evaluate(p, 'coarse').hitRate));
});
