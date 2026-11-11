// #7 #8 evaluate hook (I4): params.tolerance -> res.tolerance. Absent = identical, coarse flag, 27 probes, motor rules, export fill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), require = createRequire(import.meta.url);
for (const f of ['core', 'along']) require(`../src/engine-tolerance-${f}.js`);
require('../src/engine-tolerance.js');   // registers 'tolerance' (the loaders get it in I5)
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, V = E.VERDICTS;
const TOL = { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2 }, HALF = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 1 };
const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.timings; delete c.tolerance; return c; };
const P = { ...BASE, hood: ADJ };

test('absent or empty tolerance: results identical to today (no key); all-zero -> null', () => {
  for (const [params, mode] of [[BASE, 'coarse'], [BASE, 'full'], [P, 'coarse'], [P, 'full'], [{ ...P, entry: { rule: 'descending' } }, 'full']]) {
    const a = E.evaluate(params, mode), b = E.evaluate({ ...params, tolerance: TOL }, mode), z = E.evaluate({ ...params, tolerance: { yawDeg: 0, rpm: 'x' } }, mode);
    assert.ok(!('tolerance' in a), 'no key without params.tolerance');
    assert.deepEqual(strip(b), strip(a)); assert.deepEqual(strip(z), strip(a));
    assert.equal(z.tolerance, null); assert.equal(typeof b.tolerance.margin, 'number');
  }
});

test('BASE full (hood and no hood): margin > 0, shape, setpoint = the reported aim', () => {
  for (const params of [P, BASE]) {
    const r = E.evaluate({ ...params, tolerance: TOL }, 'full'), t = r.tolerance;
    assert.ok(t.margin > 0 && t.margin <= 4 && Number.isFinite(t.margin), JSON.stringify(t.margin));
    assert.ok(V.includes(t.verdict) && t.basis === 'rect' && t.mode === 'full' && t.entryRule === 'any');
    assert.ok(['yaw', 'angle', 'rpm', 'along'].includes(t.limitingAxis), String(t.limitingAxis));
    assert.equal(t.margin, Math.min(t.boxMargin, t.alongMargin));
    assert.ok(t.bestSetpoint && t.bestSetpoint.boxMargin >= t.boxMargin);
    if (params.hood) { assert.equal(t.setpoint.thetaDeg, r.hood.angleDeg); assert.ok(Math.abs(t.setpoint.motorRpm - r.hood.rpmWindow.centerMotorRpm) < 5); }
  }
  const t = E.evaluate({ ...P, tolerance: TOL }, 'full').tolerance;
  assert.ok(t.margin < 1.25 && t.verdict === V[2], 'BASE with 1 deg / 1 deg / 50 rpm / 2 in is a narrow window');
});

test('coarse mode: computed and flagged; no bestSetpoint', () => {
  for (const params of [P, BASE]) {
    const r = E.evaluate({ ...params, tolerance: TOL }, 'coarse'), t = r.tolerance;
    assert.equal(t.mode, 'coarse'); assert.equal(t.bestSetpoint, null); assert.ok(t.margin >= 0 && t.margin <= 4);
  }
});

test('no aim (NO_ARC) and unreachable aim: margin null, WON\'T WORK; the guard never throws', () => {
  const none = E.evaluate({ ...BASE, robot: { x: -12.75, y: 0 }, tolerance: TOL }, 'full');
  assert.equal(none.code, 'NO_ARC'); assert.deepEqual([none.tolerance.margin, none.tolerance.verdict, none.tolerance.setpoint], [null, V[2], null]);
  const slow = { ...BASE, motorId: 'yj1620', tolerance: TOL };
  for (const mode of ['coarse', 'full']) {
    const r = E.evaluate(slow, mode);
    assert.equal(r.code, 'TOO_SLOW'); assert.deepEqual([r.tolerance.margin, r.tolerance.verdict, r.tolerance.cappedBy, r.tolerance.bestSetpoint], [null, V[2], 'unreachable', null]);
  }
});

function probes(params, t) {   // 27 points {-1,0,1}^3 of (angle, rpm, yaw) at +-1x the tolerance around the setpoint
  const s = t.setpoint, out = [];
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
    const v = s.v * (s.motorRpm + j * t.tolerance.rpm) / s.motorRpm;
    out.push([i, j, k, E.classifyShot(params, s.thetaDeg + i * t.tolerance.angleDeg, v, s.yawDeg + k * t.tolerance.yawDeg)]);
  }
  return out;
}

test('sampling: margin >= 1.25 -> all 27 corner / face / centre probes at +-1x score (BASE, other spots, with an entry rule)', () => {
  const tol = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 0 };
  const cases = [[P], [BASE], [{ ...P, robot: { x: 24, y: -60 } }], [{ ...P, robot: { x: -60, y: -60 } }, 0.2], [{ ...P, entry: { rule: 'descending' } }]];
  let checked = 0;
  for (const [params, f] of cases) {
    const tl = f ? Object.fromEntries(Object.entries(tol).map(([k, v]) => [k, v * f])) : tol;
    const t = E.evaluate({ ...params, tolerance: tl }, 'full').tolerance;
    if (!(t && t.margin >= 1.25)) continue;
    checked++;
    for (const [i, j, k, c] of probes(params, t)) {
      assert.ok(c.rectHit === true, `probe ${i},${j},${k} misses at margin ${t.margin} (${JSON.stringify(params.robot)})`);
      if (params.entry) assert.ok(c.entryAngleDeg < 0, `probe ${i},${j},${k} ascends`);
    }
  }
  assert.ok(checked >= 3, `only ${checked} cases reached margin 1.25`);
  // control: the probes can fail. BASE at 1 deg / 1 deg / 50 rpm has margin 0.75, so the +-1x corners are outside the scoring box
  const narrow = E.evaluate({ ...P, tolerance: TOL }, 'full').tolerance;
  assert.ok(narrow.margin < 1 && probes(P, narrow).some(([, , , c]) => c.rectHit !== true));
});

test('sampling: along margin >= 1 -> the mouth moved by +-posIn along the line still scores (BASE hood)', () => {
  const t = E.evaluate({ ...P, tolerance: { yawDeg: 0.25, angleDeg: 0.25, rpm: 10, posIn: 1.5 } }, 'full').tolerance, s = t.setpoint;
  assert.ok(t.alongMargin >= 1, String(t.alongMargin));
  for (const D of [-1.5, 1.5, 0]) assert.equal(E.classifyShot({ ...P, robot: { x: BASE.robot.x, y: BASE.robot.y - D } }, s.thetaDeg, s.v, 90 + s.yawOffsetDeg).rectHit, true, `D ${D}`);
});

test('halving all tolerances ~ doubles the box margin (hook level); tighter tolerance never lowers the margin', () => {
  const a = E.evaluate({ ...P, tolerance: TOL }, 'full').tolerance, b = E.evaluate({ ...P, tolerance: HALF }, 'full').tolerance;
  assert.ok(Math.abs(b.boxMargin - 2 * a.boxMargin) <= 2 * Math.max(a.resolution, b.resolution) + 0.02 * b.boxMargin, `${a.boxMargin} -> ${b.boxMargin}`);
  assert.ok(b.margin >= a.margin);
});

test('export rows pick the margin up from res.tolerance', () => {
  const r = E.evaluate({ ...P, tolerance: HALF }, 'full'), row = E.exportRow(r, { d: 48, x: BASE.robot.x, y: BASE.robot.y }, P);
  assert.equal(row.margin, r.tolerance.margin);
  assert.equal(E.exportRow(E.evaluate(P, 'full'), { d: 48, x: BASE.robot.x, y: BASE.robot.y }, P).margin, null);
});
