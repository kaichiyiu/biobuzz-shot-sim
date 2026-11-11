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

// main's engine (before the mouth work) as the reference for "old results"
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadData } from './load-data.mjs';
function mainEngine() {
  const src = execFileSync('git', ['show', '427b5e9:src/engine.js'], { cwd: ROOT, encoding: 'utf8' });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bbz-')), 'engine-main.cjs');
  fs.writeFileSync(f, src);
  const M = createRequire(import.meta.url)(f); M.init(loadData()); return M;
}
const pick = (r) => ({ verdict: r.verdict, hitRate: r.hitRate, best: r.best && [r.best.thetaDeg, r.best.v, r.best.yawDeg], dist: r.distIn, psi0: r.psi0Deg });

test('mouth: a mouth at the old robot-centre spot reproduces the old results exactly', () => {
  const OLD = mainEngine();
  for (const base of [S({}), S({ robot: { x: -40, y: -50 } }), S({ target: 'blue', robot: { x: 12.75, y: 48 } }), S({ h0: 26, robot: { x: -12.75, y: -30 } })]) {
    const old = OLD.evaluate(base, 'full');
    const { robot, ...rest } = base;
    const neu = E.evaluate({ ...rest, mouth: { x: robot.x, y: robot.y, height: base.h0 } }, 'full');
    assert.deepEqual(pick(neu), pick(old));
    near(neu.launch.x, robot.x, 0, 'launch x'); near(neu.launch.y, robot.y, 0, 'launch y');
  }
  // default params (no mouth, no robot) = the old default robot spot (-12.75, -48)
  const { robot, ...noPos } = S({});
  assert.deepEqual(pick(E.evaluate(noPos, 'full')), pick(OLD.evaluate(S({}), 'full')));
  assert.deepEqual(E.evaluate(noPos, 'coarse').mouth, { x: -12.75, y: -48, height: 16 });
});

const HALF = loadData().field.field.half;
test('field frame: field size from data', () => { assert.equal(HALF, 70.5); });

test('field frame: corners map correctly for every origin', () => {
  const W = 2 * HALF;
  const eng = { 'red-audience': [-HALF, -HALF], 'blue-audience': [HALF, -HALF], 'red-far': [-HALF, HALF], 'blue-far': [HALF, HALF] };
  for (const c of Object.keys(U.CORNERS)) {
    const o = U.fieldToUser(...eng[c], c);
    near(o.x, 0, 1e-12, `${c} origin x`); near(o.y, 0, 1e-12, `${c} origin y`);
    const opp = U.fieldToUser(-eng[c][0], -eng[c][1], c);
    near(opp.x, W, 1e-12, `${c} opposite x`); near(opp.y, W, 1e-12, `${c} opposite y`);
    const m = U.fieldToDisplay(-eng[c][0], -eng[c][1], c, 'metric');
    near(m.x, 358.14, 1e-9, 'opposite corner cm'); near(m.y, 358.14, 1e-9, 'opposite corner cm');
    const ctr = U.fieldToUser(0, 0, c); near(ctr.x, HALF, 1e-12, 'centre'); near(ctr.y, HALF, 1e-12, 'centre');
    // x always runs along the audience / far wall (engine x), y along the alliance wall (engine y)
    const px = U.fieldToUser(eng[c][0] + -Math.sign(eng[c][0]) * 10, eng[c][1], c);
    near(px.x, 10, 1e-12, `${c} x axis`); near(px.y, 0, 1e-12, `${c} x axis`);
  }
  assert.equal(U.DEFAULT_CORNER, 'red-audience');
  const d = U.fieldToUser(-12.75, -48, 'red-audience');
  near(d.x, 57.75, 1e-12, 'default mouth x'); near(d.y, 22.5, 1e-12, 'default mouth y');
  assert.equal(U.normCorner('bogus'), 'red-audience');
});

test('field frame: round trips for all 4 origins in both unit systems', () => {
  for (const c of Object.keys(U.CORNERS)) for (const u of ['imperial', 'metric']) {
    for (let k = 0; k < 100; k++) {
      const X = -HALF + (k * 7.31) % (2 * HALF), Y = HALF - (k * 3.77) % (2 * HALF);
      const q = U.fieldToDisplay(X, Y, c, u);
      assert.ok(q.x >= -1e-9 && q.y >= -1e-9, 'inside the field is non-negative');
      const w = U.displayToField(q.x, q.y, c, u);
      near(w.x, X, 1e-9, `${c} ${u} x`); near(w.y, Y, 1e-9, `${c} ${u} y`);
      const h = (k * 37.3) % 360;
      const back = U.headingToField(U.headingToUser(h, c), c);
      near(Math.abs(((back - h) % 360 + 540) % 360 - 180), 0, 1e-9, `${c} heading`);
    }
  }
});

test('heading output: known geometry', () => {
  // red-audience origin: axes parallel to the engine's, so headings are unchanged
  near(U.headingToUser(90, 'red-audience'), 90, 1e-12, 'ra');
  near(U.headingToUser(90, 'blue-far'), 270, 1e-12, 'bf');      // both axes flipped
  near(U.headingToUser(0, 'blue-audience'), 180, 1e-12, 'ba');  // x flipped
  near(U.headingToUser(45, 'red-far'), 315, 1e-12, 'rf');       // y flipped
  // mouth straight in front of the red HIVE on the audience side: the mouth points +y (toward the HIVE)
  const r = E.evaluate(S({ robot: undefined, mouth: { x: -12.75, y: -48, height: 16 } }), 'full');
  assert.ok(r.best);
  near(r.psi0Deg, 90, 1e-9, 'line to the CELL');
  near(r.aimHeadingDeg, r.best.yawDeg, 0, 'aim = best yaw');
  near(U.headingToUser(r.aimHeadingDeg, 'red-audience'), 90, 1.5, 'user heading ~90');
  near(U.headingToUser(r.aimHeadingDeg, 'blue-far'), 270, 1.5, 'user heading ~270');
  // oblique: from (-50,-50) toward the red CELL mouth centroid
  const cen = E._internal.mouthCentroid('red', -1);
  const o = E.evaluate(S({ robot: undefined, mouth: { x: -50, y: -50 } }), 'coarse');
  near(o.psi0Deg, Math.atan2(cen[1] + 50, cen[0] + 50) * 180 / Math.PI, 1e-9, 'oblique psi0');
});

test('mouth: clamped to the field interior by a ball radius', () => {
  const r = E.evaluate(S({ robot: undefined, mouth: { x: 99, y: -99 } }), 'coarse');
  const L = HALF - E.ballProps('pollen').rIn;
  near(r.mouth.x, L, 1e-12, 'x'); near(r.mouth.y, -L, 1e-12, 'y');
  assert.ok(r.warnings.some((w) => w.code === 'CLAMPED'));
  const n = E.evaluate(S({ ballId: 'nectar', robot: undefined, mouth: { x: 99, y: 0 } }), 'coarse');
  near(n.mouth.x, HALF - E.ballProps('nectar').rIn, 1e-12, 'nectar limit');
  // scan grid stays inside the mouth limit
  for (const q of E.scanPoints(6)) assert.ok(Math.abs(q.x) <= L && Math.abs(q.y) <= L);
});

test('mouth: raising the mouth height lowers the required exit speed', () => {
  const lo = E.evaluate(S({ mouth: { height: 8 } }), 'full');
  const hi = E.evaluate(S({ mouth: { height: 26 } }), 'full');
  assert.ok(lo.best && hi.best, 'both have arcs');
  assert.ok(hi.best.v < lo.best.v, `v(26 in) ${hi.best.v} < v(8 in) ${lo.best.v}`);
  assert.equal(hi.h0, 26);
  assert.equal(E.evaluate(S({ h0: 10, mouth: { height: 20 } }), 'coarse').h0, 20);
});
