// B1: single-wheel spin direction (params.shooter.spin 'back' | 'top'); plan §2.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadEngine, BASE } from './load-data.mjs';
import { snapshot } from './fixtures/make-baseline.mjs';

const E = loadEngine();
const withSpin = (spin, extra) => ({ ...BASE, ...extra, shooter: { ...BASE.shooter, ...(spin === undefined ? {} : { spin }) } });
const DUAL = { ...BASE.shooter, type: 'dual', topRatio: 0.6 };

test('shooterSpin: single back +1 (default), single top -1, dual ignores spin', () => {
  assert.equal(E.shooterSpin(BASE.shooter), 1);
  assert.equal(E.shooterSpin({ ...BASE.shooter, spin: 'back' }), 1);
  assert.equal(E.shooterSpin({ ...BASE.shooter, spin: 'top' }), -1);
  assert.equal(E.shooterSpin({ ...BASE.shooter, spin: 'bogus' }), 1);
  const d = (1 - 0.6) / (1 + 0.6);
  assert.equal(E.shooterSpin(DUAL), d);
  assert.equal(E.shooterSpin({ ...DUAL, spin: 'top' }), d);
  assert.equal(E._internal.shooterNorm({ ...DUAL, spin: 'top' }).spin, 'back');
  assert.equal(E._internal.shooterNorm({ ...BASE.shooter, spin: 'top' }).spin, 'top');
});

test('back-compat: default / back table is bit-identical to the pre-change engine; top has its own table', () => {
  const hash = (t) => {
    const h = crypto.createHash('sha256');
    for (const a of t.trajs) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    for (const k of ['lens', 'apex', 'mono', 'preMax', 'thetas', 'speeds']) h.update(Buffer.from(t[k].buffer, t[k].byteOffset, t[k].byteLength));
    return h.digest('hex');
  };
  const back = E.buildTable('pollen', 1), top = E.buildTable('pollen', -1);
  assert.equal(hash(back), 'e64d9ea6e9fafa39ae9fedaa9dc2bef34ec609cb0244281b00ec131e1694b972');   // captured on the engine before B1
  assert.notEqual(top.key, back.key);
  assert.notEqual(hash(top), hash(back));
  assert.deepEqual(snapshot(E.evaluate(withSpin('back'), 'full')), snapshot(E.evaluate(BASE, 'full')));
  assert.deepEqual(snapshot(E.evaluate({ ...BASE, shooter: DUAL }, 'full')), snapshot(E.evaluate({ ...BASE, shooter: { ...DUAL, spin: 'top' } }, 'full')));
});

test('topspin: lower apex than backspin at 55 deg / 8 m/s (flyFloat, symmetric clamp)', () => {
  const apex = (S0) => Math.max(...E._internal.flyFloat('pollen', S0, 55, 8, { tEnd: 1.2 }).map((s) => s[1]));
  assert.ok(apex(-1) < apex(1) - 0.05, `${apex(-1)} vs ${apex(1)}`);
  const smax = E.constants().aero.clSMax;   // lift saturates symmetrically at |Sr| = smax
  assert.ok(Number.isFinite(smax) && smax > 0);
  const hi = (S0) => E._internal.flyFloat('pollen', S0, 55, 8, { tEnd: 0.6, clSMax: 0.3 });
  assert.deepEqual(hi(-50).map((s) => s[1]), hi(-5).map((s) => s[1]), 'clamped on the negative side: -50 == -5 once both saturate');
});

test('topspin needs 0.5-3 % more speed at BASE (fixed 70 deg), and more than backspin with a free angle', () => {
  const vOf = (spin, extra) => E.evaluate(withSpin(spin, extra), 'full').best.v;
  const fixed = { hood: { mode: 'fixed', angleDeg: 70 } };
  const d = vOf('top', fixed) / vOf('back', fixed) - 1;
  assert.ok(d >= 0.005 && d <= 0.03, `fixed-angle delta ${(d * 100).toFixed(3)} %`);
  assert.ok(vOf('top') > vOf('back'));
  assert.equal(E.evaluate(withSpin('top'), 'full').S0, -1);
});
