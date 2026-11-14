// L5: custom motor (free rpm, stall torque, encoder counts) as engine extension "motorCustom" + the guarded line in normParams.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadEngine, loadBareEngine, loadData, BASE, ROOT } from './load-data.mjs';

const E = loadEngine(), I = E._internal;
const MC = createRequire(import.meta.url)(path.join(ROOT, 'src', 'motor-custom.js'));
const YJ = loadData().motors.motors.find((m) => m.id === 'yj6000');
const CM = { freeRpm: YJ.freeRpm, stallTorqueNm: YJ.stallTorqueNm, encoderPPR: YJ.encoderPPR };
const withCustom = (extra = {}, cm = CM) => ({ ...BASE, motorId: 'custom', customMotor: cm, ...extra });
const SPOTS = [BASE, { ...BASE, robot: { x: -40, y: -50 } }, { ...BASE, target: 'blue', robot: { x: 12.75, y: 48 } }, { ...BASE, h0: 26, robot: { x: -12.75, y: -30 } }];
// timings differ run to run; the motor row legitimately names itself
const strip = (r) => {
  const c = JSON.parse(JSON.stringify(r)); delete c.timings;
  if (c.tolerance && c.tolerance.bestSetpoint) delete c.tolerance.bestSetpoint.searchMs;
  const walk = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'searchMs') delete o[k]; else walk(o[k]); } };
  walk(c);
  if (c.motor) { delete c.motor.motorId; delete c.motor.label; }
  return c;
};

test('norm: defaults the encoder to 28 counts and rejects missing / out-of-range numbers', () => {
  assert.deepEqual(MC.norm({ freeRpm: 6000, stallTorqueNm: 0.14 }), { freeRpm: 6000, stallTorqueNm: 0.14, encoderPPR: 28 });
  assert.deepEqual(MC.norm({ freeRpm: 5000, stallTorqueNm: 0.3, encoderPPR: 2048 }), { freeRpm: 5000, stallTorqueNm: 0.3, encoderPPR: 2048 });
  for (const bad of [null, undefined, 5, {}, { freeRpm: 6000 }, { stallTorqueNm: 0.1 }, { freeRpm: 0, stallTorqueNm: 0.1 }, { freeRpm: 6000, stallTorqueNm: -1 },
    { freeRpm: 1e6, stallTorqueNm: 0.1 }, { freeRpm: 6000, stallTorqueNm: 0.1, encoderPPR: 0 }, { freeRpm: '6000', stallTorqueNm: 0.1 }, { freeRpm: NaN, stallTorqueNm: 0.1 }])
    assert.equal(MC.norm(bad), null, JSON.stringify(bad));
});

test('make: a motors.json-shaped row; undefined when invalid', () => {
  const m = MC.make(CM);
  assert.equal(m.id, 'custom'); assert.equal(m.freeRpm, 6000); assert.equal(m.stallTorqueNm, YJ.stallTorqueNm); assert.equal(m.encoderPPR, 28); assert.equal(m.voltage, 12);
  assert.ok(Math.abs(m.stallTorqueKgCm - YJ.stallTorqueKgCm) < 0.01);
  assert.equal(MC.make({ freeRpm: 6000 }), undefined);
});

test('a custom motor with the yj6000 numbers evaluates exactly like yj6000 (only motorId and label differ)', () => {
  for (const p of SPOTS) for (const mode of ['coarse', 'full']) {
    const a = E.evaluate({ ...p, motorId: 'yj6000' }, mode), b = E.evaluate({ ...p, motorId: 'custom', customMotor: CM }, mode);
    assert.equal(b.motor.motorId, 'custom'); assert.equal(b.motor.label, 'Custom motor'); assert.equal(a.motor.motorId, 'yj6000');
    assert.deepEqual(strip(b), strip(a), `${JSON.stringify(p.robot)} ${mode}`);
  }
  // with a hood and a tolerance too (the extensions receive the same mo)
  const x = { hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, tolerance: { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 1 } };
  assert.deepEqual(strip(E.evaluate(withCustom(x), 'full')), strip(E.evaluate({ ...BASE, ...x }, 'full')));
});

test("motorId 'custom' without a (valid) customMotor falls back to the default motor, also after a custom one was used", () => {
  const def = E.evaluate(BASE, 'full');
  E.evaluate(withCustom({}, { freeRpm: 3000, stallTorqueNm: 0.9 }), 'full');   // leaves nothing behind
  for (const p of [{ ...BASE, motorId: 'custom' }, { ...BASE, motorId: 'custom', customMotor: { freeRpm: 6000 } }, { ...BASE, motorId: 'custom', customMotor: null }]) {
    const r = E.evaluate(p, 'full');
    assert.equal(r.motor.motorId, def.motor.motorId);
    assert.deepEqual(strip(r), strip(def));
    assert.equal(I.normParams(p).motorId, def.motor.motorId);
  }
  // customMotor without motorId 'custom' is ignored
  assert.deepEqual(strip(E.evaluate({ ...BASE, customMotor: { freeRpm: 3000, stallTorqueNm: 0.9 } }, 'full')), strip(def));
});

test('different numbers change the headroom and the recovery; more stall torque recovers faster, more free rpm gives more headroom', () => {
  const run = (cm) => E.evaluate(withCustom({}, cm), 'full').motor;
  const base = run({ freeRpm: 6000, stallTorqueNm: 0.14 });
  const fast = run({ freeRpm: 12000, stallTorqueNm: 0.14 }), strong = run({ freeRpm: 6000, stallTorqueNm: 0.5 });
  assert.ok(fast.headroom < base.headroom * 0.55, 'headroom halves with double free rpm');
  assert.ok(strong.recoveryMs < base.recoveryMs);
  assert.equal(fast.motorRpm, base.motorRpm);   // the wheel speed needed does not depend on the motor
  const slow = E.evaluate(withCustom({}, { freeRpm: 1500, stallTorqueNm: 0.5 }), 'full');
  assert.ok(slow.motor.headroom > 1 || slow.motor.headroom > base.headroom);
});

test('every motorById user works: motorModel, export ticks per rev, compareMotors, normParams', () => {
  const p = withCustom({}, { freeRpm: 5400, stallTorqueNm: 0.2, encoderPPR: 2048 });
  I.normParams(p);                                   // registers it on this engine
  assert.equal(I.motorById().custom.encoderPPR, 2048);
  const mm = E.motorModel('custom', BASE.shooter, 'pollen', 5);
  assert.equal(mm.freeRpm, 5400); assert.equal(mm.motorId, 'custom');
  const xs = E.exportSettings({}, p);
  assert.equal(xs.ticksPerMotorRev, 2048);
  assert.equal(E.exportSettings({}, withCustom({}, { freeRpm: 5400, stallTorqueNm: 0.2 })).ticksPerMotorRev, 28, 'default 28 counts');
  assert.equal(E.exportSettings({}, { ...BASE, motorId: 'yj312' }).ticksPerMotorRev, 537.7);
  // the goBILDA table does not gain a row and does not change
  const rows = E.compareMotors(p);
  assert.equal(rows.length, loadData().motors.motors.length);
  assert.ok(rows.every((r) => r.motorId !== 'custom'));
  assert.deepEqual(rows, E.compareMotors(BASE));
});

test('install: page-side motorModel works and clears again', () => {
  const B = loadEngine();
  assert.throws(() => B.motorModel('custom', BASE.shooter, 'pollen', 5), /unknown motor custom/);
  assert.equal(MC.install(CM), true);
  assert.equal(I.motorById().custom.freeRpm, 6000);
  MC.install(null);
  assert.equal(I.motorById().custom, undefined);
  assert.throws(() => E.motorModel('custom', BASE.shooter, 'pollen', 5), /unknown motor custom/);
});

test('the bare engine (no extensions) ignores motorId custom; concatenated browser / worker build registers it', () => {
  const B = loadBareEngine();
  assert.equal(B.evaluate({ ...BASE, motorId: 'custom', customMotor: CM }, 'full').motor.motorId, 'yj6000');
  const files = ['engine.js', 'motor-custom.js'];
  const self = {};   // no `module`: the browser / worker path of the UMD wrapper
  vm.runInNewContext(files.map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n;\n'), { self }, { filename: 'concat.js' });
  const W = self.ShotEngine; W.init(loadData());
  assert.ok(self.ShotMotorCustom && W._internal.ext('motorCustom'));
  const r = W.evaluate({ ...BASE, motorId: 'custom', customMotor: { freeRpm: 6000, stallTorqueNm: 0.1442 } }, 'full');
  assert.equal(r.motor.motorId, 'custom');
});
