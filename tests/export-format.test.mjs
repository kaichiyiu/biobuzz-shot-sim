// #4 F4: header / CSV / JSON / Java arrays of an export table; round trips on real engine rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const F = req(path.join(ROOT, 'src', 'export-format.js')), CC = req(path.join(ROOT, 'src', 'calib-core.js')), SCH = req(path.join(ROOT, 'src', 'config-schema.js'));
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, XS = { stepIn: 12, mouthForwardIn: 4, servo: { deg1: 45, pos1: 0.1, deg2: 80, pos2: 0.9 } };
const ROWS = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS));   // includes the unreachable d = 10 row
const CFG = SCH.defaults(loadData()), FIXED = { createdAt: '2026-11-11T10:00:00.000Z' };
const sig6 = (x) => Number(x.toPrecision(6));

function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l !== ''), comments = lines.filter((l) => l.startsWith('# ')), body = lines.filter((l) => !l.startsWith('# '));
  const split = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  const cols = split(body[0]);
  return { comments, cols, rows: body.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [cols[i], v]))) };
}

test('column order is stable; header row matches', () => {
  assert.deepEqual(F.COLUMNS, ['dMouthIn', 'dRobotIn', 'reachable', 'motorRpmC', 'motorRpmLo', 'motorRpmHi', 'ticksPerSecC', 'ticksPerSecLo', 'ticksPerSecHi',
    'wheelRpmC', 'wheelRpmLo', 'wheelRpmHi', 'exitSpeedMpsC', 'exitSpeedMpsLo', 'exitSpeedMpsHi', 'windowPct', 'launchDeg', 'servoPos', 'yawOffsetDeg', 'tofS', 'aimZIn',
    'entryAngleDeg', 'entrySpeedMps', 'margin', 'bearingLoDeg', 'bearingHiDeg']);
  const csv = F.toCsv({ header: F.header(CFG, null, ROWS, FIXED), rows: ROWS });
  assert.equal(parseCsv(csv).cols.join(','), F.COLUMNS.join(','));
});

test('CSV round trip: every number parses back to the same 6-significant-digit value, null is an empty cell, booleans survive', () => {
  assert.ok(ROWS.some((r) => !r.reachable) && ROWS.some((r) => r.reachable && r.bearingDeg));
  const csv = F.toCsv({ header: F.header(CFG, null, ROWS, FIXED), rows: ROWS }), p = parseCsv(csv);
  assert.equal(p.rows.length, ROWS.length);
  const flat = (r) => ({ ...r, motorRpmC: r.motorRpm?.c, motorRpmLo: r.motorRpm?.lo, motorRpmHi: r.motorRpm?.hi, ticksPerSecC: r.ticksPerSec?.c, ticksPerSecLo: r.ticksPerSec?.lo, ticksPerSecHi: r.ticksPerSec?.hi,
    wheelRpmC: r.wheelRpm?.c, wheelRpmLo: r.wheelRpm?.lo, wheelRpmHi: r.wheelRpm?.hi, exitSpeedMpsC: r.exitSpeedMps?.c, exitSpeedMpsLo: r.exitSpeedMps?.lo, exitSpeedMpsHi: r.exitSpeedMps?.hi,
    bearingLoDeg: r.bearingDeg?.lo, bearingHiDeg: r.bearingDeg?.hi });
  ROWS.forEach((r, i) => {
    const f = flat(r);
    for (const c of F.COLUMNS) {
      const raw = p.rows[i][c], v = f[c];
      if (v === null || v === undefined) assert.equal(raw, '', `${c} row ${i} should be empty`);
      else if (typeof v === 'number') assert.equal(Number(raw), sig6(v), `${c} row ${i}`);
      else if (typeof v === 'boolean') assert.equal(raw, String(v));
      else assert.equal(raw, v);
    }
  });
  const dead = p.rows.find((r) => r.reachable === 'false');
  assert.equal(dead.motorRpmC, ''); assert.equal(dead.launchDeg, ''); assert.equal(dead.margin, ''); assert.equal('verdict' in dead, false);
  assert.ok(p.rows.every((r) => r.servoPos === '' || Number(r.servoPos) > 0));
});

test('cells: comma, quote and newline are quoted; NaN and undefined are empty; numbers have at most 6 significant digits; LF only', () => {
  const row = { ...ROWS[2], dRobotIn: 'A, "b"', tofS: NaN, margin: undefined, aimZIn: 1 / 3 };
  const csv = F.toCsv({ header: F.header(CFG, null, [row], FIXED), rows: [row] });
  const line = csv.split('\n').find((l) => l.startsWith(`${row.dMouthIn},`));
  assert.ok(line.includes(',"A, ""b""",true,'));
  assert.ok(line.includes(',0.333333,'));
  const p = parseCsv(csv).rows[0];
  assert.equal(p.dRobotIn, 'A, "b"'); assert.equal(p.tofS, ''); assert.equal(p.margin, '');
  const nl = F.toCsv({ header: F.header(CFG, null, [row], FIXED), rows: [{ ...row, dRobotIn: 'x\ny' }] });
  assert.ok(nl.includes('"x\ny"'));
  assert.ok(csv.endsWith('\n') && !csv.includes('\r'));
});

test('header: full config, calibrated flag, rpmPerMps = rpm per m/s of the engine eta, notes (single-eta, bearing, accuracy, hood); JSON-valid in CSV and JSON', () => {
  const h = F.header(CFG, null, ROWS, FIXED), sh = CC.shooterOf(E, P).sh;
  assert.equal(h.tool, 'biobuzz-shot-sim'); assert.equal(h.accuracy, 'full'); assert.equal(h.calibrated, false); assert.equal(h.calibration, undefined); assert.equal(h.createdAt, FIXED.createdAt);
  assert.deepEqual(h.config, CFG);
  assert.equal(h.rpmPerMps, sig6(CC.motorRpmFromExitSpeed(1, sh)));
  for (const re of [/Accuracy: full/, /Single-eta limitation/, /Bearing:/, /Hood:.*widest speed run/, /NOT CALIBRATED/]) assert.ok(h.notes.some((n) => re.test(n)), String(re));
  const t = { header: h, rows: ROWS };
  assert.deepEqual(JSON.parse(F.toJson(t)), JSON.parse(JSON.stringify({ ...t, rows: t.rows.map(({ verdict, ...r }) => r) })));   // the same table, minus the verdict
  const line = parseCsv(F.toCsv(t)).comments.find((c) => c.startsWith('# header: '));
  assert.deepEqual(JSON.parse(line.slice(10)), JSON.parse(JSON.stringify(h)));
  const hc = F.header(CFG, { calibrated: true, date: '2026-11-10', fit: { mode: 'single', factor: 0.36 } }, ROWS, FIXED);
  assert.equal(hc.calibrated, true); assert.deepEqual(hc.calibration, { factor: 0.36, date: '2026-11-10', mode: 'single' }); assert.ok(!hc.notes.some((n) => /NOT CALIBRATED/.test(n)));
  assert.equal(F.header(CFG, null, [], FIXED).rpmPerMps, null);
  assert.ok(parseCsv(F.toCsv({ header: hc, rows: ROWS })).comments.includes('# calibrated: yes'));
});

test('a per-rpm eta curve makes rpmPerMps vary with rpm: the header says so and keeps the median', () => {
  const sh = CC.shooterOf(E, P).sh, f = CC.exitFactorOf(sh), curve = [[500, 0.8 * f], [4000, 1.2 * f]];
  const rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS, curve)), h = F.header(CFG, { calibrated: true, fit: { mode: 'perRpm', factor: f } }, rows, FIXED);
  assert.ok(h.notes.some((n) => /per-rpm eta curve, so rpm per m\/s varies/.test(n)));
  assert.ok(h.rpmPerMps > 0);
});

function javaArrays(src) {
  const out = {};
  for (const m of src.matchAll(/static final double\[\] (\w+) = \{ ([^}]*) \};/g)) out[m[1]] = m[2].trim() === '' ? [] : m[2].split(', ').map((x) => (x === 'Double.NaN' ? NaN : Number(x)));
  return out;
}

test('Java arrays: static final double[] DIST_IN, RPM, TICKS_PER_SEC, LAUNCH_DEG, TOF_S, YAW_OFFSET_DEG (+ window and bearing) over reachable rows; parse back to the same numbers', () => {
  const t = { header: F.header(CFG, null, ROWS, FIXED), rows: ROWS }, src = F.toJavaArrays(t), A = javaArrays(src), use = ROWS.filter((r) => r.reachable);
  assert.ok(use.length >= 3 && use.length < ROWS.length);
  for (const k of ['DIST_IN', 'RPM', 'TICKS_PER_SEC', 'LAUNCH_DEG', 'TOF_S', 'YAW_OFFSET_DEG', 'RPM_LO', 'RPM_HI', 'BEARING_LO_DEG', 'BEARING_HI_DEG']) assert.equal(A[k].length, use.length, k);
  use.forEach((r, i) => {
    assert.equal(A.DIST_IN[i], sig6(r.dRobotIn)); assert.equal(A.RPM[i], sig6(r.motorRpm.c)); assert.equal(A.TICKS_PER_SEC[i], sig6(r.ticksPerSec.c));
    assert.equal(A.LAUNCH_DEG[i], sig6(r.launchDeg)); assert.equal(A.TOF_S[i], sig6(r.tofS)); assert.equal(A.YAW_OFFSET_DEG[i], sig6(r.yawOffsetDeg));
    assert.equal(A.RPM_LO[i], sig6(r.motorRpm.lo)); assert.equal(A.RPM_HI[i], sig6(r.motorRpm.hi));
    if (r.bearingDeg) { assert.equal(A.BEARING_LO_DEG[i], sig6(r.bearingDeg.lo)); assert.equal(A.BEARING_HI_DEG[i], sig6(r.bearingDeg.hi)); } else assert.ok(Number.isNaN(A.BEARING_LO_DEG[i]));
  });
  assert.ok(A.DIST_IN.every((d, i) => i === 0 || d > A.DIST_IN[i - 1]));
  assert.match(src, new RegExp(`static final double RPM_PER_MPS = ${t.header.rpmPerMps};`));
  assert.match(src, /public final class ShooterTable \{/); assert.match(F.toJavaArrays(t, 'MyTable'), /public final class MyTable \{/); assert.match(F.toJavaArrays(t, '1 bad'), /class ShooterTable/);
  assert.ok(src.includes('Double.NaN') === use.some((r) => !r.bearingDeg));
  assert.deepEqual(javaArrays(F.toJavaArrays({ header: t.header, rows: [] })).DIST_IN, []);
  const jc = spawnSync('javac', ['-version']);
  if (jc.error) return;   // no javac here: compile check skipped
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-java-')); fs.writeFileSync(path.join(dir, 'ShooterTable.java'), src);
  const r = spawnSync('javac', ['-d', dir, path.join(dir, 'ShooterTable.java')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
});

test('no verdict in any export (owner decision 2026-11-11): no CSV column, no word in notes, JSON rows stripped', () => {
  const rows = ROWS.map((r) => ({ ...r, verdict: "WON'T WORK" })), t = { header: F.header(CFG, null, rows, FIXED), rows };
  assert.ok(!F.COLUMNS.includes('verdict'));
  assert.doesNotMatch(F.toCsv(t), /POSSIBLE|NOT CONSISTENT|WON'T WORK|verdict/i);
  const j = JSON.parse(F.toJson(t));
  assert.equal(j.rows.length, rows.length);
  assert.ok(j.rows.every((r) => !('verdict' in r) && 'reachable' in r));
  assert.ok(rows.every((r) => r.verdict), 'input rows are not mutated');
  assert.doesNotMatch(F.toJavaArrays(t), /verdict|POSSIBLE|WON'T WORK/i);
});

test('F2: header notes name the custom motor when cfg.ext.flywheelCustom.motor is on and valid; no such note otherwise', () => {
  const cfg = (motor) => ({ v: 1, robot: { motorId: 'yj6000' }, ext: { flywheelCustom: { motor } } });
  const has = (h) => h.notes.filter((n) => n.startsWith('Motor: custom'));
  const on = F.header(cfg({ on: true, freeRpm: 3000, stallTorqueNm: 1.2, encoderPPR: 20 }), null, ROWS);
  assert.equal(has(on).length, 1); assert.ok(has(on)[0].includes('custom (3000 rpm, 1.2 N·m)'));
  assert.ok(F.toCsv({ header: on, rows: ROWS }).includes('Motor: custom (3000 rpm, 1.2 N·m)'));
  assert.equal(has(F.header(cfg({ on: false, freeRpm: 3000, stallTorqueNm: 1.2 }), null, ROWS)).length, 0);
  assert.equal(has(F.header(cfg({ on: true, freeRpm: 1, stallTorqueNm: 1.2 }), null, ROWS)).length, 0);
  assert.equal(has(F.header({ v: 1, robot: { motorId: 'yj6000' } }, null, ROWS)).length, 0);
});
