// E1: calib-core - rpm <-> exit speed inverts the engine's motorCore; landing model and its inverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const C = createRequire(import.meta.url)(path.join(ROOT, 'src', 'calib-core.js'));
const E = loadEngine();
const SINGLE = { ...BASE.shooter, type: 'single', gear: 1.5, etaSingle: 0.38 };
const DUAL = { ...BASE.shooter, type: 'dual', topRatio: 0.6, etaDual: 0.8, gear: 1 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('rpm -> speed -> rpm round trip is exact (1e-9), scalar and default factor', () => {
  for (const raw of [SINGLE, DUAL]) {
    const sh = E._internal.shooterNorm(raw);
    for (const r of [500, 1234.5, 3000, 5999]) {
      near(C.motorRpmFromExitSpeed(C.exitSpeedFromMotorRpm(r, sh), sh), r, 1e-9, 'default');
      near(C.motorRpmFromExitSpeed(C.exitSpeedFromMotorRpm(r, sh, 0.33), sh, 0.33), r, 1e-9, 'scalar');
    }
  }
});

test('motorRpmFromExitSpeed equals engine motorCore(...).motorRpm at 5 speeds, single and dual', () => {
  const mo = E._internal.motorById()[BASE.motorId], bp = E.ballProps('pollen');
  for (const raw of [SINGLE, DUAL]) {
    const sh = E._internal.shooterNorm(raw);
    for (const v of [2.5, 4, 5.05, 7.5, 11]) {
      const eng = E._internal.motorCore(mo, sh, bp, v).motorRpm;
      near(C.motorRpmFromExitSpeed(v, sh), eng, 1e-9 * eng, `${raw.type} v=${v}`);
      near(C.exitSpeedFromMotorRpm(eng, sh), v, 1e-12 * v + 1e-12, 'forward');
    }
  }
});

test('curve with constant factor equals the scalar path; varying curve inverts (fixed point and bisection fallback)', () => {
  const sh = E._internal.shooterNorm(SINGLE);
  const flat = [[1000, 0.31], [3000, 0.31], [5000, 0.31]];
  for (const v of [3, 6, 9]) near(C.motorRpmFromExitSpeed(v, sh, flat), C.motorRpmFromExitSpeed(v, sh, 0.31), 1e-9);
  for (const r of [1500, 2500, 4500]) near(C.exitSpeedFromMotorRpm(r, sh, flat), C.exitSpeedFromMotorRpm(r, sh, 0.31), 1e-12);
  const lin = [[1000, 0.30], [3000, 0.36], [5000, 0.40]];
  const steep = [[1000, 0.2], [1100, 0.6], [5000, 0.6]];            // |r f'/f| ~ 10: plain fixed point diverges, bisection takes over
  for (const curve of [lin, steep]) for (const v of [2.5, 3.17, 4.5, 8]) {   // 2.5-4.5 land on the steep segment of `steep`
    const r = C.motorRpmFromExitSpeed(v, sh, curve);
    near(C.exitSpeedFromMotorRpm(r, sh, curve), v, 1e-9, 'curve inverse');
  }
  assert.equal(C.factorAt(lin, 200), 0.30); assert.equal(C.factorAt(lin, 9000), 0.40);
  near(C.factorAt(lin, 2000), 0.33, 1e-12);
});

test('landingIn matches the closed-form vacuum parabola (rho = 0), contact and centre levels', () => {
  const g = E.constants().aero.g, rIn = E.ballProps('pollen').rIn, h0 = 16;
  for (const [th, v] of [[30, 6], [45, 9], [60, 7]]) {
    for (const [level, drop] of [['contact', (h0 - rIn) * 0.0254], ['centre', h0 * 0.0254]]) {
      const vz = v * Math.sin(th * Math.PI / 180), vx = v * Math.cos(th * Math.PI / 180);
      const t = (vz + Math.sqrt(vz * vz + 2 * g * drop)) / g;       // z(t) = vz t - g t^2/2 = -drop
      near(C.landingIn(E, 'pollen', 1, th, v, h0, { rho: 0, level }), vx * t / 0.0254, 0.05, `${th} ${v} ${level}`);
    }
  }
  assert.ok(C.landingIn(E, 'pollen', 1, 45, 8, 16, { level: 'centre' }) > C.landingIn(E, 'pollen', 1, 45, 8, 16));
  assert.ok(Number.isNaN(C.landingIn(E, 'pollen', 1, 45, 8, 1)), 'mouth lower than the ball radius');
});

test('speedForLanding inverts landingIn (1e-4) for balls, spins and angles; unreachable distances give null', () => {
  const cases = [['pollen', 1], ['pollen', -1], ['nectar', 1], ['pollen', 0.25]];
  for (const [ball, S0] of cases) for (const th of [20, 35, 50, 70]) for (const v of [3, 5.5, 9]) {
    const d = C.landingIn(E, ball, S0, th, v, 16);
    near(C.speedForLanding(E, ball, S0, th, d, 16), v, 1e-4, `${ball} ${S0} ${th} ${v}`);
  }
  assert.equal(C.speedForLanding(E, 'pollen', 1, 45, 1e6, 16), null);
  assert.equal(C.speedForLanding(E, 'pollen', 1, 45, 0.01, 16), null);
  assert.equal(C.speedForLanding(E, 'pollen', 1, 45, NaN, 16), null);
});

test('landing is strictly increasing in exit speed for 20-70 deg (backspin, topspin, dual, both balls)', () => {
  for (const [ball, S0] of [['pollen', 1], ['pollen', -1], ['nectar', 1], ['pollen', 0.25]]) {
    for (let th = 20; th <= 70; th += 5) {
      let prev = 0;
      for (let v = 1; v <= 16; v += 0.5) {
        const d = C.landingIn(E, ball, S0, th, v, 16);
        assert.ok(d > prev, `${ball} S0=${S0} th=${th} v=${v}: ${d} <= ${prev}`);
        prev = d;
      }
    }
  }
});

test('shooterOf resolves cfg.robot.shooter, wheel diameter sources and spin ratio', () => {
  const cfg = { robot: { shooter: { ...SINGLE, wheelDiameterMm: undefined, wheelId: 'gecko72' } } };
  const a = C.shooterOf(E, cfg, { wheels: [{ id: 'gecko72', diameterMm: 72 }] });
  assert.equal(a.sh.wheelDiameterMm, 72); assert.equal(a.note, null); assert.equal(a.S0, 1);
  assert.match(C.shooterOf(E, cfg).note, /default/);
  assert.equal(C.shooterOf(E, { shooter: { ...SINGLE, spin: 'top' } }).S0, -1);
  near(C.shooterOf(E, DUAL).S0, 0.25, 1e-12);
  assert.equal(C.shooterOf(E, SINGLE, { wheelDiameterMm: 50 }).sh.wheelDiameterMm, 96, 'explicit shooter value wins');
});
