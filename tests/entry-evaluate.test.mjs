// C3 (#12): the entry rule inside evaluate() - legacy path untouched, filtering on a copy, empty-window paths, res.entry shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, loadBareEngine, BASE, ROOT } from './load-data.mjs';
import { SPOTS } from './fixtures/make-baseline.mjs';

const E = loadEngine(), I = E._internal;
createRequire(import.meta.url)(path.join(ROOT, 'src', 'engine-entry.js'));   // wiring (C6) is last: load it here
const at = (x, y, extra) => ({ ...BASE, robot: { x, y }, ...extra });
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, FIX45 = { mode: 'fixed', angleDeg: 45 };
const FLAT = at(-60, -60);   // far corner: with the hood floor at 45 deg the unfiltered window is a rising-entry one
const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.timings; delete c.entry; return c; };
const win = (r) => r.best && r.best.scoringWindow;
const within = (a, b) => a[0] >= b[0] - 1e-9 && a[1] <= b[1] + 1e-9;
const DESC = { rule: 'descending' }, ANY = { rule: 'any' }, TINY = { rule: 'maxSpeed', maxSpeedMps: 0.1 };

test('entry absent, {rule:any} or junk: identical results (minus timings); res.entry only when params.entry is present', () => {
  const spots = [...Object.values(SPOTS), FLAT];
  for (const base of spots) for (const hood of [undefined, ADJ]) for (const mode of ['coarse', 'full']) {
    const prm = { ...base, ...(hood ? { hood } : {}) }, ref = E.evaluate(prm, mode);
    assert.ok(!('entry' in ref));
    for (const en of [ANY, { rule: 'sideways' }, 'descending', { rule: 'maxSpeed' }]) {
      const r = E.evaluate({ ...prm, entry: en }, mode);
      assert.deepEqual(strip(r), strip(ref), `${JSON.stringify(en)} ${mode} ${hood ? 'hood' : ''}`);
      assert.deepEqual(r.entry.rule, ANY);
      assert.equal(r.entry.dropped, 0);
    }
  }
});

test('without engine-entry loaded (bare engine) params.entry is ignored: no res.entry, same result', () => {
  const B = loadBareEngine(), a = B.evaluate(BASE, 'full'), b = B.evaluate({ ...BASE, entry: DESC }, 'full');
  assert.ok(!('entry' in b));
  assert.deepEqual(strip(b), strip(a));
});

test('res.entry shape: { rule, kept, dropped, best: { angleDeg, speedMps } } and kept + dropped is the unfiltered count', () => {
  const left = SPOTS.left, a = E.evaluate({ ...left, entry: ANY }, 'full'), d = E.evaluate({ ...left, entry: DESC }, 'full');
  assert.deepEqual(Object.keys(d.entry), ['rule', 'kept', 'dropped', 'best', 'coarse']);
  assert.deepEqual(d.entry.rule, DESC);
  assert.deepEqual(Object.keys(d.entry.best), ['angleDeg', 'speedMps']);
  assert.ok(d.entry.dropped > 0 && d.entry.kept > 0);
  assert.equal(d.entry.kept + d.entry.dropped, a.entry.kept);   // same fine grid: the rule does not move the aim without a hood
  assert.ok(d.entry.best.angleDeg < 0 && d.entry.best.speedMps > 0);
  const c = E.evaluate({ ...left, entry: { rule: 'maxSpeed', maxSpeedMps: 5 } }, 'coarse');
  assert.deepEqual(c.entry.rule, { rule: 'maxSpeed', maxSpeedMps: 5 });
});

test('descending at the flat-shot spot: window empty or entry direction < 0 (never rising); hood picks a steeper angle', () => {
  const a = E.evaluate({ ...FLAT, hood: ADJ, entry: ANY }, 'full'), d = E.evaluate({ ...FLAT, hood: ADJ, entry: DESC }, 'full');
  assert.ok(a.entry.best.angleDeg > 0, 'unfiltered window at this spot enters rising: ' + a.entry.best.angleDeg);
  assert.ok(d.entry.best === null || d.entry.best.angleDeg < 0);
  assert.ok(d.entry.best && d.entry.best.angleDeg < 0 && d.hood.angleDeg > a.hood.angleDeg, 'window survives at a steeper angle');
  const f = E.evaluate({ ...FLAT, hood: FIX45, entry: DESC }, 'full');   // fixed 45 deg: only rising entries exist -> no window
  assert.equal(f.code, 'NO_ARC');
  assert.equal(win(f), null);
  assert.equal(f.entry.best, null);
});

test('filtered window is contained in the unfiltered window (aim cell kept) and strictly narrower', () => {
  const a = E.evaluate({ ...SPOTS.left, entry: ANY }, 'full'), d = E.evaluate({ ...SPOTS.left, entry: DESC }, 'full');
  assert.ok(!win(a).moved && !win(d).moved);
  for (const k of ['thetaDeg', 'v', 'yawDeg']) assert.ok(within(win(d)[k], win(a)[k]), k);
  assert.ok(win(d).thetaDeg[0] > win(a).thetaDeg[0], 'lower launch angles (flatter entry) were dropped');
  const m = E.evaluate({ ...SPOTS.left, entry: { rule: 'maxSpeed', maxSpeedMps: 2.1 } }, 'full');   // entry speed of the aim cell is 2.04 m/s
  assert.ok(m.entry.dropped > 0 && !win(m).moved);
  assert.ok(win(m).thetaDeg[0] > win(a).thetaDeg[0]);
  for (const k of ['thetaDeg', 'v', 'yawDeg']) assert.ok(within(win(m)[k], win(a)[k]), 'maxSpeed ' + k);
});

test('cache not poisoned: descending then any returns the unfiltered result; grid arrays are untouched', () => {
  for (const prm of [SPOTS.left, FLAT, { ...FLAT, hood: ADJ }]) {
    const before = E.evaluate({ ...prm, entry: ANY }, 'full');
    const p = I.normParams(prm), t = E.buildTable(p.ballId, E.shooterSpin(p.shooter)), g = I.getGrid(p, t);
    const snapRect = Uint8Array.from(g.rectHits), snapEntry = Float32Array.from(g.entry), rectRef = g.rectHits, entryRef = g.entry;
    assert.ok(E.evaluate({ ...prm, entry: DESC }, 'coarse').entry.dropped > 0);   // the coarse view is the cached grid's own arrays
    E.evaluate({ ...prm, entry: DESC }, 'full');
    const after = E.evaluate({ ...prm, entry: ANY }, 'full'), plain = E.evaluate(prm, 'full');
    assert.deepEqual(strip(after), strip(before));
    assert.deepEqual(strip(plain), strip(before));
    assert.deepEqual(after.entry, before.entry);
    const g2 = I.getGrid(p, t);
    assert.equal(g2, g);
    assert.equal(g2.rectHits, rectRef); assert.equal(g2.entry, entryRef);
    assert.deepEqual([...g2.rectHits], [...snapRect]);
    assert.deepEqual([...g2.entry].map(String), [...snapEntry].map(String));
  }
});

test('a rule that empties the window never throws: hood -> NO_ARC, no hood -> no scoring window (coarse and full)', () => {
  for (const mode of ['coarse', 'full']) {
    for (const hood of [ADJ, FIX45]) {
      const r = E.evaluate({ ...BASE, hood, entry: TINY }, mode);
      assert.equal(r.code, 'NO_ARC', `hood ${hood.mode} ${mode}`);
      assert.equal(r.best, null);
      assert.equal(r.entry.kept, 0);
      assert.equal(r.entry.best, null);
      assert.ok(r.reason.length > 0);
    }
    for (const prm of [BASE, FLAT, SPOTS.left]) {
      const r = E.evaluate({ ...prm, entry: TINY }, mode);
      assert.ok(['NO_ARC', 'TOO_SLOW', 'HIT'].includes(r.code) || typeof r.code === 'string');
      assert.equal(win(r) || null, null, 'no scoring window when every rect hit is dropped');
      assert.equal(r.entry.kept, 0); assert.equal(r.entry.best, null);
    }
  }
  assert.equal(E.compareMotors({ ...BASE, entry: TINY }).length, 11);   // other entry points ignore the rule and keep working
});
