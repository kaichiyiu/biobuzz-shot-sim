import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const U = createRequire(import.meta.url)(path.join(ROOT, 'src', 'units.js'));
const E = loadEngine();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const S = (o) => ({ ...BASE, ...o, shooter: { ...BASE.shooter, ...(o.shooter || {}) } });

test('unit conversions: known values', () => {
  near(U.toLen(1, 'metric'), 2.54, 1e-12, 'in->cm');
  near(U.toSpeed(1, 'imperial'), 3.28084, 1e-5, 'm/s->ft/s');
  near(U.toMass(1, 'metric'), 1000, 1e-9, 'kg->g');
  near(U.toMass(0.028349523125, 'imperial'), 1, 1e-12, 'kg->oz');
  near(U.toLen(16, 'imperial'), 16, 0, 'in identity');
  assert.equal(U.fmtLen(16, 0, 'metric'), '41 cm');
  assert.equal(U.fmtLen(16, 0, 'imperial'), '16 in');
  assert.equal(U.fmtSpeed(7.5, null, 'metric'), '7.50 m/s');
  assert.equal(U.fmtSpeed(7.5, null, 'imperial'), '24.6 ft/s');
  assert.equal(U.fmtMass(0.0249, 1, 'metric'), '24.9 g');
  assert.equal(U.fmtLen(NaN), '—');
});

test('unit conversions: round trips in both systems', () => {
  for (const u of ['metric', 'imperial']) {
    for (let k = 0; k < 200; k++) {
      const x = (k - 100) * 0.731;
      near(U.fromLen(U.toLen(x, u), u), x, 1e-12, `len ${u}`);
      near(U.fromSpeed(U.toSpeed(x, u), u), x, 1e-12, `speed ${u}`);
      near(U.fromMass(U.toMass(x, u), u), x, 1e-12, `mass ${u}`);
      near(U.parseLen(String(U.toLen(x, u)), u), x, 1e-9, `parseLen ${u}`);
      near(U.parseSpeed(String(U.toSpeed(x, u)), u), x, 1e-9, `parseSpeed ${u}`);
      near(U.parseMass(String(U.toMass(x, u)), u), x, 1e-9, `parseMass ${u}`);
    }
  }
  assert.ok(Number.isNaN(U.parseLen('abc', 'metric')));
  assert.ok(Number.isNaN(U.parseLen('', 'metric')));
  near(U.parseLen(' 1,000 ', 'metric'), 1000 / 2.54, 1e-9, 'commas/space');
});

test('unit system state and engine-text localisation', () => {
  assert.equal(U.setSystem('metric'), 'metric');
  assert.equal(U.lenUnit(), 'cm');
  assert.equal(U.localizeText('Needs at least 7.2 m/s — at most 29.0 in from'), 'Needs at least 7.2 m/s — at most 73.7 cm from');
  U.setSystem('imperial');
  assert.equal(U.localizeText('Needs at least 7.2 m/s'), 'Needs at least 23.6 ft/s');
  assert.equal(U.setSystem('bogus'), 'imperial');
});

test('mouth: defaults reproduce the old (robot-centre) results exactly', () => {
  for (const base of [S({}), S({ robot: { x: -40, y: -50 } }), S({ target: 'blue', robot: { x: 12.75, y: 48 } })]) {
    const old = E.evaluate(base, 'full');
    E._internal.clearCaches && E._internal.clearCaches();
    const neu = E.evaluate({ ...base, mouth: { height: base.h0, forward: 0, lateral: 0 } }, 'full');
    assert.equal(neu.verdict, old.verdict);
    assert.equal(neu.hitRate, old.hitRate);
    assert.deepEqual(neu.best && [neu.best.thetaDeg, neu.best.v, neu.best.yawDeg], old.best && [old.best.thetaDeg, old.best.v, old.best.yawDeg]);
    near(neu.launch.x, base.robot.x, 1e-12, 'launch x'); near(neu.launch.y, base.robot.y, 1e-12, 'launch y');
  }
});

test('mouth: zero offsets with an explicit heading still equal the old results', () => {
  const base = S({});
  const a = E.evaluate(base, 'full');
  const b = E.evaluate({ ...base, robot: { ...base.robot, heading: 37 } }, 'full');
  assert.equal(b.hitRate, a.hitRate); assert.equal(b.best.v, a.best.v);
});

test('mouth: offsets move the launch point by robot pose', () => {
  const I = E._internal, hs = { red: -1, blue: 1 };
  let p = I.launchPoint({ x: 0, y: -48, heading: 90 }, 5, 2, 'red', hs);   // facing +y: forward = +y, left = -x
  near(p.x, -2, 1e-9, 'x'); near(p.y, -43, 1e-9, 'y');
  p = I.launchPoint({ x: 10, y: 10, heading: 0 }, 5, 2, 'red', hs);
  near(p.x, 15, 1e-9, 'x'); near(p.y, 12, 1e-9, 'y');
  // auto heading faces the CELL: a forward offset brings the mouth closer to the target
  const r0 = E.evaluate(S({}), 'coarse'), r1 = E.evaluate(S({ mouth: { forward: 6 } }), 'coarse');
  near(r0.distIn - r1.distIn, 6, 1e-6, 'forward 6 in toward the CELL');
  const r2 = E.evaluate(S({ mouth: { forward: 99, lateral: -99 } }), 'coarse');
  assert.equal(r2.mouth.forward, 12); assert.equal(r2.mouth.lateral, -12);
});

test('mouth: raising the mouth height lowers the required exit speed', () => {
  // flat shot from the audience side: a higher mouth needs less speed to reach the CELL
  const lo = E.evaluate(S({ mouth: { height: 8 } }), 'full');
  const hi = E.evaluate(S({ mouth: { height: 26 } }), 'full');
  assert.ok(lo.best && hi.best, 'both have arcs');
  assert.ok(hi.best.v < lo.best.v, `v(26 in) ${hi.best.v} < v(8 in) ${lo.best.v}`);
  assert.equal(hi.h0, 26);
  // mouth.height wins over legacy h0
  assert.equal(E.evaluate(S({ h0: 10, mouth: { height: 20 } }), 'coarse').h0, 20);
});
