// #4 G2: Java template + renderer. Placeholder filling, literal round trips, errors; compile check when a Java compiler exists (javac, or java 11+ source mode).
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
const S = req(path.join(ROOT, 'src', 'export-solver.js')), J = req(path.join(ROOT, 'src', 'export-java.js'));
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'ShotSolver.java.txt'), 'utf8');
const XS = { stepIn: 4, mouthForwardIn: 5.5 };
const mk = (hood) => { const P = { ...BASE, hood }, rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS)); return { P, rows, c: S.constantsFrom(P, rows, E) }; };
const ADJ = mk({ mode: 'adjustable', minDeg: 45, maxDeg: 80 }), FIX = mk({ mode: 'fixed', angleDeg: 62.5 });
const SCALARS = { MASS_KG: 'massKg', AREA_M2: 'areaM2', RHO: 'rho', CD: 'cd', CL_SLOPE: 'clSlope', CL_SMAX: 'clSMax', G: 'g', S0: 'S0', DT: 'dt', H0_M: 'h0M', AIM_Z_M: 'aimZM',
  RPM_PER_MPS: 'rpmPerMps', TICKS_PER_MOTOR_REV: 'ticksPerMotorRev', MOUTH_FORWARD_IN: 'mouthForwardIn' };
const field = (src, name) => { const m = new RegExp(`static final (?:double|boolean) ${name} = ([^;]+);`).exec(src); assert.ok(m, name); return m[1].trim(); };
const list = (src, name) => { const m = new RegExp(`static final double\\[\\] ${name} = \\{([^}]*)\\};`).exec(src); assert.ok(m, name); return m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number); };

// Java compiler: javac when present, else the java 11+ source launcher (needs the jdk.compiler module). Returns null when neither works.
function javaTool() {
  const ok = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return !r.error && r.status === 0 ? r : null; };
  if (ok('javac', ['-version'])) return 'javac';
  const m = ok('java', ['--list-modules']);
  return m && /^jdk\.compiler@/m.test(m.stdout) ? 'source' : null;
}
const TOOL = javaTool();

test('template: ≤ 200 lines, plain Java 8 (no imports, no var), every {{NAME}} is a renderer placeholder and every placeholder is used', () => {
  assert.ok(TEMPLATE.split('\n').length <= 200);
  assert.ok(!/^\s*import /m.test(TEMPLATE) && !/\bvar\s+\w+\s*=/.test(TEMPLATE));
  assert.match(TEMPLATE, /public final class ShotSolver/); assert.match(TEMPLATE, /public long lastSolveNanos/); assert.match(TEMPLATE, /public Result solve\(double dRobotIn\)/);
  assert.match(TEMPLATE, /public static void main\(String\[\] args\)/);
  const used = [...new Set([...TEMPLATE.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, J.PLACEHOLDERS);
});

test('render: no {{ left; every scalar literal round-trips exactly; hood arrays equal the table (adjustable) or are empty (fixed)', () => {
  const a = J.renderJava(ADJ.c, TEMPLATE), f = J.renderJava(FIX.c, TEMPLATE);
  for (const out of [a, f]) assert.ok(!out.includes('{{'));
  for (const [name, key] of Object.entries(SCALARS)) { assert.equal(Number(field(a, name)), ADJ.c[key], name); assert.equal(Number(field(f, name)), FIX.c[key], name); }
  assert.equal(field(a, 'HOOD_FIXED'), 'false'); assert.equal(field(a, 'HOOD_ANGLE_DEG'), 'Double.NaN');
  assert.deepEqual(list(a, 'HOOD_D_IN'), ADJ.c.hood.table.map((p) => p[0])); assert.deepEqual(list(a, 'HOOD_DEG'), ADJ.c.hood.table.map((p) => p[1]));
  for (const [o, k] of [[a, ADJ], [f, FIX]]) { assert.deepEqual(list(o, 'AIM_D_IN'), k.c.aim.map((p) => p[0])); assert.deepEqual(list(o, 'AIM_Z'), k.c.aim.map((p) => p[1])); assert.ok(k.c.aim.length >= 7); }
  assert.equal(field(f, 'HOOD_FIXED'), 'true'); assert.equal(Number(field(f, 'HOOD_ANGLE_DEG')), 62.5);
  assert.deepEqual(list(f, 'HOOD_D_IN'), []); assert.deepEqual(list(f, 'HOOD_DEG'), []);
});

test('literal: Java double text for integers, exponents, negatives, NaN, infinities, -0', () => {
  for (const x of [0, 28, -3, 0.0025, 1e-7, 1.5e21, -2.5e-9, 9.81, 0.1 + 0.2, Math.PI]) { const s = J.literal(x); assert.equal(Number(s), x, s); assert.match(s, /[.eE]/, s); }
  assert.equal(J.literal(NaN), 'Double.NaN'); assert.equal(J.literal(Infinity), 'Double.POSITIVE_INFINITY'); assert.equal(J.literal(-Infinity), 'Double.NEGATIVE_INFINITY');
  assert.equal(J.literal(-0), '-0.0'); assert.throws(() => J.literal('1'), /number/);
  const nan = J.renderJava({ ...FIX.c, aimZM: NaN, rpmPerMps: NaN }, TEMPLATE);   // no usable rows: constants are NaN, still renders
  assert.equal(field(nan, 'AIM_Z_M'), 'Double.NaN'); assert.equal(field(nan, 'RPM_PER_MPS'), 'Double.NaN');
});

test('render errors: unknown placeholder, leftover "{{", missing constant, bad hood', () => {
  assert.throws(() => J.renderJava(FIX.c, TEMPLATE + '\n// {{BOGUS}}'), /unknown placeholder/);
  assert.throws(() => J.renderJava(FIX.c, TEMPLATE + '\n// {{ not a name }}'), /\{\{/);
  assert.throws(() => J.renderJava({ ...FIX.c, massKg: undefined }, TEMPLATE), /massKg/);
  assert.throws(() => J.renderJava({ ...FIX.c, hood: { mode: 'both' } }, TEMPLATE), /hood/);
  assert.throws(() => J.renderJava({ ...FIX.c, hood: undefined }, TEMPLATE), /hood/);
});

test('the rendered class compiles (javac, or the java source launcher); with no input its main prints only the header', { skip: TOOL ? false : 'no Java compiler on this machine (javac / java 11+ with jdk.compiler)' }, () => {
  for (const k of [ADJ, FIX, { c: { ...FIX.c, aimZM: NaN, rpmPerMps: NaN, ticksPerMotorRev: NaN } }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotsolver-')), file = path.join(dir, 'ShotSolver.java');
    fs.writeFileSync(file, J.renderJava(k.c, TEMPLATE));
    const r = TOOL === 'javac' ? spawnSync('javac', ['-source', '8', '-target', '8', '-d', dir, file], { encoding: 'utf8' }) : spawnSync('java', [file], { input: '', encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    if (TOOL === 'source') assert.equal(r.stdout.trim(), 'dRobotIn,thetaDeg,vMps,motorRpm,ticksPerSec,ok,iterations,solveNanos');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
