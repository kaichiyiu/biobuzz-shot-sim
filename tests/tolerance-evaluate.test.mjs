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
    // BASE without a hood aims at the edge of the speed window: the next speed cell misses, so the conservative margin is 0 (the best setpoint is inside)
    assert.ok((params.hood ? t.margin > 0 : t.margin >= 0 && t.bestSetpoint.boxMargin > 0) && t.margin <= 4 && Number.isFinite(t.margin), JSON.stringify(t.margin));
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
  for (const [params, f0, mult] of cases.flatMap(([a, b]) => [[a, b, 1], [a, b, 0.5], [a, b, 0.25]])) {   // conservative margins are about one cell lower: also probe at 1/2 and 1/4 of the tolerances
    const f = (f0 || 1) * mult, tl = Object.fromEntries(Object.entries(tol).map(([k, v]) => [k, v * f]));
    const t = E.evaluate({ ...params, tolerance: tl }, 'full').tolerance;
    if (!(t && t.margin >= 1.25)) continue;
    checked++;
    for (const [i, j, k, c] of probes(params, t)) {
      assert.ok(c.rectHit === true, `probe ${i},${j},${k} misses at margin ${t.margin} (${JSON.stringify(params.robot)})`);
      if (params.entry) assert.ok(c.entryAngleDeg < 0, `probe ${i},${j},${k} ascends`);
    }
  }
  assert.ok(checked >= 6, `only ${checked} cases reached margin 1.25`);
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

// ---- guarantee: margin >= 1 means EVERYTHING inside the scale-1 box scores (angle, rpm, yaw, sideways and along-the-line mouth moves)
const I = E._internal;
function guarantee(params, base, target, N = 220, noAlong = false) {
  let rs = 20261111; const rnd = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296, U = () => rnd() * 2 - 1;
  const m0 = E.evaluate({ ...params, tolerance: { ...base, best: false } }, 'full').tolerance.margin, f = m0 / target;
  if (!(m0 > 0)) return { t: null, n: 0, miss: [] };   // no usable setpoint at this spot
  const tol = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * f]));
  const t = E.evaluate({ ...params, tolerance: { ...tol, best: false } }, 'full').tolerance, s = t.setpoint;
  if (!(t.margin >= 1)) return { t, n: 0, miss: [] };
  const p = I.normParams(params), cen = I.mouthCentroid(p.target, p.hiveState[p.target]), psi = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x);
  const c = Math.cos(psi), sn = Math.sin(psi), L = p.mouthLimit, miss = []; let n = 0, tries = 0;
  while (n < N && tries++ < 20 * N) {
    const u = [U(), U(), U(), U(), U()];   // angle, rpm, yaw, sideways, along (fractions of the tolerance; the scale-1 box)
    if (noAlong) u[4] = 0;
    const lat = u[3] * tol.posIn, al = u[4] * tol.posIn, mx = p.launch.x - sn * lat - al * c, my = p.launch.y + c * lat - al * sn;
    if (Math.abs(mx) > L || Math.abs(my) > L) continue;
    n++;
    const v = s.v * (s.motorRpm + u[1] * tol.rpm) / s.motorRpm;
    const cl = E.classifyShot({ ...params, robot: undefined, mouth: { x: mx, y: my } }, s.thetaDeg + u[0] * tol.angleDeg, v, s.yawDeg + u[2] * tol.yawDeg);
    if (cl.rectHit !== true || (params.entry && params.entry.rule === 'descending' && !(cl.entryAngleDeg < 0))) miss.push(u.map((x) => +x.toFixed(2)));
  }
  return { t, n, miss };
}

test('guarantee: margin >= 1 -> >= 200 seeded random points of the scale-1 box (5 axes, real classifyShot, mouth translated) all score', () => {
  const base = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 1 }, desc = { ...P, entry: { rule: 'descending' } };
  const cases = [[{ ...P, robot: { x: 0, y: -24 } }, 1.02], [{ ...P, robot: { x: 24, y: -60 } }, 1.1], [{ ...P, robot: { x: -60, y: -60 } }, 1.25],
    [{ ...P, robot: { x: 40, y: -20 } }, 1.6], [P, 1.05], [desc, 1.1], [{ ...BASE, robot: { x: 0, y: -24 } }, 1.0], [{ ...BASE, robot: { x: -30, y: -40 } }, 1.1]];
  let counted = 0;
  for (const [params, target] of cases) {
    const r = guarantee(params, base, target);
    if (r.n === 0) continue;
    counted++;
    assert.ok(r.n >= 200, `${JSON.stringify(params.robot)}: only ${r.n} points`);
    assert.deepEqual(r.miss.slice(0, 3), [], `${JSON.stringify(params.robot)} margin ${r.t.margin} (box ${r.t.boxMargin}, along ${r.t.alongMargin}): ${r.miss.length}/${r.n} points miss`);
  }
  assert.ok(counted >= 6, `only ${counted} cases reached margin 1`);
  // position-heavy tolerance (3 in sideways): the yaw-equivalent of a sideways move (atan(pos / d)) must hold too. Along is left at 0 here:
  // the along range is measured with the other errors at zero, so a corner that combines a full along move with full angle / rpm / yaw errors can still miss (known limit, progress.md)
  for (const [params, target] of [[{ ...P, robot: { x: -60, y: -60 } }, 1.0], [{ ...P, robot: { x: 40, y: -20 } }, 1.05], [{ ...P, robot: { x: -20, y: -40 } }, 1.0]]) {
    const r = guarantee(params, { yawDeg: 0.1, angleDeg: 0.5, rpm: 25, posIn: 3 }, target, 220, true);
    assert.ok(r.n >= 200, `${JSON.stringify(params.robot)}: margin ${r.t && r.t.margin}`);
    assert.deepEqual(r.miss.slice(0, 3), [], `${JSON.stringify(params.robot)} lateral: margin ${r.t.margin}`);
  }
});
