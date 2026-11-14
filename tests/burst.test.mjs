// #9 burst fire (K1): E.burstPlan reproduces the math-review deficits and follows motorCore's own recovery laws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), require = createRequire(import.meta.url);
require('../src/engine-burst.js');   // registers 'burst' (the loaders get it in K4)
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const mk = (control, extra = {}, hood) => ({ ...BASE, hood, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control, ...extra } });
const run = (params, shots, opts = {}) => { const r = E.evaluate(params, 'full'); return { r, b: E.burstPlan(r, params, { shots, ...opts }) }; };
const REF = [0, 3.5, 6.0, 7.9, 9.2];

test('default open loop (I 4.17e-4, 0.5 s): deficits 0 / 3.5 / 6.0 / 7.9 / 9.2 % within 0.5 pp, with and without a hood', () => {
  for (const hood of [undefined, ADJ]) {
    const { b } = run(mk('power', {}, hood), 5);
    assert.equal(b.perShot.length, 5); assert.equal(b.control, 'power');
    b.perShot.forEach((s, i) => { assert.equal(s.k, i + 1); assert.ok(Math.abs(s.deficitPct - REF[i]) <= 0.5, `shot ${s.k}: ${s.deficitPct}`); });
    assert.equal(b.perShot[0].inWindow, true); assert.equal(b.allIn, false); assert.equal(b.firstOut, 2);
    assert.ok(b.steadyDeficitPct > b.perShot[4].deficitPct && b.steadyDeficitPct < 100);
  }
});

test('shot 2 equals motorCore\'s own residual (open loop) and wAfterInterval (PID, short interval)', () => {
  for (const [control, dt] of [['power', 0.5], ['power', 0.1], ['pid', 0.5], ['pid', 0.012]]) {
    const { r, b } = run(mk(control, { shotInterval: dt }, ADJ), 2);
    const d = r.motor.details, own = 100 * (1 - d.wAfterInterval / d.w0);
    assert.ok(Math.abs(b.perShot[1].deficitPct - own) < 1e-9, `${control} ${dt}: ${b.perShot[1].deficitPct} vs ${own}`);
    assert.ok(Math.abs(b.perShot[1].deficitPct - 100 * r.motor.residual) < 1e-9);
    assert.equal(b.intervalS, dt);
  }
});

test('PID: deficits under 0.5 % when recovery fits; carries over when it does not; a longer interval fixes it', () => {
  const ok = run(mk('pid'), 5).b;
  assert.ok(ok.perShot.every((s) => s.deficitPct < 0.5 && s.inWindow) && ok.allIn && ok.firstOut === null && ok.steadyDeficitPct < 0.5);
  const tight = run(mk('pid', { shotInterval: 0.012 }), 5, {}).b;
  assert.ok(tight.perShot[1].deficitPct > 0.5 && tight.perShot[4].deficitPct >= tight.perShot[1].deficitPct, JSON.stringify(tight.perShot));
  const longer = run(mk('pid', { shotInterval: 0.012 }), 5, { intervalS: 0.5 }).b;
  assert.equal(longer.intervalS, 0.5); assert.ok(longer.allIn);
  assert.ok(tight.minIntervalS > 0.012 && tight.minIntervalS <= 0.5);
});

test('minIntervalS: smallest whole ms keeping all shots in the window; non-decreasing in shots; opts.intervalS overrides', () => {
  const params = mk('power', {}, ADJ), r = E.evaluate(params, 'full');
  let prev = -1;
  for (let n = 1; n <= 6; n++) {
    const b = E.burstPlan(r, params, { shots: n });
    assert.ok(b.minIntervalS >= prev, `shots ${n}`); prev = b.minIntervalS;
    if (n >= 2) {
      assert.ok(E.burstPlan(r, params, { shots: n, intervalS: b.minIntervalS }).allIn, `min interval passes (${n})`);
      assert.ok(!E.burstPlan(r, params, { shots: n, intervalS: b.minIntervalS - 0.001 }).allIn, `1 ms less fails (${n})`);
    }
  }
  assert.equal(E.burstPlan(r, params, { shots: 1 }).minIntervalS, 0);
  assert.ok(E.burstPlan(r, params, { shots: 5 }).minIntervalS > 0.5);
  assert.equal(E.burstPlan(r, params, { shots: 3, intervalS: 30 }).allIn, true);
});

test('window source: hood rpmWindow, else scoringWindow; setpoint override; null cases never throw', () => {
  const rh = E.evaluate(mk('power', {}, ADJ), 'full'), bh = E.burstPlan(rh, null, { shots: 2 });
  assert.deepEqual(bh.windowRpm, rh.hood.rpmWindow.motorRpm); assert.equal(bh.setpointRpm, rh.hood.rpmWindow.centerMotorRpm);
  const rn = E.evaluate(mk('power'), 'full'), bn = E.burstPlan(rn, null, { shots: 2 });
  assert.deepEqual(bn.windowRpm, rn.best.scoringWindow.motorRpm);
  const hi = E.burstPlan(rn, null, { shots: 4, setpointRpm: rn.best.scoringWindow.motorRpm[1] });
  assert.equal(hi.perShot[0].inWindow, true); assert.equal(hi.perShot[1].inWindow, true); assert.equal(hi.perShot[3].inWindow, false);   // aiming at the top edge: ~4.4 % of room
  assert.ok(hi.perShot[0].motorRpm === hi.setpointRpm && hi.perShot[2].motorRpm < hi.perShot[1].motorRpm);
  const none = E.evaluate({ ...BASE, robot: { x: -12.75, y: 0 } }, 'full'), slow = E.evaluate({ ...BASE, motorId: 'yj1620' }, 'full');
  for (const x of [none, slow, null, {}]) assert.equal(E.burstPlan(x, BASE, { shots: 3 }), null);
  assert.equal(E.burstPlan(rn, BASE, { shots: 0 }), null); assert.equal(E.burstPlan(rn, BASE, {}), null);
  assert.equal(E.burstPlan(rn, BASE, { shots: 99 }).shots, 20);
  assert.equal(E.burstPlan(rn, BASE, { shots: 2, setpointRpm: 1e9 }), null);
});
