// C2 (#12): engine-entry.js on synthetic 3x3x3 views (no engine run needed beyond loading the extension).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, ROOT } from './load-data.mjs';

const E = loadEngine(), X = createRequire(import.meta.url)(path.join(ROOT, 'src', 'engine-entry.js'));
const N = 27;

// every cell a rect hit except 5 and 6; angle = i - 13 (negative for i < 13), speed = 1 + 0.5 i
function synth() {
  const rectHits = new Uint8Array(N).fill(1), entry = new Float32Array(2 * N).fill(NaN);
  rectHits[5] = 0; rectHits[6] = 0;
  for (let i = 0; i < N; i++) if (rectHits[i]) { entry[2 * i] = i - 13; entry[2 * i + 1] = 1 + 0.5 * i; }
  return { hits: new Uint8Array(N).fill(1), rectHits, entry, nA: 3, nB: 3, nC: 3, thStep: 1, lnStep: 0.01, yawStep: 1 };
}
const kept = (v) => [...v.rectHits].map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
const snap = (v) => JSON.stringify({ r: [...v.rectHits], e: [...v.entry].map((x) => (Number.isNaN(x) ? 'nan' : x)) });

test('registers as ext("entry") with the EntryExt functions', () => {
  assert.equal(E._internal.ext('entry'), X);
  for (const f of ['norm', 'cellOk', 'filterView', 'summary', 'result']) assert.equal(typeof X[f], 'function');
});

test('any: same rect-hit content (the same view object is returned, documented)', () => {
  const v = synth(), f = X.filterView(v, { rule: 'any' });
  assert.equal(f, v);
  assert.deepEqual(kept(X.filterView(v, undefined)), kept(v));
});

test('descending drops cells with angle >= 0; cells without rect hit stay out', () => {
  const v = synth(), f = X.filterView(v, { rule: 'descending' });
  assert.deepEqual(kept(f), [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12]);   // angles i - 13 < 0 means i <= 12; 5 and 6 never were hits
  assert.ok(kept(f).every((i) => v.entry[2 * i] < 0));
});

test('maxSpeed drops speed > limit and keeps speed == limit', () => {
  const v = synth(), f = X.filterView(v, { rule: 'maxSpeed', maxSpeedMps: 1 + 0.5 * 10 });
  assert.deepEqual(kept(f), [0, 1, 2, 3, 4, 7, 8, 9, 10]);
  assert.deepEqual(kept(X.filterView(v, { rule: 'maxSpeed', maxSpeedMps: 0.5 })), []);
});

test('filterView returns a new view with a new rectHits, shares the other arrays, and never mutates its input', () => {
  const v = synth(), before = snap(v), f = X.filterView(v, { rule: 'descending' });
  assert.notEqual(f, v);
  assert.notEqual(f.rectHits, v.rectHits);
  assert.equal(f.rectHits.length, N);
  assert.equal(f.entry, v.entry);
  assert.equal(f.hits, v.hits);
  assert.equal(f.unfiltered, v);
  assert.equal(snap(v), before);
  const frozen = Object.freeze(synth());   // a frozen view object must also work
  assert.doesNotThrow(() => X.filterView(frozen, { rule: 'maxSpeed', maxSpeedMps: 3 }));
});

test('cellOk: rule per cell; a missing or NaN entry fails a real rule', () => {
  const v = synth();
  assert.equal(X.cellOk(v, 0, { rule: 'descending' }), true);
  assert.equal(X.cellOk(v, 20, { rule: 'descending' }), false);
  assert.equal(X.cellOk(v, 13, { rule: 'descending' }), false);   // angle 0 is not descending
  assert.equal(X.cellOk(v, 5, { rule: 'descending' }), false);    // NaN
  assert.equal(X.cellOk({ rectHits: v.rectHits }, 0, { rule: 'maxSpeed', maxSpeedMps: 9 }), false);
  assert.equal(X.cellOk({ rectHits: v.rectHits }, 0, { rule: 'any' }), true);
});

test('norm: junk becomes any; a valid rule is cleaned to its own keys', () => {
  for (const bad of [undefined, null, 0, 5, 'descending', [], true, {}, { rule: 'sideways' }, { rule: 'maxSpeed' },
    { rule: 'maxSpeed', maxSpeedMps: 0 }, { rule: 'maxSpeed', maxSpeedMps: -3 }, { rule: 'maxSpeed', maxSpeedMps: NaN },
    { rule: 'maxSpeed', maxSpeedMps: Infinity }, { rule: 'maxSpeed', maxSpeedMps: '5' }]) {
    assert.deepEqual(X.norm(bad), { rule: 'any' }, JSON.stringify(bad));
  }
  assert.deepEqual(X.norm({ rule: 'descending', maxSpeedMps: 4, junk: 1 }), { rule: 'descending' });
  assert.deepEqual(X.norm({ rule: 'maxSpeed', maxSpeedMps: 5.5, junk: 1 }), { rule: 'maxSpeed', maxSpeedMps: 5.5 });
  assert.deepEqual(X.norm({ rule: 'any', maxSpeedMps: 5 }), { rule: 'any' });
});

test('summary and result: counts, and best = entry of the aim cell (else the nearest rect hit)', () => {
  const v = synth(), f = X.filterView(v, { rule: 'descending' });
  assert.deepEqual(X.summary(v, f), { kept: 11, dropped: 14 });
  const sel = { a: 1, b: 1, c: 1, cellMaxB: 2, sigV: 0.02 }, p = { precision: { sigThetaDeg: 1, sigYawDeg: 1 } };
  const none = X.result(v, sel, p, { rule: 'any' });
  assert.deepEqual(none, { rule: { rule: 'any' }, kept: 25, dropped: 0, best: { angleDeg: 0, speedMps: 7.5 } });   // cell 13: angle 0, speed 7.5
  const r = X.result(f, sel, p, { rule: 'descending' });   // aim cell 13 was dropped: nearest rect hit instead (no window ext needed: ext('window') is loaded)
  assert.equal(r.kept, 11); assert.equal(r.dropped, 14);
  assert.ok(r.best && r.best.angleDeg < 0);
  assert.equal(X.result(X.filterView(v, { rule: 'maxSpeed', maxSpeedMps: 0.1 }), sel, p, { rule: 'maxSpeed', maxSpeedMps: 0.1 }).best, null);
  assert.equal(X.result(v, null, p, { rule: 'any' }).best, null);
});
