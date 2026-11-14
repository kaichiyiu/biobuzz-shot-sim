// Single-wheel bit-identity guard for the dual-wheel split (issue M2, N1): E.motorModel of single-wheel configs must stay
// byte-identical to the snapshot taken before the split (tests/fixtures/baseline-motor-pre-m2.json). Dual entries are compared
// with the post-split snapshot (baseline-motor-post-m2.json, card N9; the documented diff is process_docs/issue-m2/dual-diff.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadBareEngine } from './load-data.mjs';
import { SINGLES, DUALS, SPOTS, load, motorRow, snapshotEval, clean } from './fixtures/make-baseline-dual.mjs';

const E = loadEngine(), PRE = load('pre'), POST = load('post');

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

test('post-split snapshot: single rows identical to the pre-split ones, dual rows changed (derivation in process_docs/issue-m2/design.md)', () => {
  assert.deepEqual(POST.single, PRE.single);
  assert.equal(POST.dual.length, PRE.dual.length);
  POST.dual.forEach((r, i) => assert.equal(r.id, PRE.dual[i].id));
  assert.ok(POST.dual.some((r, i) => r.out.dip !== PRE.dual[i].out.dip), 'dual dips moved');
  const k1 = POST.dual.findIndex((r) => r.id === 'd-k1-pid-v9');
  assert.ok(Math.abs(POST.dual[k1].out.dip - PRE.dual[k1].out.dip) < 1e-12, 'k = 1 (no spin, equal wheels) is unchanged');
});

test('dual wheels: motorModel (all fields) equals the post-split snapshot', () => {
  DUALS.forEach((c, i) => assert.deepEqual(motorRow(E, c), POST.dual[i], c.id));
});

test('dual wheels: evaluate(full) at the two spots equals the post-split snapshot (hit rate, code, motor dip / residual)', () => {
  for (const [spot, p] of Object.entries(SPOTS)) assert.deepEqual({ spot, ...clean(snapshotEval(E.evaluate(p, 'full'))) }, POST.evalDual.find((x) => x.spot === spot), spot);
});
