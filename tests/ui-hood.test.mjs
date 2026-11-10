import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './load-data.mjs';

const H = createRequire(import.meta.url)(path.join(ROOT, 'src', 'ui-hood.js'));
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test('load: defaults are adjustable 45-80 with an empty angle', () => {
  assert.deepEqual(H.load(undefined, mem()), { mode: 'adjustable', minDeg: 45, maxDeg: 80, angleText: '' });
  assert.deepEqual(H.load({ mode: 'adjustable', minDeg: 40, maxDeg: 70 }, mem()), { mode: 'adjustable', minDeg: 40, maxDeg: 70, angleText: '' });
});

test('load / save: persisted values win, typed text survives, corrupt storage falls back', () => {
  const st = mem();
  H.save({ mode: 'fixed', minDeg: 50, maxDeg: 75, angleText: '62.5' }, st);
  assert.deepEqual(H.load(undefined, st), { mode: 'fixed', minDeg: 50, maxDeg: 75, angleText: '62.5' });
  H.save({ mode: 'fixed', minDeg: 50, maxDeg: 75, angleText: 'abc' }, st);
  assert.equal(H.load(undefined, st).angleText, 'abc');
  st.setItem('biobuzz-shot-sim.hood', '{not json');
  assert.equal(H.load(undefined, st).mode, 'adjustable');
  st.setItem('biobuzz-shot-sim.hood', JSON.stringify({ mode: 'weird', minDeg: 'x' }));
  assert.deepEqual(H.load(undefined, st), { mode: 'adjustable', minDeg: 45, maxDeg: 80, angleText: '' });
  assert.equal(H.load(undefined, null).mode, 'adjustable');
});

test('validate: fixed needs a number in 1-89; adjustable never errors', () => {
  const fx = (t) => H.validate({ mode: 'fixed', minDeg: 45, maxDeg: 80, angleText: t });
  for (const t of ['', '   ']) assert.equal(fx(t).code, 'HOOD_ANGLE_REQUIRED', JSON.stringify(t));
  for (const t of ['0', '0.9', '89.1', '95', '-5']) assert.equal(fx(t).code, 'HOOD_ANGLE_RANGE', t);
  for (const t of ['1', '62.5', '89', ' 45 ', '62,5']) assert.equal(fx(t), null, t);
  assert.equal(fx('').message, 'Enter launch angle');
  assert.equal(fx('95').message, 'Launch angle must be 1–89°');
  assert.equal(fx('').field, 'hood.angleDeg');
  assert.equal(H.validate({ mode: 'adjustable', minDeg: 80, maxDeg: 45, angleText: '' }), null);
});

test('toParams: matches the engine HoodParams shape', () => {
  assert.deepEqual(H.toParams({ mode: 'adjustable', minDeg: 45, maxDeg: 80, angleText: '99' }), { mode: 'adjustable', minDeg: 45, maxDeg: 80 });
  assert.deepEqual(H.toParams({ mode: 'fixed', minDeg: 45, maxDeg: 80, angleText: '62.5' }), { mode: 'fixed', angleDeg: 62.5 });
  assert.deepEqual(H.toParams({ mode: 'fixed', minDeg: 45, maxDeg: 80, angleText: '' }), { mode: 'fixed', angleDeg: null });
});

test('validate: typed text that is not a number gets its own message, distinct from the empty prompt', () => {
  const fx = (t) => H.validate({ mode: 'fixed', minDeg: 45, maxDeg: 80, angleText: t });
  for (const t of ['65abc', 'abc', 'NaN', '1e1', '6 5', '--5']) {
    const e = fx(t);
    assert.equal(e.code, 'HOOD_ANGLE_RANGE', t);
    assert.match(e.message, /must be a number between 1 and 89/, t);
    assert.notEqual(e.message, fx('').message);
  }
  assert.equal(H.toParams({ mode: 'fixed', minDeg: 45, maxDeg: 80, angleText: '65abc' }).angleDeg, null);
});

test('isNarrow / isFixedLike mirror the engine rule: a range under 1 degree (after clamping to 10-89) runs as fixed', () => {
  assert.equal(H.isNarrow(60, 60), true);
  assert.equal(H.isNarrow(60, 60.5), true);
  assert.equal(H.isNarrow(60.5, 60), true);      // swapped
  assert.equal(H.isNarrow(60, 61), false);
  assert.equal(H.isNarrow(45, 80), false);
  assert.equal(H.isNarrow(3, 8), true);           // both clamp to 10
  assert.equal(H.isNarrow(95, 99), true);         // both clamp to 89
  assert.equal(H.isNarrow(NaN, NaN), false);      // defaults 45-80
  assert.equal(H.isFixedLike({ mode: 'fixed', angleDeg: 60 }), true);
  assert.equal(H.isFixedLike({ mode: 'adjustable', minDeg: 60, maxDeg: 60.4 }), true);
  assert.equal(H.isFixedLike({ mode: 'adjustable', minDeg: 45, maxDeg: 80 }), false);
  assert.equal(H.isFixedLike(undefined), false);
});
