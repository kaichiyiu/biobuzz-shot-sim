// #9 burst-aware setpoint: with the burst in the margin the first shot fires at the best speed cell of the eroded grid (owner decision 2026-11-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const E = loadEngine(), req = createRequire(import.meta.url);
const TC = req(path.join(ROOT, 'src', 'engine-tolerance-core.js')), BS = req(path.join(ROOT, 'src', 'engine-tolerance-burst.js'));
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const shooter = (control) => ({ ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control });
const OPEN = { ...BASE, hood: ADJ, shooter: shooter('power') }, PID = { ...BASE, hood: ADJ, shooter: shooter('pid') };
const TOL = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 0 };
const ev = (params, tol) => E.evaluate({ ...params, tolerance: tol }, 'full');
const strip = (t) => { const c = JSON.parse(JSON.stringify(t)); if (c.bestSetpoint) delete c.bestSetpoint.searchMs; return c; };
const scaleTol = (f, extra) => ({ yawDeg: TOL.yawDeg * f, angleDeg: TOL.angleDeg * f, rpm: TOL.rpm * f, posIn: 0, ...extra });

test('pick(): equals a brute-force search of the speed axis (same largestBox), ties go to the cell closest to centre + B/2; null without a positive margin', () => {
  const nA = 3, nB = 40, nC = 3, dims = [nA, nB, nC], H = new Uint8Array(nA * nB * nC);
  let rs = 7; const R = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  const runs = [[3, 12], [16, 19], [22, 36]];   // hit runs along b (all a, c)
  for (let a = 0; a < nA; a++) for (const [lo, hi] of runs) for (let b = lo; b <= hi; b++) for (let c = 0; c < nC; c++) H[(a * nB + b) * nC + c] = 1;
  const view = { rectHits: BS.erodeLow(H, dims, 2), nA, nB, nC }, S = TC.summedVolume(view.rectHits, dims);
  const K = { kA: 0.4, kY: 0.4, kB: (b) => [0.8 + (b % 3) * 0.1, 0.6] };
  const brute = [];
  for (let b = 0; b < nB; b++) {
    if (view.rectHits[(1 * nB + b) * nC + 1] !== 1) continue;
    const kb = K.kB(b), bx = TC.largestBox({ H: view.rectHits, dims, center: [1, b, 1], neg: [K.kA, kb[0], K.kY], pos: [K.kA, kb[1], K.kY], sMax: 4, S });
    brute.push({ b, s: bx.s });
  }
  const best = Math.max(...brute.map((x) => x.s)), tops = brute.filter((x) => x.s >= best - 1e-9);
  const pk = BS.pick(view, S, K, [1, 25, 1], { top: nB - 1, B: 2, sMax: 4, ok: () => true, along: () => null });
  assert.ok(pk && Math.abs(pk.margin - best) < 1e-9 && best > 0);
  const target = 25 + 1, want = tops.map((x) => x.b).sort((p, q) => Math.abs(p - target) - Math.abs(q - target) || p - q)[0];
  assert.equal(pk.b, want);
  assert.equal(BS.pick(view, S, K, [1, 25, 1], { top: nB - 1, B: 2, sMax: 4, ok: () => false, along: () => null }), null);   // no reachable cell
  const lowOnly = BS.pick(view, S, K, [1, 25, 1], { top: 12, B: 2, sMax: 4, ok: () => true, along: () => null });   // the highest allowed cell is capped by `top`
  assert.ok(lowOnly && lowOnly.b <= 12);
  assert.equal(BS.pick(view, S, K, [1, 25, 1], { top: nB - 1, B: 2, sMax: 4, ok: () => true, along: () => ({ margin: 0 }) }), null);   // an along margin of 0 kills every candidate
});

test('no burst: results and export rows are exactly what they were (no burstSetpoint key, burstShots 1 or zero deficit change nothing)', () => {
  const base = ev(PID, TOL).tolerance;
  assert.ok(!('burstSetpoint' in base) && !('bias' in base));
  assert.deepEqual(strip(ev(PID, { ...TOL, burstShots: 1 }).tolerance), strip(base));
  const five = ev(PID, { ...TOL, burstShots: 5 }).tolerance;   // PID recovers within the interval: deficit 0, nothing to raise
  assert.equal(five.bias.cells, 0); assert.ok(!('burstSetpoint' in five));
  assert.deepEqual(strip({ ...five, bias: undefined }), strip({ ...base, bias: undefined }));
  const q = E.sweepPoints(OPEN, 4)[4], at = (p) => ({ ...p, mouth: { ...p.mouth, x: q.x, y: q.y } });
  const rowOf = (tol) => E.exportRow(E.evaluate(at({ ...OPEN, tolerance: tol }), 'full'), q, at({ ...OPEN, tolerance: tol }), {});
  assert.deepEqual(rowOf({ ...TOL, burstShots: 1 }), rowOf(TOL));
  assert.deepEqual({ ...rowOf(TOL), margin: null }, E.exportRow(E.evaluate(at(OPEN), 'full'), q, at(OPEN), {}));
});

test('default open loop, 3 shots at 3 s and 2 s: headline margin > 0 at a raised setpoint; burstPlan with it has every shot in the window', () => {
  for (const [iv, shiftMin] of [[3, 0.3], [2, 0.8]]) {
    const r = ev(OPEN, { ...TOL, burstShots: 3, burstIntervalS: iv }), t = r.tolerance, b = t.burstSetpoint;
    assert.ok(t.margin > 0 && t.bias.fits === true && b, `iv ${iv}: ${t.margin}`);
    assert.ok(b.motorRpm > t.setpoint.motorRpm && b.shiftPct >= shiftMin && b.cells > 0 && b.v > t.setpoint.v, JSON.stringify(b));
    assert.ok(Math.abs(b.motorRpm / t.setpoint.motorRpm - b.v / t.setpoint.v) < 1e-9 && b.exitSpeedMps === b.v);
    assert.ok(t.margin <= t.bestSetpoint.margin + 1e-12 && t.limitingAxis, `${t.margin} vs ${t.bestSetpoint.margin}`);
    assert.equal(t.boxMargin, t.margin);
    const plan = E.burstPlan(r, OPEN, { shots: 3, intervalS: iv, setpointRpm: b.motorRpm });
    assert.equal(plan.allIn, true, JSON.stringify(plan.perShot)); assert.equal(plan.perShot[0].motorRpm, b.motorRpm);
    assert.ok(plan.perShot[2].motorRpm >= plan.windowRpm[0]);
  }
  // the margin is the best cell along the speed axis: raising only the speed beyond the pick (a higher setpoint) never gives more than the headline
  const t3 = ev(OPEN, { ...TOL, burstShots: 3, burstIntervalS: 3 }).tolerance;
  assert.ok(t3.margin > 0.5 && t3.burstSetpoint.shiftPct < 5);
});

test('5 shots at 0.5 s (deficit 9.2 % > window): margin 0, burstSetpoint is null and bias.fits false (the engine setpoint stays the headline)', () => {
  const t = ev(OPEN, { ...TOL, burstShots: 5, burstIntervalS: 0.5 }).tolerance;
  assert.equal(t.margin, 0); assert.equal(t.burstSetpoint, null); assert.equal(t.bias.fits, false);
  assert.ok(t.setpoint.motorRpm > 0);
});

// ---- sampling: at the SHIFTED first-shot speed every shot (its own deficit, from the shifted speed) with errors inside the scale-1 box scores
test('sampling guarantee at the shifted setpoint: seeded points over every shot\'s deficit, rpm, angle and yaw score (scale 1 and scale = margin)', () => {
  let rs = 20261113; const U = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const at = (x, y) => ({ ...OPEN, robot: { x, y } });
  let counted = 0;
  for (const [params, shots, iv, f] of [[OPEN, 3, 3, 0.25], [OPEN, 3, 2, 0.1], [OPEN, 3, 2, 0.25], [OPEN, 5, 3, 0.1], [at(24, -60), 3, 3, 0.25], [at(-40, -40), 3, 3, 0.5], [at(0, -24), 4, 3, 0.25]]) {
    const tol = scaleTol(f), r = ev(params, { ...tol, burstShots: shots, burstIntervalS: iv }), t = r.tolerance, b = t.burstSetpoint;
    if (!b || !(t.margin >= 1)) continue;
    counted++;
    const plan = E.burstPlan(r, params, { shots, intervalS: iv, setpointRpm: b.motorRpm });
    assert.equal(plan.allIn, true);
    for (const sc of [1, Math.min(t.margin, 3) * 0.999]) {
      const miss = [];
      for (let n = 0; n < 300; n++) {
        const sh = plan.perShot[n % shots], rpm = b.motorRpm * (1 - sh.deficitPct / 100) + U() * tol.rpm * sc, u = [U() * sc, U() * sc];
        const cl = E.classifyShot(params, b.thetaDeg + u[0] * tol.angleDeg, b.v * rpm / b.motorRpm, b.yawDeg + u[1] * tol.yawDeg);
        if (cl.rectHit !== true) miss.push([sh.k, +rpm.toFixed(1), ...u.map((x) => +x.toFixed(2))]);
      }
      assert.deepEqual(miss.slice(0, 3), [], `${JSON.stringify(params.robot)} shots ${shots} iv ${iv} f ${f} scale ${sc}: ${miss.length} miss (margin ${t.margin})`);
    }
  }
  assert.ok(counted >= 5, `only ${counted} cases reached margin 1`);
});

test('export row: the centre is the burst setpoint (motor, ticks, wheel, exit speed), lo / hi stay the window; with and without an eta curve', () => {
  const xs = { stepIn: 4 }, burst = { ...TOL, burstShots: 3, burstIntervalS: 3 }, CURVE = [[1500, 0.42], [2500, 0.38], [3500, 0.34], [4500, 0.31]];
  const P0 = OPEN, P1 = { ...OPEN, tolerance: { ...burst, best: false } };   // best:false as the export panel runs it
  let raised = 0;
  for (const curve of [null, CURVE]) for (const q of E.exportPoints(P0, xs).filter((_, i) => i % 3 === 1)) {
    const r0 = E.exportPoint(P0, q, xs, curve), r1 = E.exportPoint(P1, q, xs, curve);
    if (!r0.reachable) continue;
    assert.deepEqual([r1.motorRpm.lo, r1.motorRpm.hi, r1.exitSpeedMps.lo, r1.exitSpeedMps.hi, r1.windowPct], [r0.motorRpm.lo, r0.motorRpm.hi, r0.exitSpeedMps.lo, r0.exitSpeedMps.hi, r0.windowPct]);
    const at = { ...P1, mouth: { ...P1.mouth, x: q.x, y: q.y } }, t = E.evaluate(at, 'full').tolerance, b = t && t.burstSetpoint;
    if (!b || !(b.shiftPct > 0)) { assert.equal(r1.motorRpm.c, r0.motorRpm.c); continue; }
    raised++;
    assert.ok(r1.motorRpm.c > r0.motorRpm.c && r1.motorRpm.c <= r1.motorRpm.hi + 1e-9, `${r1.motorRpm.c} vs ${r0.motorRpm.c}`);
    assert.ok(r1.exitSpeedMps.c > r0.exitSpeedMps.c && r1.ticksPerSec.c > r0.ticksPerSec.c && r1.wheelRpm.c > r0.wheelRpm.c);
    assert.ok(Math.abs(r1.ticksPerSec.c - r1.motorRpm.c / 60 * 28) < 1e-9);
    if (!curve) assert.equal(r1.motorRpm.c, b.motorRpm);
    assert.equal(r1.exitSpeedMps.c, b.exitSpeedMps);
    assert.ok(r1.margin > 0);
  }
  assert.ok(raised >= 3, `only ${raised} raised rows`);
});

test('UI text: burst panel shiftOf / describe and the tolerance panel line, numbers only; the raised setpoint is used only when the burst is included', () => {
  const UB = req(path.join(ROOT, 'src', 'ui-burst.js')), PN = req(path.join(ROOT, 'src', 'ui-tolerance-panel.js')), U = req(path.join(ROOT, 'src', 'units.js'));
  const r = ev(OPEN, { ...TOL, burstShots: 3, burstIntervalS: 3 }), t = r.tolerance, nf = (x, d) => Number(x).toFixed(d);
  assert.equal(UB.shiftOf(t, false), null); assert.equal(UB.shiftOf(null, true), null);
  const sh = UB.shiftOf(t, true), plan = E.burstPlan(r, OPEN, { shots: 3, intervalS: 3, setpointRpm: sh.setpointRpm });
  assert.ok(sh.pct > 0 && sh.rpm > 0 && Math.abs(sh.rpm - (t.burstSetpoint.motorRpm - t.setpoint.motorRpm)) < 1e-9);
  const d = UB.describe(plan, nf, t.bias, sh);
  assert.match(d.shiftText, /^Setpoint raised by \+\d+\.\d % \(\+\d+ rpm\) so the burst stays in the window\.$/);
  assert.deepEqual(d.rows.map((x) => x.state), ['in', 'in', 'in']);
  assert.equal(UB.describe(plan, nf, t.bias, null).shiftText, '');
  const pd = PN.describe(t, U, {});
  assert.match(pd.burst, /^Burst: first shot at [\d,]+ rpm \(\+\d+\.\d %, \+\d+ rpm\) so the later shots stay in the window\.$/);
  assert.equal(PN.describe(ev(OPEN, TOL).tolerance, U, {}).burst, '');
  assert.ok(!/POSSIBLE|NOT CONSISTENT|WON'T WORK/.test(d.shiftText + pd.burst));
});
