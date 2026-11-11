// F6: pure parts of the export panel (settings, default ticks, soundness flag, table build, cells, range) + the panel/hook on a tiny fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const X = req(path.join(ROOT, 'src', 'ui-export.js')), F = req(path.join(ROOT, 'src', 'export-format.js'));
const CC = req(path.join(ROOT, 'src', 'calib-core.js')), U = req(path.join(ROOT, 'src', 'units.js'));
req(path.join(ROOT, 'src', 'engine-export.js'));
const E = loadEngine();
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } };
const at = (q) => ({ ...P, mouth: { ...P.mouth, x: q.x, y: q.y } });
const rowAt = (i, curve) => { const q = E.sweepPoints(P, 4)[i]; return E.exportRow(E.evaluate(at(q), 'full'), q, P, {}, curve); };

test('normSettings: step clamped 2..12 (default 4), junk -> defaults, servo needs four numbers and distinct angles, formats filtered', () => {
  assert.deepEqual(X.normSettings(null), { stepIn: 4, ticksPerMotorRev: null, mouthForwardIn: 0, servo: null, formats: ['csv', 'json', 'java'] });
  assert.equal(X.normSettings({ stepIn: 0.5 }).stepIn, 2); assert.equal(X.normSettings({ stepIn: 40 }).stepIn, 12);
  assert.equal(X.normSettings({ stepIn: 'x' }).stepIn, 4); assert.equal(X.normSettings({ stepIn: 7.5 }).stepIn, 7.5);
  assert.equal(X.normSettings({ ticksPerMotorRev: -3 }).ticksPerMotorRev, null); assert.equal(X.normSettings({ ticksPerMotorRev: 537.7 }).ticksPerMotorRev, 537.7);
  assert.equal(X.normSettings({ mouthForwardIn: NaN }).mouthForwardIn, 0); assert.equal(X.normSettings({ mouthForwardIn: -2 }).mouthForwardIn, -2);
  assert.equal(X.normSettings({ servo: { deg1: 40, pos1: 0.1, deg2: 40, pos2: 0.9 } }).servo, null);
  assert.equal(X.normSettings({ servo: { deg1: 40, pos1: 0.1, deg2: 70, pos2: null } }).servo, null);
  assert.deepEqual(X.normSettings({ servo: { deg1: 40, pos1: 0.1, deg2: 70, pos2: 0.9 } }).servo, { deg1: 40, pos1: 0.1, deg2: 70, pos2: 0.9 });
  assert.deepEqual(X.normSettings({ formats: ['json', 'xml', 'csv'] }).formats, ['csv', 'json']); assert.deepEqual(X.normSettings({ formats: [] }).formats, []);
});

test('defaultTicks follows the selected motor (encoderPPR); runSettings fills null ticks, keeps an explicit value', () => {
  assert.equal(X.defaultTicks(E, P), 28);
  const other = E.exportSettings({}, { ...P, motorId: 'yj435' }).ticksPerMotorRev;
  assert.equal(X.defaultTicks(E, { ...P, motorId: 'yj435' }), other);
  assert.equal(X.runSettings({ stepIn: 6 }, E, P).ticksPerMotorRev, 28);
  assert.equal(X.runSettings({ ticksPerMotorRev: 100 }, E, P).ticksPerMotorRev, 100);
  assert.equal(X.runSettings({ stepIn: 99 }, E, P).stepIn, 12);
});

test('soundness: a row whose highest rpm exceeds the usable free speed is "over motor limit", reachable:false in the copy, skipped by Java, noted in the header', () => {
  const free = X.usableFreeRpm(E, P), f = CC.exitFactorOf(CC.shooterOf(E, P).sh);
  assert.ok(free > 1000);
  const ok = rowAt(3), curve = [[0, f * 0.3], [1e5, f * 0.3]], bad = rowAt(3, curve);   // low eta -> far more rpm than the motor has
  assert.ok(ok.motorRpm.hi < free && bad.motorRpm.hi > free);
  const rows = [ok, bad], t = X.buildTable(null, null, rows, free, F);
  assert.equal(rows[1].reachable, true);                                    // input not mutated
  assert.equal(t.rows[0].reachable, true); assert.equal(t.rows[1].reachable, false); assert.equal(t.rows[1].overMotorLimit, true);
  assert.ok(t.header.notes.some((n) => /Over motor limit: 1 row/.test(n)));
  assert.equal(X.buildTable(null, null, [ok], free, F).header.notes.some((n) => /Over motor limit/.test(n)), false);
  const java = F.toJavaArrays({ header: t.header, rows: [{ ...ok, dRobotIn: 20 }, { ...bad, ...t.rows[1], dRobotIn: 30 }] }, 'T');
  assert.match(java, /DIST_IN = \{\s*20\s*\}/); assert.doesNotMatch(java.match(/DIST_IN = \{[^}]*\}/)[0], /30/);   // the DIST_IN array only: the header carries an ISO timestamp (e.g. '.730Z')
  const cells = X.rowCells(t.rows, U, 'imperial');
  assert.equal(cells[1].note, 'over motor limit'); assert.equal(cells[1].bad, true); assert.equal(cells[0].note, '');
});

test('exportRange: reachable rows only (limited copy), null when none; calibration curve only for mode perRpm', () => {
  const a = rowAt(3), b = rowAt(5);
  const rg = X.rangeOf([a, b]);
  assert.equal(rg[0], Math.min(a.motorRpm.lo, b.motorRpm.lo)); assert.equal(rg[1], Math.max(a.motorRpm.hi, b.motorRpm.hi));
  assert.equal(X.rangeOf([{ ...a, reachable: false }]), null); assert.equal(X.rangeOf([]), null);
  const curve = [[0, 0.4], [9000, 0.5]];
  assert.equal(X.etaCurveOf({ calibrated: true, mode: 'perRpm', fit: { curve } }), curve);
  assert.equal(X.etaCurveOf({ calibrated: true, mode: 'single', fit: { curve } }), undefined); assert.equal(X.etaCurveOf(null), undefined);
});

test('rowCells: distance in display units, unreachable rows show their verdict', () => {
  const r = rowAt(3), c = X.rowCells([r], U, 'metric')[0];
  assert.equal(c.dist, U.nf(U.toLen(r.dRobotIn, 'metric'), 1)); assert.match(c.rpm, /^[\d,]+ \[[\d,]+-[\d,]+\]$/); assert.match(c.angle, /°$/);
  const u = X.rowCells([{ dRobotIn: 40, dMouthIn: 40, reachable: false, verdict: "WON'T WORK" }], U, 'imperial')[0];
  assert.equal(u.note, "won't work"); assert.equal(u.rpm, '-');
});

test('CSV through buildTable carries the uncalibrated note and the column row', () => {
  const t = X.buildTable(null, null, [rowAt(3)], X.usableFreeRpm(E, P), F), csv = X.textOf(F, 'csv', t);
  assert.match(csv, /NOT CALIBRATED/); assert.ok(csv.split('\n').some((l) => l.startsWith('dMouthIn,')));
  assert.ok(JSON.parse(X.textOf(F, 'json', t)).rows.length === 1);
});

// P1-F3: the browser hook on a fake window. A run captures params / calibration / cfg / curve at start; a change mid-run must not leak into the header, the motor-limit flag or the algorithm section.
function rig() {
  const log = { say: [], tables: [], algo: [], runs: [] }, live = { cfg: { field: { h0: 16 } }, calib: null };
  const panel = { calibrated() {}, sync() {}, busy() {}, progress() {}, say: (t) => log.say.push(t), table: (cells) => log.tables.push(cells) };
  let deps = null;
  const win = {
    ShotUI: { hooks: [], exportPanel: { mount: (host, d) => { deps = d; return panel; } }, config: { collect: () => JSON.parse(JSON.stringify(live.cfg)) }, calibReport: { record: () => live.calib },
      exportAlgo: { setTable: (d) => log.algo.push(d) } },
    ExportFormat: F, ExportRunner: { run: (p, xs, o) => { let res; const promise = new Promise((r) => { res = r; }); const h = { p, xs, o, promise, finish: (rows) => res(rows), cancel() {} }; log.runs.push(h); return h; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'ui-export.js'), 'utf8'), { window: win, document: { getElementById: () => ({}) }, JSON, Object, Math, Promise, Array, Number, isFinite });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'export');
  hook.onStart({ engine: E, units: U, state: { units: 'imperial' }, recalc() {} });
  return { hook, deps, log, live, win };
}
const pKey = (p) => JSON.stringify(p);

test('F3 stale settings: params / cfg / calibration changed during the run -> header, motor limit and algorithm section use the START values, result is labelled', async () => {
  const { hook, deps, log, live } = rig(), P1 = P, P2 = { ...P, h0: 22, motorId: 'yj435' };
  hook.onResult({}, P1, 'full'); deps.run();
  assert.equal(log.runs.length, 1); assert.equal(pKey(log.runs[0].p), pKey(P1)); assert.equal(log.runs[0].o.etaCurve, undefined);
  live.cfg = { field: { h0: 22 } }; live.calib = { calibrated: true, mode: 'perRpm', fit: { curve: [[0, 0.3], [1e5, 0.3]] } };   // the user moves a slider and applies a calibration during the run
  hook.onResult({}, P2, 'full');
  const free1 = X.usableFreeRpm(E, P1), free2 = X.usableFreeRpm(E, P2);
  assert.notEqual(free1, free2);
  const mid = (free1 + free2) / 2, ok = rowAt(3), between = { ...rowAt(5), motorRpm: { lo: mid * 0.9, c: mid * 0.95, hi: mid } };   // highest rpm between the two motors' limits: the flag tells which one was used
  log.runs[0].finish([ok, between]); await log.runs[0].promise; await new Promise((r) => setImmediate(r));
  assert.equal(log.algo.length, 1);
  const a = log.algo[0];
  assert.equal(pKey(a.params), pKey(P1)); assert.equal(a.cfg.field.h0, 16); assert.equal(a.etaCurve, undefined); assert.equal(a.ready, true);
  assert.equal(!!a.rows[1].overMotorLimit, mid > free1, 'flagged against the START motor (P1), not the live one'); assert.equal(a.rows[0].reachable, true);
  assert.match(log.say[log.say.length - 1], /settings at the start of the run/);
  assert.ok(a.rows.length === 2);
});

test('F3: no change -> not labelled; a change that is reverted before the end is not stale; a cancelled run is labelled too', async () => {
  const r1 = rig(); r1.hook.onResult({}, P, 'full'); r1.deps.run(); r1.log.runs[0].finish([rowAt(3)]); await r1.log.runs[0].promise; await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(r1.log.say[r1.log.say.length - 1], /settings at the start/); assert.equal(r1.log.algo[0].params, P);
  const r2 = rig(); r2.hook.onResult({}, P, 'full'); r2.deps.run(); r2.hook.onResult({}, { ...P, h0: 20 }, 'coarse'); r2.hook.onResult({}, P, 'full');
  r2.log.runs[0].finish([rowAt(3)]); await r2.log.runs[0].promise; await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(r2.log.say[r2.log.say.length - 1], /settings at the start/);
  const r3 = rig(); r3.hook.onResult({}, P, 'full'); r3.deps.run(); r3.hook.onResult({}, { ...P, h0: 20 }, 'full');
  const rows = [rowAt(3)]; rows.cancelled = true; r3.log.runs[0].finish(rows); await r3.log.runs[0].promise; await new Promise((r) => setImmediate(r));
  assert.match(r3.log.say[r3.log.say.length - 1], /Cancelled after 1 rows.*settings at the start of the run/); assert.equal(r3.log.algo[0].ready, false);
});

test('F3 pure: isStale compares params and calibration by value; the note text is exported', () => {
  const cap = { p: { a: 1 }, calib: { x: 1 } };
  assert.equal(X.isStale(cap, { a: 1 }, { x: 1 }), false); assert.equal(X.isStale(cap, { a: 2 }, { x: 1 }), true); assert.equal(X.isStale(cap, { a: 1 }, null), true);
  assert.equal(X.isStale({ p: null, calib: null }, undefined, null), false); assert.match(X.STALE_NOTE, /settings at the start of the run/);
});
