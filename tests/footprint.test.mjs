import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadData } from './load-data.mjs';
const require = createRequire(import.meta.url);
const FP = require('../src/footprint.js');
const field = loadData().field;
const R = FP.defaults();
const f = (x, y, h, r = R) => FP.feasible({ x, y }, h, r, field);

test('defaults are the FTC 18 in cube', () => {
  assert.deepEqual(FP.defaults(), { lengthIn: 18, widthIn: 18, mouthForwardIn: 0 });
});
test('field centre near the legs is infeasible (hive)', () => {
  assert.deepEqual(f(0, 0, 0), { ok: true, reason: '' }); // between the two foot bars (x = +-24), 18 in robot fits
  assert.equal(f(-23.9, -18.95, 0).reason, 'hive');       // on a leg base
  assert.equal(f(-24, 0, 90).reason, 'hive');             // on a foot bar
  assert.equal(f(-30, 0, 90).reason, 'hive');             // 18 in robot overlaps the foot bar from beside it
});
test('corner spot facing the red HIVE is feasible', () => {
  assert.deepEqual(f(-50, -50, 180), { ok: true, reason: '' });
  assert.deepEqual(f(50, 50, 0), { ok: true, reason: '' });
});
test('wall crossing is reported as wall', () => {
  assert.equal(f(-65, 0, 180).reason, 'wall');            // mouth at -65, half length 9 -> corner at -74
  assert.equal(f(0, 66, 90).reason, 'wall');
  assert.equal(f(-61.5, 0, 180).ok, true);                // corner exactly -70.5
});
test('rotation matters', () => {
  // gap between foot bar face (x = -24 + 0.6 = -23.4 ... outer face -24.6) and the wall-side: park a robot just outside the bar
  const x = -24.6 - 9 - 0.2;                               // axis-aligned robot half width 9 clears the bar by 0.2
  assert.equal(f(x, 0, 0).ok, true);
  assert.equal(f(x, 0, 45).reason, 'hive');                // rotated corner reaches 9*sqrt2
});
test('robot centre is mouthForwardIn behind the mouth', () => {
  const r = { lengthIn: 18, widthIn: 18, mouthForwardIn: 9 };
  assert.equal(FP.feasible({ x: -70.5, y: 0 }, 180, r, field).ok, true);   // centre -61.5, front face on the wall
  assert.equal(FP.feasible({ x: -71, y: 0 }, 180, r, field).reason, 'wall');
  assert.equal(f(-70.5, 0, 180).reason, 'wall');                           // mouthForward 0: centre at the mouth
});
test('red/blue symmetry', () => {
  for (const [x, y, h] of [[-50, -50, 180], [-23.9, -18.95, 0], [-30, 0, 90], [-65, 10, 180], [5, 30, 33], [-26, 10, 45]]) {
    assert.deepEqual(f(-x, y, 180 - h), f(x, y, h));
    assert.deepEqual(f(x, -y, -h), f(x, y, h));
  }
});
test('segment-box distance is exact', () => {
  assert.equal(FP._segBox(-5, 5, 5, 5, 1, 1), 4);
  assert.equal(FP._segBox(-5, -5, 5, 5, 1, 1), 0);
  assert.ok(Math.abs(FP._segBox(3, 3, 5, 5, 1, 1) - 2 * Math.SQRT2) < 1e-12);
});
