// #7 #8 tolerance glue (I3): unit conversion, margins, bands, motor rules, bestSetpoint. Synthetic views for hand calculations, BASE for the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), I = E._internal, require = createRequire(import.meta.url);
for (const f of ['core', 'along']) require(`../src/engine-tolerance-${f}.js`);
const T = require('../src/engine-tolerance.js'), TC = require('../src/engine-tolerance-core.js');
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, V = E.VERDICTS;
const TOL = { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2 };

function capture(params) {   // view / sel / res / ctx of a full evaluate, taken from the hood result call
  const hood = I.ext('hood'), orig = hood.result; let cap;
  hood.result = function (view, sel, res, hn, m, ctx) { cap = { view, sel, res, ctx }; return orig.apply(this, arguments); };
  try { E.evaluate(params, 'full'); } finally { hood.result = orig; }
  return cap;
}
const P = { ...BASE, hood: ADJ }, C = capture(P), p = I.normParams(P);
const deps = { p, mo: C.ctx.mo, sh: C.ctx.sh, bp: C.ctx.bp };
const run = (tol, res = C.res, view = C.view, sel = C.sel) => T.result(view, sel, res, T.norm(tol), deps);

// ---- synthetic view: ones in a block (minus seeded holes), speeds geometric through the setpoint speed
const NA = 31, NB = 41, NC = 31, LN = 0.01, TH = 0.5, YS = 0.25, V0 = C.sel.v, CELL = [10, 20, 15];
function synth(holes = 0, seed = 7) {
  const H = new Uint8Array(NA * NB * NC); let r = seed;
  for (let a = 7; a <= 15; a++) for (let b = 16; b <= 30; b++) for (let c = 9; c <= 17; c++) H[(a * NB + b) * NC + c] = 1;
  for (let i = 0; i < H.length; i++) { r = (r * 1103515245 + 12345) % 2147483648; if (holes && H[i] && r / 2147483648 < holes && i !== (CELL[0] * NB + CELL[1]) * NC + CELL[2]) H[i] = 0; }
  return { rectHits: H, nA: NA, nB: NB, nC: NC, thStep: TH, lnStep: LN, yawStep: YS,
    thetas: Array.from({ length: NA }, (_, i) => 60 + i * TH), yaws: Array.from({ length: NC }, (_, i) => 85 + i * YS),
    speeds: Array.from({ length: NB }, (_, i) => V0 * Math.exp((i - CELL[1]) * LN)) };
}
const sel0 = (view) => ({ a: CELL[0], b: CELL[1], c: CELL[2], theta: view.thetas[CELL[0]], v: V0, yaw: view.yaws[CELL[2]], cellMaxB: NB - 1, sigV: 0.02 });
const res0 = (o = {}) => ({ distIn: 100, psi0Deg: 90, mode: 'full', code: 'OK', best: { reachable: true }, motor: { control: 'fixed', headroom: 0.5 }, hood: null, ...o });

test('norm: junk to 0, all zero or non-object -> null, source and best flags', () => {
  assert.equal(T.norm(null), null); assert.equal(T.norm(5), null); assert.equal(T.norm({}), null);
  assert.equal(T.norm({ yawDeg: 0, angleDeg: 0, rpm: 0, posIn: 0 }), null);
  assert.equal(T.norm({ yawDeg: 'x', angleDeg: NaN, rpm: -3, posIn: Infinity }), null);
  assert.deepEqual(T.norm({ yawDeg: 1, angleDeg: -1, rpm: 'a', posIn: 2, source: 'preset', best: false }), { yawDeg: 1, angleDeg: 0, rpm: 0, posIn: 2, source: 'preset', best: false });
  assert.equal(T.norm({ yawDeg: 1 }).source, 'measured'); assert.equal(T.norm({ yawDeg: 1 }).best, true);
  assert.equal(T.norm({ rpm: 10 }).rpm, 10);
});

test('verdictOf bands: POSSIBLE >= 1.25, NOT CONSISTENT >= 1.0, WON\'T WORK below; null -> WON\'T WORK; custom bands', () => {
  assert.deepEqual(V, [T.verdictOf(2), T.verdictOf(1.1), T.verdictOf(0.5)]);
  assert.deepEqual(T.BANDS, { ok: 1.25, mid: 1 });
  assert.equal(T.verdictOf(1.25), V[0]); assert.equal(T.verdictOf(1.2499), V[1]); assert.equal(T.verdictOf(1.0), V[1]);
  assert.equal(T.verdictOf(0.9999), V[2]); assert.equal(T.verdictOf(0), V[2]); assert.equal(T.verdictOf(null), V[2]); assert.equal(T.verdictOf(NaN), V[2]);
  assert.equal(T.verdictOf(1.25 * (1 - 1e-9)), V[0]);   // the core's "just under" on a knife edge
  assert.equal(T.verdictOf(1.5, { ok: 2, mid: 1.4 }), V[1]);
});

test('synthetic view: margins match the hand calculation (angle, speed, yaw breakpoints)', () => {
  const view = synth(), tn = { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 0 };
  const r = run(tn, res0(), view, sel0(view));
  const rpmC = r.setpoint.motorRpm, x = 50 / rpmC;
  // ones: a 7..15 (3 below, 5 above the cell 10), b 16..30 (4 / 10), c 9..17 (6 / 2). First failing m = run + 1; k = index units per s.
  const angle = Math.min(4 / (1 / TH), 6 / (1 / TH)), yaw = Math.min(7 / (1 / YS), 3 / (1 / YS));
  const rpm = Math.min(5 / (-Math.log(1 - x) / LN), 11 / (Math.log(1 + x) / LN));
  assert.ok(Math.abs(r.perAxis.angle - angle) < 1e-6 && Math.abs(r.perAxis.yaw - yaw) < 1e-6 && Math.abs(r.perAxis.rpm - rpm) < 1e-6, JSON.stringify([r.perAxis, angle, yaw, rpm]));
  assert.ok(Math.abs(r.boxMargin - yaw) < 1e-6, `${r.boxMargin} vs ${yaw}`);   // yaw is the tightest: 3 cells above / 4 per s
  assert.deepEqual([r.limitingAxis, r.limitingSide, r.viewLimited, r.lowerBound, r.capped], ['yaw', 1, false, false, false]);
  assert.equal(r.alongMargin, null); assert.equal(r.position.alongIn, null); assert.equal(r.margin, r.boxMargin);
  assert.ok(Math.abs(r.position.lateralIn - 100 * Math.tan(r.boxMargin * 1 * Math.PI / 180)) < 1e-9);
  assert.equal(r.verdict, V[2]); assert.equal(r.basis, 'rect'); assert.equal(r.mode, 'full'); assert.deepEqual(r.bands, { ok: 1.25, mid: 1 });
});

test('synthetic view: lateral position adds atan(posIn / dist) degrees to the yaw half-window', () => {
  const view = synth(), tn = { yawDeg: 0.5, angleDeg: 0, rpm: 0, posIn: 0 };
  const wY = 0.5 + Math.atan(1.75 / 100) * 180 / Math.PI;
  const a = run(tn, res0(), view, sel0(view)), b = T.result(view, sel0(view), res0(), T.norm({ yawDeg: 0.5, posIn: 0 }), deps);
  assert.ok(Math.abs(a.boxMargin - 3 * YS / 0.5) < 1e-6, String(a.boxMargin));
  // posIn > 0 also runs alongRange on the real BASE geometry; the box part only needs the yaw term
  const c = run({ yawDeg: 0.5, posIn: 1.75 }, res0(), view, sel0(view));
  assert.ok(Math.abs(c.perAxis.yaw - 3 * YS / wY) < 1e-6, `${c.perAxis.yaw} vs ${3 * YS / wY}`);
  assert.ok(b.boxMargin > 0);
});

test('synthetic view: an axis with tolerance 0 is unconstrained; rpm tolerance >= rpm caps the low side at the grid (view limited)', () => {
  const view = synth(), r = run({ yawDeg: 1, angleDeg: 0, rpm: 0, posIn: 0 }, res0(), view, sel0(view));
  assert.equal(r.perAxis.angle, 4); assert.equal(r.perAxis.rpm, 4); assert.ok(r.boxMargin < 4);
  const big = run({ rpm: 1e6 }, res0(), view, sel0(view));
  const kPos = Math.log(1 + 1e6 / big.setpoint.motorRpm) / LN;   // low side: k = b + 1 = 21 (4 ones below, m = 5); high side: 10 ones above, m = 11
  assert.ok(Math.abs(big.perAxis.rpm - Math.min(5 / 21, 11 / kPos)) < 1e-6, String(big.perAxis.rpm));
});

test('synthetic view: capped at sMax; lowerBound when the box ran into the view edge', () => {
  const H = new Uint8Array(NA * NB * NC).fill(1), view = { ...synth(), rectHits: H };
  const r = run({ yawDeg: 0.01, angleDeg: 0.01, rpm: 0.5 }, res0(), view, sel0(view));
  assert.ok(r.capped && r.margin === 4 && r.boxMargin === 4 && r.limitingAxis === null && !r.lowerBound);
  const e = run({ yawDeg: 4, angleDeg: 4 }, res0(), view, sel0(view));   // 16 cells of yaw, 8 of angle per s: leaves the 31-cell view first
  assert.ok(e.viewLimited && e.lowerBound && !e.capped && e.margin < 4, JSON.stringify([e.margin, e.viewLimited]));
});

test('halving all tolerances doubles the box margin (within one grid step) at BASE', () => {
  for (const tol of [TOL, { yawDeg: 1.5, angleDeg: 2, rpm: 30, posIn: 0 }, { yawDeg: 3, angleDeg: 0.6, rpm: 0, posIn: 0 }]) {   // exact for the linear axes; the rpm term (ln(1 +- x)) is only approximately linear
    const a = run(tol), b = run(Object.fromEntries(Object.entries(tol).map(([k, v]) => [k, v / 2])));
    assert.ok(a.boxMargin > 0 && b.boxMargin <= 4);
    assert.ok(Math.abs(b.boxMargin - 2 * a.boxMargin) <= Math.max(a.resolution, b.resolution) * 2 + 1e-9 || b.boxMargin >= 4 || b.viewLimited,
      `${JSON.stringify(tol)}: ${a.boxMargin} -> ${b.boxMargin} (res ${a.resolution}, ${b.resolution})`);
  }
});

test('BASE: setpoint is the hood set cell, along range from alongRange, margin = min(box, along)', () => {
  const r = run(TOL), s = C.sel.hood.set;
  assert.deepEqual(r.setpoint.cell, [s.a, s.b, s.c]); assert.equal(r.setpoint.moved, false);
  assert.equal(r.setpoint.thetaDeg, C.view.thetas[s.a]); assert.equal(r.setpoint.v, s.v); assert.ok(Math.abs(r.setpoint.motorRpm - C.res.motor.motorRpm) < 1e-6);
  const al = E.alongRange(p, { thetaDeg: r.setpoint.thetaDeg, v: s.v, yawOffsetDeg: 0 });
  assert.deepEqual(r.position.alongIn, [-al.minusIn, al.plusIn]); assert.equal(r.alongMargin, Math.min(al.minusIn, al.plusIn) / 2);
  assert.equal(r.margin, Math.min(r.boxMargin, r.alongMargin));
  assert.deepEqual(Object.keys(r.perAxis).sort(), ['angle', 'rpm', 'yaw']);
  const z = run({ ...TOL, posIn: 0 }); assert.equal(z.alongMargin, null); assert.equal(z.position.alongIn, null);
  const t = run({ yawDeg: 0.1, angleDeg: 0.1, rpm: 5, posIn: 30 });   // 30 in of position error: the along range binds
  assert.ok(t.alongMargin < t.boxMargin && t.limitingAxis === 'along' && [-1, 1].includes(t.limitingSide), JSON.stringify([t.alongMargin, t.boxMargin, t.limitingAxis]));
});

test('motor rules: unreachable -> WON\'T WORK; PID with headroom above the downgrade caps at NOT CONSISTENT; margin untouched', () => {
  const tol = { yawDeg: 0.2, angleDeg: 0.2, rpm: 10, posIn: 0 }, base = run(tol), down = E.constants().model.downgrade;
  assert.equal(down, 0.92); assert.ok(base.margin >= 1.25 && base.verdict === V[0] && base.cappedBy === null, JSON.stringify([base.margin, base.verdict]));
  const slow = run(tol, { ...C.res, code: 'TOO_SLOW', best: { ...C.res.best, reachable: false } });
  assert.deepEqual([slow.verdict, slow.cappedBy, slow.margin, slow.boxMargin, slow.bestSetpoint], [V[2], 'unreachable', null, base.boxMargin, null]);
  assert.equal(run(tol, { ...C.res, best: { ...C.res.best, reachable: false } }).verdict, V[2]);
  const pid = (control, headroom) => run(tol, { ...C.res, motor: { ...C.res.motor, control, headroom } });
  assert.deepEqual([pid('pid', 0.95).verdict, pid('pid', 0.95).cappedBy], [V[1], 'headroom']);
  assert.equal(pid('pid', 0.9).verdict, V[0]); assert.equal(pid('fixed', 0.99).verdict, V[0]);
  const bad = run({ yawDeg: 3, angleDeg: 3, rpm: 200, posIn: 0 }, { ...C.res, motor: { ...C.res.motor, control: 'pid', headroom: 0.99 } });
  assert.equal(bad.verdict, V[2]); assert.equal(bad.cappedBy, null);   // the cap never lifts a worse verdict
});

test('null input, no aim, coarse flag', () => {
  assert.equal(T.result(C.view, C.sel, C.res, null, deps), null);
  const none = run(TOL, { ...C.res, best: null, motor: null }, C.view, null);
  assert.deepEqual([none.margin, none.boxMargin, none.alongMargin, none.verdict, none.setpoint], [null, null, null, V[2], null]);
  assert.equal(run(TOL, { ...C.res, mode: 'coarse' }).mode, 'coarse');
  const view = synth(); assert.equal(run({ yawDeg: 1 }, res0({ mode: 'coarse' }), view, sel0(view)).mode, 'coarse');
  assert.equal(run({ yawDeg: 1 }, res0(), { ...view, thStep: 1 }, sel0(view)).mode, 'coarse');
});

test('aim cell that is not a rect hit: the nearest rect-hit cell is the setpoint (moved)', () => {
  const view = synth(), s = { ...sel0(view), a: 3 }, r = run({ yawDeg: 0.25 }, res0(), view, s);
  assert.equal(r.setpoint.moved, true); assert.equal(r.setpoint.cell[0], 7); assert.ok(r.margin > 0);
  const empty = { ...view, rectHits: new Uint8Array(view.rectHits.length) }, z = run({ yawDeg: 1 }, res0(), empty, s);
  assert.deepEqual([z.margin, z.boxMargin, z.verdict], [0, 0, V[2]]);
});

test('bestSetpoint: equals brute force over every rect-hit cell, never worse than the setpoint, null on coarse / best:false', () => {
  for (const holes of [0, 0.03, 0.12]) {
    const view = synth(holes), tn = { yawDeg: 0.75, angleDeg: 0.5, rpm: 40, posIn: 0 }, r = run(tn, res0(), view, sel0(view)), b = r.bestSetpoint;
    const S = TC.summedVolume(view.rectHits, [NA, NB, NC]), wY = tn.yawDeg; let best = -1;
    for (let a = 0; a < NA; a++) for (let q = 0; q < NB; q++) for (let c = 0; c < NC; c++) {
      if (!view.rectHits[(a * NB + q) * NC + c]) continue;
      const x = tn.rpm / (r.setpoint.motorRpm * view.speeds[q] / V0), kb = [x >= 1 ? q + 1 : Math.min(-Math.log(1 - x) / LN, q + 1), Math.log(1 + x) / LN];
      const bx = TC.largestBox({ H: view.rectHits, dims: [NA, NB, NC], center: [a, q, c], neg: [tn.angleDeg / TH, kb[0], wY / YS], pos: [tn.angleDeg / TH, kb[1], wY / YS], sMax: 4, S });
      best = Math.max(best, bx.s);
    }
    assert.ok(Math.abs(b.boxMargin - best) < 1e-6 && b.boxMargin >= r.boxMargin - 1e-12, `holes ${holes}: ${b.boxMargin} vs brute ${best} (setpoint ${r.boxMargin})`);
    assert.equal(b.margin, b.boxMargin); assert.ok(b.evaluated >= 0 && b.searchMs >= 0 && b.cell.length === 3);
    assert.equal(b.thetaDeg, view.thetas[b.cell[0]]); assert.equal(b.v, view.speeds[b.cell[1]]); assert.equal(b.yawDeg, view.yaws[b.cell[2]]);
    assert.ok(Math.abs(b.motorRpm - r.setpoint.motorRpm * b.v / V0) < 1e-6);
  }
  const view = synth();
  assert.equal(run({ yawDeg: 1 }, res0(), { ...view, thStep: 1 }, sel0(view)).bestSetpoint, null);
  assert.equal(T.result(view, sel0(view), res0(), T.norm({ yawDeg: 1, best: false }), deps).bestSetpoint, null);
});

test('bestSetpoint at BASE stays inside the hood range and the motor cap; the hood pick itself is not touched', () => {
  const r = run(TOL), b = r.bestSetpoint;
  assert.ok(b && b.boxMargin >= r.boxMargin && b.thetaDeg >= 45 && b.thetaDeg <= 80);
  assert.ok(b.v <= C.sel.vCap * (1 + 1e-9));
  const again = E.evaluate({ ...P, tolerance: undefined }, 'full'); assert.equal(again.hood.angleDeg, C.res.hood.angleDeg);
});
