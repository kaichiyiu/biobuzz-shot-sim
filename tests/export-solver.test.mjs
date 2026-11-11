// #4 G1: on-robot flight solver (JS reference) against the engine's own flight model and export rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const S = req(path.join(ROOT, 'src', 'export-solver.js')), F = req(path.join(ROOT, 'src', 'export-format.js'));
const IN = 0.0254, XS = { stepIn: 4, mouthForwardIn: 5.5 };
const ADJ = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, FIX = { ...BASE, hood: { mode: 'fixed', angleDeg: 62.5 } };
const rowsOf = (P) => E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS));
const CASES = [['adjustable', ADJ], ['fixed', FIX], ['legacy no hood', BASE]].map(([name, P]) => { const rows = rowsOf(P); return { name, P, rows, c: S.constantsFrom(P, rows, E), ok: rows.filter((r) => r.reachable) }; });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

test('trajectory equals E._internal.flyFloat to 1e-9 m over 1 s (backspin, topspin, dual; drag, lift, clamp)', () => {
  const sh = BASE.shooter, spins = [['back', { ...sh, spin: 'back' }], ['top', { ...sh, spin: 'top' }], ['dual', { ...sh, type: 'dual', topRatio: 0.6 }]];
  for (const [name, shooter] of spins) {
    const P = { ...BASE, shooter }, c = S.constantsFrom(P, [], E), S0 = E.shooterSpin(shooter);
    assert.equal(c.S0, S0, name);
    assert.ok(name === 'back' ? S0 === 1 : name === 'top' ? S0 === -1 : Math.abs(S0) < 1);
    for (const [th, v] of [[20, 3], [45, 6], [62.5, 5.2], [80, 9], [89, 15]]) {
      const ref = E._internal.flyFloat('pollen', S0, th, v), mine = S.trajectory(c, th, v, 1.0);
      assert.equal(mine.length, ref.length);
      let worst = 0;
      for (let i = 0; i < ref.length; i++) for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(mine[i][k] - ref[i][k]));
      assert.ok(worst <= 1e-9, `${name} th ${th} v ${v}: max diff ${worst}`);
    }
  }
  // changed drag/lift constants and a small clamp (flyFloat opts) are honoured identically
  const c = { ...S.constantsFrom(BASE, [], E), cd: 0.7, rho: 1.1, clSlope: 0.35, clSMax: 0.4, g: 9.7 };
  const ref = E._internal.flyFloat('pollen', 1, 55, 7, { cd: 0.7, rho: 1.1, clSlope: 0.35, clSMax: 0.4, g: 9.7 }), mine = S.trajectory(c, 55, 7, 1.0);
  near(Math.max(...ref.map((p, i) => Math.max(...p.map((x, k) => Math.abs(x - mine[i][k]))))), 0, 1e-9, 'custom constants');
});

test('constantsFrom: engine constants, per-distance aim table (own integrator, centre speed), rpm/ticks from the rows (same rpmPerMps as ExportFormat.header)', () => {
  for (const { name, rows, c, ok } of CASES) {
    const bp = E.ballProps('pollen'), A = E.constants().aero;
    assert.deepEqual([c.massKg, c.areaM2, c.rho, c.cd, c.clSlope, c.clSMax, c.g], [bp.massKg, bp.areaM2, A.rho, A.cd, A.clSlope, A.clSMax, A.g]);
    assert.equal(c.dt, 0.0025); assert.equal(c.S0, 1); near(c.h0M, 16 * IN, 1e-12, 'h0');
    // per-distance aim = this integrator's centre-speed path height at rho = dMouth (m above the mouth); aimZM = median of those (fallback)
    assert.equal(c.aim.length, ok.length);
    ok.forEach((r, i) => {
      assert.equal(c.aim[i][0], r.dRobotIn);
      assert.equal(c.aim[i][1], S.heightAt(c, r.launchDeg, r.exitSpeedMps.c, r.dMouthIn * IN), name + ' aim ' + r.dRobotIn);
      near(c.aim[i][1] / IN + 16, 57, 8, 'aim is near the CELL mouth height (in above floor)');
      if (name !== 'legacy no hood') near(c.aim[i][1], (r.aimZIn - 16) * IN, 0.003, 'hood modes: best.v = window centre, so equals the engine path height');
    });
    near(c.aimZM, median(c.aim.map((p) => p[1])), 1e-15, name + ' median');
    assert.equal(S.aimFor(c, ok[1].dRobotIn), c.aim[1][1]); near(S.aimFor(c, (ok[1].dRobotIn + ok[2].dRobotIn) / 2), (c.aim[1][1] + c.aim[2][1]) / 2, 1e-12, 'aim mid');
    assert.equal(S.aimFor(c, 0), c.aim[0][1]); assert.equal(S.aimFor(c, 999), c.aim[c.aim.length - 1][1]); assert.equal(S.aimFor({ aim: [], aimZM: 1.25 }, 30), 1.25);
    near(c.ticksPerMotorRev, 28, 1e-9, 'ticks'); near(c.mouthForwardIn, 5.5, 1e-9, 'forward');
    near(c.rpmPerMps / F.header(null, null, rows).rpmPerMps, 1, 1e-5, name + ' rpmPerMps');
    assert.equal(c.hood.mode, name === 'fixed' ? 'fixed' : 'adjustable');
    if (name === 'fixed') assert.equal(c.hood.angleDeg, 62.5);
    else { assert.equal(c.hood.table.length, ok.length); assert.deepEqual(c.hood.table[0], [ok[0].dRobotIn, ok[0].launchDeg]); }
  }
  const none = S.constantsFrom(ADJ, [], E);   // nothing to export: NaN fields, solver says not ok instead of throwing
  assert.ok(Number.isNaN(none.aimZM) && Number.isNaN(none.rpmPerMps) && none.hood.table.length === 0);
  assert.equal(S.solveSpeed(none, 30).ok, false);
});

test('angleFor: fixed is constant; adjustable interpolates linearly in the (dRobot, deg) table and is flat beyond the ends', () => {
  const fix = CASES[1].c, c = { hood: { mode: 'adjustable', table: [[20, 80], [30, 70], [50, 60]] } };
  assert.equal(S.angleFor(fix, 5), 62.5); assert.equal(S.angleFor(fix, 500), 62.5);
  assert.equal(S.angleFor(c, 20), 80); assert.equal(S.angleFor(c, 30), 70); assert.equal(S.angleFor(c, 50), 60);
  near(S.angleFor(c, 25), 75, 1e-12, 'mid first'); near(S.angleFor(c, 40), 65, 1e-12, 'mid second');
  assert.equal(S.angleFor(c, 0), 80); assert.equal(S.angleFor(c, 99), 60);
  const adj = CASES[0]; for (const r of adj.ok) assert.equal(S.angleFor(adj.c, r.dRobotIn), r.launchDeg);
  assert.ok(Number.isNaN(S.angleFor({ hood: { mode: 'adjustable', table: [] } }, 30)));
});

test('z(rho) is non-decreasing in v on the table range (theta 40-80, rho 0.2-1.5 m, v 2-12; backspin, topspin, dual); outside it the solver returns the lowest root', () => {
  const c0 = S.constantsFrom(BASE, [], E);
  for (const S0 of [1, -1, 0.25, -0.5]) for (let th = 40; th <= 80; th += 5) for (const rho of [0.2, 0.5, 0.8, 1.1, 1.5]) {
    let prev = -Infinity;
    for (let v = 2; v <= 12.0001; v += 0.25) { const z = S.heightAt({ ...c0, S0 }, th, v, rho); assert.ok(z >= prev - 1e-12, `S0 ${S0} th ${th} rho ${rho} v ${v}: ${z} < ${prev}`); prev = z; }
  }
  // steep backspin shot (84 deg): z(rho) peaks near 13 m/s and then falls (F(16) < aim), so plain bisection on [2, 16] would fail; the solver returns the lowest speed that reaches the aim height.
  const c = { ...CASES[0].c, aim: [], hood: { mode: 'fixed', angleDeg: 84 } }, d = 20 + 5.5, rho = 20 * IN;
  const s = S.solveSpeed(c, d);
  let vLow = null; for (let v = 2; v <= 16 && vLow === null; v += 0.001) if (S.heightAt(c, 84, v, rho) >= c.aimZM) vLow = v;
  assert.ok(s.ok); near(s.vMps, vLow, 2e-3, 'lowest root');
});

for (const k of CASES) {
  test(`solveSpeed ${k.name} at BASE: at every table distance it reproduces the row's centre exit speed to 1e-4 relative (by construction); ok, <= 80 flights`, () => {
    for (const r of k.ok) {
      const s = S.solveSpeed(k.c, r.dRobotIn);
      assert.ok(s.ok && s.iterations <= 80, `d ${r.dRobotIn}`);
      near(s.vMps / r.exitSpeedMps.c, 1, 1e-4, `d ${r.dRobotIn} v ${s.vMps} vs ${r.exitSpeedMps.c}`);
      near(s.motorRpm, s.vMps * k.c.rpmPerMps, 1e-9, 'rpm'); near(s.ticksPerSec, s.motorRpm / 60 * 28, 1e-9, 'ticks'); assert.equal(s.thetaDeg, r.launchDeg);
    }
  });
}

test('solveSpeed: ok:false beyond reach (too far, too close, angle cannot reach the aim height, bad constants)', () => {
  const fix = CASES[1].c;
  for (const d of [800, 5.6, 5.5, 0, -3]) { const s = S.solveSpeed(fix, d); assert.equal(s.ok, false, 'd ' + d); assert.ok(Number.isNaN(s.vMps) && Number.isNaN(s.motorRpm) && Number.isNaN(s.ticksPerSec)); }
  assert.equal(S.solveSpeed({ ...fix, hood: { mode: 'fixed', angleDeg: 10 } }, 40).ok, false);
  assert.equal(S.solveSpeed({ ...fix, aim: [], aimZM: 40 }, 40).ok, false);
  assert.equal(S.solveSpeed({ ...fix, aim: [], aimZM: NaN }, 40).ok, false);
  assert.equal(S.solveSpeed({ ...fix, hood: { mode: 'fixed', angleDeg: NaN } }, 40).ok, false);
});

test('solveSpeed: dense sweep stays within the 80-flight limit (backspin and topspin); a solve is cheap', (t) => {
  const top = S.constantsFrom({ ...FIX, shooter: { ...BASE.shooter, spin: 'top' } }, CASES[1].rows, E);
  let max = 0, n = 0; const t0 = process.hrtime.bigint();
  for (const c of [CASES[0].c, CASES[1].c, top]) for (let d = 14; d <= 60; d += 0.5) { const s = S.solveSpeed(c, d); n++; if (s.ok) { assert.ok(s.iterations <= 80); max = Math.max(max, s.iterations); } }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  assert.ok(max >= 20 && max <= 80, 'max iterations ' + max); t.diagnostic('max flights per solve ' + max);
  assert.ok(ms < 50, `${ms} ms per solve`);
});
