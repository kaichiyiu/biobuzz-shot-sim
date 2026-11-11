// #2 hood search: when the coarse ranking cannot separate angles (the coarse pick is one speed-lattice node), the fine view must
// reach the whole tie set, so the answer does not depend on the arbitrary coarse seed. Design: process_docs/issue-2/design.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), HX = E._internal.ext('hood');
const spot = (x, y, spin, lo, hi, mode = 'full') => E.evaluate({ ...BASE, robot: { x, y }, shooter: { ...BASE.shooter, spin }, hood: { mode: 'adjustable', minDeg: lo, maxDeg: hi } }, mode);
const fixedAt = (x, y, spin, a) => E.evaluate({ ...BASE, robot: { x, y }, shooter: { ...BASE.shooter, spin }, hood: { mode: 'fixed', angleDeg: a } }, 'full');
const steps = (pct) => Math.round(Math.log(1 + pct / 100) / 0.005);   // width in fine speed steps (ln grid 0.005)
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const bestFixed = (x, y, spin, from, to, by) => {
  let m = 0;
  for (let a = from; a <= to; a += by) { const f = fixedAt(x, y, spin, a); if (f.hood.rpmWindow) m = Math.max(m, steps(f.hood.rpmWindow.widthPct)); }
  return m;
};
const sig = (r) => [r.hood.angleDeg, r.hood.rangeDeg, +r.hood.rpmWindow.widthRpm.toFixed(2), +r.hood.rpmWindow.widthPct.toFixed(3), +r.best.v.toFixed(4), +r.best.yawDeg.toFixed(2)];

test('topspin at the default spot: the hood picks the plateau, not the blind coarse seed (was 64.75 deg, 2.02 %, 48.3 rpm)', () => {
  const r = spot(-12.75, -48, 'top', 45, 80), w = r.hood.rpmWindow;
  assert.ok(w.widthPct >= 3.5, `window ${w.widthPct} % (pre-fix 2.02 %)`);
  assert.ok(w.widthRpm >= 1.5 * 48.3, `window ${w.widthRpm} rpm (pre-fix 48.3)`);
  assert.ok(r.hood.angleDeg >= 66 && r.hood.angleDeg <= 75, `angle ${r.hood.angleDeg}`);
  assert.ok(r.hood.rangeDeg[0] > 65.25, 'the tie range left the old seed neighbourhood');
  const bf = bestFixed(-12.75, -48, 'top', 60, 80, 1);   // 4.6 % at 70..74 deg
  assert.ok(steps(w.widthPct) >= bf - 2, `adjustable ${steps(w.widthPct)} steps vs best fixed ${bf} (pre-fix deficit was 5)`);
});

test('seed independence: a different coarse seed (hood from 64, pick window 1 step) lands on the same plateau', () => {
  const a = spot(-12.75, -48, 'top', 62, 80), b = spot(-12.75, -48, 'top', 64, 80);
  near(a.hood.angleDeg, b.hood.angleDeg, 0.5, 'angle');
  near(a.hood.rpmWindow.widthPct, b.hood.rpmWindow.widthPct, 1e-6, 'width %');
  near(a.hood.rpmWindow.widthRpm / b.hood.rpmWindow.widthRpm, 1, 0.015, 'rpm width ratio');
  for (const lo of [56, 58, 60]) assert.deepEqual(sig(spot(-12.75, -48, 'top', lo, 80)), sig(a), `lo ${lo}`);   // same hit support -> same answer
});

test('property: adjustable 60-80 is within 2 fine speed steps of the best fixed angle (3 spots x back/top)', () => {
  for (const [x, y] of [[-12.75, -48], [-48, -60], [24, -48]]) for (const spin of ['back', 'top']) {
    const r = spot(x, y, spin, 60, 80), s = steps(r.hood.rpmWindow.widthPct), bf = bestFixed(x, y, spin, 60, 80, 2);
    assert.ok(s >= bf - 2, `${x},${y} ${spin}: adjustable ${s} steps (${r.hood.angleDeg} deg) vs best fixed ${bf}`);
  }
});

test('non-degenerate scenarios (coarse pick window >= 1 step) are bit-identical to the pre-fix engine', () => {
  const PRE = [   // captured before the change: [x, y, spin, lo, hi, angle, rangeDeg, widthRpm, widthPct, best.v, best.yaw]
    [-12.75, -48, 'back', 45, 80, 68.25, [67.25, 69.25], 98.66, 4.603, 4.9599, 90],
    [24, -48, 'top', 60, 80, 65.25, [60, 66.5], 114.38, 5.127, 5.1755, 134.35],
    [-36, -48, 'back', 45, 80, 63.25, [56, 64.5], 91.54, 4.081, 5.177, 57.27],
    [12, -48, 'top', 45, 80, 64, [59, 71], 103.72, 4.603, 5.2144, 128.15],
  ];
  for (const [x, y, spin, lo, hi, ...want] of PRE) assert.deepEqual(sig(spot(x, y, spin, lo, hi)), want, `${x},${y} ${spin} ${lo}-${hi}`);
  assert.equal(steps(spot(-12.75, -48, 'back', 45, 80).hood.rpmWindow.widthPct), 9);
});

test('degenerate scenarios never lose the old window (rpm) and improve it', () => {
  const OLD = [[-12.75, -48, 'top', 45, 80, 48.3], [-48, -60, 'back', 60, 80, 72.44], [24, -60, 'back', 60, 80, 85.15]];   // pre-fix widthRpm
  for (const [x, y, spin, lo, hi, old] of OLD) {
    const w = spot(x, y, spin, lo, hi).hood.rpmWindow.widthRpm;
    assert.ok(w >= 1.1 * old, `${x},${y} ${spin}: ${w} rpm vs pre-fix ${old}`);
  }
});

test('coarse preview and fixed mode are untouched', () => {
  const c = spot(-12.75, -48, 'top', 45, 80, 'coarse');
  assert.deepEqual([c.hood.angleDeg, c.hood.rangeDeg, c.hood.preview, c.hood.rpmWindow.widthPct], [64, [62, 66], true, 0]);
  const f = fixedAt(-12.75, -48, 'top', 70);
  assert.equal(f.hood.angleDeg, 70); assert.equal(steps(f.hood.rpmWindow.widthPct), 9);
});

test('fineOpts: no tie set or a tie set inside the old reach -> the old view; outside -> a superset on the same node lattice', () => {
  const sel = (tie) => ({ theta: 65, v: 5.2, hood: { vLo: 5.1, vHi: 5.3, tie } }), hn = { mode: 'adjustable', lo: 45, hi: 80 };
  const old = { theta: 65, vSpanLn: 0.12, thSpan: 6, yawSpan: 6, skipAim: true };
  assert.deepEqual(HX.fineOpts(sel(undefined), hn), old);
  assert.deepEqual(HX.fineOpts(sel({ t0: 61, t1: 69, v0: 4.9, v1: 5.5, ln: 0.02 }), hn), old);
  const o = HX.fineOpts(sel({ t0: 62, t1: 80, v0: 4.8, v1: 5.9, ln: 0.02 }), hn);
  assert.ok(Number.isInteger(o.theta * 4), 'centre on the 0.25 deg lattice');
  assert.ok(o.theta - o.thSpan <= 59 && o.theta + o.thSpan >= 80 && o.theta + o.thSpan <= 80 + 0.25, `angles ${o.theta} +- ${o.thSpan}`);   // old reach 59..71, tie 61..81 clipped to the hood
  assert.ok(o.vSpanLn >= 0.12 && o.vSpanLn >= Math.log(5.9 / 5.2) && o.vSpanLn >= Math.log(5.2 / 4.8), `vSpanLn ${o.vSpanLn}`);
  assert.deepEqual([o.yawSpan, o.skipAim], [6, true]);
  const fx = HX.fineOpts({ ...sel({ t0: 1, t1: 89, v0: 1, v1: 30, ln: 0.02 }), hood: { vLo: 5, vHi: 5.1 } }, { mode: 'fixed', angleDeg: 70, lo: 70, hi: 70 });
  assert.deepEqual([fx.theta, fx.thSpan], [70, 0]);
});
