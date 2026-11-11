// E6: pure helpers of the calibration form (grid <-> CalibRow[], plan range, live messages, Fit gating, unit switch, CSV round trip).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const G = req(path.join(ROOT, 'src', 'ui-calib-grid.js'));
const U = req(path.join(ROOT, 'src', 'units.js'));
const V = req(path.join(ROOT, 'src', 'calib-validate.js'));
const P = req(path.join(ROOT, 'src', 'calib-plan.js'));
const CSV = req(path.join(ROOT, 'src', 'calib-csv.js'));
const E = loadEngine();
const env = (units = 'imperial') => ({ ballId: 'pollen', h0In: 16, units, U });
const settings = [{ id: 'h55-low', motorRpmSet: 2000, hoodDeg: 55, predictedLandingIn: 90 }, { id: 'h55-top', motorRpmSet: 2600, hoodDeg: 55, predictedLandingIn: 150 }];

test('rangeOf: current window +/- 15 %, clipped to usable free speed; export range wins; null without a result', () => {
  assert.deepEqual(G.rangeOf({ hood: { rpmWindow: { centerMotorRpm: 2000 } }, motor: { usableFreeRpm: 5800 } }), [1700, 2300]);
  assert.deepEqual(G.rangeOf({ motor: { motorRpm: 5000, usableFreeRpm: 5500 } }), [4250, 5500]);
  assert.deepEqual(G.rangeOf({ motor: { motorRpm: 2000 } }, [1500, 3000]), [1500, 3000]);
  assert.equal(G.rangeOf(null), null);
});

test('hoodDegsOf: fixed hood angle, adjustable recommended angle, else none', () => {
  assert.deepEqual(G.hoodDegsOf({ hood: { mode: 'fixed', angleText: '58.25' } }), [58.3]);
  assert.deepEqual(G.hoodDegsOf({ hood: { mode: 'adjustable' } }, { hood: { angleDeg: 61 } }), [61]);
  assert.deepEqual(G.hoodDegsOf({ hood: { mode: 'fixed', angleText: '' } }), []);
});

test('grid -> rows in inches (imperial and metric), blanks dropped, thousands comma in rpm', () => {
  const g = G.makeGrid(settings);
  g[0].rpm = '2,010'; g[0].shots = ['90', '91.5', '', '89', '90'];
  const rows = G.toRows(g, env());
  assert.equal(rows.length, 1);                               // second setting untouched
  assert.deepEqual(rows[0].landingIn, [90, 91.5, 89, 90]);
  assert.equal(rows[0].measuredMotorRpm, 2010); assert.equal(rows[0].settingId, 'h55-low'); assert.equal(rows[0].h0In, 16);
  const m = G.toRows(g.map((x) => ({ ...x, shots: ['254', '', '', '', ''] })), env('metric'));
  assert.ok(Math.abs(m[0].landingIn[0] - 100) < 1e-9);        // 254 cm = 100 in
});

test('rows -> grid -> rows round trip, setpoints kept by id, unit switch re-expresses cells', () => {
  const g = G.makeGrid(settings);
  g[1].rpm = '2590'; g[1].shots = ['148', '150', '149.5', '151', '150'];
  const rows = G.toRows(g, env());
  const back = G.fromRows(rows, g, env());
  assert.equal(back[0].setpointRpm, 2600); assert.equal(back[0].shots.length, 5);
  assert.deepEqual(G.toRows(back, env()), rows);
  G.convert(back, 'imperial', 'metric', U);
  assert.ok(Math.abs(Number(back[0].shots[0]) - 148 * 2.54) < 0.06);
  assert.ok(Math.abs(G.toRows(back, env('metric'))[0].landingIn[0] - 148) < 0.03);
});

test('messages and ready: rpm missing, NaN cell, implausible distance, rpm far from setpoint; 15 good shots enable Fit', () => {
  const g = G.makeGrid(settings);
  assert.equal(G.ready(g, env(), V), false);
  g[0].shots = ['90', 'x', '', '', ''];
  const m = G.messages(g, env(), V);
  assert.ok(m.some((x) => /not a number/.test(x.text)) && m.some((x) => /measured motor rpm/.test(x.text)));
  g[0].rpm = '3000'; g[0].shots = ['90', '91', '92', '90', '1000'];
  const m2 = G.messages(g, env(), V);
  assert.ok(m2.some((x) => x.level === 'warn' && /setpoint/.test(x.text)));
  assert.ok(m2.some((x) => x.level === 'error' && /300|1000/.test(x.text)));
  assert.equal(G.ready(g, env(), V), false);
  // 15 synthetic shots from a 3-setting plan
  const cfg = { field: { ballId: 'pollen', h0: 16 }, robot: { shooter: { ...BASE.shooter, type: 'single', etaSingle: 0.45 } } };
  const plan = P.plan(cfg, [1800, 2400], [55], { engine: E });
  const full = G.makeGrid(plan.settings);
  full.forEach((r) => { r.rpm = String(r.setpointRpm); r.shots = Array(5).fill(String(r.predictedIn)); });
  assert.equal(G.toRows(full, env()).reduce((s, r) => s + r.landingIn.length, 0), 15);
  assert.equal(G.ready(full, env(), V), true);
});

test('CSV export of the form rows imports back to the same rows', () => {
  const g = G.makeGrid(settings);
  g[0].rpm = '2010'; g[0].shots = ['90', '91', '92', '90', '89.5'];
  const rows = G.toRows(g, env());
  const r = CSV.fromCsv(CSV.toCsv(rows));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, rows);
});
