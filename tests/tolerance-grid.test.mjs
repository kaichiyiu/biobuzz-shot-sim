// O0: res.tolerance.grid echoes the grid steps and the angle / yaw index rates the margin used (Show the derivation reads them instead of hard-coding).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const TOL = { yawDeg: 0.3, angleDeg: 0.3, rpm: 15, posIn: 1 };
const run = (tol, mode) => E.evaluate({ ...BASE, hood: ADJ, tolerance: tol }, mode);

test('full result: steps 0.25 deg / 0.5 % / 0.25 deg, kA, wY and kY equal a hand calculation', () => {
  const r = run(TOL, 'full'), g = r.tolerance.grid;
  assert.deepEqual([g.thStep, g.lnStep, g.yawStep], [0.25, 0.005, 0.25]);
  const wY = 0.3 + Math.atan(1 / r.distIn) * 180 / Math.PI;
  assert.ok(Math.abs(g.kA - 0.3 / 0.25) < 1e-12);
  assert.ok(Math.abs(g.wY - wY) < 1e-9);
  assert.ok(Math.abs(g.kY - wY / 0.25) < 1e-9);
});

test('coarse result: 1 deg and 2 % steps, yaw step of the coarse view', () => {
  const r = run(TOL, 'coarse'), g = r.tolerance.grid;
  assert.equal(g.thStep, 1); assert.ok(Math.abs(g.lnStep - Math.log(E._internal.tableSpec.vRatio)) < 1e-12);
  assert.ok(g.yawStep >= 0.5); assert.ok(Math.abs(g.kA - 0.3) < 1e-12);
});

test('no tolerance -> no result and no grid; position 0 keeps wY = yaw tolerance', () => {
  assert.equal(run(null, 'full').tolerance, undefined);
  const g = run({ ...TOL, posIn: 0 }, 'full').tolerance.grid;
  assert.ok(Math.abs(g.wY - 0.3) < 1e-12);
});
