// E3: calib-fit - synthetic shots from the engine's own forward model with a known factor and Gaussian noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const C = req(path.join(ROOT, 'src', 'calib-core.js'));
const F = req(path.join(ROOT, 'src', 'calib-fit.js'));
const E = loadEngine();
const SINGLE = { ...BASE.shooter, type: 'single', etaSingle: 0.45 };
const DUAL = { ...BASE.shooter, type: 'dual', topRatio: 0.6, etaDual: 0.9 };
const cfgOf = (shooter) => ({ field: { ballId: 'pollen', h0: 16 }, robot: { shooter } });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

function rng(seed) {                      // mulberry32 + Box-Muller
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}
// rows from the forward model: truth(rpm) = exit factor; rpm set per row; actualDeg = hood + real offset
function gen(shooter, truth, rpms, { noise = 2, seed = 1, hood = 45, n = 5, offset = 0 } = {}) {
  const g = rng(seed), so = C.shooterOf(E, cfgOf(shooter)), f = typeof truth === 'number' ? () => truth : truth;
  return rpms.map((rpm, i) => {
    const m = rpm * (1 + 0.005 * g());                                  // encoder reading differs slightly from the setpoint
    const v = C.exitSpeedFromMotorRpm(m, so.sh, f(m));
    const d0 = C.landingIn(E, 'pollen', so.S0, hood + offset, v, 16);
    return { settingId: 's' + i, ballId: 'pollen', h0In: 16, hoodDeg: hood, measuredMotorRpm: m, landingIn: Array.from({ length: n }, () => d0 + noise * g()) };
  });
}
const fit = (rows, shooter, o) => F.fit(rows, cfgOf(shooter), { engine: E, ...o });

test('single: recovers factor 0.36 from 2 in landing noise (|error| < 0.01) over 12 seeds', () => {
  let worst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = fit(gen(SINGLE, 0.36, [2200, 3000, 3800], { seed }), SINGLE);
    worst = Math.max(worst, Math.abs(r.factor - 0.36));
    assert.equal(r.mode, 'single'); assert.equal(r.curve, null); assert.equal(r.eta.single, r.factor); assert.equal(r.eta.dual, undefined);
  }
  assert.ok(worst < 0.01, 'worst error ' + worst);
});

test('noise-free data is recovered to 1e-5 and nothing is flagged', () => {
  const r = fit(gen(SINGLE, 0.36, [2200, 3000, 3800], { noise: 0 }), SINGLE);
  near(r.factor, 0.36, 1e-5);
  assert.ok(r.rows.every((x) => x.flag === 'ok' && Math.abs(x.residualIn) < 0.01 && x.spreadIn < 1e-6));
  assert.ok(r.spreadRpm < 0.01);
  assert.ok(r.assumptions.some((a) => /Actual launch angle = hood angle/.test(a)));
});

test('one wild shot is flagged "repeat" and moves the fit by less than 0.005', () => {
  const clean = gen(SINGLE, 0.36, [2200, 3000, 3800], { seed: 7 });
  const dirty = JSON.parse(JSON.stringify(clean)); dirty[1].landingIn[2] += 70;
  const a = fit(clean, SINGLE), b = fit(dirty, SINGLE);
  assert.deepEqual(b.rows.map((x) => x.flag), ['ok', 'repeat', 'ok']);
  assert.match(b.rows[1].reason, /outlier/);
  assert.ok(Math.abs(a.factor - b.factor) < 0.005, `${a.factor} ${b.factor}`);
  assert.equal(b.rows[1].nUsed, 4);
  // an impossible distance (never reached) is unusable, flagged and excluded
  const imp = JSON.parse(JSON.stringify(clean)); imp[0].landingIn[0] = 1e6;
  const c = fit(imp, SINGLE);
  assert.equal(c.rows[0].flag, 'repeat'); assert.match(c.rows[0].reason, /cannot reach/);
  assert.throws(() => fit([{ ...clean[0], landingIn: [1e6] }], SINGLE), /no usable/);
});

test('perRpm recovers a linear factor trend; single fit is biased on the same data', () => {
  const truth = (rpm) => 0.30 + 0.10 * (rpm - 1500) / 3000;
  const rows = gen(SINGLE, truth, [1500, 2500, 3500, 4500], { noise: 1, seed: 3 });
  const r = fit(rows, SINGLE, { mode: 'perRpm' });
  assert.equal(r.mode, 'perRpm'); assert.equal(r.curve.length, 4);
  r.curve.forEach(([rpm, f]) => near(f, truth(rpm), 0.01, 'knot ' + rpm));
  near(C.factorAt(r.curve, 3000), truth(3000), 0.01, 'interpolated');
  near(r.factor, truth(3000), 0.01, 'engine eta = value at the middle of the range');
  assert.ok(r.curve.every((k, i) => i === 0 || k[0] > r.curve[i - 1][0]));
  const s = fit(rows, SINGLE);
  assert.ok(Math.max(...rows.map((x) => Math.abs(s.factor - truth(x.measuredMotorRpm)))) > 0.04);
  // the curve predicts each row better than the single factor
  const err = (fr) => Math.max(...fr.rows.map((x) => Math.abs(x.residualIn)));
  assert.ok(err(r) < 0.5 * err(s), `${err(r)} vs ${err(s)}`);
});

test('perRpm falls back to single with a note when the curve is unusable', () => {
  const one = fit(gen(SINGLE, 0.36, [3000], { seed: 2 }), SINGLE, { mode: 'perRpm' });
  assert.equal(one.mode, 'single'); assert.ok(one.assumptions.some((a) => /at least 2 distinct/.test(a)));
});

test('perRpm with exit speed falling as rpm rises (unphysical) falls back to single with a note', () => {
  const truth = (rpm) => (rpm < 2000 ? 0.60 : 0.25);
  const r = fit(gen(SINGLE, truth, [1900, 2100, 3000], { noise: 0.5, seed: 6 }), SINGLE, { mode: 'perRpm' });
  assert.equal(r.mode, 'single'); assert.equal(r.curve, null);
  assert.ok(r.assumptions.some((a) => /fall as rpm rises/.test(a)));
});

test('dual wheels: etaDual = factor * 2 / (1 + topRatio) and recovers the true etaDual', () => {
  const trueEta = 0.82, k = 0.6;
  const r = fit(gen(DUAL, trueEta * (1 + k) / 2, [1300, 1800, 2400], { seed: 5 }), DUAL);
  near(r.factor, trueEta * (1 + k) / 2, 0.01);
  near(r.eta.dual, r.factor * 2 / (1 + k), 1e-12);
  near(r.eta.dual, trueEta, 0.015); assert.equal(r.eta.single, undefined);
});

test('spreadRpm grows with landing noise; its definition (half the 5-95 % range) matches 1.645 sigma on large samples', () => {
  const sp = [0.5, 2, 6].map((noise) => fit(gen(SINGLE, 0.36, [2200, 3000, 3800], { noise, seed: 11 }), SINGLE).spreadRpm);
  assert.ok(sp[0] < sp[1] && sp[1] < sp[2] && sp[0] > 0, sp.join());
  // one row, 600 shots: spreadRpm ~ 1.645 * sigma_d / (d landing / d rpm)
  const rows = gen(SINGLE, 0.36, [3000], { noise: 3, seed: 4, n: 600 });
  const r = fit(rows, SINGLE), m = rows[0].measuredMotorRpm, so = C.shooterOf(E, cfgOf(SINGLE));
  const L = (rpm) => C.landingIn(E, 'pollen', so.S0, 45, C.exitSpeedFromMotorRpm(rpm, so.sh, 0.36), 16);
  const slope = (L(m + 10) - L(m - 10)) / 20;
  near(r.spreadRpm, 1.645 * 3 / slope, 0.12 * 1.645 * 3 / slope, 'rpm spread');
});

test('angle offset from video: used in the inversion, reported, and removes the bias it explains', () => {
  const rows = gen(SINGLE, 0.36, [2200, 3000, 3800], { noise: 0, offset: 3 });
  const naive = fit(rows, SINGLE), good = fit(rows, SINGLE, { angleOffsetDeg: 3 });
  near(good.factor, 0.36, 1e-5); assert.equal(good.angleOffsetDeg, 3); assert.equal(naive.angleOffsetDeg, null);
  assert.ok(Math.abs(naive.factor - 0.36) > 0.003);
  assert.ok(good.assumptions.some((a) => /hood angle \+ 3 deg/.test(a)));
});

test('clean Gaussian data: few false "repeat" rows (< 10 % over 30 seeds), fit still within 0.01', () => {
  let rowsRep = 0, total = 0;
  for (let seed = 100; seed < 130; seed++) {
    const r = fit(gen(SINGLE, 0.36, [2200, 3000, 3800], { seed }), SINGLE);
    rowsRep += r.rows.filter((x) => x.flag === 'repeat').length; total += r.rows.length;
    near(r.factor, 0.36, 0.01);
  }
  assert.ok(rowsRep / total < 0.1, `${rowsRep}/${total}`);
});

test('a row with much larger scatter than the others is marked repeat', () => {
  const rows = gen(SINGLE, 0.36, [2200, 3000, 3800, 3400], { noise: 0.5, seed: 9 });
  const g = rng(99); rows[3].landingIn = rows[3].landingIn.map((d) => d + 18 * g());
  const r = fit(rows, SINGLE);
  assert.equal(r.rows[3].flag, 'repeat'); assert.equal(r.rows[0].flag, 'ok');
});
