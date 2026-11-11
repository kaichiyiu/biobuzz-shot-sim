// #4 F5: export-runner.js. Main-thread fallback with the real engine; worker path with a fake Worker that runs worker-export.js in a vm sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const R = req(path.join(ROOT, 'src', 'export-runner.js'));
const WSRC = fs.readFileSync(path.join(ROOT, 'src', 'worker-export.js'), 'utf8');
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, XS = { stepIn: 24, mouthForwardIn: 2 };   // step 24: 3 points (10, 34, 52.6)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expected = () => E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS));

// a Worker stand-in: postMessage -> worker-export.js (in a vm, real engine); replies arrive on onmessage; spy keeps what was posted
function fakeWorker({ silent = false } = {}) {
  const spy = { posted: [], terminated: false };
  const self = Object.assign(new EventTarget(), { ShotEngine: E, postMessage: (m) => { if (!spy.terminated) setTimeout(() => w.onmessage && w.onmessage({ data: structuredClone(m) }), 0); } });
  vm.runInNewContext(WSRC, { self, setTimeout, importScripts: () => {} });
  const w = {
    onmessage: null, onerror: null, spy,
    postMessage(m) { spy.posted.push(m); if (!silent && !spy.terminated) self.dispatchEvent(new MessageEvent('message', { data: structuredClone(m) })); },
    terminate() { spy.terminated = true; }
  };
  return w;
}

test('fallback (no worker): 3 points at step 24, rows equal E.exportPoint, onRow counts up, promise resolves with all rows', async () => {
  const seen = [], h = R.run(P, XS, { engine: E, forceMain: true, onRow: (row, n, t) => seen.push([n, t, row.dMouthIn]) }), rows = await h.promise;
  assert.equal(rows.length, 3); assert.equal(rows.cancelled, undefined);
  assert.deepEqual(rows, expected());
  assert.deepEqual(seen.map((s) => s.slice(0, 2)), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(rows[1].dRobotIn, rows[1].dMouthIn + 2);
  h.cancel();   // after the end: no effect
  assert.equal((await h.promise).cancelled, undefined);
});

test('fallback: factory null, factory throwing and factory rejecting all use the main thread', async () => {
  for (const workerFactory of [() => null, () => { throw new Error('no worker'); }, () => Promise.reject(new Error('blocked')), undefined]) {
    const rows = await R.run(P, { stepIn: 12 }, { engine: E, workerFactory: workerFactory === undefined ? () => undefined : workerFactory }).promise;
    assert.equal(rows.length, E.sweepPoints(P, 12).length);
  }
});

test('cancel: the promise resolves with the partial rows flagged cancelled, and no further onRow arrives; cancel before the first tick gives []', async () => {
  let n = 0, h;
  h = R.run(P, XS, { engine: E, forceMain: true, onRow: () => { n++; h.cancel(); } });
  const rows = await h.promise;
  assert.equal(rows.length, 1); assert.equal(rows.cancelled, true);
  await sleep(600); assert.equal(n, 1);
  const h2 = R.run(P, XS, { engine: E, forceMain: true }); h2.cancel();
  const r2 = await h2.promise; assert.equal(r2.length, 0); assert.equal(r2.cancelled, true);
});

test('errors reject with an Error (invalid hood); no engine also rejects', async () => {
  await assert.rejects(R.run({ ...BASE, hood: { mode: 'fixed' } }, XS, { engine: E, forceMain: true }).promise, /angle/i);
  await assert.rejects(R.run(P, XS, { forceMain: true, engine: {} }).promise, Error);
});

test('worker path: rows come from the dedicated worker (protocol), worker is terminated at the end, etaCurve and settings are forwarded', async () => {
  const wk = fakeWorker(), seen = [], curve = [[0, 0.3], [9000, 0.3]];
  const rows = await R.run(P, XS, { workerFactory: () => Promise.resolve(wk), etaCurve: curve, onRow: (r, n, t) => seen.push([n, t]) }).promise;
  assert.equal(JSON.stringify(rows.map((r) => r.dMouthIn)), JSON.stringify(expected().map((r) => r.dMouthIn))); assert.equal(rows.length, 3);
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
  assert.equal(wk.spy.posted[0].type, 'exportSweep'); assert.deepEqual(wk.spy.posted[0].settings, XS); assert.deepEqual(wk.spy.posted[0].etaCurve, curve);
  assert.equal(wk.spy.terminated, true);
  const plain = fakeWorker(); const r2 = await R.run(P, XS, { workerFactory: () => plain }).promise;   // a plain (non-Promise) worker works too
  assert.equal(JSON.stringify(r2), JSON.stringify(expected()));
});

test('worker path: cancel posts cancelExport, terminates, and resolves the partial rows flagged; a worker error rejects', async () => {
  const wk = fakeWorker(); let h, got = 0;
  h = R.run(P, XS, { workerFactory: () => wk, onRow: () => { got++; if (got === 1) h.cancel(); } });
  const rows = await h.promise;
  assert.equal(rows.cancelled, true); assert.equal(rows.length, 1);
  assert.deepEqual(wk.spy.posted.map((m) => m.type), ['exportSweep', 'cancelExport']); assert.equal(wk.spy.terminated, true);
  await sleep(300); assert.equal(got, 1);
  const bad = fakeWorker();
  await assert.rejects(R.run({ ...BASE, hood: { mode: 'fixed' } }, XS, { workerFactory: () => bad }).promise, /angle/i);
  const dead = fakeWorker({ silent: true }), p = R.run(P, XS, { workerFactory: () => dead });
  await sleep(20); dead.onerror({ message: 'boom' });
  await assert.rejects(p.promise, /boom/);
});

test('worker path: a worker without the export feature (silent) falls back to the main thread after the timeout; cancel before the worker is ready terminates it', async () => {
  const silent = fakeWorker({ silent: true });
  const rows = await R.run(P, { stepIn: 12 }, { engine: E, workerFactory: () => silent, firstRowTimeoutMs: 40 }).promise;
  assert.equal(rows.length, E.sweepPoints(P, 12).length); assert.equal(silent.spy.terminated, true);
  const late = fakeWorker(); let ready;
  const h = R.run(P, XS, { workerFactory: () => new Promise((res) => { ready = () => res(late); }) });
  h.cancel(); ready();
  const r = await h.promise; await sleep(20);
  assert.equal(r.cancelled, true); assert.equal(r.length, 0); assert.equal(late.spy.terminated, true); assert.equal(late.spy.posted.length, 0);
});
