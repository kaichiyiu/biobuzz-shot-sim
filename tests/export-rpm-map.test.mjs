// F2 (Phase 1 review): with a per-rpm eta curve the on-robot algorithm uses a monotone piecewise-linear rpm(v) map instead of one median rpmPerMps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const S = req(path.join(ROOT, 'src', 'export-solver.js')), CC = req(path.join(ROOT, 'src', 'calib-core.js')), X = req(path.join(ROOT, 'src', 'export-compare.js')), J = req(path.join(ROOT, 'src', 'export-java.js'));
const A = req(path.join(ROOT, 'src', 'ui-export-algo.js')), T = req(path.join(ROOT, 'src', 'export-tex.js'));
const XS = { stepIn: 4, mouthForwardIn: 5.5 };
const CURVES = { mild: [[1500, 0.42], [2500, 0.38], [3500, 0.34], [4500, 0.31]], strong: [[1000, 0.5], [2000, 0.45], [3000, 0.36], [4000, 0.30], [5500, 0.27]], flatEnds: [[2000, 0.40], [3000, 0.40], [3500, 0.38]] };
const HOODS = { adjustable: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, fixed: { mode: 'fixed', angleDeg: 62.5 } };
const mk = (hood, curve) => { const P = { ...BASE, hood }, rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS, curve)); return { P, rows, c: S.constantsFrom(P, rows, E, curve), sh: CC.shooterOf(E, P).sh }; };

for (const [hn, hood] of Object.entries(HOODS)) for (const [cn, curve] of Object.entries(CURVES)) {
  test(`rpmMap ${hn} / ${cn}: monotone, interpolation error < 0.1 % (50 points per interval), algorithm rpm = table centre rpm to 0.2 % at the table distances`, () => {
    const { rows, c, sh } = mk(hood, curve), m = c.rpmMap;
    assert.ok(Array.isArray(m) && m.length >= 4 && m.length <= 160, 'nodes ' + (m && m.length)); assert.equal(c.rpmMapError, '');
    for (let i = 1; i < m.length; i++) assert.ok(m[i][0] > m[i - 1][0] && m[i][1] > m[i - 1][1], 'monotone at node ' + i);
    const reach = rows.filter((r) => r.reachable), vmin = Math.min(...reach.map((r) => r.exitSpeedMps.lo)), vmax = Math.max(...reach.map((r) => r.exitSpeedMps.hi));
    assert.ok(m[0][0] <= vmin && m[m.length - 1][0] >= vmax, 'map covers the table exit-speed range');
    let maxErr = 0;
    for (let i = 0; i < m.length - 1; i++) for (let j = 0; j <= 50; j++) {
      const v = m[i][0] + (m[i + 1][0] - m[i][0]) * j / 50, ex = CC.motorRpmFromExitSpeed(v, sh, curve);
      maxErr = Math.max(maxErr, Math.abs(S.rpmFor(c, v) / ex - 1));
    }
    assert.ok(maxErr < 1e-3, 'max interpolation error ' + maxErr);
    let worst = 0;
    for (const r of reach) { const s = S.solveSpeed(c, r.dRobotIn); assert.ok(s.ok); worst = Math.max(worst, Math.abs(s.motorRpm / r.motorRpm.c - 1)); assert.ok(Math.abs(s.ticksPerSec / (s.motorRpm / 60 * c.ticksPerMotorRev) - 1) < 1e-12, 'ticks follow rpm'); }
    assert.ok(worst < 2e-3, 'algorithm vs table centre rpm: ' + worst);
    if (process.env.RPMMAP_LOG) console.log(hn, cn, 'nodes', m.length, 'maxErr', maxErr.toExponential(2), 'tableWorst', (worst * 100).toFixed(4) + ' %');
  });
}

test('without a curve rpmMap is null and the single rpmPerMps is used (unchanged); with a curve the single factor is wrong by far more than the window', () => {
  const plain = mk(HOODS.fixed, undefined), cur = mk(HOODS.fixed, CURVES.strong);
  assert.equal(plain.c.rpmMap, null); assert.equal(plain.c.rpmMapError, '');
  const r = plain.rows.find((x) => x.reachable), s = S.solveSpeed(plain.c, r.dRobotIn);
  assert.equal(s.motorRpm, s.vMps * plain.c.rpmPerMps);
  const old = { ...cur.c, rpmMap: null }, worstOld = Math.max(...cur.rows.filter((x) => x.reachable).map((x) => Math.abs(S.solveSpeed(old, x.dRobotIn).motorRpm - x.motorRpm.c) / (x.motorRpm.hi - x.motorRpm.lo)));
  const worstNew = Math.max(...cur.rows.filter((x) => x.reachable).map((x) => Math.abs(S.solveSpeed(cur.c, x.dRobotIn).motorRpm - x.motorRpm.c) / (x.motorRpm.hi - x.motorRpm.lo)));
  assert.ok(worstOld > 0.5 && worstNew < 0.02, `old single factor ${worstOld.toFixed(2)} windows, map ${worstNew.toFixed(4)} windows`);
});

test('rpmFor: interpolates, continues with the end slope outside the map, falls back to v * rpmPerMps for an empty or one-node map', () => {
  const c = { rpmPerMps: 100, rpmMap: [[2, 220], [4, 400], [6, 700]] };
  assert.equal(S.rpmFor(c, 3), 310); assert.equal(S.rpmFor(c, 5), 550); assert.equal(S.rpmFor(c, 4), 400);
  assert.equal(S.rpmFor(c, 1), 220 - 90); assert.equal(S.rpmFor(c, 7), 700 + 150);
  assert.equal(S.rpmFor({ rpmPerMps: 100, rpmMap: null }, 3), 300); assert.equal(S.rpmFor({ rpmPerMps: 100, rpmMap: [[2, 5]] }, 3), 300);
});

test('a non-monotone curve (v(n) falls with rpm) gives no map, an error text, and the algorithm section is not usable', () => {
  const bad = [[2000, 0.40], [3000, 0.40], [3500, 0.33]], { P, rows, c } = mk(HOODS.fixed, undefined);
  const c2 = S.constantsFrom(P, rows, E, bad);
  assert.equal(c2.rpmMap, null); assert.match(c2.rpmMapError, /not increasing/);
  const p = A.prepare(rows, P, E, bad); assert.equal(p.usable, false); assert.match(p.reason, /per-rpm curve/);
  assert.equal(A.prepare(rows, P, E, CURVES.mild).usable, true); assert.equal(A.prepare(rows, P, E).usable, true);
  assert.equal(S.constantsFrom(P, [], E, bad).rpmMap, null);   // no usable row: no map, no throw
  assert.ok(c.rpmMap === null);
});

test('java source: map arrays are emitted (empty without a curve) and the .tex shows the map form only with a curve', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'ShotSolver.java.txt'), 'utf8'), tex = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'derivation.tex.txt'), 'utf8');
  assert.ok(tpl.split('\n').length <= 200);
  const withMap = mk(HOODS.adjustable, CURVES.mild), plain = mk(HOODS.adjustable, undefined);
  const jm = J.renderJava(withMap.c, tpl), jp = J.renderJava(plain.c, tpl);
  const arr = (src, name) => /\{([^}]*)\}/.exec(new RegExp(`${name} = \\{[^}]*\\}`).exec(src)[0])[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  assert.deepEqual(arr(jm, 'RPM_MAP_V'), withMap.c.rpmMap.map((p) => p[0])); assert.deepEqual(arr(jm, 'RPM_MAP_RPM'), withMap.c.rpmMap.map((p) => p[1]));
  assert.deepEqual(arr(jp, 'RPM_MAP_V'), []); assert.deepEqual(arr(jp, 'RPM_MAP_RPM'), []);
  const cfg = { robot: { motorId: 'yj6000', shooter: { type: 'single', gear: 1, etaSingle: 0.38 } }, calibration: { calibrated: true, mode: 'perRpm', fit: { curve: CURVES.mild } } };
  const tm = T.renderTex(withMap.c, cfg, tex, { wheelDiameterMm: 96 }), tp = T.renderTex(plain.c, { ...cfg, calibration: null }, tex, { wheelDiameterMm: 96 });
  assert.match(tm, /inverse map \$n\(v\)\$/); assert.ok(tm.includes(T.tn(withMap.c.rpmMap[3][1], 5)) && !/\\kappa\\, v/.test(tm) && /n\(v\)\}\{60\}/.test(tm));
  assert.match(tp, /\\kappa\\, v/); assert.ok(!/inverse map/.test(tp));
  if (!spawnSync('pdflatex', ['--version']).error) {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rpmmap-')), f = path.join(dir, 'map.tex');
    fs.writeFileSync(f, tm);
    const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', dir, f], { encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout || '').split('\n').filter((l) => l.startsWith('!')).join(' | '));
  }
});

test('compare / vectors use the map: every reachable row of a strongly curved calibration is within 5 % of its window', () => {
  const { rows, c } = mk(HOODS.fixed, CURVES.strong);
  const cmp = X.compare(rows, c); assert.ok(cmp.length >= 5);
  for (const e of cmp) assert.ok(e.ok && e.diffPctOfWindow < 5, `d ${e.dRobotIn}: ${e.diffPctOfWindow} %`);
  const v = X.vectors(c, [40, 50]); assert.ok(v.every((x) => x.ok));
});
