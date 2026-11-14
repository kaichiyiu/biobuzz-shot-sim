// Single-wheel bit-identity guard for the dual-wheel split (issue M2, N1): E.motorModel of single-wheel configs must stay
// byte-identical to the snapshot taken before the split (tests/fixtures/baseline-motor-pre-m2.json). Dual entries are compared
// with the post-split snapshot from card N9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadBareEngine } from './load-data.mjs';
import { SINGLES, DUALS, SPOTS, load, motorRow } from './fixtures/make-baseline-dual.mjs';

const E = loadEngine(), PRE = load('pre');

test('motor snapshot file lists the planned configs', () => {
  assert.equal(PRE.single.length, SINGLES.length);
  assert.equal(PRE.dual.length, DUALS.length);
  assert.equal(PRE.evalDual.length, Object.keys(SPOTS).length);
  assert.ok(PRE.single.some((r) => r.out.recoveryMs === 'Infinity'), 'the unreachable-speed edge case is in the file');
});

test('single wheels: motorModel (all fields, with and without extensions) equals the pre-split snapshot', () => {
  const B = loadBareEngine();
  SINGLES.forEach((c, i) => {
    assert.deepEqual(motorRow(E, c), PRE.single[i], c.id);
    assert.deepEqual(motorRow(B, c), PRE.single[i], c.id + ' (bare engine)');
  });
});

test('single wheels: no dual-only result fields', () => {
  for (const r of PRE.single) assert.ok(!('dipTop' in r.out) && !('dipExit' in r.out) && !('splitModel' in r.out.details));
});
