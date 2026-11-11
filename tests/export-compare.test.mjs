// #4 G3: test vectors for the Java port and the table-vs-algorithm comparison, on real engine rows at BASE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const S = req(path.join(ROOT, 'src', 'export-solver.js')), X = req(path.join(ROOT, 'src', 'export-compare.js'));
const XS = { stepIn: 4, mouthForwardIn: 5.5 };
const HOODS = { adjustable: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, fixed: { mode: 'fixed', angleDeg: 62.5 }, legacy: undefined };
const mkP = (hood) => ({ ...BASE, hood });
const mk2 = (hood) => { const P = mkP(hood), rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS)); return { P, rows, c: S.constantsFrom(P, rows, E) }; };
const CASES = [['adjustable', mk2(HOODS.adjustable)], ['fixed', mk2(HOODS.fixed)], ['legacy', mk2(HOODS.legacy)]];
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

test('vectors: one entry per distance, equal to solveSpeed (angle, speed, rpm, ticks, ok, iterations)', () => {
  const { c } = CASES[0][1], ds = [20, 30.5, 41, 52, 5000, 5];
  const v = X.vectors(c, ds);
  assert.equal(v.length, ds.length);
  v.forEach((e, i) => { const s = S.solveSpeed(c, ds[i]); assert.equal(e.dRobotIn, ds[i]); for (const k of ['thetaDeg', 'vMps', 'motorRpm', 'ticksPerSec']) assert.ok(Object.is(e[k], s[k]) || e[k] === s[k], k); assert.equal(e.ok, s.ok); assert.equal(e.iterations, s.iterations); });
  assert.equal(v[4].ok, false); assert.equal(v[5].ok, false);   // 5000 in: beyond reach; 5 in: inside the mouth-forward offset
});

test('vectorsCsv: header + one line per vector, numbers round trip exactly, NaN prints as NaN', () => {
  const { c } = CASES[1][1], list = X.vectors(c, [25, 35, 45, 900]), lines = X.vectorsCsv(list).trim().split('\n');
  assert.equal(lines[0], 'dRobotIn,thetaDeg,vMps,motorRpm,ticksPerSec,ok,iterations'); assert.equal(lines.length, 5);
  lines.slice(1).forEach((l, i) => { const f = l.split(','); for (let k = 0; k < 5; k++) assert.ok(Object.is(Number(f[k]), [list[i].dRobotIn, list[i].thetaDeg, list[i].vMps, list[i].motorRpm, list[i].ticksPerSec][k])); assert.equal(f[5], String(list[i].ok)); });
  assert.match(lines[4], /,NaN,NaN,NaN,false,/);
});

for (const [name, { rows, c }] of CASES) {
  test(`compare ${name} at BASE table distances: reachable rows only; diffPctOfWindow = |algo - table| / (hi - lo) * 100, ~0 by construction`, () => {
    const cmp = X.compare(rows, c), ok = rows.filter((r) => r.reachable);
    assert.equal(cmp.length, ok.length); assert.ok(cmp.length >= 7);
    cmp.forEach((e, i) => {
      const r = ok[i], s = S.solveSpeed(c, r.dRobotIn);
      assert.equal(e.dRobotIn, r.dRobotIn); assert.equal(e.tableRpm, r.motorRpm.c); assert.equal(e.algoRpm, s.motorRpm); assert.equal(e.windowRpm, r.motorRpm.hi - r.motorRpm.lo); assert.equal(e.ok, true);
      assert.ok(Math.abs(e.diffPctOfWindow - Math.abs(s.motorRpm - r.motorRpm.c) / (r.motorRpm.hi - r.motorRpm.lo) * 100) < 1e-12);
      assert.ok(e.diffPctOfWindow < 0.1, `d ${e.dRobotIn}: ${e.diffPctOfWindow} % of the window`);
    });
  });
}

// The real check: between table points. Export at step 4, evaluate the sim afresh at the step-2 distances that are not table points (d + 2),
// and compare the solver (interpolated angle and aim tables) with those fresh full-accuracy rows.
for (const [name, { P, rows, c }] of CASES) {
  test(`midpoints ${name}: solver vs fresh sim rows at d + 2 (diffPctOfWindow per point is reported)`, (t) => {
    const d4 = new Set(E.exportPoints(P, XS).map((q) => q.d.toFixed(6)));
    const fresh = E.exportPoints(P, { stepIn: 2 }).filter((q) => !d4.has(q.d.toFixed(6))).map((q) => E.exportPoint(P, q, XS)).filter((r) => r.reachable);
    const lo = Math.min(...rows.filter((r) => r.reachable).map((r) => r.dRobotIn)), hi = Math.max(...rows.filter((r) => r.reachable).map((r) => r.dRobotIn));
    const inside = fresh.filter((r) => r.dRobotIn > lo && r.dRobotIn < hi), flagged = (r) => r.motorRpm.hi - r.motorRpm.lo < 50;   // flagged: window < 50 rpm = edge of reach
    assert.ok(inside.length >= 5);
    // oracle: the same solver told the angle the sim actually chose at that midpoint (separates the angle-table error from the aim / solver error)
    const algo = inside.map((r) => X.compare([r], c)[0].diffPctOfWindow), oracle = inside.map((r) => X.compare([r], { ...c, hood: { mode: 'fixed', angleDeg: r.launchDeg } })[0].diffPctOfWindow);
    t.diagnostic(`${name}: ` + inside.map((r, i) => `${r.dRobotIn}:${algo[i].toFixed(1)}%${flagged(r) ? '(edge)' : ''}/${oracle[i].toFixed(1)}%`).join(' ') + '  [interpolated angle / sim angle]');
    const keep = (a) => a.filter((_, i) => !flagged(inside[i]));
    assert.ok(median(keep(oracle)) < 25 && Math.max(...keep(oracle)) < 60, `with the sim's own angle: median ${median(keep(oracle))}, max ${Math.max(...keep(oracle))}`);
    if (name === 'adjustable') {   // known: the adjustable table's angles jump between grid points (45-80 deg picked per distance), so linear angle interpolation misses; reported, bounded only loosely
      assert.ok(median(keep(algo)) < 60, `median ${median(keep(algo))}`);
    } else {
      assert.ok(median(keep(algo)) < 25, `median ${median(keep(algo))}`);
      if (name === 'fixed') assert.ok(Math.max(...keep(algo)) < 60, `max ${Math.max(...keep(algo))}`);
      else assert.ok(keep(algo).filter((x) => x >= 60).length <= 1, 'legacy: at most the steepest-angle midpoint (d 12, 83 deg) exceeds 60 %');
    }
  });
}

test('compare: not-ok solver gives null algoRpm / diff and ok:false; unreachable rows are skipped', () => {
  const { rows, c } = CASES[1][1], cmp = X.compare(rows, { ...c, aim: [], aimZM: 40 });
  assert.equal(cmp.length, rows.filter((r) => r.reachable).length);
  for (const e of cmp) { assert.equal(e.ok, false); assert.equal(e.algoRpm, null); assert.equal(e.diffPctOfWindow, null); assert.ok(e.tableRpm > 0); }
  assert.deepEqual(X.compare([], c), []); assert.deepEqual(X.compare(null, c), []);
  assert.ok(rows.some((r) => !r.reachable));
});
