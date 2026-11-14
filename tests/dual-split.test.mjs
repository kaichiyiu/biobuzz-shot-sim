// Issue M2 (N2): DualSplit.motor / rows, pure maths (no engine motorCore involved).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const DS = createRequire(import.meta.url)('../src/dual-split.js');
// POLLEN (2.80 in, 0.055 lb, wall 0.070 in; thin hollow sphere), yj6000 12 V, 96 mm wheel, I = 4e-4 per shaft, eta_dual 0.9
const R = 1.4 * 0.0254, Ri = R - 0.07 * 0.0254, MASS = 0.055 * 0.45359237;
const BALL = { massKg: MASS, I: 0.4 * MASS * (R ** 5 - Ri ** 5) / (R ** 3 - Ri ** 3), rIn: 1.4 };
const WFREE = 6000 * 0.97 * 2 * Math.PI / 60, IB = 4e-4, TAU = IB * WFREE / 0.1442;
const inp = (k, o = {}) => {
  const v = o.v || 9;
  return { ball: BALL, vExit: v, S0: (1 - k) / (1 + k), k, vBottom: v / (0.9 * (1 + k) / 2), wheelRadiusM: 0.048, IB, IT: IB, lossFactor: 2,
    control: 'pid', tauS: TAU, wFree: WFREE, dt: 0.5, ...o };
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('k = 1: no spin, equal split, identical wheels', () => {
  for (const control of ['pid', 'power']) {
    const m = DS.motor(inp(1, { control }));
    near(m.share, 0.5, 1e-15); near(m.dipB, m.dipT, 1e-12); near(m.dipExit, m.dipB, 1e-12);
    near(m.JB_over_mv, 0.5, 1e-15); near(m.JT_over_mv, 0.5, 1e-15);
  }
});

test('c = 0 (point-mass ball) reproduces the old 1 / (1 + k) share exactly', () => {
  for (const k of [0.2, 0.45, 0.8]) near(DS.motor(inp(k, { ball: { ...BALL, I: 0 } })).share, 1 / (1 + k), 1e-15, 'k ' + k);
});

test('invariants: E_B + E_T = E_tot, J_B + J_T = m v, J_B - J_T = c S0 m v, shares add to 1 (1e-12)', () => {
  for (const k of [0, 0.05, 0.2, 0.3, 0.45, 0.6, 0.9, 1]) for (const control of ['pid', 'power']) {
    const i = inp(k, { control }), m = DS.motor(i);
    near(m.EBJ + m.ETJ, m.EtotJ, 1e-12, 'energy k ' + k);
    near(m.share + m.shareTop, 1, 1e-12);
    near(m.JB_over_mv + m.JT_over_mv, 1, 1e-12);
    near(m.JB_over_mv - m.JT_over_mv, m.c * i.S0, 1e-12);
    // energy drawn is proportional to impulse x surface speed
    if (k > 0) near(m.ETJ / m.EBJ, k * m.JT_over_mv / m.JB_over_mv, 1e-12, 'work ratio k ' + k);
    near(m.c, 0.634, 5e-4);
  }
});

test('plan table (POLLEN, yj6000, I 4e-4, D 96 mm, eta 0.9): share, dip_B, dip_T, dip_x', () => {
  const T = [[0.2, 0.925, 5.10, 10.7], [0.3, 0.872, 5.21, 8.7], [0.45, 0.784, 5.38, 7.4], [0.6, 0.697, 5.55, 6.8], [1.0, 0.5, 6.0, 6.0]];
  for (const [k, sh, dB, dT] of T) {
    const m = DS.motor(inp(k));
    near(m.share, sh, 6e-4, 'share k ' + k); near(100 * m.dipB, dB, 0.02, 'dip_B k ' + k); near(100 * m.dipT, dT, 0.1, 'dip_T k ' + k);
    near(100 * m.dipExit, 6.0, 0.05, 'dip_x k ' + k);
  }
});

test('exit-speed dip stays within 0.1 pp of the k = 1 dip for dips <= 10 %', () => {
  const ref = DS.motor(inp(1)).dipB;
  for (const k of [0.3, 0.45, 0.6, 0.8]) for (const v of [5.05, 9]) {
    const m = DS.motor(inp(k, { v }));
    assert.ok(m.dipB <= 0.1 && m.dipT <= 0.1);
    near(100 * m.dipExit, 100 * ref, 0.1, `k ${k} v ${v}`);
  }
});

test('dip does not depend on the exit speed (E ~ v^2, w0 ~ v)', () => {
  near(DS.motor(inp(0.45, { v: 5.05 })).dipB, DS.motor(inp(0.45, { v: 9 })).dipB, 1e-12);
});

test('top wheel at rest (k = 0): all energy on the bottom wheel, no top dip, no NaN', () => {
  for (const control of ['pid', 'power']) {
    const m = DS.motor(inp(0, { control, vBottom: 5 }));
    assert.equal(m.share, 1); assert.equal(m.shareTop, 0); assert.equal(m.ETJ, 0); assert.equal(m.dipT, 0); assert.equal(m.w0T, 0);
    assert.equal(m.resT, 0);
    for (const x of Object.values(m)) assert.ok(typeof x === 'number' && !Number.isNaN(x), 'finite or Infinity, never NaN');
  }
});

test('a stalled top wheel: w1T = 0, dipT = 1, recovery stays finite for PID', () => {
  const m = DS.motor(inp(0.5, { IT: 1e-6, vExit: 9 }));   // tiny top inertia cannot supply its share
  assert.equal(m.w1T, 0); assert.equal(m.dipT, 1);
  assert.ok(Number.isFinite(m.recoveryS) && m.recoveryS > 0);
  for (const x of Object.values(m)) assert.ok(!Number.isNaN(x));
});

test('recovery: slower wheel decides; unreachable speed is Infinity; PID residual 0 when back before the next shot', () => {
  const m = DS.motor(inp(0.3));
  assert.equal(m.residual, 0);
  const t = (w0, w1, tau) => tau * Math.log((WFREE - w1) / (WFREE - w0));
  near(m.recoveryS, Math.max(t(m.w0B, m.w1B, TAU), t(m.w0T, m.w1T, TAU)), 1e-12);
  assert.equal(DS.motor(inp(0.3, { vBottom: 1.1 * WFREE * 0.048 })).recoveryS, Infinity);
  const o = DS.motor(inp(0.3, { control: 'power' }));   // open loop: residual = dip_x e^(-dt/tau) (linear law)
  near(o.residual, o.dipExit * Math.exp(-0.5 / TAU), 1e-12);
});

test('IT scales the top wheel: a heavier top shaft dips less and recovers slower', () => {
  const a = DS.motor(inp(0.45)), b = DS.motor(inp(0.45, { IT: 8e-4 }));
  assert.ok(b.dipT < a.dipT);
  near(b.EBJ, a.EBJ, 1e-15);
});

test('rows(): top wheel rows from a dual result, no verdict words; empty for a non-dual / legacy result', () => {
  const i = inp(0.45), d = DS.motor(i), k = 0.45;
  const details = { type: 'dual', splitModel: 'impulse', topRatio: k, cBall: d.c, share: d.share, shareTop: d.shareTop, keLinJ: 1.01, keRotJ: 0.1, w0: d.w0B,
    w0Top: d.w0T, w1Top: d.w1T, shotEnergyTopJ: d.ETJ, inertiaKgM2: IB, inertiaTopKgM2: IB };
  const m = { S0: i.S0, dip: d.dipB, dipTop: d.dipT, dipExit: d.dipExit, details };
  const fmt = { f: (x, n) => x.toFixed(n), pct: (x, n) => (100 * x).toFixed(n) + '%', sci: (x) => x.toExponential(2), ms: (x) => x.toFixed(0) + ' ms' };
  const rows = DS.rows(m, details, fmt);
  assert.equal(rows.length, 6);
  for (const r of rows) {
    assert.ok(r.what && r.formula && r.numbers && r.result, r.what);
    assert.ok(!/POSSIBLE|NOT CONSISTENT|WON'T WORK|verdict/i.test(JSON.stringify(r)));
    assert.ok(!/NaN|undefined/.test(JSON.stringify(r)), r.what);
  }
  assert.deepEqual(DS.rows(null, null, fmt), []);
  assert.deepEqual(DS.rows({ ...m }, { ...details, type: 'single' }, fmt), []);
  assert.deepEqual(DS.rows({ ...m }, { ...details, splitModel: undefined }, fmt), []);
});

test('recoveryRows(): slower wheel and exit-weighted leftover equal motor() for both control types', () => {
  const fmt = { f: (x, n) => x.toFixed(n), pct: (x, n) => (100 * x).toFixed(n) + '%', sci: (x) => x.toExponential(2), ms: (x) => (isFinite(x) ? x.toFixed(3) + ' ms' : 'never') };
  for (const control of ['pid', 'power']) {
    const i = inp(0.45, { control, dt: 0.5 }), d = DS.motor(i), k = 0.45;
    const details = { type: 'dual', splitModel: 'impulse', topRatio: k, w0: d.w0B, w1: d.w1B, w0Top: d.w0T, w1Top: d.w1T, wFree: WFREE, shotInterval: 0.5, inertiaKgM2: IB, inertiaTopKgM2: IB };
    const m = { control, tauS: TAU, dip: d.dipB, dipTop: d.dipT, recoveryMs: 1000 * d.recoveryS, residual: d.residual };
    const rows = DS.recoveryRows(m, details, fmt);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].result === fmt.ms(m.recoveryMs) && rows[1].result === fmt.pct(d.residual, 2), control);
    assert.ok(rows.every((r) => !/NaN|undefined|verdict|POSSIBLE/.test(JSON.stringify(r))));
  }
  assert.deepEqual(DS.recoveryRows(null, null, fmt), []);
});
