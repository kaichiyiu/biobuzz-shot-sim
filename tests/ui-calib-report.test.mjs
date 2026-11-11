// E7: pure parts of the calibration report (record, eta status, slider widening, table cells) and a fit -> apply round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const R = req(path.join(ROOT, 'src', 'ui-calib-report.js'));
const C = req(path.join(ROOT, 'src', 'calib-core.js'));
const F = req(path.join(ROOT, 'src', 'calib-fit.js'));
const U = req(path.join(ROOT, 'src', 'units.js'));
const E = loadEngine();
const SH = { ...BASE.shooter, type: 'single', etaSingle: 0.45 };
const cfg = { field: { ballId: 'pollen', h0: 16 }, robot: { shooter: SH } };

function synth(truth, rpms) {
  const so = C.shooterOf(E, cfg);
  return rpms.map((rpm, i) => {
    const d = C.landingIn(E, 'pollen', so.S0, 55, C.exitSpeedFromMotorRpm(rpm, so.sh, truth), 16);
    return { settingId: 's' + i, ballId: 'pollen', h0In: 16, hoodDeg: 55, measuredMotorRpm: rpm, landingIn: [d - 0.4, d + 0.3, d, d + 0.2, d - 0.1] };
  });
}

test('fit of synthetic 0.36 shots -> record -> status calibrated; changed by hand; other wheel type ignored', () => {
  const rows = synth(0.36, [2000, 2300, 2600]);
  const fit = F.fit(rows, cfg, { engine: E });
  assert.ok(Math.abs(fit.eta.single - 0.36) < 0.005, String(fit.eta.single));
  const rec = R.makeRecord(fit, rows, { s0: 2000 }, null, Date.UTC(2026, 10, 11));
  assert.equal(rec.calibrated, true); assert.equal(rec.date.slice(0, 10), '2026-11-11'); assert.equal(rec.applied.key, 'etaSingle');
  assert.equal(rec.applied.value, Math.round(fit.eta.single * 1e4) / 1e4);
  const sh = { type: 'single', etaSingle: rec.applied.value };
  assert.equal(R.etaStatus(rec, sh), 'calibrated');
  assert.equal(R.etaStatus(rec, { ...sh, etaSingle: 0.4 }), 'changed');
  assert.equal(R.etaStatus(rec, { ...sh, type: 'dual' }), 'none');
  assert.equal(R.etaStatus(null, sh), 'none');
  assert.deepEqual(JSON.parse(JSON.stringify(rec)).applied, rec.applied);   // JSON-safe (stored in the config)
});

test('wideRange: includes the stored value, keeps the usual range otherwise', () => {
  assert.deepEqual(R.wideRange(0.3, 0.5, 0.28), [0.28, 0.5]);
  assert.deepEqual(R.wideRange(0.3, 0.5, 0.36), [0.3, 0.5]);
  assert.deepEqual(R.wideRange(0.3, 0.5, 0.2749), [0.27, 0.5]);
  assert.deepEqual(R.wideRange(0.8, 0.95, 1.02), [0.8, 1.02]);
});

test('rowCells: display units, repeat mark; stripTag removes the eta label suffix once', () => {
  const rows = synth(0.36, [2000, 2300, 2600]);
  rows[1].landingIn[2] += 70;
  const fit = F.fit(rows, cfg, { engine: E });
  const cells = R.rowCells(fit, U, 'metric');
  assert.equal(cells.length, 3); assert.ok(cells[1].repeat); assert.ok(!cells[0].repeat);
  assert.ok(Math.abs(Number(cells[0].meas) - fit.rows[0].meanIn * 2.54) < 0.06);
  assert.equal(R.stripTag('wheel surface speed (manual)'), 'wheel surface speed');
  assert.equal(R.stripTag('wheel surface speed (calibrated 2026-11-11)'), 'wheel surface speed');
  assert.equal(R.stripTag('wheel surface speed'), 'wheel surface speed');
});

test('applying the fitted eta moves the motor rpm for a given exit speed by old / new factor', () => {
  const fit = F.fit(synth(0.36, [2000, 2300, 2600]), cfg, { engine: E });
  const v = 6;
  const old = C.motorRpmFromExitSpeed(v, C.shooterOf(E, cfg).sh);
  const cal = C.motorRpmFromExitSpeed(v, C.shooterOf(E, { ...cfg, robot: { shooter: { ...SH, etaSingle: fit.eta.single } } }).sh);
  assert.ok(Math.abs(cal / old - 0.45 / fit.eta.single) < 1e-6);
});

test('Clear restores the manual eta stored at Apply (only while the eta still sits at the applied value); older records keep today\'s behaviour', () => {
  const fit = { eta: { single: 0.38 }, mode: 'single', factor: 0.38, rows: [] };
  const prev = R.manualBefore(null, { type: 'single', etaSingle: 0.45 }, 'etaSingle');
  assert.deepEqual(prev, { key: 'etaSingle', value: 0.45 });
  const rec = R.makeRecord(fit, [], {}, null, 0, prev);
  assert.deepEqual(rec.previousManual, { key: 'etaSingle', value: 0.45 });
  assert.deepEqual(R.restoreOf(rec, { type: 'single', etaSingle: 0.38 }), { key: 'etaSingle', value: 0.45 });
  assert.equal(R.restoreOf(rec, { type: 'single', etaSingle: 0.41 }), null);          // moved by hand since: that value is the manual one
  assert.equal(R.restoreOf(R.makeRecord(fit, [], {}, null, 0), { type: 'single', etaSingle: 0.38 }), null);   // older record
  // re-applying while still calibrated keeps the original manual value; after a hand edit the current value is the new manual one
  assert.deepEqual(R.manualBefore(rec, { type: 'single', etaSingle: 0.38 }, 'etaSingle'), { key: 'etaSingle', value: 0.45 });
  assert.deepEqual(R.manualBefore(rec, { type: 'single', etaSingle: 0.41 }, 'etaSingle'), { key: 'etaSingle', value: 0.41 });
});
