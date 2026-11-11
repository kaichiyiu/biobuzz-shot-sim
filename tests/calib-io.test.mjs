// E4: calib-csv round trip / error reporting and calib-video launch angle.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const CSV = req(path.join(ROOT, 'src', 'calib-csv.js'));
const V = req(path.join(ROOT, 'src', 'calib-video.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

const ROWS = [
  { settingId: 'h45-low', ballId: 'pollen', h0In: 16, hoodDeg: 45, measuredMotorRpm: 2013.5, landingIn: [61.2, 60.4, 62, 59.9, 61.5] },
  { settingId: 'h45-mid', ballId: 'nectar', h0In: 15.5, hoodDeg: 45, measuredMotorRpm: 3004, landingIn: [120, 118.25, 121, 119.5, 120.75] },
];

test('CSV round trip keeps rows, settingIds, order and exact numbers', () => {
  const text = CSV.toCsv(ROWS);
  assert.equal(text.split('\n')[0], 'settingId,ballId,h0In,hoodDeg,measuredMotorRpm,landingIn');
  assert.equal(text.trim().split('\n').length, 1 + 10, 'one line per shot');
  const r = CSV.fromCsv(text);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, ROWS);
});

test('CSV without settingId groups consecutive identical setups; CRLF, BOM, column order, quotes, blank lines', () => {
  const text = '﻿ballId,hoodDeg,landingIn,measuredMotorRpm,h0In\r\npollen,45,60,2000,16\r\n\r\npollen,45,61,2000,16\r\nPOLLEN,50,90,2500,16\r\n';
  const r = CSV.fromCsv(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { ballId: 'pollen', h0In: 16, hoodDeg: 45, measuredMotorRpm: 2000, landingIn: [60, 61] });
  assert.equal(r.rows[1].hoodDeg, 50); assert.equal(r.rows[1].ballId, 'pollen');
  const many = CSV.fromCsv('ballId,hoodDeg,landingIn,measuredMotorRpm,h0In\npollen,45,1,2000,16\npollen,50,2,2500,16\npollen,50,3,2500,16\npollen,50,4,2500,16\npollen,45,5,2000,16\n');
  assert.deepEqual(many.rows.map((x) => x.landingIn), [[1], [2, 3, 4], [5]], 'only consecutive identical lines group');
  const q = CSV.fromCsv('settingId,ballId,h0In,hoodDeg,measuredMotorRpm,landingIn\n"a,1",pollen,16,45,2000,60\n');
  assert.equal(q.rows[0].settingId, 'a,1');
  assert.deepEqual(CSV.fromCsv(CSV.toCsv(q.rows)).rows, q.rows, 'comma in id survives a round trip');
  assert.deepEqual(CSV.fromCsv(CSV.toCsv([])).rows, []);
});

test('bad input returns errors and does not throw', () => {
  const noHead = CSV.fromCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(noHead.rows, []); assert.match(noHead.errors[0], /Missing column\(s\): ballId, h0In/);
  assert.equal(CSV.fromCsv('').errors.length, 1);
  assert.equal(CSV.fromCsv(null).errors.length, 1);
  const bad = CSV.fromCsv('ballId,h0In,hoodDeg,measuredMotorRpm,landingIn\npollen,16,45,2000,abc\nsnail,16,45,2000,60\npollen,16,45,2000,61\npollen,16,45\n');
  assert.equal(bad.rows.length, 1); assert.deepEqual(bad.rows[0].landingIn, [61]);
  assert.equal(bad.errors.length, 4);   // + the short last line misses measuredMotorRpm and landingIn
  assert.match(bad.errors[3], /Line 5: landingIn/);
  assert.match(bad.errors[0], /Line 2: landingIn "abc" is not a number/);
  assert.match(bad.errors[1], /Line 3: ballId "snail"/);
  const mix = CSV.fromCsv('settingId,ballId,h0In,hoodDeg,measuredMotorRpm,landingIn\ns,pollen,16,45,2000,60\ns,pollen,16,45,2100,61\n');
  assert.equal(mix.rows[0].landingIn.length, 2); assert.match(mix.errors[0], /different/);
});

test('video: (0,0) -> (10,10) is 45 deg; offset from the hood angle; mirrored video; vertical and bad input', () => {
  const a = V.angleOffset({ x: 0, y: 0 }, { x: 10, y: 10 }, 42);
  near(a.launchDeg, 45, 1e-12); near(a.offsetDeg, 3, 1e-12); assert.equal(a.speedMps, null); assert.equal(a.gravityBiasDeg, null);
  near(V.angleOffset({ x: 5, y: 1 }, { x: 1, y: 3 }, 45).launchDeg, Math.atan2(2, 4) * 180 / Math.PI, 1e-12);
  near(V.angleOffset({ x: 0, y: 0 }, { x: 0, y: 1 }, 45).launchDeg, 90, 1e-12);
  assert.match(V.angleOffset({ x: 0, y: 0 }, { x: 0, y: 0 }, 45).error, /identical/);
  assert.match(V.angleOffset({ x: 0 }, { x: 1, y: 1 }, 45).error, /numeric/);
});

test('video: fps gives speed (frame gap respected) and the gravity bias of the chord angle', () => {
  const a = V.angleOffset({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, 45, 60);          // 0.1414 m in 1/60 s
  near(a.speedMps, Math.hypot(0.1, 0.1) * 60, 1e-9);
  const b = V.angleOffset({ x: 0, y: 0, frame: 10 }, { x: 0.1, y: 0.1, frame: 12 }, 45, 60);
  near(b.speedMps, Math.hypot(0.1, 0.1) * 30, 1e-9);
  // bias = atan((vz + g dt/2)/vx) - atan(vz/vx), dt = 1/60, vx = vz = 6 m/s
  near(a.gravityBiasDeg, (Math.atan2(6 + 9.80665 / 120, 6) - Math.PI / 4) * 180 / Math.PI, 1e-9);
  assert.ok(a.gravityBiasDeg > 0.1 && a.gravityBiasDeg < 1);
  assert.equal(V.angleOffset({ x: 0, y: 0 }, { x: 1, y: 1 }, 45, 0).speedMps, null);
});
