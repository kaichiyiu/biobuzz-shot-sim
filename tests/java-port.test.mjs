// #4 G3: the rendered Java class reproduces the JS solver's test vectors (1e-6 relative). Skipped when no Java compiler exists
// (javac, or java 11+ with the jdk.compiler module = source launcher).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const S = req(path.join(ROOT, 'src', 'export-solver.js')), J = req(path.join(ROOT, 'src', 'export-java.js')), X = req(path.join(ROOT, 'src', 'export-compare.js'));
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'ShotSolver.java.txt'), 'utf8');
const XS = { stepIn: 4, mouthForwardIn: 5.5 };
const run = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 1 << 24 });
const probe = (cmd, args) => { const r = run(cmd, args); return !r.error && r.status === 0 ? r : null; };
const TOOL = probe('javac', ['-version']) ? 'javac' : (() => { const m = probe('java', ['--list-modules']); return m && /^jdk\.compiler@/m.test(m.stdout) ? 'source' : null; })();
const CURVE = [[1000, 0.5], [2000, 0.45], [3000, 0.36], [4000, 0.30], [5500, 0.27]];   // F2: per-rpm calibration -> rpm(v) map arrays in the Java source
const mk = (P, curve) => { const rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS, curve)); return S.constantsFrom(P, rows, E, curve); };
const MODES = [['adjustable', mk({ ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } })], ['fixed', mk({ ...BASE, hood: { mode: 'fixed', angleDeg: 62.5 } })],
  ['topspin fixed', mk({ ...BASE, shooter: { ...BASE.shooter, spin: 'top' }, hood: { mode: 'fixed', angleDeg: 62.5 } })],
  ['per-rpm map adjustable', mk({ ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, CURVE)], ['per-rpm map fixed', mk({ ...BASE, hood: { mode: 'fixed', angleDeg: 62.5 } }, CURVE)]];
// 20 distances: the table range with irregular spacing, plus one beyond reach and one inside the mouth-forward offset
const D20 = Array.from({ length: 18 }, (_, i) => 14 + i * 2.6 + (i % 3) * 0.37).concat([4000, 3]);

for (const [name, c] of MODES) {
  test(`java port ${name}: 20 vectors match the JS reference to 1e-6 relative (speed, angle, rpm, ticks; ok and iterations equal)`,
    { skip: TOOL ? false : 'no Java compiler on this machine (javac / java 11+ with jdk.compiler)' }, () => {
      assert.equal(D20.length, 20); assert.equal(!!c.rpmMap, name.startsWith('per-rpm'));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'javaport-')), file = path.join(dir, 'ShotSolver.java');
      try {
        fs.writeFileSync(file, J.renderJava(c, TEMPLATE));
        const csv = X.vectorsCsv(X.vectors(c, D20));
        let r;
        if (TOOL === 'javac') { const cr = run('javac', ['-source', '8', '-target', '8', '-d', dir, file]); assert.equal(cr.status, 0, cr.stderr); r = run('java', ['-cp', dir, 'ShotSolver'], csv); }
        else r = run('java', [file], csv);
        assert.equal(r.status, 0, r.stderr);
        const lines = r.stdout.trim().split('\n').filter((l) => /^[0-9-]/.test(l)), want = X.vectors(c, D20);
        assert.equal(lines.length, 20);
        let nOk = 0;
        lines.forEach((l, i) => {
          const f = l.split(','), w = want[i];
          assert.equal(Number(f[0]), w.dRobotIn); assert.equal(f[5] === 'true', w.ok, 'ok at d ' + w.dRobotIn); assert.equal(Number(f[6]), w.iterations, 'iterations at d ' + w.dRobotIn);
          [[1, 'thetaDeg'], [2, 'vMps'], [3, 'motorRpm'], [4, 'ticksPerSec']].forEach(([k, key]) => {
            const g = Number(f[k]);
            if (Number.isNaN(w[key])) return assert.ok(Number.isNaN(g), `${key} at d ${w.dRobotIn}`);
            assert.ok(Math.abs(g - w[key]) <= 1e-6 * Math.abs(w[key]) + 1e-12, `${key} at d ${w.dRobotIn}: java ${g} vs js ${w[key]}`);
          });
          if (w.ok) { nOk++; assert.ok(Number(f[7]) > 0, 'lastSolveNanos reported'); }
        });
        assert.ok(nOk >= 10, `${nOk} of 20 vectors solved`);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}
