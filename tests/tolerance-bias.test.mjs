// #9 burst bias in the tolerance box (K2): params.tolerance.burstShots -> speed axis low side widened by the largest per-shot deficit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), require = createRequire(import.meta.url);
for (const f of ['burst', 'tolerance-core', 'tolerance-along', 'tolerance']) require(`../src/engine-${f}.js`);   // the loaders get these in K4
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

test('default open loop (I 4.17e-4, 0.5 s): 3+ shots give a strictly lower margin than 1 shot, and more shots never raise it', () => {
  const m = [1, 2, 3, 4, 5].map((n) => ev(OPEN, { ...TOL, burstShots: n }));
  assert.ok(m[0].margin > 0);
  for (let n = 2; n <= 5; n++) assert.ok(m[n - 1].margin < m[0].margin, `shots ${n}: ${m[n - 1].margin} vs ${m[0].margin}`);
  for (let n = 1; n < 5; n++) assert.ok(m[n].margin <= m[n - 1].margin + 1e-12);
  const plan = E.burstPlan(E.evaluate(OPEN, 'full'), OPEN, { shots: 5 }), b = m[4].bias;
  assert.ok(Math.abs(b.speedPct - Math.max(...plan.perShot.map((s) => s.deficitPct))) < 1e-9 && b.speedPct > 8);
  assert.deepEqual([b.shots, b.intervalS, b.control, b.perShotPct.length], [5, 0.5, 'power', 5]);
  assert.ok(m[4].boxMargin < m[0].boxMargin && ['rpm', 'angle', 'yaw'].includes(m[4].limitingAxis));
  assert.equal(m[4].limitingAxis, 'rpm'); assert.equal(m[4].limitingSide, -1);   // the low-speed side limits
});

test('bias without an rpm tolerance still applies (speed axis neg = the deficit alone); all four zero = no tolerance at all', () => {
  const a = ev(OPEN, { yawDeg: 0.5, angleDeg: 0.5 }), b = ev(OPEN, { yawDeg: 0.5, angleDeg: 0.5, burstShots: 5 });
  assert.ok(b.margin < a.margin && b.limitingAxis === 'rpm', `${a.margin} -> ${b.margin}`);
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
  const r = E.evaluate({ ...params, tolerance: { ...tol, burstShots: shots, burstIntervalS: iv, best: false } }, 'full'), t = r.tolerance, s = t.setpoint;
  if (!(t.margin >= 1)) return null;
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
    assert.deepEqual(r.miss.slice(0, 3), [], `${JSON.stringify(params.robot)} shots ${shots} margin ${r.t.margin}: ${r.miss.length} miss`);
  }
  assert.ok(counted >= 5, `only ${counted} cases reached margin 1`);
  // control: the same points fail when the bias is left out of the box (margin computed with one shot, probes still spread over 5 shots)
  const r1 = E.evaluate({ ...OPEN, tolerance: { ...TOL, best: false } }, 'full'), t1 = r1.tolerance, plan = E.burstPlan(r1, OPEN, { shots: 5 });
  const low = E.classifyShot(OPEN, t1.setpoint.thetaDeg, t1.setpoint.v * (1 - plan.perShot[4].deficitPct / 100 - TOL.rpm / t1.setpoint.motorRpm), t1.setpoint.yawDeg);
  assert.equal(low.rectHit, false);
});
