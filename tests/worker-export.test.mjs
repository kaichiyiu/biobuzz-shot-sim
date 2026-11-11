// #4 F3: worker-export.js protocol, in a vm sandbox with a fake worker `self` (EventTarget + postMessage collector) and the real engine.
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
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'worker-export.js'), 'utf8');
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, XS = { stepIn: 12, mouthForwardIn: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// returns { self, out, send(data), onPost(fn) }; asWorker = false leaves importScripts undefined (main thread)
function boot(asWorker = true) {
  const out = [], hooks = [], self = Object.assign(new EventTarget(), { ShotEngine: E, postMessage: (m) => { out.push(m); hooks.forEach((h) => h(m)); } });
  vm.runInNewContext(SRC, { self, setTimeout, importScripts: asWorker ? () => {} : undefined });
  return { self, out, send: (data) => self.dispatchEvent(new MessageEvent('message', { data })), onPost: (h) => hooks.push(h) };
}
async function until(w, pred, ms = 20000) {
  const t0 = Date.now();
  while (!pred(w.out)) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + JSON.stringify(w.out.map((m) => m.type))); await sleep(5); }
}

test('inside a worker: N rows then exportDone, rows equal E.exportPoint, done/total count up, ids echoed', async () => {
  const w = boot(); w.send({ type: 'exportSweep', id: 'e1', params: P, settings: XS });
  await until(w, (o) => o.some((m) => m.type === 'exportDone'));
  const pts = E.exportPoints(P, XS), rows = w.out.filter((m) => m.type === 'exportRow');
  assert.equal(rows.length, pts.length); assert.ok(pts.length >= 4);
  rows.forEach((m, i) => { assert.equal(m.id, 'e1'); assert.equal(m.done, i + 1); assert.equal(m.total, pts.length); assert.deepEqual(m.row, E.exportPoint(P, pts[i], XS)); });
  assert.equal(JSON.stringify(w.out[w.out.length - 1]), JSON.stringify({ type: 'exportDone', id: 'e1' }));   // vm-realm object: compare as JSON assert.equal(w.out.length, pts.length + 1);
  assert.equal(rows[1].row.dRobotIn, rows[1].row.dMouthIn + 3);
});

test('cancelExport from inside the first reply stops before the next row; a pending tick never computes; no done message', async () => {
  const w = boot(); w.onPost((m) => { if (m.type === 'exportRow' && m.done === 1) w.send({ type: 'cancelExport' }); });
  w.send({ type: 'exportSweep', id: 'c1', params: P, settings: XS });
  await sleep(1200);
  assert.equal(w.out.map((m) => m.type).join(), 'exportRow');
  const w2 = boot(); w2.send({ type: 'exportSweep', id: 'c2', params: P, settings: XS }); w2.send({ type: 'cancelExport' });   // cancel before the first tick fired
  await sleep(500);
  assert.equal(w2.out.length, 0);
});

test('a new exportSweep supersedes the running one (old ids go quiet); errors come back as exportError', async () => {
  const w = boot(); let sent = false;
  w.onPost((m) => { if (!sent && m.id === 'a') { sent = true; w.send({ type: 'exportSweep', id: 'b', params: P, settings: { stepIn: 12 } }); } });
  w.send({ type: 'exportSweep', id: 'a', params: P, settings: XS });
  await until(w, (o) => o.some((m) => m.type === 'exportDone'));
  assert.equal(w.out.filter((m) => m.id === 'a').length, 1);
  assert.ok(w.out.filter((m) => m.id === 'b' && m.type === 'exportRow').length >= 4);
  const e = boot(); e.send({ type: 'exportSweep', id: 'x', params: { ...BASE, hood: { mode: 'fixed' } }, settings: XS });
  await until(e, (o) => o.length > 0);
  assert.equal(e.out[0].type, 'exportError'); assert.equal(e.out[0].id, 'x'); assert.match(e.out[0].message, /angle/i);
  assert.equal(e.out.length, 1);
});

test('other message types and junk are ignored (no reply); outside a worker no listener is registered at all', async () => {
  const w = boot();
  for (const d of [{ type: 'init', data: {} }, { type: 'evaluate', id: 1, params: P, mode: 'full' }, { type: 'sweep', id: 's', params: P }, { type: 'cancelSweep' }, { type: 'scan' }, null, 'x', 5, {}]) w.send(d);
  await sleep(100);
  assert.equal(w.out.length, 0);
  let added = 0; const self = { ShotEngine: E, postMessage() {}, addEventListener() { added++; } };
  vm.runInNewContext(SRC, { self, setTimeout });   // no importScripts: main thread
  assert.equal(added, 0);
  const m = boot(false); m.send({ type: 'exportSweep', id: 'z', params: P, settings: XS }); await sleep(100); assert.equal(m.out.length, 0);
});
