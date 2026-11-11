// #15 J2: worker-margin.js protocol in a vm sandbox with a fake worker `self`, the real engine, tolerance modules and footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine(), FP = req(path.join(ROOT, 'src', 'footprint.js')), FIELD = loadData().field;
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'worker-margin.js'), 'utf8');
const TOL = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 1 }, ROBOT = { lengthIn: 18, widthIn: 18, mouthForwardIn: 0 };
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, tolerance: TOL };
const PASSES = [66, 33];   // 9 + 16 spots: cheap test grid (second pass shares 0 / +-66 with the first)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// returns { self, out, send(data), onPost(fn), calls: evaluate argument log }
function boot({ asWorker = true, engine = E } = {}) {
  const out = [], hooks = [], calls = [];
  const eng = Object.assign({}, engine, { evaluate: (p, mode) => { calls.push({ p, mode }); return engine.evaluate(p, mode); } });
  const self = Object.assign(new EventTarget(), { ShotEngine: eng, ShotFootprint: FP, postMessage: (m) => { out.push(m); hooks.forEach((h) => h(m)); } });
  vm.runInNewContext(SRC, { self, setTimeout, importScripts: asWorker ? () => {} : undefined });
  return { self, out, calls, send: (data) => self.dispatchEvent(new MessageEvent('message', { data })), onPost: (h) => hooks.push(h) };
}
async function until(w, pred, ms = 60000) {
  const t0 = Date.now();
  while (!pred(w.out)) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + w.out.length + ' msgs'); await sleep(5); }
}
const scan = (id, extra = {}) => ({ type: 'marginScan', id, params: P, passes: PASSES, robot: ROBOT, field: FIELD, ...extra });

test('cells stream with done/total and the documented shape; infeasible cells are not evaluated; best:false and full mode forced', async () => {
  const w = boot(); w.send(scan('m1'));
  await until(w, (o) => o.some((m) => m.type === 'marginDone'));
  const cells = w.out.filter((m) => m.type === 'marginCell'), total = 9 + 16;
  assert.equal(cells.length, total); assert.equal(w.out[w.out.length - 1].type, 'marginDone');
  cells.forEach((m, i) => { assert.equal(m.id, 'm1'); assert.equal(m.done, i + 1); assert.equal(m.total, total); });
  const bad = cells.filter((m) => !m.cell.feasible), ok = cells.filter((m) => m.cell.feasible);
  assert.ok(bad.length >= 1 && ok.length >= 5, `${bad.length} infeasible / ${ok.length} feasible`);
  bad.forEach((m) => { assert.ok(['wall', 'hive'].includes(m.cell.reason)); assert.equal(m.cell.margin, undefined); });
  assert.equal(w.calls.length, ok.length, 'one evaluate per feasible spot, none for infeasible');
  w.calls.forEach((c) => { assert.equal(c.mode, 'full'); assert.equal(c.p.tolerance.best, false); assert.equal(c.p.tolerance.rpm, 25); });
  assert.equal(P.tolerance.best, undefined, 'the caller params are not mutated');
  const c = ok[0].cell;
  for (const k of ['x', 'y', 'pass', 'feasible', 'reason', 'margin', 'verdict', 'limitingAxis', 'lowerBound', 'capped', 'rpmWidthPct', 'motorRpm']) assert.ok(k in c, k);
  assert.ok(ok.every((m) => m.cell.margin === null || Number.isFinite(m.cell.margin)));
  assert.ok(ok.some((m) => m.cell.rpmWidthPct > 0 && m.cell.motorRpm > 0));
});

test('a spot near the default robot has a positive margin, a limiting axis and a verdict from the margin bands', async () => {
  const w = boot(); w.onPost((m) => { if (m.type === 'marginCell' && m.cell.x === -12 && m.cell.y === -48) w.send({ type: 'cancelMargin' }); });
  w.send(scan('g', { passes: [12] })); await until(w, (o) => o.some((m) => m.cell && m.cell.x === -12 && m.cell.y === -48));
  const c = w.out[w.out.length - 1].cell;
  assert.ok(c.feasible && c.margin > 0 && c.margin <= 4, String(c.margin)); assert.ok(['yaw', 'angle', 'rpm', 'along'].includes(c.limitingAxis));
  assert.equal(c.verdict, E.evaluate({ ...P, mouth: { x: -12, y: -48 } }, 'full').tolerance.verdict);
}, { timeout: 120000 });

test('second pass skips the first-pass spots; passes default to [12, step]', async () => {
  const w = boot(); w.send(scan('p'));
  await until(w, (o) => o.some((m) => m.type === 'marginDone'));
  const cells = w.out.filter((m) => m.type === 'marginCell').map((m) => m.cell), keys = cells.map((c) => c.x + ',' + c.y);
  assert.equal(new Set(keys).size, keys.length, 'no spot twice');
  assert.equal(cells.filter((c) => c.pass === 0).length, 9); assert.equal(cells.filter((c) => c.pass === 1).length, 16);
  assert.ok(cells.slice(0, 9).every((c) => c.pass === 0) && cells.slice(9).every((c) => c.pass === 1));
  assert.ok(cells.filter((c) => c.pass === 1).every((c) => c.x % 66 !== 0 || c.y % 66 !== 0));
  const d = boot(), seen = new Set(E.scanPoints(12).map((q) => q.x + ',' + q.y));   // default passes [12, step]
  d.onPost((m) => { if (m.type === 'marginCell') d.send({ type: 'cancelMargin' }); });
  d.send({ type: 'marginScan', id: 'd', params: P, step: 66, robot: ROBOT, field: FIELD }); await sleep(800);
  const extra = E.scanPoints(66).filter((q) => !seen.has(q.x + ',' + q.y)).length;
  assert.equal(d.out[0].total, E.scanPoints(12).length + extra); assert.equal(d.out[0].cell.pass, 0);
});


test('without params.tolerance: cells keep rpmWidthPct and the legacy verdict, margin null', async () => {
  const { tolerance, ...plain } = P, w = boot(); w.send(scan('n', { params: plain, passes: [33] }));
  await until(w, (o) => o.some((m) => m.type === 'marginDone'));
  const ok = w.out.filter((m) => m.type === 'marginCell' && m.cell.feasible).map((m) => m.cell);
  assert.ok(ok.length >= 2);
  ok.forEach((c) => { assert.equal(c.margin, null); assert.equal(c.limitingAxis, null); assert.ok(E.VERDICTS.includes(c.verdict)); });
  assert.ok(ok.some((c) => c.rpmWidthPct > 0));
  w.calls.forEach((c) => assert.ok(!('tolerance' in c.p)));
});

test('cancelMargin from inside a reply stops the scan; a pending tick never computes; a new scan supersedes; errors come back', async () => {
  const w = boot(); w.onPost((m) => { if (m.type === 'marginCell' && m.done === 2) w.send({ type: 'cancelMargin' }); });
  w.send(scan('c1')); await sleep(1500);
  assert.ok(w.out.length >= 2 && w.out.length <= 3, String(w.out.length)); assert.ok(!w.out.some((m) => m.type === 'marginDone'));
  const w2 = boot(); w2.send(scan('c2')); w2.send({ type: 'cancelMargin' }); await sleep(500);
  assert.equal(w2.out.length, 0); assert.equal(w2.calls.length, 0);
  const w3 = boot(); let sent = false;
  w3.onPost((m) => { if (!sent && m.id === 'a') { sent = true; w3.send(scan('b', { passes: [66] })); } });
  w3.send(scan('a')); await until(w3, (o) => o.some((m) => m.type === 'marginDone'));
  assert.equal(w3.out.filter((m) => m.id === 'a').length, 1); assert.equal(w3.out.filter((m) => m.id === 'b' && m.type === 'marginCell').length, 9);
  const e = boot(); e.send(scan('x', { params: { ...P, hiveState: null } })); await until(e, (o) => o.length > 0);
  assert.equal(e.out[0].type, 'marginError'); assert.equal(e.out[0].id, 'x'); assert.equal(e.out.length, 1);
});

test('other messages and junk ignored; no listener outside a worker', async () => {
  const w = boot();
  for (const d of [{ type: 'init', data: {} }, { type: 'scan', id: 1 }, { type: 'exportSweep' }, { type: 'cancelExport' }, null, 'x', 5, {}]) w.send(d);
  await sleep(100); assert.equal(w.out.length, 0);
  let added = 0; const self = { ShotEngine: E, postMessage() {}, addEventListener() { added++; } };
  vm.runInNewContext(SRC, { self, setTimeout }); assert.equal(added, 0);
});
