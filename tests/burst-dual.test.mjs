// Issue M2 (N5): burst plans of a dual-wheel shooter follow the exit-speed dip (D1): dip_x = (dip_B + k dip_T) / (1 + k).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine();
const dual = (k, control, over = {}) => ({ ...BASE, shooter: { ...BASE.shooter, type: 'dual', topRatio: k, control, shotInterval: 0.5, inertiaKgM2: 4e-4, ...over } });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('dual open loop: shot-2 deficit = 100 x motor.residual (linear law), for every k and interval', () => {
  for (const k of [0.2, 0.45, 0.8, 1]) for (const iv of [0.1, 0.5, 1, 3]) {
    const p = dual(k, 'power', { shotInterval: iv }), r = E.evaluate(p, 'full'), plan = E.burstPlan(r, p, { shots: 3 });
    near(plan.perShot[1].deficitPct, 100 * r.motor.residual, 1e-9, `k ${k} iv ${iv}`);
    near(plan.dipPct, 100 * r.motor.dipExit, 1e-12, 'plan dip is the exit-speed dip');
  }
});

test('dual open loop: every shot follows x[n+1] = 1 - (1 - x[n](1 - dip_x)) q', () => {
  const p = dual(0.45, 'power'), r = E.evaluate(p, 'full'), plan = E.burstPlan(r, p, { shots: 6 }), q = Math.exp(-0.5 / r.motor.tauS);
  let x = 1;
  plan.perShot.forEach((s) => { near(s.deficitPct, 100 * (1 - x), 1e-9, 'shot ' + s.k); x = 1 - (1 - x * (1 - r.motor.dipExit)) * q; });
  // the old bottom-wheel dip would give a smaller deficit: the exit dip is what D1 asks for
  assert.ok(r.motor.dipExit > r.motor.dip && plan.perShot[1].deficitPct > 100 * r.motor.dip * q);
});

test('dual PID, default setup: the wheels are back before the next shot, deficits 0 = bottom wheel wAfterInterval', () => {
  for (const k of [0.2, 0.45, 0.8]) {
    const p = dual(k, 'pid'), r = E.evaluate(p, 'full'), plan = E.burstPlan(r, p, { shots: 4, setpointRpm: r.motor.motorRpm });
    const d = r.motor.details;
    assert.equal(r.motor.residual, 0);
    for (const s of plan.perShot) near(s.deficitPct, 0, 1e-9);
    near(plan.perShot[1].deficitPct, 100 * (1 - d.wAfterInterval / d.w0), 0.1);
  }
});

test('dual PID, 30 ms interval (stress): scalar dip_x approximation is conservative, within 1.2 pp of the exit-weighted residual', () => {
  for (const k of [0.2, 0.45, 0.6]) {
    const p = dual(k, 'pid', { shotInterval: 0.03 }), r = E.evaluate(p, 'full'), plan = E.burstPlan(r, p, { shots: 3, setpointRpm: r.motor.motorRpm });
    const exact = 100 * r.motor.residual, got = plan.perShot[1].deficitPct;
    assert.ok(got >= exact - 1e-9 && got - exact < 1.2, `k ${k}: burst ${got} vs residual ${exact}`);   // k 0.6: exact 0, burst 0.3 (top wheel recovers faster in relative terms)
  }
});

test('dual k = 1 behaves like a single wheel (dip_x = dip_B); single wheels still use m.dip', () => {
  const p1 = dual(1, 'power'), r1 = E.evaluate(p1, 'full');
  near(r1.motor.dipExit, r1.motor.dip, 1e-12);
  const ps = { ...BASE, shooter: { ...BASE.shooter, control: 'power', shotInterval: 0.5 } }, rs = E.evaluate(ps, 'full'), plan = E.burstPlan(rs, ps, { shots: 2 });
  assert.ok(!('dipExit' in rs.motor));
  near(plan.dipPct, 100 * rs.motor.dip, 1e-12);
  near(plan.perShot[1].deficitPct, 100 * rs.motor.residual, 1e-9);
});

test('dual tolerance with a burst: bias = largest per-shot deficit of the exit-dip plan, burst-aware setpoint works', () => {
  const OPEN = { ...dual(0.45, 'power'), hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, TOL = { yawDeg: 0.5, angleDeg: 0.5, rpm: 25, posIn: 0 };
  const r = E.evaluate({ ...OPEN, tolerance: { ...TOL, burstShots: 3, burstIntervalS: 3 } }, 'full'), t = r.tolerance;
  const plan = E.burstPlan(r, OPEN, { shots: 3, intervalS: 3 });
  near(t.bias.speedPct, Math.max(...plan.perShot.map((s) => s.deficitPct)), 1e-9);
  assert.ok(Number.isFinite(t.margin) && t.margin >= 0 && t.bias.speedPct > 0);
  assert.ok(t.burstSetpoint && Number.isFinite(t.burstSetpoint.motorRpm));
});
