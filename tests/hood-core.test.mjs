// #2 hood core: pure scans of a boolean window grid, on synthetic grids (no engine needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HC = createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine-hood-core.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// runs: [a, c, bLo, bHi] -> 1s in H[a, b, c]
function mk(nA, nB, nC, runs) {
  const H = new Uint8Array(nA * nB * nC);
  for (const [a, c, lo, hi] of runs) for (let b = lo; b <= hi; b++) H[(a * nB + b) * nC + c] = 1;
  return { H, dims: { nA, nB, nC } };
}
const SP = Array.from({ length: 12 }, (_, i) => 1 + i);   // speed i+1: width = bHi - bLo, one step = 1
const tolOf = (aw) => HC.stepAt(SP, aw.bHi);
const widths = (list) => list.map((x) => x.width);

test('widest window per angle: longest run in b, widest column over yaws, run edges at the middle yaw', () => {
  const { H, dims } = mk(3, 10, 3, [[0, 0, 2, 4], [0, 0, 6, 9], [0, 1, 1, 3], [1, 2, 0, 5]]);
  const l = HC.widestWindows(H, dims, SP, 9, 0, 2);
  assert.deepEqual(l[0], { a: 0, width: 3, bLo: 6, bHi: 9, c: 0, cLo: 0, cHi: 1 });   // c=1 (width 2) is within one step of 3
  assert.deepEqual(l[1], { a: 1, width: 5, bLo: 0, bHi: 5, c: 2, cLo: 2, cHi: 2 });
  assert.deepEqual(l[2], { a: 2, width: 0, bLo: -1, bHi: -1, c: -1, cLo: -1, cHi: -1 });   // no run at all
});

test('yaw plateau: c is the middle of the contiguous yaws within one speed step of the widest (symmetric and one-sided)', () => {
  const col = (a, ws) => ws.map((w, c) => (w ? [a, c, 0, w] : null)).filter(Boolean);   // width w = run b 0..w
  let g = mk(2, 10, 7, [...col(0, [1, 4, 5, 5, 5, 4, 1]), ...col(1, [5, 5, 5, 5, 2, 1, 0])]);
  const l = HC.widestWindows(g.H, g.dims, SP, 9, 0, 1);
  assert.equal(l[0].cLo, 1); assert.equal(l[0].cHi, 5); assert.equal(l[0].c, 3);
  assert.equal(l[1].cLo, 0); assert.equal(l[1].cHi, 3); assert.equal(l[1].c, 1);   // (0 + 3) >> 1
});

test('ties within one step give a range; the recommended angle is its middle, rounded toward the maximum', () => {
  const mkList = (ws) => { const g = mk(ws.length, 10, 1, ws.map((w, a) => (w ? [a, 0, 0, w] : null)).filter(Boolean)); return HC.widestWindows(g.H, g.dims, SP, 9, 0, ws.length - 1); };
  let o = HC.pickOptimalAngle(mkList([2, 5, 5, 6, 5, 3]), tolOf);
  assert.deepEqual([o.aLo, o.aHi, o.a, o.width], [1, 4, 3, 6]);   // mid 2.5, max at 3 -> up
  o = HC.pickOptimalAngle(mkList([6, 5, 5, 5, 3]), tolOf);
  assert.deepEqual([o.aLo, o.aHi, o.a], [0, 3, 1]);               // mid 1.5, max at 0 -> down
  o = HC.pickOptimalAngle(mkList([1, 3, 7, 3, 1]), tolOf);
  assert.deepEqual([o.aLo, o.aHi, o.a, o.others], [2, 2, 2, []]); // a single clear winner
  assert.equal(HC.pickOptimalAngle(mkList([0, 0, 0]), tolOf), null, 'no window anywhere -> null');
});

test('non-contiguous ties: the run holding the maximum is recommended, the others are listed', () => {
  const ws = [6, 3, 6, 6, 2, 5], g = mk(6, 10, 1, ws.map((w, a) => [a, 0, 0, w]));
  const o = HC.pickOptimalAngle(HC.widestWindows(g.H, g.dims, SP, 9, 0, 5), tolOf);
  assert.deepEqual([o.aLo, o.aHi, o.a], [0, 0, 0]);
  assert.deepEqual(o.others, [[2, 3], [5, 5]]);
});

test('edgeAtSpan is set when the recommended run reaches the first or last angle given', () => {
  const run = (ws) => { const g = mk(ws.length, 10, 1, ws.map((w, a) => [a, 0, 0, w])); return HC.pickOptimalAngle(HC.widestWindows(g.H, g.dims, SP, 9, 0, ws.length - 1), tolOf); };
  assert.equal(run([5, 6, 6, 3, 1]).edgeAtSpan, true);
  assert.equal(run([2, 5, 6, 5, 2]).edgeAtSpan, false);
  assert.equal(run([1, 2, 5, 6, 6]).edgeAtSpan, true);
});

test('the motor cap clips windows (upper edge = cap) and removes runs that start above it', () => {
  const { H, dims } = mk(1, 12, 1, [[0, 0, 4, 9]]);
  assert.deepEqual(widths(HC.widestWindows(H, dims, SP, 11, 0, 0)), [5]);
  const clipped = HC.widestWindows(H, dims, SP, 6, 0, 0)[0];
  assert.deepEqual([clipped.bLo, clipped.bHi, clipped.width], [4, 6, 2]);
  assert.equal(HC.widestWindows(H, dims, SP, 3, 0, 0)[0].bLo, -1);
});

test('angle range is clipped to the grid', () => {
  const { H, dims } = mk(3, 10, 1, [[0, 0, 0, 3], [1, 0, 0, 3], [2, 0, 0, 3]]);
  assert.deepEqual(HC.widestWindows(H, dims, SP, 9, -5, 99).map((x) => x.a), [0, 1, 2]);
  assert.deepEqual(HC.widestWindows(H, dims, SP, 9, 2, 1), []);
});

test('setpointOf: the grid speed nearest the window middle (rpm is proportional to speed)', () => {
  const geo = Array.from({ length: 20 }, (_, i) => 2 * Math.pow(1.02, i));
  const aw = { a: 4, bLo: 3, bHi: 10, c: 7 };
  const s = HC.setpointOf(aw, geo), mid = (geo[3] + geo[10]) / 2;
  assert.deepEqual([s.a, s.c], [4, 7]);
  for (let b = 3; b <= 10; b++) assert.ok(Math.abs(geo[s.b] - mid) <= Math.abs(geo[b] - mid) + 1e-12);
  assert.deepEqual(HC.setpointOf({ a: 0, bLo: 2, bHi: 5, c: 0 }, SP), { a: 0, b: 3, c: 0 }, 'midpoint 4.5 between speeds 4 and 5 -> the lower');
  assert.equal(HC.setpointOf({ a: 0, bLo: 6, bHi: 6, c: 0 }, SP).b, 6, 'one-cell window');
});

test('runAt: the run holding bNear, else the nearest run (ties -> lower); null outside the grid; respects the cap', () => {
  const { H, dims } = mk(2, 12, 2, [[0, 0, 1, 2], [0, 0, 6, 9]]);
  assert.deepEqual(HC.runAt(H, dims, 0, 0, 7, 11), { bLo: 6, bHi: 9 });
  assert.deepEqual(HC.runAt(H, dims, 0, 0, 3, 11), { bLo: 1, bHi: 2 }, 'nearest below (distance 1 vs 3)');
  assert.deepEqual(HC.runAt(H, dims, 0, 0, 4, 11), { bLo: 1, bHi: 2 }, 'distance 2 to both runs -> the lower');
  assert.deepEqual(HC.runAt(H, dims, 0, 0, 7, 8), { bLo: 6, bHi: 8 }, 'cap 8 clips the upper run');
  assert.deepEqual(HC.runAt(H, dims, 0, 0, 7, 4), { bLo: 1, bHi: 2 }, 'cap 4 leaves only the lower run');
  assert.equal(HC.runAt(H, dims, 1, 0, 3, 11), null, 'empty column');
  assert.equal(HC.runAt(H, dims, 2, 0, 3, 11), null, 'angle outside the grid');
  assert.equal(HC.runAt(H, dims, -1, 0, 3, 11), null);
  assert.equal(HC.runAt(H, dims, 0, 5, 3, 11), null, 'yaw outside the grid');
});

test('sensitivity: width ratio, centre shift, nominalStillScores, and "no window" at the changed angle', () => {
  // nominal (a=2, c=1): run 4..8 (width 4, centre 6); a=3: 5..8; a=1: 2..5; a=4: none; a=0: 0..7 (holds the nominal speed)
  const { H, dims } = mk(5, 12, 3, [[2, 1, 4, 8], [3, 1, 5, 8], [1, 1, 2, 5], [0, 1, 0, 7]]);
  const r = HC.sensitivity(H, dims, SP, { a: 2, b: 6, c: 1 }, [1, -1, 2, -2], 11);
  assert.deepEqual(r.map((x) => [x.dIdx, x.bLo, x.bHi]), [[1, 5, 8], [-1, 2, 5], [2, -1, -1], [-2, 0, 7]]);
  near(r[0].widthRatio, 3 / 4, 1e-12, '+1 ratio'); near(r[0].centerShiftIdx, 0.5, 1e-12, '+1 shift');
  assert.equal(r[0].nominalStillScores, true);    // b = 6 is inside 5..8
  near(r[1].widthRatio, 3 / 4, 1e-12, '-1 ratio'); near(r[1].centerShiftIdx, -2.5, 1e-12, '-1 shift');
  assert.equal(r[1].nominalStillScores, false);   // b = 6 is above 2..5: the window moved away
  assert.deepEqual([r[2].widthRatio, r[2].centerShiftIdx, r[2].nominalStillScores], [0, null, false]);
  near(r[3].widthRatio, 7 / 4, 1e-12, '-2 ratio'); assert.equal(r[3].nominalStillScores, true);
  // an angle off the grid has no window; the cap removes the setpoint
  assert.equal(HC.sensitivity(H, dims, SP, { a: 0, b: 6, c: 1 }, [-1], 11)[0].bLo, -1);
  assert.equal(HC.sensitivity(H, dims, SP, { a: 2, b: 6, c: 1 }, [1], 5)[0].nominalStillScores, false, 'setpoint above the cap');
});

// deterministic pseudo-random grids against a naive oracle
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
test('random grids: widths equal a brute-force oracle; the optimum range is exactly the tied contiguous run', () => {
  const rnd = lcg(12345);
  for (let it = 0; it < 60; it++) {
    const nA = 4 + Math.floor(rnd() * 8), nB = 12, nC = 1 + Math.floor(rnd() * 6), cap = 5 + Math.floor(rnd() * 7);
    const H = new Uint8Array(nA * nB * nC);
    for (let a = 0; a < nA; a++) for (let c = 0; c < nC; c++) { const lo = Math.floor(rnd() * nB), len = Math.floor(rnd() * 7); for (let b = lo; b < Math.min(nB, lo + len); b++) H[(a * nB + b) * nC + c] = 1; if (rnd() < 0.3) H[(a * nB + Math.floor(rnd() * nB)) * nC + c] = 1; }
    const list = HC.widestWindows(H, { nA, nB, nC }, SP, cap, 0, nA - 1);
    const oracle = [];
    for (let a = 0; a < nA; a++) {
      let w = -1;
      for (let c = 0; c < nC; c++) for (let lo = 0; lo <= cap; lo++) for (let hi = lo; hi <= cap; hi++) {
        let all = true; for (let b = lo; b <= hi; b++) if (!H[(a * nB + b) * nC + c]) all = false;
        if (all && SP[hi] - SP[lo] > w) w = SP[hi] - SP[lo];
      }
      oracle.push(w);
    }
    list.forEach((x, a) => { assert.equal(x.bLo >= 0 ? x.width : -1, oracle[a], `iteration ${it}, angle ${a}`); if (x.bLo >= 0) assert.ok(x.bHi <= cap); });
    const o = HC.pickOptimalAngle(list, tolOf), W = Math.max(...oracle);
    if (W < 0) { assert.equal(o, null); continue; }
    const first = oracle.indexOf(W), floor = W - 1;      // tolOf = 1 on the unit speed grid
    let lo = first, hi = first;
    while (lo > 0 && oracle[lo - 1] >= floor) lo--;
    while (hi < nA - 1 && oracle[hi + 1] >= floor) hi++;
    assert.deepEqual([o.aLo, o.aHi, o.width], [lo, hi, W], `iteration ${it} range`);
    assert.ok(o.a >= lo && o.a <= hi && Math.abs(o.a - (lo + hi) / 2) <= 0.5);
  }
});

// ---- D15 advised aim: speed and yaw centred together at a fixed angle
function fromCells(nA, nB, nC, cellsByAngle) {
  const H = new Uint8Array(nA * nB * nC);
  cellsByAngle.forEach((cells, a) => cells.forEach(([b, c]) => { H[(a * nB + b) * nC + c] = 1; }));
  return { H, dims: { nA, nB, nC } };
}

test('centreAim: an asymmetric (triangular) region converges to the joint centre from any start', () => {
  // yaw c allows speeds c..14-c (c <= 7): the window narrows toward high yaw; joint centre = speed 7, yaw run 0..7 -> 3
  const cells = [];
  for (let c = 0; c <= 7; c++) for (let b = c; b <= 14 - c; b++) cells.push([b, c]);
  const { H, dims } = fromCells(1, 16, 8, [cells]), sp = Array.from({ length: 16 }, (_, i) => i);
  for (const [b, c] of [[4, 6], [10, 0], [7, 7], [12, 2], [1, 1]]) assert.deepEqual(HC.centreAim(H, dims, sp, { a: 0, b, c }, 15), { a: 0, b: 7, c: 3 }, `start ${b},${c}`);
  // a stable point is a fixed point of the map and sits in the middle of both runs
  const r = HC.centreAim(H, dims, sp, { a: 0, b: 7, c: 3 }, 15), rb = HC.runAt(H, dims, 0, r.c, r.b, 15), rc = HC.yawRunAt(H, dims, 0, r.b, r.c, 15);
  assert.deepEqual([rb.bLo + rb.bHi, rc.cLo + rc.cHi], [14, 7]);
});

test('centreAim: the speed cap limits the speed run that is centred', () => {
  const cells = []; for (let b = 2; b <= 12; b++) cells.push([b, 3]);
  const { H, dims } = fromCells(1, 14, 7, [cells]), sp = Array.from({ length: 14 }, (_, i) => i);
  assert.equal(HC.centreAim(H, dims, sp, { a: 0, b: 5, c: 3 }, 13).b, 7);
  assert.equal(HC.centreAim(H, dims, sp, { a: 0, b: 5, c: 3 }, 8).b, 5, 'run 2..8 under a cap of 8');
});

test('centreAim: a 2-cycle returns its first point; an empty grid leaves the aim unchanged', () => {
  // found by search: the map (0,4) -> (1,3) -> (0,4) on this 7 x 7 region (cells are [b, c])
  const cells = [[0, 0], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [2, 1], [2, 4], [2, 5], [3, 2], [4, 0], [4, 1], [4, 2], [4, 6], [5, 3], [6, 0], [6, 5], [6, 6]];
  const { H, dims } = fromCells(1, 7, 7, [cells]), sp = [0, 1, 2, 3, 4, 5, 6];
  assert.deepEqual(HC.centreAim(H, dims, sp, { a: 0, b: 0, c: 4 }, 6), { a: 0, b: 0, c: 4 }, 'starting on the cycle: the start');
  assert.deepEqual(HC.centreAim(H, dims, sp, { a: 0, b: 1, c: 3 }, 6), { a: 0, b: 1, c: 3 });
  assert.equal(HC.centreAim(new Uint8Array(49), { nA: 1, nB: 7, nC: 7 }, sp, { a: 0, b: 3, c: 3 }, 6).b, 3, 'no window: unchanged');
});

test('centreAim: the angle is never changed; each angle is centred on its own slice', () => {
  const t = (shift) => { const c = []; for (let b = 2 + shift; b <= 8 + shift; b++) for (let y = 1; y <= 5; y++) c.push([b, y]); return c; };
  const { H, dims } = fromCells(3, 14, 7, [t(0), t(3), t(0)]), sp = Array.from({ length: 14 }, (_, i) => i);
  const r0 = HC.centreAim(H, dims, sp, { a: 0, b: 4, c: 1 }, 13), r1 = HC.centreAim(H, dims, sp, { a: 1, b: 4, c: 1 }, 13);
  assert.deepEqual([r0.a, r0.b, r0.c], [0, 5, 3]); assert.deepEqual([r1.a, r1.b, r1.c], [1, 8, 3]);
});
