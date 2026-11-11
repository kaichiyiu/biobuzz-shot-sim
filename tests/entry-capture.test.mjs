// C1 (#12): entry angle / speed captured per rect-hit cell by testTraj; classifyCore gains entryAngleDeg and rectHit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), I = E._internal;

function setup(params) {
  const p = I.normParams(params), sh = p.shooter, bp = E.ballProps(p.ballId), S0 = E.shooterSpin(sh);
  const table = E.buildTable(p.ballId, S0), grid = I.getGrid(p, table), view = I.coarseView(grid);
  return { p, sh, bp, table, grid, view, mo: I.motorById()[p.motorId] };
}
// deterministic sampler (no Math.random: the suite must be repeatable)
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function pick(list, n, rand) { const a = list.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; }
function cell(view, i) { const c = i % view.nC, b = Math.floor(i / view.nC) % view.nB, a = Math.floor(i / (view.nC * view.nB)); return { a, b, c, th: view.thetas[a], v: view.speeds[b], yaw: view.yaws[c] }; }
const core = (s, view, i) => { const k = cell(view, i); return I.classifyCore(s.p, s.grid.ctx, s.table.K, s.table.S0, k.th, k.v, k.yaw); };

const s = setup(BASE), V = s.view;
const rectIdx = [], missIdx = [], pentOnly = [];
for (let i = 0; i < V.hits.length; i++) {
  if (V.rectHits[i]) rectIdx.push(i); else if (V.hits[i]) pentOnly.push(i); else missIdx.push(i);
}

test('view.entry: Float32Array(2 N), carried from the grid, NaN everywhere except rect-hit cells', () => {
  assert.ok(V.entry instanceof Float32Array);
  assert.equal(V.entry.length, 2 * V.hits.length);
  assert.equal(V.entry, s.grid.entry);
  assert.ok(rectIdx.length > 50, 'BASE has enough rect hits: ' + rectIdx.length);
  for (let i = 0; i < V.hits.length; i++) {
    if (V.rectHits[i]) {
      assert.ok(Number.isFinite(V.entry[2 * i]) && Math.abs(V.entry[2 * i]) < 90, 'angle at rect cell ' + i);
      assert.ok(V.entry[2 * i + 1] > 0.5 && V.entry[2 * i + 1] < 40, 'speed at rect cell ' + i);
    } else assert.ok(Number.isNaN(V.entry[2 * i]) && Number.isNaN(V.entry[2 * i + 1]), 'non-rect cell ' + i + ' must be NaN');
  }
});

test('50 random rect-hit cells: entry matches classifyCore within 1 deg and 2 % speed', () => {
  for (const i of pick(rectIdx, 50, rng(12))) {
    const r = core(s, V, i);
    assert.ok(r.hit && r.rectHit, 'cell ' + i);
    assert.ok(Math.abs(V.entry[2 * i] - r.entryAngleDeg) <= 1, `angle ${V.entry[2 * i]} vs ${r.entryAngleDeg}`);
    assert.ok(Math.abs(V.entry[2 * i + 1] / r.entrySpeed - 1) <= 0.02, `speed ${V.entry[2 * i + 1]} vs ${r.entrySpeed}`);
  }
});

test('classifyCore().rectHit equals view.rectHits: 50 rect hits, 50 misses, 50 pentagon-only hits', () => {
  const rand = rng(7), sets = [[rectIdx, true], [missIdx, false], [pentOnly, false]];
  for (const [list, want] of sets) {
    const sample = pick(list, 50, rand);
    assert.ok(sample.length >= (want ? 50 : 1), 'sample size ' + sample.length);
    for (const i of sample) assert.equal(core(s, V, i).rectHit, want, 'cell ' + i);
  }
});

test('classifyShot: angle null without a crossing; descending shots have a negative angle', () => {
  const miss = E.classifyShot(BASE, 10, 3, 0);
  assert.equal(miss.hit, false);
  assert.equal(miss.rectHit, false);
  assert.equal(miss.entryAngleDeg, null);
  const desc = rectIdx.filter((i) => V.entry[2 * i] < 0).length;
  assert.ok(desc > 0, 'some BASE rect hits enter on the way down');
});

test('fine view carries entry with the same NaN rule; grid cache returns the same entry object', () => {
  const sel = I.selectAim(s.view, s.p, s.mo, s.sh, s.bp, false), fine = I.fineStage(s.p, s.table, s.grid, sel, s.mo, s.sh, s.bp).view;
  assert.equal(fine.entry.length, 2 * fine.hits.length);
  let n = 0;
  for (let i = 0; i < fine.hits.length; i++) {
    assert.equal(Number.isNaN(fine.entry[2 * i]), !fine.rectHits[i], 'fine cell ' + i);
    if (fine.rectHits[i]) n++;
  }
  assert.ok(n > 0);
  const again = setup(BASE);
  assert.equal(again.grid, s.grid, 'cache hit');
  assert.equal(again.view.entry, V.entry);
  E.evaluate(BASE, 'coarse');
  assert.equal(I.getGrid(s.p, s.table).entry, V.entry);
});
