// #4 F1: one export row per distance (engine-export.js), against the real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine(), X = req(path.join(ROOT, 'src', 'engine-export.js')), CC = req(path.join(ROOT, 'src', 'calib-core.js'));
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const P = { ...BASE, hood: ADJ };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const at = (params, q) => ({ ...params, mouth: { ...params.mouth, x: q.x, y: q.y } });
const full = (params, q) => E.evaluate(at(params, q), 'full');
const PTS = E.sweepPoints(P, 4), Q = PTS[3];   // d = 22

test('hood row equals sweepRow rpm; ticks = rpm / 60 * 28 (yj6000); robot distance = mouth distance + forward offset', () => {
  for (const q of [PTS[3], PTS[5]]) {
    const r = full(P, q), sr = E.sweepRow(r, q.d), row = E.exportRow(r, q, P, { mouthForwardIn: 5.5 });
    assert.deepEqual([row.motorRpm.lo, row.motorRpm.hi], sr.motorRpm);
    assert.deepEqual([row.wheelRpm.lo, row.wheelRpm.hi], sr.wheelRpm);
    assert.equal(row.motorRpm.c, r.hood.rpmWindow.centerMotorRpm);
    for (const k of ['c', 'lo', 'hi']) near(row.ticksPerSec[k], row.motorRpm[k] / 60 * 28, 1e-9, 'ticks ' + k);
    assert.equal(row.dMouthIn, q.d); assert.equal(row.dRobotIn, q.d + 5.5);
    assert.equal(row.verdict, r.verdict); assert.equal(row.reachable, true);
    assert.equal(row.launchDeg, r.best.thetaDeg); assert.equal(row.yawOffsetDeg, r.best.yawOffsetDeg); assert.equal(row.tofS, r.best.tToCell);
    near(row.exitSpeedMps.c, (row.exitSpeedMps.lo + row.exitSpeedMps.hi) / 2, 1e-12, 'v centre');
    assert.equal(row.windowPct, r.hood.rpmWindow.widthPct); assert.equal(row.margin, null); assert.equal(row.bearingDeg, null);
  }
});

test('no hood: rpm from best.scoringWindow, centre = midpoint, window percent from the speed window', () => {
  const q = E.sweepPoints(BASE, 4)[4], r = full(BASE, q), sw = r.best.scoringWindow, row = E.exportRow(r, q, BASE, {});
  assert.deepEqual([row.motorRpm.lo, row.motorRpm.hi], sw.motorRpm);
  near(row.motorRpm.c, (sw.motorRpm[0] + sw.motorRpm[1]) / 2, 1e-9, 'centre');
  near(row.windowPct, 100 * (sw.v[1] / sw.v[0] - 1), 1e-9, 'pct');
  assert.equal(row.launchDeg, r.best.thetaDeg);
});

test('throws on a coarse result and on an error result; unreachable spot gives nulls and reachable:false', () => {
  assert.throws(() => X.exportRow(E.evaluate(at(P, Q), 'coarse'), Q, P, {}), /full/);
  const bad = { ...BASE, hood: { mode: 'fixed' } };
  assert.throws(() => X.exportRow(E.evaluate(bad, 'full'), Q, bad, {}), /angle/i);
  const q0 = PTS[0], r0 = full(P, q0), row = E.exportRow(r0, q0, P, { mouthForwardIn: 2 });   // d = 10: no arc with the hood
  assert.equal(r0.best, null);
  assert.equal(row.reachable, false); assert.equal(row.verdict, r0.verdict); assert.equal(row.dRobotIn, 12);
  for (const k of ['motorRpm', 'ticksPerSec', 'wheelRpm', 'exitSpeedMps', 'windowPct', 'launchDeg', 'servoPos', 'yawOffsetDeg', 'tofS', 'aimZIn', 'entryAngleDeg', 'entrySpeedMps', 'bearingDeg'])
    assert.equal(row[k], null, k);
});

test('aimZIn: interpolated path height at rho = distIn (near the CELL mouth centre height); null when the path ends earlier', () => {
  const r = full(P, Q), row = E.exportRow(r, Q, P, {}), cen = E._internal.mouthCentroid('red', -1);
  assert.ok(Math.abs(row.aimZIn - cen[2]) < 6, `aimZ ${row.aimZIn} vs centroid ${cen[2]}`);
  const H = E._internal.ext('export').heightAt, path = [[0, 0, 10], [3, 4, 20], [6, 8, 18]];   // rho 0, 5, 10
  near(H(path, 2.5), 15, 1e-12, 'mid first segment'); near(H(path, 5), 20, 1e-12, 'vertex'); near(H(path, 7.5), 19, 1e-12, 'second segment');
  assert.equal(H(path, 10.5), null); assert.equal(H([[0, 0, 1]], 1), null);
  assert.equal(E.exportRow({ ...r, distIn: 1e4 }, Q, P, {}).aimZIn, null);
});

test('servo map is linear through the two points; absent or degenerate map gives null; settings clamp', () => {
  const r = full(P, Q), th = r.best.thetaDeg, sv = { deg1: 45, pos1: 0.2, deg2: 80, pos2: 0.9 };
  near(E.exportRow(r, Q, P, { servo: sv }).servoPos, 0.2 + (th - 45) * 0.7 / 35, 1e-12, 'servo');
  assert.equal(E.exportRow(r, Q, P, {}).servoPos, null);
  assert.equal(E.exportRow(r, Q, P, { servo: { ...sv, deg2: 45 } }).servoPos, null);
  assert.deepEqual([X.exportSettings({ stepIn: 1 }, P).stepIn, X.exportSettings({ stepIn: 99 }, P).stepIn, X.exportSettings({}, P).stepIn], [2, 12, 4]);
  assert.equal(X.exportSettings({}, P).ticksPerMotorRev, 28); assert.equal(X.exportSettings({ ticksPerMotorRev: 537.7 }, P).ticksPerMotorRev, 537.7);
  assert.equal(X.exportPoints(P, { stepIn: 12 }).length, E.sweepPoints(P, 12).length);
});

test('etaCurve: a flat curve at the engine eta reproduces the engine rpm; a curve 10 % higher cuts rpm by 1/1.1 and keeps the exit speeds', () => {
  const r = full(P, Q), sh = CC.shooterOf(E, P).sh, f = CC.exitFactorOf(sh), base = E.exportRow(r, Q, P, {});
  const same = E.exportRow(r, Q, P, {}, [[0, f], [1e5, f]]), up = E.exportRow(r, Q, P, {}, [[0, 1.1 * f], [1e5, 1.1 * f]]);
  for (const k of ['c', 'lo', 'hi']) {
    near(same.motorRpm[k] / base.motorRpm[k], 1, 1e-9, 'same ' + k); near(up.motorRpm[k] / base.motorRpm[k], 1 / 1.1, 1e-9, 'up ' + k);
    near(up.wheelRpm[k], up.motorRpm[k] * sh.gear, 1e-9, 'wheel'); near(up.ticksPerSec[k], up.motorRpm[k] / 60 * 28, 1e-9, 'ticks');
    assert.equal(up.exitSpeedMps[k], base.exitSpeedMps[k]);
  }
  const slope = E.exportRow(r, Q, P, {}, [[500, 0.5 * f], [4000, 1.5 * f]]);   // eta rises with rpm: window ends map through the curve
  assert.ok(slope.motorRpm.lo < slope.motorRpm.c && slope.motorRpm.c < slope.motorRpm.hi);
  near(CC.exitSpeedFromMotorRpm(slope.motorRpm.hi, sh, [[500, 0.5 * f], [4000, 1.5 * f]]), base.exitSpeedMps.hi, 1e-6, 'round trip');
});

test('entry angle and speed: from res.entry.best when an entry rule is active, else the centre shot (descending < 0)', () => {
  const r = full(P, Q), row = E.exportRow(r, Q, P, {});
  assert.equal(r.entry, undefined);
  assert.equal(row.entryAngleDeg, E.classifyShot(at(P, Q), r.best.thetaDeg, r.best.v, r.best.yawDeg).entryAngleDeg);
  assert.equal(row.entrySpeedMps, r.best.entrySpeed);
  const pe = { ...P, entry: { rule: 'descending' } }, re = full(pe, Q), rowE = E.exportRow(re, Q, pe, {});
  assert.deepEqual([rowE.entryAngleDeg, rowE.entrySpeedMps], [re.entry.best.angleDeg, re.entry.best.speedMps]);
  assert.ok(rowE.entryAngleDeg < 0);
});

test('margin is read from result.tolerance when present, else null', () => {
  const r = full(P, Q);
  assert.equal(E.exportRow({ ...r, tolerance: { margin: 0.42 } }, Q, P, {}).margin, 0.42);
  assert.equal(E.exportRow(r, Q, P, {}).margin, null);
});
