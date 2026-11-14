// O4: margin section: conversions equal res.tolerance.grid, ceil extents / s / resolution / limiting axis / along / lateral / final min equal res.tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), D = require(path.join(ROOT, 'src', 'derive-tex.js')), M = require(path.join(ROOT, 'src', 'derive-margin.js'));
const TC = require(path.join(ROOT, 'src', 'engine-tolerance-core.js'));
const E = loadEngine(), I = E._internal, ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const TOL = { yawDeg: 0.3, angleDeg: 0.3, rpm: 15, posIn: 1 };
const mk = (tol, extra = {}) => ({ ...BASE, hood: ADJ, tolerance: tol, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control: 'power' }, ...extra });
const run = (tol, mode = 'full') => { const p = mk(tol); return { r: E.evaluate(p, mode), p }; };
const rowOf = (s, what) => s.rows.find((x) => x.what === what);
const ext = (s, k) => (k > 0 && s > 0 ? Math.ceil(s * k * (1 - 1e-12)) : 0);

function capture(p) {   // the rect-hit view and aim cell of a full evaluate (as tests/tolerance.test.mjs)
  const hood = I.ext('hood'), orig = hood.result; let cap;
  hood.result = function (view, sel) { cap = { view, sel }; return orig.apply(this, arguments); };
  try { E.evaluate(p, 'full'); } finally { hood.result = orig; }
  return cap;
}

test('rates equal res.tolerance.grid; extents are ceil(s k) of the echoed numbers; the box is all ones and the next breakpoint is not', () => {
  const { r, p } = run(TOL), t = r.tolerance, g = t.grid, s = M.margin(r, p, {});
  assert.equal(rowOf(s, 'Angle rate').res, `${D.n(g.kA, 3)} cells per s`); assert.equal(rowOf(s, 'Yaw rate').res, `${D.n(g.kY, 3)} cells per s`);
  assert.ok(rowOf(s, 'Yaw with position').res.startsWith(`${D.n(g.wY, 3)}°`));
  const x = TOL.rpm / t.setpoint.motorRpm, kn = -Math.log(1 - x) / g.lnStep, kp = Math.log(1 + x) / g.lnStep;
  assert.equal(rowOf(s, 'Speed rates (low, high)').res, `${D.n(kn, 3)}, ${D.n(kp, 3)} cells per s`);
  const eA = ext(t.boxMargin, g.kA), eY = ext(t.boxMargin, g.kY), eN = ext(t.boxMargin, kn), eP = ext(t.boxMargin, kp);
  assert.ok(rowOf(s, 'Box: angle').res.startsWith(`±${eA} cells`)); assert.ok(rowOf(s, 'Box: yaw').res.startsWith(`±${eY} cells`)); assert.equal(rowOf(s, 'Box: speed').res, `−${eN} / +${eP} cells`);
  assert.ok(rowOf(s, 'Box: angle').num.endsWith(`= ${eA}`));
  const { view, sel } = capture(p), dims = [view.nA, view.nB, view.nC], S = TC.summedVolume(view.rectHits, dims), c = [t.setpoint.cell[0], t.setpoint.cell[1], t.setpoint.cell[2]];
  const cnt = (e) => TC.boxSum(S, dims, [c[0] - e[0], c[1] - e[2], c[2] - e[1]], [c[0] + e[0], c[1] + e[3], c[2] + e[1]]), vol = (e) => (2 * e[0] + 1) * (e[2] + e[3] + 1) * (2 * e[1] + 1);
  const e0 = [eA, eY, eN, eP]; assert.equal(cnt(e0), vol(e0));
  const sHi = t.boxMargin + t.resolution, e1 = [ext(sHi, g.kA), ext(sHi, g.kY), ext(sHi, kn), ext(sHi, kp)].map((v, i) => Math.max(v, e0[i]));
  assert.ok(cnt(e1) < vol(e1) || e1.some((v, i) => c[[0, 2, 1, 1][i]] - v < 0));
});

test('s, resolution, limiting axis / side, perAxis, along min / plus, lateral and the final min equal res.tolerance', () => {
  const { r, p } = run(TOL), t = r.tolerance, s = M.margin(r, p, {});
  assert.equal(rowOf(s, 'Box margin').res, `${D.n(t.boxMargin, 3)}, resolution ${D.n(t.resolution, 3)}`);
  assert.ok(rowOf(s, 'Box margin').num.includes(D.n(t.boxMargin + t.resolution, 3)));
  assert.equal(rowOf(s, 'Limiting axis').res, `${t.limitingAxis}, ${t.limitingSide < 0 ? 'low side' : 'high side'}`);
  assert.equal(rowOf(s, 'Each axis alone').num, `${D.n(t.perAxis.yaw, 3)},\\ ${D.n(t.perAxis.angle, 3)},\\ ${D.n(t.perAxis.rpm, 3)}`);
  const al = rowOf(s, 'Along the shooting line');
  assert.ok(al.num.includes(`\\min(${D.n(t.along.minusIn, 2)},\\ ${D.n(t.along.plusIn, 2)})`)); assert.ok(al.res.startsWith(D.n(t.along.margin, 3)));
  assert.equal(rowOf(s, 'Sideways position').res, `${D.n(t.position.lateralIn, 2)} in`);
  assert.equal(rowOf(s, 'Margin').num, `\\min(${D.n(t.boxMargin, 3)},\\ ${D.n(t.along.margin, 3)},\\ 4)`); assert.ok(rowOf(s, 'Margin').res.startsWith(D.n(t.margin, 3)));
  assert.equal(Math.min(t.boxMargin, t.along.margin, 4), t.margin);
  assert.ok(rowOf(s, 'Best setpoint in the view'));
  assert.doesNotMatch(JSON.stringify(s), /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined/i);
});

test('no position tolerance: no along / lateral rows; capped result gets a plain note', () => {
  const { r, p } = run({ yawDeg: 0.01, angleDeg: 0.01, rpm: 1, posIn: 0 }), s = M.margin(r, p, {});
  assert.equal(rowOf(s, 'Along the shooting line'), undefined); assert.equal(rowOf(s, 'Sideways position'), undefined);
  assert.equal(r.tolerance.capped, true); assert.ok(s.notes.some((x) => /capped at 4/.test(x))); assert.equal(rowOf(s, 'Box margin').num, 's = 4');
  assert.equal(rowOf(s, 'Margin').num, '\\min(4.000,\\ 4)');
});

test('synthetic flags: lowerBound, limited along range, unreachable and burst notes; centre cell missing', () => {
  const { r, p } = run(TOL), clone = (o) => JSON.parse(JSON.stringify({ ...r, ...o, tolerance: { ...r.tolerance, ...(o.tolerance || {}) } }));
  assert.ok(M.margin(clone({ tolerance: { lowerBound: true } }), p, {}).notes.some((x) => /lower bound/.test(x)));
  const lim = M.margin(clone({ tolerance: { along: { ...r.tolerance.along, limited: true } } }), p, {}); assert.ok(lim.notes.some((x) => /search cap/.test(x)));
  const un = M.margin(clone({ tolerance: { cappedBy: 'unreachable', margin: null } }), p, {}); assert.ok(un.notes.some((x) => /more motor speed/.test(x))); assert.equal(rowOf(un, 'Margin').res, 'n/a');
  const none = M.margin(clone({ tolerance: { setpoint: null } }), p, {}); assert.ok(none.notes.some((x) => /margin is 0/.test(x))); assert.equal(none.rows.length, 1);
});

test('burst included: the box note and the burst setpoint rpm in the speed rates; absent tolerance -> null; preview label', () => {
  const b = run({ ...TOL, burstShots: 2, burstIntervalS: 1.5 }), sb = M.margin(b.r, b.p, {});
  assert.ok(sb.notes.some((x) => /burst-aware setpoint/.test(x)));
  assert.ok(rowOf(sb, 'Speed rates (low, high)').num.includes(D.n(b.r.tolerance.burstSetpoint.motorRpm, 1)));
  const n0 = run(null); assert.equal(M.margin(n0.r, n0.p, {}), null); assert.equal(M.margin(b.r, { ...b.p, tolerance: undefined }, {}), null); assert.equal(M.margin(null, b.p, {}), null);
  const c = run(TOL, 'coarse'); assert.match(M.margin(c.r, c.p, {}).lead, /Preview/);
});
