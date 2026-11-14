// Issue M2 (N6): the independent motor oracle (tests/crosscheck/oracle_motor.py) checks itself and fails the old 1/(1+k) share.
// Does not touch the engine. Skipped when python3 is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './load-data.mjs';

const PY = path.join(ROOT, 'tests', 'crosscheck', 'oracle_motor.py');
const have = spawnSync('python3', ['-I', '-c', '1']).status === 0;
const run = (...a) => spawnSync('python3', ['-I', PY, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const opts = { skip: have ? false : 'python3 not available' };

test('oracle self-test passes (invariants, c = 0 special case, RK4 vs exponential, negative control)', opts, () => {
  const r = run('--selftest');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest ok/);
});

test('oracle grid: impulse and energy invariants hold in every output (no engine involved)', opts, () => {
  const j = JSON.parse(run().stdout);
  assert.ok(j.cases.length >= 80);
  for (const { in: c, out: o } of j.cases) {
    assert.ok(Math.abs(o.JB_over_mv + o.JT_over_mv - 1) < 1e-12, c.id);
    assert.ok(Math.abs(o.shotEnergyJ + o.shotEnergyTopJ - o.EtotJ) < 1e-12 * o.EtotJ, c.id);
    if (c.kind === 'single') assert.equal(o.share, 1, c.id);
    else {
      assert.ok(Math.abs((o.JB_over_mv - o.JT_over_mv) - o.c * o.S0) < 1e-12, c.id);
      assert.ok(Math.abs(o.dipExit - (o.dip + c.k * o.dipTop) / (1 + c.k)) < 1e-12 || o.dipExit === undefined, c.id);
      if (c.k === 1) assert.ok(Math.abs(o.share - 0.5) < 1e-12, c.id);
    }
  }
  assert.ok(j.cases.some((x) => x.out.recoveryMs === 'Infinity'), 'unreachable speed gives Infinity (as a string in the JSON)');
});

test('negative control: the old 1/(1+k) bottom share disagrees with the oracle by more than 8 % at k = 0.3', opts, () => {
  const j = JSON.parse(run().stdout);
  for (const { in: c, out: o } of j.cases.filter((x) => x.in.kind === 'dual' && x.in.k === 0.3)) {
    const old = o.EtotJ / (1 + c.k);
    assert.ok(Math.abs(o.shotEnergyJ - old) / old > 0.08, `${c.id}: ${o.shotEnergyJ} vs old ${old}`);
  }
  const old08 = (c) => c.out.EtotJ / (1 + c.in.k);   // and at k = 1 the old share is right (no spin, equal wheels)
  for (const c of j.cases.filter((x) => x.in.kind === 'dual' && x.in.k === 1)) assert.ok(Math.abs(c.out.shotEnergyJ - old08(c)) < 1e-12 * c.out.EtotJ);
});

test('oracle is independent of the engine sources', () => {
  const src = fs.readFileSync(PY, 'utf8');
  assert.ok(!/^\s*(import|from)\s+.*oracle\b/m.test(src) && !/dual-split|engine\.js|motorCore/.test(src.replace(/^"""[\s\S]*?"""/, '')));
});
