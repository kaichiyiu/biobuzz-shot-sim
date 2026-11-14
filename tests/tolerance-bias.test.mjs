// #9 burst bias in the tolerance box (K2): params.tolerance.burstShots -> speed axis low side widened by the largest per-shot deficit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), require = createRequire(import.meta.url);
for (const f of ['burst', 'tolerance-core', 'tolerance-along', 'tolerance-burst', 'tolerance']) require(`../src/engine-${f}.js`);   // the loaders get these in K4
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const shooter = (control) => ({ ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control });
const OPEN = { ...BASE, hood: ADJ, shooter: shooter('power') }, PID = { ...BASE, hood: ADJ, shooter: shooter('pid') };
const TOL = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 0 };
const ev = (params, tol) => E.evaluate({ ...params, tolerance: tol }, 'full').tolerance;
const strip = (t) => { const c = JSON.parse(JSON.stringify(t)); delete c.bias; delete c.tolerance; if (c.bestSetpoint) delete c.bestSetpoint.searchMs; return c; };

test('bias 0 (PID recovers in time, or one shot): every margin field identical to no burstShots; no bias key without a burst', () => {
  const base = ev(PID, TOL);
  const five = ev(PID, { ...TOL, burstShots: 5 });
  assert.equal(five.bias.speedPct, 0); assert.equal(five.bias.shots, 5); assert.equal(five.bias.control, 'pid');
  assert.deepEqual(strip(five), strip(base));
  assert.ok(!('bias' in base) && !('bias' in ev(OPEN, { ...TOL, burstShots: 1 })));
  assert.deepEqual(strip(ev(OPEN, { ...TOL, burstShots: 1 })), strip(ev(OPEN, TOL)));
  assert.ok(base.margin >= 1, String(base.margin));
});

const ev3 = (n, f = 1, iv = 3) => ev(OPEN, { yawDeg: TOL.yawDeg * f, angleDeg: TOL.angleDeg * f, rpm: TOL.rpm * f, posIn: 0, burstShots: n, burstIntervalS: iv });

test('default open loop, 0.5 s (I 4.17e-4): the deficit (> 8 %) is wider than the window -> margin 0 at the setpoint and at the best cell; echo of the plan', () => {
  const m = [1, 2, 3, 4, 5].map((n) => ev(OPEN, { ...TOL, burstShots: n }));
  assert.ok(m[0].margin > 0);
  for (let n = 2; n <= 5; n++) assert.ok(m[n - 1].margin < m[0].margin, `shots ${n}: ${m[n - 1].margin} vs ${m[0].margin}`);
  for (let n = 1; n < 5; n++) assert.ok(m[n].margin <= m[n - 1].margin + 1e-12);
  const plan = E.burstPlan(E.evaluate(OPEN, 'full'), OPEN, { shots: 5 }), b = m[4].bias;
  assert.ok(Math.abs(b.speedPct - Math.max(...plan.perShot.map((s) => s.deficitPct))) < 1e-9 && b.speedPct > 8);
  assert.deepEqual([b.shots, b.intervalS, b.control, b.perShotPct.length], [5, 0.5, 'power', 5]);
  assert.ok(b.cells > 0 && Number.isInteger(b.cells));
  assert.equal(m[4].margin, 0); assert.equal(m[4].bestSetpoint.margin, 0);
});

test('shot k outside the window (1 s interval: 5.27 % deficit at the default open-loop setup) gives margin 0 whatever the tolerances; fixed offset, not scaled', () => {
  const plan = E.burstPlan(E.evaluate(OPEN, 'full'), OPEN, { shots: 5, intervalS: 1 });
  assert.ok(plan.firstOut > 1 && !plan.allIn && Math.abs(plan.perShot[4].deficitPct - 5.27) < 0.05, JSON.stringify([plan.firstOut, plan.perShot[4].deficitPct]));
  for (const f of [0.05, 0.25, 1]) {
    const t = ev3(5, f, 1);
    assert.equal(t.margin, 0, `f ${f}`); assert.equal(t.bestSetpoint.margin, 0, `best, f ${f}`);
  }
});

test('moderate tolerance, 3 s interval: 3+ shots give a strictly lower best margin than 1 shot, more shots never raise it, the deficit is a fixed offset (cells)', () => {
  for (const f of [0.5, 1]) {
    const m = [1, 2, 3, 4, 5].map((n) => ev3(n, f));
    for (let n = 3; n <= 5; n++) assert.ok(m[n - 1].bestSetpoint.margin < m[0].bestSetpoint.margin, `f ${f} shots ${n}: ${m[n - 1].bestSetpoint.margin} vs ${m[0].bestSetpoint.margin}`);
    for (let n = 1; n < 5; n++) assert.ok(m[n].bestSetpoint.margin <= m[n - 1].bestSetpoint.margin + 1e-12 && m[n].margin <= m[n - 1].margin + 1e-12);
    assert.ok(m[2].bestSetpoint.margin > 0, 'a 1 % deficit leaves room at the best cell');
  }
  // same cells whatever the tolerance size (not multiplied by s)
  assert.equal(ev3(3, 0.1).bias.cells, ev3(3, 1).bias.cells);
});

test('bias without an rpm tolerance still applies (the deficit alone moves the speed axis); all four zero = no tolerance at all', () => {
  const a = ev(OPEN, { yawDeg: 0.5, angleDeg: 0.5 }), b = ev(OPEN, { yawDeg: 0.5, angleDeg: 0.5, burstShots: 5, burstIntervalS: 3 }), c = ev(OPEN, { yawDeg: 0.5, angleDeg: 0.5, burstShots: 5 });
  // the deficit alone still shifts the speed axis (cells > 0); the raised first-shot setpoint then wins back the margin (here angle-limited: equal), never more
  assert.ok(b.bias.cells > 0 && b.burstSetpoint.cells > 0 && b.margin <= a.margin + 1e-12, `${a.margin} -> ${b.margin}`);
  assert.equal(c.margin, 0);
  assert.equal(E.evaluate({ ...OPEN, tolerance: { burstShots: 5 } }, 'full').tolerance, null);
});

test('the burst interval option changes the bias; a longer interval lowers it; no burst module / no aim never throws', () => {
  const s = (iv) => ev(OPEN, { ...TOL, burstShots: 5, burstIntervalS: iv }).bias.speedPct;
  assert.ok(s(0.2) > s(0.5) && s(0.5) > s(3) && s(30) < 0.5);
  const none = E.evaluate({ ...OPEN, robot: { x: -12.75, y: 0 }, tolerance: { ...TOL, burstShots: 5 } }, 'full').tolerance;
  assert.equal(none.margin, null); assert.ok(!none.bias);
});

// ---- sampling: at margin >= 1 the scale-1 box, shifted down by every shot's deficit, scores (seeded points, real classifyShot)
function sample(params, tol, shots, iv, N) {
  let rs = 20261113; const U = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const r = E.evaluate({ ...params, tolerance: { ...tol, burstShots: shots, burstIntervalS: iv } }, 'full'), t = r.tolerance, s = t.bestSetpoint;   // the best cell: the engine's own cell sits at the window centre, which the fixed offset can leave at margin 0
  if (!s || !(s.margin >= 1)) return null;
  const plan = E.burstPlan(r, params, { shots, intervalS: iv }), miss = [];
  for (let n = 0; n < N; n++) {
    const sh = plan.perShot[n % shots], rpm = s.motorRpm * (1 - sh.deficitPct / 100) + U() * tol.rpm;
    const u = [U(), U()], cl = E.classifyShot(params, s.thetaDeg + u[0] * tol.angleDeg, s.v * rpm / s.motorRpm, s.yawDeg + u[1] * tol.yawDeg);
    if (cl.rectHit !== true) miss.push([sh.k, +rpm.toFixed(1), ...u.map((x) => +x.toFixed(2))]);
  }
  return { t, n: N, miss };
}

test('sampling: margin >= 1 with a burst bias -> 300 seeded points over every shot\'s rpm (deficit +- rpm tolerance), angle and yaw all score', () => {
  let counted = 0;
  const at = (x, y) => ({ ...OPEN, robot: { x, y } });   // a 3 s wait keeps the bias near 1-2 %: the aim window (4-6 % wide) can hold it
  for (const [params, shots, iv, f] of [[OPEN, 3, 3, 0.1], [OPEN, 3, 3, 0.25], [OPEN, 5, 3, 0.1], [at(24, -60), 3, 3, 0.25], [at(-40, -40), 3, 3, 0.5], [at(-40, -40), 5, 3, 0.25], [at(0, -24), 4, 3, 0.25]]) {
    const tol = Object.fromEntries(Object.entries(TOL).map(([k, v]) => [k, v * f])), r = sample(params, tol, shots, iv, 300);
    if (!r) continue;
    counted++;
    assert.deepEqual(r.miss.slice(0, 3), [], `${JSON.stringify(params.robot)} shots ${shots} margin ${r.t.bestSetpoint.margin}: ${r.miss.length} miss`);
  }
  assert.ok(counted >= 5, `only ${counted} cases reached margin 1`);
  // control: the same points fail when the bias is left out of the box (margin computed with one shot, probes still spread over 5 shots)
  const r1 = E.evaluate({ ...OPEN, tolerance: { ...TOL, best: false } }, 'full'), t1 = r1.tolerance, plan = E.burstPlan(r1, OPEN, { shots: 5 });
  const low = E.classifyShot(OPEN, t1.setpoint.thetaDeg, t1.setpoint.v * (1 - plan.perShot[4].deficitPct / 100 - TOL.rpm / t1.setpoint.motorRpm), t1.setpoint.yawDeg);
  assert.equal(low.rectHit, false);
});

// ---- sampling with the FULL deficit (fixed offset): every point of the scale-s box shifted down by the largest deficit scores, at the best cell
test('fixed-offset guarantee: points inside the scale-1 (and scale-margin) box with the full deficit applied all score, at several spots', () => {
  let rs = 987654321; const U = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const at = (x, y) => ({ ...OPEN, robot: { x, y } });
  let counted = 0;
  for (const [params, shots, f] of [[OPEN, 3, 0.25], [OPEN, 5, 0.5], [OPEN, 3, 1], [at(24, -60), 3, 0.25], [at(-40, -40), 3, 0.5], [at(-40, -40), 5, 0.25], [at(0, -24), 4, 0.25]]) {
    const tol = { yawDeg: TOL.yawDeg * f, angleDeg: TOL.angleDeg * f, rpm: TOL.rpm * f, posIn: 0 };
    const t = E.evaluate({ ...params, tolerance: { ...tol, burstShots: shots, burstIntervalS: 3 } }, 'full').tolerance, b = t && t.bestSetpoint;
    if (!b || !(b.margin >= 1)) continue;
    counted++;
    for (const sc of [1, Math.min(b.margin, 3) * 0.999]) {
      const miss = [], d = t.bias.speedPct / 100;
      for (let n = 0; n < 250; n++) {
        const rpm = b.motorRpm * (1 - d) + U() * tol.rpm * sc, u = [U() * sc, U() * sc];
        const cl = E.classifyShot(params, b.thetaDeg + u[0] * tol.angleDeg, b.v * rpm / b.motorRpm, b.yawDeg + u[1] * tol.yawDeg);
        if (cl.rectHit !== true) miss.push([+rpm.toFixed(1), ...u.map((x) => +x.toFixed(2))]);
      }
      assert.deepEqual(miss.slice(0, 3), [], `${JSON.stringify(params.robot)} shots ${shots} f ${f} scale ${sc}: ${miss.length} miss (best margin ${b.margin})`);
    }
  }
  assert.ok(counted >= 4, `only ${counted} cases reached margin 1`);
});
