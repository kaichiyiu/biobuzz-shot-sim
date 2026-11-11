// E5: calib-validate - live checks of a calibration row.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const V = createRequire(import.meta.url)(path.join(ROOT, 'src', 'calib-validate.js'));
const GOOD = { ballId: 'pollen', h0In: 16, hoodDeg: 45, measuredMotorRpm: 3000, landingIn: [118, 120, 121, 119, 122] };
const imp = { units: 'imperial', setpointRpm: 3000 }, met = { units: 'metric', setpointRpm: 3000 };
const by = (r, field, level) => r.filter((x) => x.field === field && (!level || x.level === level));

test('a good row has no findings', () => {
  assert.deepEqual(V.validateRow(GOOD, imp), []);
  assert.deepEqual(V.validateRow(GOOD, { units: 'metric' }), [], 'setpoint is optional');
});

test('measured rpm more than 10 % from the setpoint warns (not at the boundary)', () => {
  assert.equal(by(V.validateRow({ ...GOOD, measuredMotorRpm: 3301 }, imp), 'measuredMotorRpm', 'warn').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, measuredMotorRpm: 2690 }, imp), 'measuredMotorRpm', 'warn').length, 1);
  assert.equal(V.validateRow({ ...GOOD, measuredMotorRpm: 3299 }, imp).length, 0);
  assert.equal(V.validateRow({ ...GOOD, measuredMotorRpm: 2701 }, imp).length, 0);
  assert.match(V.validateRow({ ...GOOD, measuredMotorRpm: 3600 }, imp)[0].text, /20 % from the setpoint 3000/);
});

test('landing outside 12-300 in is an error per shot; boundaries are accepted', () => {
  const r = V.validateRow({ ...GOOD, landingIn: [11.9, 12, 300, 300.1, NaN] }, imp);
  assert.deepEqual(by(r, 'landingIn[0]', 'error').length + by(r, 'landingIn[3]', 'error').length + by(r, 'landingIn[4]', 'error').length, 3);
  assert.equal(by(r, 'landingIn[1]').length + by(r, 'landingIn[2]').length, 0);
  assert.match(by(r, 'landingIn[0]')[0].text, /Shot 1: 11\.9 in is outside the 12 in to 300 in/);
  assert.match(by(V.validateRow({ ...GOOD, landingIn: [5, 5, 5, 5, 5] }, met), 'landingIn[0]')[0].text, /12\.7 cm is outside the 30\.5 cm to 762 cm/);
});

test('unit mix-up hints: metres typed as inches, centimetres or mm typed as inches', () => {
  const m = V.validateRow({ ...GOOD, landingIn: [2.5, 2.6, 2.4, 2.55, 2.5] }, imp);
  assert.equal(by(m, 'landingIn', 'warn').length, 1); assert.match(by(m, 'landingIn', 'warn')[0].text, /metres or feet/);
  const c = V.validateRow({ ...GOOD, landingIn: [450, 470, 460, 455, 465] }, imp);
  assert.match(by(c, 'landingIn', 'warn')[0].text, /centimetres or millimetres/);
  const mm = V.validateRow({ ...GOOD, landingIn: [900, 910, 905, 895, 902] }, met);
  assert.match(by(mm, 'landingIn', 'warn')[0].text, /millimetres/);
  const mm2 = V.validateRow({ ...GOOD, landingIn: [1.2, 1.3, 1.1, 1.25, 1.2] }, met);
  assert.match(by(mm2, 'landingIn', 'warn')[0].text, /metres \(typical/);
});

test('other plausibility checks: ball, height, angle, rpm, shot count, scatter', () => {
  assert.equal(by(V.validateRow({ ...GOOD, ballId: 'x' }, imp), 'ballId', 'error').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, h0In: 60 }, imp), 'h0In', 'warn').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, h0In: undefined }, imp), 'h0In', 'error').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, hoodDeg: 120 }, imp), 'hoodDeg', 'error').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, measuredMotorRpm: 0 }, imp), 'measuredMotorRpm', 'error').length, 1);
  assert.match(V.validateRow({ ...GOOD, measuredMotorRpm: 9000 }, { units: 'imperial' })[0].text, /free speed/);
  assert.equal(by(V.validateRow({ ...GOOD, landingIn: [118, 120] }, imp), 'landingIn', 'warn').length, 1);
  assert.equal(by(V.validateRow({ ...GOOD, landingIn: [] }, imp), 'landingIn', 'error').length, 1);
  assert.match(by(V.validateRow({ ...GOOD, landingIn: [100, 101, 180, 99, 100] }, imp), 'landingIn', 'warn')[0].text, /mistyped/);
  assert.doesNotThrow(() => V.validateRow(null, null));
  assert.ok(V.validateRow(undefined).every((x) => x.field && x.level && x.text));
});
