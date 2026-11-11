// G4: pure helpers of the "On-robot algorithm" section (prepare, downloads' text, vectors, cell formatting, midpoint points, chunked runChecks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const A = req(path.join(ROOT, 'src', 'ui-export-algo.js')), S = req(path.join(ROOT, 'src', 'export-solver.js')), X = req(path.join(ROOT, 'src', 'export-compare.js')), U = req(path.join(ROOT, 'src', 'units.js'));
const E = loadEngine(), XS = { stepIn: 4, mouthForwardIn: 5.5 };
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } };
const rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS));
const prep = A.prepare(rows, P, E), tpl = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'ShotSolver.java.txt'), 'utf8');

test('prepare: usable with reachable rows, not usable (with a reason) for none', () => {
  assert.equal(prep.usable, true); assert.equal(prep.reason, ''); assert.ok(prep.c.aim.length >= 7);
  const none = A.prepare(rows.map((r) => ({ ...r, reachable: false })), P, E);
  assert.equal(none.usable, false); assert.match(none.reason, /no reachable row/);
  assert.equal(A.prepare([], P, E).usable, false);
});

test('javaText: rendered class has no placeholder left; a missing template is an error', () => {
  const j = A.javaText(prep.c, tpl);
  assert.ok(j.length > 1000 && !j.includes('{{') && /class ShotSolver/.test(j));
  assert.throws(() => A.javaText(prep.c, undefined), /not loaded/); assert.throws(() => A.javaText(prep.c, ''), /not loaded/);
});

test('vectorDistances / vectorsText: 3 in outside each end, 1 in steps inside; CSV = ExportCompare.vectorsCsv of those distances', () => {
  const reach = rows.filter((r) => r.reachable).map((r) => r.dRobotIn), lo = Math.min(...reach), hi = Math.max(...reach), d = A.vectorDistances(rows);
  assert.equal(d[0], lo - 3); assert.equal(d[1], Math.ceil(lo)); assert.equal(d[d.length - 1], hi + 3); assert.equal(d[d.length - 2], hi);
  for (let i = 2; i < d.length - 3; i++) assert.equal(d[i] - d[i - 1], 1);
  assert.deepEqual(A.vectorDistances([]), []); assert.deepEqual(A.vectorDistances([{ reachable: false, dRobotIn: 5 }]), []);
  const csv = A.vectorsText(prep.c, rows), lines = csv.trim().split('\n');
  assert.equal(lines[0], 'dRobotIn,thetaDeg,vMps,motorRpm,ticksPerSec,ok,iterations'); assert.equal(lines.length, d.length + 1);
  assert.equal(csv, X.vectorsCsv(X.vectors(prep.c, d)));
  assert.equal(Number(lines[1].split(',')[0]), lo - 3); assert.equal(Number(lines[lines.length - 1].split(',')[0]), hi + 3);   // outside points are in the file (the solver clamps its tables there; ok per the solver)
});

test('compareCells / checkCells / summary: strings in display units, bad flags, counts', () => {
  const cc = A.compareCells([{ dRobotIn: 24, tableRpm: 2100.4, algoRpm: 2130.2, diffPctOfWindow: 28.34, ok: true }, { dRobotIn: 30, tableRpm: 2200, algoRpm: null, diffPctOfWindow: null, ok: false }, { dRobotIn: 36, tableRpm: 2300, algoRpm: 2500, diffPctOfWindow: 60, ok: true }], U, 'imperial');
  assert.deepEqual(cc.map((c) => c.bad), [false, true, true]); assert.equal(cc[0].dist, U.nf(24, 1)); assert.equal(cc[0].diff, '28.3 %'); assert.equal(cc[1].diff, 'no solution'); assert.equal(cc[1].algo, '-');
  assert.equal(A.compareCells([{ dRobotIn: 25.4, tableRpm: 1, algoRpm: 1, diffPctOfWindow: 0, ok: true }], U, 'metric')[0].dist, U.nf(U.toLen(25.4, 'metric'), 1));
  const list = [
    { dRobotIn: 20, algoAngle: 70.25, algoRpm: 2100, windowLo: 2050, windowHi: 2150, inWindow: true, offsetPctOfHalfWindow: 0, ok: true, reachable: true },
    { dRobotIn: 24, algoAngle: 70, algoRpm: 2300, windowLo: 2050, windowHi: 2150, inWindow: false, offsetPctOfHalfWindow: 300, ok: true, reachable: true },
    { dRobotIn: 28, algoAngle: 60, algoRpm: 2000, windowLo: null, windowHi: null, inWindow: false, offsetPctOfHalfWindow: null, ok: true, reachable: false },
    { dRobotIn: 32, algoAngle: NaN, algoRpm: null, windowLo: null, windowHi: null, inWindow: false, offsetPctOfHalfWindow: null, ok: false, reachable: false },
    { dRobotIn: 36, algoAngle: NaN, algoRpm: null, windowLo: null, windowHi: null, inWindow: false, offsetPctOfHalfWindow: null, ok: true, reachable: false, error: 'boom' }];
  const k = A.checkCells(list, U, 'imperial');
  assert.deepEqual(k.map((c) => c.status), ['in window', 'OUT', 'no window', 'no solution', 'error']); assert.deepEqual(k.map((c) => c.bad), [false, true, true, true, true]);
  assert.equal(k[0].win, '2,050-2,150'); assert.equal(k[0].angle, '70.3°'); assert.equal(k[1].off, '300 %'); assert.equal(k[3].angle, '-');
  const s = A.summary(list); assert.deepEqual([s.n, s.inside, s.outside, s.noWindow], [5, 1, 1, 3]); assert.match(s.text, /^1 of 5 points/);
});

test('midpointQs: one point halfway between each pair of neighbouring table rows (half-step grid minus the table grid), inside the reachable range', () => {
  const qs = A.midpointQs(E, P, rows, prep.c), ds = qs.map((q) => q.d + prep.c.mouthForwardIn), reach = rows.filter((r) => r.reachable).map((r) => r.dRobotIn);
  assert.ok(qs.length >= 9, String(qs.length));
  ds.forEach((d) => { assert.ok(d > Math.min(...reach) && d < Math.max(...reach)); assert.ok(!reach.some((r) => Math.abs(r - d) < 1e-6)); });
  assert.ok(ds.slice(1).every((d, i) => Math.abs(d - ds[i] - 4) < 1e-6));   // spaced by the table step
  assert.ok(qs.every((q) => typeof q.x === 'number' && typeof q.y === 'number'));
  assert.deepEqual(A.midpointQs(E, P, [], prep.c), []); assert.deepEqual(A.midpointQs(E, P, rows.slice(0, 1), prep.c), []);
});

test('runChecks: one checkAt per scheduled tick, onPoint/onDone, cancel stops and reports cancelled; a throwing point becomes an error entry', () => {
  const qs = A.midpointQs(E, P, rows, prep.c).slice(0, 3), queue = [], schedule = (f) => queue.push(f), seen = [];
  let done = null;
  const job = A.runChecks(E, P, prep.c, qs, { schedule, onPoint: (r, i, n) => seen.push([i, n]), onDone: (l, cancelled) => { done = [l, cancelled]; } });
  assert.equal(queue.length, 1); assert.equal(seen.length, 0);   // nothing runs before the first tick
  queue.shift()(); assert.equal(seen.length, 1); assert.equal(queue.length, 1);
  queue.shift()(); queue.shift()(); assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]); assert.equal(done, null);
  queue.shift()(); assert.equal(done[1], false); assert.equal(done[0].length, 3); assert.equal(queue.length, 0);
  done[0].forEach((r, i) => assert.deepEqual(r, X.checkAt(P, E, prep.c, qs[i])));
  // cancel after the first point
  const q2 = [], got = []; let d2 = null;
  const j2 = A.runChecks(E, P, prep.c, qs, { schedule: (f) => q2.push(f), onPoint: (r) => got.push(r), onDone: (l, c) => { d2 = [l.length, c, d2 ? d2[2] + 1 : 1]; } });
  q2.shift()(); j2.cancel(); j2.cancel(); assert.deepEqual(d2, [1, true, 1]); q2.shift()(); assert.equal(got.length, 1);
  // throwing engine
  const q3 = []; let l3 = null;
  A.runChecks({ evaluate() { throw new Error('boom'); }, exportRow() { throw new Error('boom'); } }, P, prep.c, qs.slice(0, 1), { schedule: (f) => q3.push(f), onDone: (l) => { l3 = l; } });
  q3.shift()(); q3.shift()(); assert.equal(l3[0].error, 'boom'); assert.equal(l3[0].inWindow, false);
});
