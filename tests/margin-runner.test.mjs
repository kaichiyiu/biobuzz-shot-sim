// #15 J2: margin-runner.js main-thread path with the real engine, footprint and tolerance modules; worker path with a fake worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine(), FP = req(path.join(ROOT, 'src', 'footprint.js')), FIELD = loadData().field, MR = req(path.join(ROOT, 'src', 'margin-runner.js'));
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, tolerance: { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 1 } };
const ROBOT = { lengthIn: 18, widthIn: 18, mouthForwardIn: 0 }, PASSES = [66, 33];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function counting() {
  const calls = [], eng = Object.assign({}, E, { evaluate: (p, mode) => { calls.push({ p, mode }); return E.evaluate(p, mode); } });
  return { eng, calls };
}
const base = (extra) => ({ passes: PASSES, robot: ROBOT, field: FIELD, engine: E, footprint: FP, forceMain: true, ...extra });

test('main thread: cells stream via onCell with done/total, promise resolves with all cells; infeasible spots are not evaluated; best:false', async () => {
  const { eng, calls } = counting(), seen = [];
  const r = MR.run(P, base({ engine: eng, onCell: (c, n, t) => seen.push([c, n, t]) })), cells = await r.promise;
  assert.equal(cells.length, 25); assert.equal(seen.length, 25); assert.ok(!cells.cancelled);
  seen.forEach(([c, n, t], i) => { assert.equal(n, i + 1); assert.equal(t, 25); assert.equal(c, cells[i]); });
  const ok = cells.filter((c) => c.feasible), bad = cells.filter((c) => !c.feasible);
  assert.ok(bad.length >= 1 && ok.length >= 5); assert.ok(bad.every((c) => ['wall', 'hive'].includes(c.reason)));
  assert.equal(calls.length, ok.length);
  calls.forEach((c) => { assert.equal(c.mode, 'full'); assert.equal(c.p.tolerance.best, false); });
  assert.equal(P.tolerance.best, undefined);
  const c = ok.find((q) => q.margin !== null), res = E.evaluate({ ...P, mouth: { x: c.x, y: c.y } }, 'full');
  assert.equal(c.margin, res.tolerance.margin); assert.equal(c.verdict, res.tolerance.verdict); assert.equal(c.rpmWidthPct, res.hood.rpmWindow.widthPct);
  assert.equal(cells.filter((q) => q.pass === 0).length, 9); assert.equal(cells.filter((q) => q.pass === 1).length, 16);
  assert.equal(new Set(cells.map((q) => q.x + ',' + q.y)).size, 25);
});

test('main thread: the footprint heading is the line from the mouth to the target mouth centroid', async () => {
  const seenH = [], fp = { defaults: FP.defaults, feasible: (m, h, rb, f) => { seenH.push([m, h]); return FP.feasible(m, h, rb, f); } };
  await MR.run(P, base({ passes: [66], footprint: fp })).promise;
  const cen = E._internal.mouthCentroid('red', -1);
  assert.equal(seenH.length, 9);
  seenH.forEach(([m, h]) => assert.ok(Math.abs(h - Math.atan2(cen[1] - m.y, cen[0] - m.x) * 180 / Math.PI) < 1e-9));
});

test('main thread without tolerance: margin null, legacy verdict, rpmWidthPct kept', async () => {
  const { tolerance, ...plain } = P, cells = await MR.run(plain, base({ passes: [33] })).promise, ok = cells.filter((c) => c.feasible);
  assert.ok(ok.length >= 2); ok.forEach((c) => { assert.equal(c.margin, null); assert.ok(E.VERDICTS.includes(c.verdict)); });
  assert.ok(ok.some((c) => c.rpmWidthPct > 0));
});

test('cancel: resolves with the cells so far and cancelled === true; no further callbacks; engine errors reject', async () => {
  let n = 0, r;
  r = MR.run(P, base({ onCell: () => { if (++n === 3) r.cancel(); } }));
  const cells = await r.promise; await sleep(300);
  assert.equal(cells.cancelled, true); assert.equal(cells.length, 3); assert.equal(n, 3);
  const r2 = MR.run(P, base()); r2.cancel(); const c2 = await r2.promise; assert.equal(c2.length, 0); assert.equal(c2.cancelled, true);
  await assert.rejects(MR.run({ ...P, hiveState: null }, base()).promise);
});

function fakeWorker(script) {
  const wk = { sent: [], terminated: false, postMessage(m) { wk.sent.push(m); script(wk, m); }, terminate() { wk.terminated = true; } };
  return wk;
}
test('worker path: messages per protocol, cells forwarded, terminated at the end; cancel posts cancelMargin', async () => {
  const wk = fakeWorker((w, m) => {
    if (m.type !== 'marginScan') return;
    setTimeout(() => { w.onmessage({ data: { type: 'other', id: 'zzz' } });
      for (let i = 1; i <= 2; i++) w.onmessage({ data: { type: 'marginCell', id: m.id, cell: { x: i, y: 0, feasible: true }, done: i, total: 2 } });
      w.onmessage({ data: { type: 'marginDone', id: m.id } }); }, 0);
  }), got = [];
  const cells = await MR.run(P, { step: 12, robot: ROBOT, field: FIELD, workerFactory: () => wk, onCell: (c, n, t) => got.push([n, t]) }).promise;
  assert.equal(cells.length, 2); assert.deepEqual(got, [[1, 2], [2, 2]]); assert.ok(wk.terminated);
  const m = wk.sent[0]; assert.equal(m.type, 'marginScan'); assert.deepEqual(m.passes, [12, 12]); assert.equal(m.step, 12); assert.equal(m.field, FIELD); assert.equal(m.robot, ROBOT);
  const w2 = fakeWorker(() => {}), r = MR.run(P, { workerFactory: () => Promise.resolve(w2), robot: ROBOT, field: FIELD });
  await sleep(20); r.cancel(); const c2 = await r.promise;
  assert.equal(c2.cancelled, true); assert.equal(w2.sent.map((x) => x.type).join(), 'marginScan,cancelMargin'); assert.ok(w2.terminated);
  const w3 = fakeWorker((w, mm) => { if (mm.type === 'marginScan') setTimeout(() => w.onmessage({ data: { type: 'marginError', id: mm.id, message: 'boom' } }), 0); });
  await assert.rejects(MR.run(P, { workerFactory: () => w3, robot: ROBOT, field: FIELD }).promise, /boom/);
});

test('silent worker or failing factory falls back to the main thread', async () => {
  const w = fakeWorker(() => {}), cells = await MR.run(P, base({ forceMain: false, passes: [66], workerFactory: () => w, firstCellTimeoutMs: 30 })).promise;
  assert.equal(cells.length, 9); assert.ok(w.terminated);
  const c2 = await MR.run(P, base({ forceMain: false, passes: [66], workerFactory: () => { throw new Error('no worker'); } })).promise;
  assert.equal(c2.length, 9);
});
