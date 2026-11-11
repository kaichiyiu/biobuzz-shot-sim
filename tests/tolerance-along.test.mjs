// #8 tolerance along the shooting line: alongRange at BASE with the real engine (hood setpoint), window edge, caps, mouth limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), I = E._internal;
createRequire(import.meta.url)('../src/engine-tolerance-along.js');   // registers E.alongRange (wiring into the loaders comes later)
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };

function setpoint(P) {   // the hood's pick at P: angle, middle of the rpm window's exit speeds, yaw offset from the heading
  const r = E.evaluate({ ...P, hood: ADJ }, 'full'), w = r.hood.rpmWindow.vExit;
  return { r, w, sp: { thetaDeg: r.hood.angleDeg, v: (w[0] + w[1]) / 2, yawOffsetDeg: r.best.yawDeg - r.psi0Deg } };
}
const { w: W, sp: SP } = setpoint(BASE);
const total = (a) => a.minusIn + a.plusIn;
// independent probe for BASE: the target centroid is straight ahead (+y), so moving D further away is robot.y - D, heading stays 90 deg
const scores = (D, sp = SP) => E.classifyShot({ ...BASE, robot: { x: BASE.robot.x, y: BASE.robot.y - D } }, sp.thetaDeg, sp.v, 90 + sp.yawOffsetDeg).rectHit === true;

test('registered as an engine extension and exposed on E', () => {
  assert.equal(typeof E.alongRange, 'function'); assert.equal(I.ext('toleranceAlong').alongRange, E.alongRange);
});

test('the hood setpoint at BASE scores at D = 0 and has a finite, asymmetric-capable range', () => {
  assert.ok(scores(0)); assert.equal(SP.yawOffsetDeg, 0);
  const a = E.alongRange(BASE, SP);
  assert.ok(a.minusIn > 0 && a.plusIn > 0, JSON.stringify(a));
  assert.ok(a.minusIn < 24 && a.plusIn < 24 && Number.isFinite(a.minusIn + a.plusIn));
  assert.deepEqual([a.minusEnd, a.plusEnd, a.limited], ['fail', 'fail', false]);
  assert.notEqual(a.minusIn, a.plusIn);   // the two sides are independent (minus = towards the target)
});

test('edges agree with direct probes: last passing offset scores, one tolerance further does not', () => {
  for (const tolIn of [0.25, 0.05]) {
    const a = E.alongRange(BASE, SP, { tolIn });
    assert.ok(scores(a.plusIn) && !scores(a.plusIn + tolIn + 1e-6), `plus tol ${tolIn}`);
    assert.ok(scores(-a.minusIn) && !scores(-(a.minusIn + tolIn + 1e-6)), `minus tol ${tolIn}`);
  }
  const c = E.alongRange(BASE, SP), f = E.alongRange(BASE, SP, { tolIn: 0.05 });
  assert.ok(f.plusIn >= c.plusIn && f.plusIn <= c.plusIn + 0.25 + 1e-9 && f.minusIn >= c.minusIn && f.minusIn <= c.minusIn + 0.25 + 1e-9);
});

test('moving v to the lower window edge shrinks the range (both sides); an unreachable v gives { 0, 0 }', () => {
  const mid = E.alongRange(BASE, SP), edge = E.alongRange(BASE, { ...SP, v: W[0] });
  assert.ok(total(edge) < total(mid), `${total(edge)} < ${total(mid)}`);
  assert.ok(edge.minusIn <= mid.minusIn && edge.plusIn <= mid.plusIn);
  const slow = E.alongRange(BASE, { ...SP, v: 3 });
  assert.deepEqual([slow.minusIn, slow.plusIn, slow.limited], [0, 0, false]);
  const aim = E.alongRange(BASE, { ...SP, yawOffsetDeg: 25 });   // aimed 25 deg off: misses at D = 0
  assert.equal(total(aim), 0);
  assert.equal(total(E.alongRange(BASE, null)), 0);
});

test('maxIn caps each side and flags it (lower bound); stepIn does not change a clean edge', () => {
  const a = E.alongRange(BASE, SP, { maxIn: 2 });
  assert.deepEqual([a.minusIn, a.plusIn, a.minusEnd, a.plusEnd, a.limited], [2, 2, 'cap', 'cap', true]);
  const full = E.alongRange(BASE, SP), fine = E.alongRange(BASE, SP, { stepIn: 0.5 });
  assert.ok(Math.abs(fine.plusIn - full.plusIn) <= 0.25 + 1e-9 && Math.abs(fine.minusIn - full.minusIn) <= 0.25 + 1e-9);
});

test('a slanted ray (robot off the centre line) keeps the heading: setpoint scores, range finite', () => {
  const P = { ...BASE, robot: { x: -40, y: -48 } }, { r, sp } = setpoint(P);
  const a = E.alongRange(P, sp);
  assert.ok(Math.abs(r.psi0Deg - 90) > 5);   // really slanted
  assert.ok(a.minusIn + a.plusIn > 0 && a.minusIn < 24 && a.plusIn < 24, JSON.stringify(a));
});

test('the mouth limit ends the far side and is reported as limited', () => {
  const P = { ...BASE, robot: { x: -12.75, y: -66.5 } }, L = I.normParams(P).mouthLimit;
  let hit = null;
  for (let v = 6.1; v <= 6.5 && !hit; v += 0.05) {
    const a = E.alongRange(P, { thetaDeg: 50, v, yawOffsetDeg: 0 });
    if (a.plusEnd === 'mouth') hit = a;
  }
  assert.ok(hit, 'a shot that still scores at the wall exists in the scan');
  assert.ok(Math.abs(hit.plusIn - (L - 66.5)) < 1e-6, `${hit.plusIn} vs ${L - 66.5}`);
  assert.equal(hit.limited, true);
});

test('entry rule: descending narrows the along range (subset of any), every probe in it descends; maxSpeed likewise', () => {
  const sp = { thetaDeg: 70, v: 5, yawOffsetDeg: 0 }, any = E.alongRange(BASE, sp);
  const at = (D) => E.classifyShot({ ...BASE, robot: { x: BASE.robot.x, y: BASE.robot.y - D } }, sp.thetaDeg, sp.v, 90);
  assert.ok(total(any) > 0 && at(-any.minusIn).rectHit);
  const d = E.alongRange({ ...BASE, entry: { rule: 'descending' } }, sp);
  assert.ok(d.minusIn <= any.minusIn && d.plusIn <= any.plusIn);
  assert.ok(d.minusIn < any.minusIn, 'the flat shot towards the target stops descending before it stops scoring');
  for (let D = -d.minusIn; D <= d.plusIn + 1e-9; D += 0.25) {   // robot.y - D: +D is further away, matching alongRange's sign
    const c = at(D);
    assert.ok(c.rectHit && c.entryAngleDeg < 0, `D ${D}: ${JSON.stringify([c.rectHit, c.entryAngleDeg])}`);
  }
  const just = at(-(d.minusIn + 0.25 + 1e-6));   // one tolerance further: scores but no longer descends
  assert.ok(!just.rectHit || !(just.entryAngleDeg < 0));
  const v0 = at(0).entrySpeed, ms = E.alongRange({ ...BASE, entry: { rule: 'maxSpeed', maxSpeedMps: v0 + 0.01 } }, sp);
  assert.ok(ms.minusIn <= any.minusIn && ms.plusIn <= any.plusIn);
  for (let D = -ms.minusIn; D <= ms.plusIn + 1e-9; D += 0.25) assert.ok(at(D).entrySpeed <= v0 + 0.01 + 1e-9, `maxSpeed at D ${D}`);
  const none = E.alongRange({ ...BASE, entry: { rule: 'maxSpeed', maxSpeedMps: v0 - 0.5 } }, sp);
  assert.equal(total(none), 0);   // the setpoint itself breaks the rule
  assert.deepEqual(E.alongRange({ ...BASE, entry: { rule: 'any' } }, sp), any);   // rule 'any' = legacy path, unchanged
});
