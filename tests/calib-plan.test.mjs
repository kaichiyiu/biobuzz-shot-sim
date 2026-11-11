// E2: calib-plan - 3 settings per angle, 5 shots each, predicted landing from the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const P = req(path.join(ROOT, 'src', 'calib-plan.js'));
const C = req(path.join(ROOT, 'src', 'calib-core.js'));
const E = loadEngine();
const cfg = { field: { ballId: 'pollen', h0: 16 }, robot: { shooter: { ...BASE.shooter, type: 'single', etaSingle: 0.4 } } };

test('3 settings per angle (low / mid / top), 5 shots each, 15 balls for one angle', () => {
  const p = P.plan(cfg, [2000, 4000], [45], { engine: E });
  assert.equal(p.settings.length, 3);
  assert.deepEqual(p.settings.map((s) => s.motorRpmSet), [2000, 3000, 4000]);
  assert.ok(p.settings.every((s) => s.shots === 5 && s.hoodDeg === 45 && s.ballId === 'pollen' && s.h0In === 16));
  assert.equal(new Set(p.settings.map((s) => s.id)).size, 3);
  assert.equal(p.balls, 15);
  assert.equal(p.minutes, 20);
  const two = P.plan(cfg, [2000, 4000], [40, 55], { engine: E });
  assert.equal(two.settings.length, 6); assert.equal(two.balls, 30);
});

test('predicted landing increases with rpm and equals the engine model at the setting', () => {
  const p = P.plan(cfg, [2200, 4400], [35, 55], { engine: E });
  for (const deg of [35, 55]) {
    const d = p.settings.filter((s) => s.hoodDeg === deg).map((s) => s.predictedLandingIn);
    assert.ok(d[0] < d[1] && d[1] < d[2], d.join());
  }
  const s = p.settings[1], so = C.shooterOf(E, cfg);
  const d = C.landingIn(E, 'pollen', so.S0, s.hoodDeg, C.exitSpeedFromMotorRpm(s.motorRpmSet, so.sh), 16);
  assert.ok(Math.abs(d - s.predictedLandingIn) <= 0.05);
});

test('assumptions: actual angle = hood angle; out-of-range tape distances are called out; bad input throws', () => {
  const p = P.plan(cfg, [2200, 4400], [45], { engine: E });
  assert.ok(p.assumptions.some((a) => /actual launch angle = hood angle/i.test(a)));
  const far = P.plan(cfg, [5000, 6000], [45], { engine: E });
  assert.ok(far.assumptions.some((a) => /outside the 12-300 in/.test(a)));
  assert.throws(() => P.plan(cfg, [4000, 2000], [45], { engine: E }));
  assert.throws(() => P.plan(cfg, [2000, 4000], [], { engine: E }));
  assert.throws(() => P.plan(cfg, [2000, 4000], [95], { engine: E }));
  assert.throws(() => P.plan(cfg, [2000, 4000], [45]), /engine/);
});
