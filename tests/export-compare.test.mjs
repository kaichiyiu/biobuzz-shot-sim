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
const mk = (hood) => { const P = { ...BASE, hood }, rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS)); return { rows, c: S.constantsFrom(P, rows, E) }; };
const CASES = [['adjustable', mk({ mode: 'adjustable', minDeg: 45, maxDeg: 80 })], ['fixed', mk({ mode: 'fixed', angleDeg: 62.5 })]];
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
  test(`compare ${name} hood at BASE: reachable rows only; diffPctOfWindow = |algo - table| / (hi - lo) * 100; regression guard on the size of the differences`, () => {
    const cmp = X.compare(rows, c), ok = rows.filter((r) => r.reachable);
    assert.equal(cmp.length, ok.length); assert.ok(cmp.length >= 7);
    cmp.forEach((e, i) => {
      const r = ok[i], s = S.solveSpeed(c, r.dRobotIn);
      assert.equal(e.dRobotIn, r.dRobotIn); assert.equal(e.tableRpm, r.motorRpm.c); assert.equal(e.algoRpm, s.motorRpm); assert.equal(e.windowRpm, r.motorRpm.hi - r.motorRpm.lo); assert.equal(e.ok, true);
      assert.ok(Math.abs(e.diffPctOfWindow - Math.abs(s.motorRpm - r.motorRpm.c) / (r.motorRpm.hi - r.motorRpm.lo) * 100) < 1e-12);
    });
    const d = cmp.map((e) => e.diffPctOfWindow), under = d.filter((x) => x < 50).length;
    assert.ok(median(d) < 30, `median ${median(d)} % of the window`);
    assert.ok(under >= (2 / 3) * d.length, `${under} of ${d.length} rows under 50 % of the window: ${d.map((x) => x.toFixed(0)).join(' ')}`);
  });
}

test('compare: not-ok solver gives null algoRpm / diff and ok:false; unreachable rows are skipped', () => {
  const { rows, c } = CASES[1][1], cmp = X.compare(rows, { ...c, aimZM: 40 });
  assert.equal(cmp.length, rows.filter((r) => r.reachable).length);
  for (const e of cmp) { assert.equal(e.ok, false); assert.equal(e.algoRpm, null); assert.equal(e.diffPctOfWindow, null); assert.ok(e.tableRpm > 0); }
  assert.deepEqual(X.compare([], c), []); assert.deepEqual(X.compare(null, c), []);
  assert.ok(rows.some((r) => !r.reachable));
});
