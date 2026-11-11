// E7 must-fix: a calibrated eta outside the slider range survives normalize (engine bounds only); uncalibrated still clamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadData } from './load-data.mjs';

const S = createRequire(import.meta.url)(path.join(ROOT, 'src', 'config-schema.js'));
const data = loadData();
const withEta = (single, dual, cal) => {
  const x = S.defaults(data);
  x.robot.shooter.etaSingle = single; x.robot.shooter.etaDual = dual;
  x.calibration = cal;
  return S.normalize(x, data);
};

test('calibrated: eta 0.28 / 0.7 are kept; engine bounds still apply', () => {
  const { cfg, warnings } = withEta(0.28, 0.7, { calibrated: true, date: 'x' });
  assert.equal(cfg.robot.shooter.etaSingle, 0.28);
  assert.equal(cfg.robot.shooter.etaDual, 0.7);
  assert.equal(warnings.filter((w) => /eta/.test(w)).length, 0);
  const hi = withEta(7, 9, { calibrated: true }).cfg.robot.shooter;
  assert.equal(hi.etaSingle, 1); assert.equal(hi.etaDual, 1.5);
  assert.equal(withEta(-1, -1, { calibrated: true }).cfg.robot.shooter.etaSingle, 0.01);
});

test('not calibrated (null, or flag missing / false): slider range clamps as before', () => {
  for (const cal of [null, { calibrated: false }, { date: 'x' }]) {
    const { cfg, warnings } = withEta(0.28, 0.7, cal);
    assert.equal(cfg.robot.shooter.etaSingle, 0.3);
    assert.equal(cfg.robot.shooter.etaDual, 0.8);
    assert.ok(warnings.some((w) => w.includes('etaSingle')));
  }
});

test('calibrated eta round trip: normalize is idempotent and keeps the record', () => {
  const a = withEta(0.28, 0.9, { calibrated: true, date: 'd' }).cfg;
  const b = S.normalize(a, data);
  assert.deepEqual(b.cfg, a);
  assert.equal(b.cfg.calibration.date, 'd');
});
