// #4 F2: bearing range over which an export row still scores (engine-export-bearing.js), real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine(), I = E._internal;
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } };
const PTS = E.sweepPoints(P, 4);
const rowAt = (params, q) => E.exportPoint(params, q, {});
const widthOf = (b) => b.hi - b.lo;

// independent probe of one bearing offset b (deg): same geometry as the module, written out again
function probe(params, row, b) {
  const p = I.normParams(params), cen = I.mouthCentroid(p.target, p.hiveState[p.target]);
  const a = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x) + b * Math.PI / 180;
  const x = cen[0] - row.dMouthIn * Math.cos(a), y = cen[1] - row.dMouthIn * Math.sin(a);
  if (Math.abs(x) > p.mouthLimit || Math.abs(y) > p.mouthLimit) return 'out';
  const at = { ...params, mouth: { ...params.mouth, x, y } };
  return E.classifyShot(at, row.launchDeg, row.exitSpeedMps.c, a * 180 / Math.PI + row.yawOffsetDeg).rectHit ? 'hit' : 'miss';
}

test('on-axis spot: lo < 0 < hi, bounds are 0.5 deg multiples, and agree with a fine brute-force scan to the 0.5 deg resolution', () => {
  const row = rowAt(P, PTS[8]), b = row.bearingDeg;   // d = 42: a narrow range at the hood optimum
  assert.ok(b && b.lo < 0 && b.hi > 0, JSON.stringify(b));
  assert.equal(Math.abs(b.lo % 0.5), 0); assert.equal(b.hi % 0.5, 0);
  for (const s of [1, -1]) {
    let ff = 0.05; while (probe(P, row, s * ff) === 'hit') ff += 0.05;   // first failure on a 0.05 deg grid
    const r = s > 0 ? b.hi : -b.lo;
    assert.ok(r < ff && ff <= r + 0.55 + 1e-9, `side ${s}: result ${r}, first failure ${ff}`);
  }
});

test('the range narrows with distance at a tilted opening (two spots) and the row bearing itself always passes', () => {
  const near = rowAt(P, PTS[3]), far = rowAt(P, PTS[8]);   // d = 22 and 42
  assert.deepEqual(near.bearingDeg, { lo: -45, hi: 45 });   // steep entry: the full search width scores
  assert.ok(widthOf(far.bearingDeg) < 20 && widthOf(far.bearingDeg) < widthOf(near.bearingDeg), JSON.stringify([near.bearingDeg, far.bearingDeg]));
  assert.equal(probe(P, far, 0), 'hit');
  assert.equal(E.bearingRange(P, far, { maxDeg: 3 }).hi, 3);
  assert.deepEqual(E.bearingRange(P, near, { maxDeg: 10 }), { lo: -10, hi: 10 });
  const w1 = E.bearingRange(P, far, { stepDeg: 1 });   // a finer start step lands on the same bisection answer within the resolution
  assert.ok(Math.abs(w1.lo - far.bearingDeg.lo) <= 0.5 && Math.abs(w1.hi - far.bearingDeg.hi) <= 0.5);
});

test('null for an unreachable row, for a row whose own bearing does not score, and for junk rows', () => {
  const dead = rowAt(P, PTS[0]);   // d = 10: no arc with the hood
  assert.equal(dead.reachable, false); assert.equal(dead.bearingDeg, null); assert.equal(E.bearingRange(P, dead), null);
  const row = rowAt(P, PTS[8]);
  assert.equal(E.bearingRange(P, { ...row, launchDeg: 20 }), null);
  assert.equal(E.bearingRange(P, null), null); assert.equal(E.bearingRange(P, { ...row, exitSpeedMps: null }), null);
});

test('a position outside the mouth limit ends the range: at the field edge the range is closed on that side', () => {
  const C = { ...P, mouth: { x: 60, y: -55 } }, pts = E.sweepPoints(C, 6), q = pts[pts.length - 1], row = rowAt(C, q);
  assert.ok(q.d > 90);
  assert.equal(row.bearingDeg.hi, 0); assert.equal(probe(C, row, 0.5), 'out');
  assert.ok(row.bearingDeg.lo < 0 && probe(C, row, row.bearingDeg.lo) === 'hit' && probe(C, row, row.bearingDeg.lo - 0.5) !== 'hit');
  // every bound of every row of that line is consistent: it passes, and half a degree further it does not
  for (const qq of pts) {
    const rw = rowAt(C, qq), bd = rw.bearingDeg;
    if (!bd) continue;
    if (bd.hi < 45) assert.ok(probe(C, rw, bd.hi) === 'hit' && probe(C, rw, bd.hi + 0.5) !== 'hit', `hi at d=${qq.d}`);
    if (bd.lo > -45) assert.ok(probe(C, rw, bd.lo) === 'hit' && probe(C, rw, bd.lo - 0.5) !== 'hit', `lo at d=${qq.d}`);
  }
});

test('exportPoint fills bearingDeg for reachable rows only; the sweep stays one row per point', () => {
  const rows = E.exportPoints(P, { stepIn: 12 }).map((q) => E.exportPoint(P, q, {}));
  assert.equal(rows.length, E.sweepPoints(P, 12).length);
  for (const r of rows) assert.equal(r.bearingDeg !== null, r.reachable && probe(P, r, 0) === 'hit');
});
