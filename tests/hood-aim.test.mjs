// D15 advised aim under a hood: centred in its scoring window, independent of precision,
// and consistent between the coarse result, the full result and the all-motors table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadData, BASE } from './load-data.mjs';

const E = loadEngine();
const I = E._internal;
const PRESETS = loadData().shooter.precision;
const ADJUSTABLE = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const FIXED_65 = { mode: 'fixed', angleDeg: 65 };
const SPOTS = [[-12.75, -48], [-40, -50], [24, -60], [12.75, -30], [-60, -60], [0, -60], [-48, -24], [36, -36], [-24, -40], [48, -48]];
const at = (x, y, extra = {}) => ({ ...BASE, robot: { x, y }, ...extra });

// grid steps of the result's view: speed step (ln) and yaw step (deg)
function steps(params, mode) {
  if (mode === 'full') return { lnStep: 0.005, yawStep: 0.25 };
  const p = I.normParams(params);
  const view = I.coarseView(I.getGrid(p, E.buildTable(p.ballId, E.shooterSpin(p.shooter))));
  return { lnStep: view.lnStep, yawStep: view.yawStep };
}

test('advised aim sits at the centre of its scoring window, within one grid step in speed and yaw', () => {
  let checked = 0;
  for (const hood of [ADJUSTABLE, FIXED_65]) for (const [x, y] of SPOTS) for (const mode of ['coarse', 'full']) {
    const params = at(x, y, { hood });
    const r = E.evaluate(params, mode);
    if (!r.best || !r.best.scoringWindow || r.best.scoringWindow.moved) continue;
    const w = r.best.scoringWindow, st = steps(params, mode);
    // a fine-view yaw window that fills the +-6 deg span is cut by the view; its middle is not the aim (the coarse centre is kept)
    if (mode === 'full' && (w.yawDeg[0] <= r.best.yawDeg - 5.75 || w.yawDeg[1] >= r.best.yawDeg + 5.75)) continue;
    const vMid = (w.v[0] + w.v[1]) / 2, yawMid = (w.yawDeg[0] + w.yawDeg[1]) / 2;
    const label = `${hood.mode} ${x},${y} ${mode}`;
    assert.ok(r.best.v >= w.v[0] && r.best.v <= w.v[1], `${label}: speed inside the window`);
    assert.ok(r.best.yawDeg >= w.yawDeg[0] - 1e-9 && r.best.yawDeg <= w.yawDeg[1] + 1e-9, `${label}: yaw inside the window`);
    // the window is read on the yaw node next to the aim; in a slanted region that shifts its speed edges by up to two steps
    assert.ok(Math.abs(Math.log(r.best.v / vMid)) <= 2 * st.lnStep + 1e-9, `${label}: speed ${r.best.v} vs centre ${vMid}`);
    assert.ok(Math.abs(r.best.yawDeg - yawMid) <= st.yawStep + 1e-9, `${label}: yaw ${r.best.yawDeg} vs centre ${yawMid}`);
    checked++;
  }
  assert.ok(checked >= 20, `enough cases were checked (${checked})`);
});

test('the advised speed is the rpm (linear speed) midpoint of the reported rpm window', () => {
  for (const hood of [ADJUSTABLE, FIXED_65]) {
    const r = E.evaluate(at(-40, -50, { hood }), 'full'), w = r.hood.rpmWindow;
    assert.ok(Math.abs(r.best.v - (w.vExit[0] + w.vExit[1]) / 2) <= 1e-9 * r.best.v + 1e-12, hood.mode);
    assert.ok(Math.abs(r.motor.motorRpm - w.centerMotorRpm) <= 1e-6 * w.centerMotorRpm, `${hood.mode}: motor rpm = window centre`);
  }
});

test('precision presets do not change the advised aim (angle, speed, yaw), coarse or full', () => {
  for (const hood of [ADJUSTABLE, FIXED_65]) for (const [x, y] of [[-12.75, -48], [-40, -50], [24, -60]]) for (const mode of ['coarse', 'full']) {
    const aim = (precision) => { const r = E.evaluate(at(x, y, { hood, precision }), mode); return [r.best.thetaDeg, r.best.v, r.best.yawDeg]; };
    const ref = aim(PRESETS.typical);
    for (const k of Object.keys(PRESETS)) assert.deepEqual(aim(PRESETS[k]), ref, `${hood.mode} ${x},${y} ${mode} ${k}`);
  }
});

// Tolerances: the coarse view has a 2 % speed step and a yaw step of 0.5-1.5 deg, so a window is only 2-4 cells wide; the
// slanted (speed, yaw) region then gives centres up to ~4 % in speed and ~3.6 deg in yaw apart (measured); hit rate gap <= 0.2.
test('fixed hood: coarse, full and the all-motors row agree', () => {
  let n = 0, worstHit = 0, flips = 0;
  for (const [x, y] of SPOTS) {
    const params = at(x, y, { hood: FIXED_65 });
    const c = E.evaluate(params, 'coarse'), f = E.evaluate(params, 'full');
    const row = E.compareMotors(params).find((m) => m.motorId === params.motorId);
    assert.equal(row.hitRate, c.hitRate, 'all-motors row = coarse result'); assert.equal(row.verdict, c.verdict); assert.equal(row.code, c.code);
    assert.equal(c.code === 'NO_ARC', f.code === 'NO_ARC', `${x},${y}: same no-arc decision`);
    if (!c.best || !f.best) continue;
    n++;
    assert.equal(f.best.thetaDeg, 65); assert.equal(c.best.thetaDeg, 65);
    assert.ok(Math.abs(c.best.v / f.best.v - 1) <= 0.04, `${x},${y}: speed ${c.best.v} vs ${f.best.v}`);
    assert.ok(Math.abs(c.best.yawDeg - f.best.yawDeg) <= 4, `${x},${y}: yaw ${c.best.yawDeg} vs ${f.best.yawDeg}`);
    worstHit = Math.max(worstHit, Math.abs(c.hitRate - f.hitRate)); flips += c.verdict !== f.verdict ? 1 : 0;
  }
  assert.ok(n >= 6, `${n} spots with an arc`);
  assert.ok(worstHit <= 0.2, `worst coarse-vs-full hit-rate gap ${worstHit}`);
  assert.ok(flips <= 2, `${flips} verdict flips between coarse and full`);
});

// Adjustable: the coarse angle is a noisy preview (widths are multiples of the 2 % step), so only bounded agreement is asserted.
test('adjustable hood: the all-motors row equals the coarse result; coarse and full stay within the fine search span', () => {
  let n = 0, sumHit = 0, worstHit = 0;
  for (const [x, y] of SPOTS) {
    const params = at(x, y, { hood: ADJUSTABLE });
    const c = E.evaluate(params, 'coarse'), f = E.evaluate(params, 'full');
    const row = E.compareMotors(params).find((m) => m.motorId === params.motorId);
    assert.equal(row.hitRate, c.hitRate); assert.equal(row.verdict, c.verdict);
    if (!c.best || !f.best) continue;
    n++;
    assert.ok(Math.abs(c.best.thetaDeg - f.best.thetaDeg) <= 6.5, `${x},${y}: angle ${c.best.thetaDeg} vs ${f.best.thetaDeg}`);
    const gap = Math.abs(c.hitRate - f.hitRate); sumHit += gap; worstHit = Math.max(worstHit, gap);
  }
  assert.ok(n >= 8, `${n} spots with an arc`);
  assert.ok(sumHit / n <= 0.12 && worstHit <= 0.3, `mean ${sumHit / n}, worst ${worstHit}`);
});
