// O5: burst section: B cells and D equal res.tolerance.bias; burst-aware setpoint quoted; absent burst -> null; dual wheels name the exit-speed dip.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), D = require(path.join(ROOT, 'src', 'derive-tex.js')), B = require(path.join(ROOT, 'src', 'derive-burst.js'));
const E = loadEngine(), ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const TOL = { yawDeg: 0.3, angleDeg: 0.3, rpm: 15, posIn: 1 };
const run = (tol, shooter = {}) => { const p = { ...BASE, hood: ADJ, tolerance: tol, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control: 'power', ...shooter } }; return { r: E.evaluate(p, 'full'), p }; };
const rowOf = (s, what) => s.rows.find((x) => x.what === what);

test('B cells and D equal bias.cells / speedPct; per-shot deficits and recovery law quoted; burst setpoint shift and cell', () => {
  const { r, p } = run({ ...TOL, burstShots: 3, burstIntervalS: 2 }), t = r.tolerance, bs = t.bias, s = B.burst(r, p, {});
  assert.equal(s.id, 'burst'); assert.ok(bs.cells > 0 && bs.fits);
  assert.equal(rowOf(s, 'Cells of erosion').res, `${bs.cells} cells on the low-speed side`); assert.ok(rowOf(s, 'Cells of erosion').num.endsWith(`= ${bs.cells}`));
  assert.ok(rowOf(s, 'Fixed offset').res.startsWith(`${D.n(bs.speedPct, 2)} %`));
  assert.ok(rowOf(s, 'Fixed offset').num.endsWith(D.n(-Math.log(1 - bs.speedPct / 100), 4)));
  assert.equal(rowOf(s, 'Speed deficit before each shot').num, `${bs.perShotPct.map((x) => D.n(x, 2)).join(',\\ ')}\\,\\%`);
  assert.ok(rowOf(s, 'Recovery between shots').res.startsWith('open loop (fixed power), 3 shots every 2.00 s'));
  assert.equal(rowOf(s, 'Dip per shot').res, `${D.n(100 * r.motor.dip, 2)} %`);
  const sp = t.burstSetpoint, row = rowOf(s, 'Burst-aware setpoint');
  assert.ok(row.num.includes(D.n(sp.motorRpm, 1)) && row.num.includes(D.n(t.setpoint.motorRpm, 1)));
  assert.ok(row.res.startsWith(`+${D.n(sp.shiftPct, 2)} % (${sp.cells} cells)`));
  assert.doesNotMatch(JSON.stringify(s), /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined/i);
});

test('dual wheels: the dip row is the exit-speed dip of r.motor and the note names it', () => {
  const { r, p } = run({ ...TOL, burstShots: 2, burstIntervalS: 2 }, { type: 'dual', topRatio: 0.6 }), s = B.burst(r, p, {});
  assert.ok(Number.isFinite(r.motor.dipExit));
  assert.ok(rowOf(s, 'Dip per shot (both wheels)').res.startsWith(`${D.n(100 * r.motor.dipExit, 2)} %`));
  assert.ok(rowOf(s, 'Dip per shot (both wheels)').res.includes(`top wheel ${D.n(100 * r.motor.dipTop, 2)} %`));
  assert.ok(s.notes.some((x) => /exit-speed dip/.test(x)));
  assert.equal(s.notes.some((x) => /less than about 50 ms/.test(x)), false);
  const pd = run({ ...TOL, burstShots: 2, burstIntervalS: 2 }, { type: 'dual', topRatio: 0.6, control: 'pid' }), sp2 = B.burst(pd.r, pd.p, {});
  assert.ok(sp2, "PID dual burst section");
  if (sp2) {
    assert.ok(sp2.notes.some((x) => /less than about 50 ms/.test(x)));
    const rr = rowOf(sp2, 'Recovery between shots'), dd = pd.r.motor.details; assert.ok(rr.num.startsWith(`r = \\omega_{free}/\\omega_0 = ${D.n(dd.wFree / dd.w0, 3)}`), rr.num);
  }
  const single = run({ ...TOL, burstShots: 2, burstIntervalS: 2 }); assert.equal(rowOf(B.burst(single.r, single.p, {}), 'Dip per shot (both wheels)'), undefined);
  assert.equal(B.burst(single.r, single.p, {}).notes.some((x) => /exit-speed dip/.test(x)), false);
});

test('no cell fits: plain note; PID without deficit: no erosion rows; absent burst or tolerance -> null', () => {
  const nf = run({ ...TOL, burstShots: 3, burstIntervalS: 0.5 }), sn = B.burst(nf.r, nf.p, {});
  assert.equal(nf.r.tolerance.bias.fits, false); assert.ok(sn.notes.some((x) => /margin is 0/.test(x))); assert.equal(rowOf(sn, 'Burst-aware setpoint'), undefined);
  const pid = run({ ...TOL, burstShots: 3, burstIntervalS: 1 }, { control: 'pid' }), sp = B.burst(pid.r, pid.p, {});
  assert.equal(pid.r.tolerance.bias.cells, 0); assert.equal(rowOf(sp, 'Eroded grid'), undefined); assert.ok(rowOf(sp, 'Recovery between shots').res.startsWith('PID'));
  const none = run(TOL); assert.equal(B.burst(none.r, none.p, {}), null); const n0 = run(null); assert.equal(B.burst(n0.r, n0.p, {}), null); assert.equal(B.burst(null, {}, {}), null);
});
