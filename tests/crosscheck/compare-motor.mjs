// Cross-check of the flywheel / motor model: E.motorModel vs the independent oracle tests/crosscheck/oracle_motor.py (issue M2, N7).
//   node tests/crosscheck/compare-motor.mjs        (npm run crosscheck:motor)
// Single and dual cases, pid and power. Tolerance: relative 1e-6 (1e-4 on times the oracle finds by stepping), plus 1e-9 absolute on fractions.
// Also checks that the oracle's model constants equal the engine's data. Writes tests/crosscheck/out/motor-{cases,out,report}.json. Exit 1 on disagreement.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadEngine } from '../load-data.mjs';

const E = loadEngine(), OUT = path.join(ROOT, 'tests', 'crosscheck', 'out');
fs.mkdirSync(OUT, { recursive: true });
const py = spawnSync('python3', ['-I', path.join(ROOT, 'tests', 'crosscheck', 'oracle_motor.py')], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (py.status !== 0) { console.error('oracle failed', py.stderr); process.exit(2); }
const cases = JSON.parse(py.stdout).cases;
fs.writeFileSync(path.join(OUT, 'motor-cases.json'), JSON.stringify(cases.map((c) => c.in)));
fs.writeFileSync(path.join(OUT, 'motor-out.json'), JSON.stringify(cases.map((c) => c.out)));

const K = E.constants().model, motors = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'motors.json'), 'utf8')).motors;
const bad = [], num = (x) => (x === 'Infinity' ? Infinity : x === '-Infinity' ? -Infinity : x);
let nCmp = 0, maxRel = 0;
function cmp(id, field, got, want, rel, abs) {
  nCmp++; want = num(want);
  if (!isFinite(want) || !isFinite(got)) { if (got !== want) bad.push({ id, field, got, want }); return; }
  const err = Math.abs(got - want), r = err / Math.max(Math.abs(want), 1e-300);
  if (Math.abs(want) > 1e-3) maxRel = Math.max(maxRel, r);
  if (err > rel * Math.abs(want) + abs) bad.push({ id, field, got, want, rel: r });
}

for (const { in: c, out: o } of cases) {
  const mo = motors.find((m) => m.freeRpm === c.motor.freeRpm && Math.abs(m.stallTorqueNm - c.motor.stallTorqueNm) < 1e-9);
  if (!mo) { bad.push({ id: c.id, field: 'motor row not in data/motors.json' }); continue; }
  for (const key of ['lossFactor', 'freeSpeedFactor', 'etaSingle', 'etaDual', 'ratedV', 'batteryV']) if (K[key] !== c[key]) bad.push({ id: c.id, field: 'model constant ' + key, got: K[key], want: c[key] });
  const sh = { type: c.kind, topRatio: c.k, control: c.control, gear: c.gear, motorsPerWheel: c.motors, wheelDiameterMm: c.diameterMm, inertiaKgM2: c.inertia, shotInterval: c.shotInterval, batteryV: c.batteryV };
  const m = E.motorModel(mo.id, sh, 'pollen', c.v), d = m.details;
  const f = (name, got, want, rel = 1e-6, abs = 1e-9) => cmp(c.id, name, got, want, rel, abs);
  f('dip', m.dip, o.dip); f('residual', m.residual, o.residual); f('sigmaRecovery', m.sigmaRecovery, o.residual / 2);
  f('recoveryMs', m.recoveryMs, o.recoveryMs, 1e-4, 1e-6); f('spinUpMs', m.spinUpMs, o.spinUpMs, 1e-4, 1e-6);
  f('shotEnergyJ', m.shotEnergyJ, o.shotEnergyJ); f('share', d.share, o.share); f('tauS', m.tauS, o.tauS);
  f('w0', d.w0, o.w0); f('w1', d.w1, o.w1); f('wAfterInterval', d.wAfterInterval, o.wAfterInterval, 1e-6, 1e-7); f('S0', m.S0, o.S0);
  if (c.kind === 'dual') {
    f('dipTop', m.dipTop, o.dipTop); f('dipExit', m.dipExit, o.dipExit); f('shotEnergyTopJ', d.shotEnergyTopJ, o.shotEnergyTopJ); f('shareTop', d.shareTop, o.shareTop);
    f('w0Top', d.w0Top, o.w0Top); f('w1Top', d.w1Top, o.w1Top); f('c', d.cBall, o.c, 1e-6, 1e-9);
  } else if ('dipExit' in m) bad.push({ id: c.id, field: 'single result has dipExit' });
}
const report = { cases: cases.length, comparisons: nCmp, maxRelErr: maxRel, failures: bad.length, detail: bad.slice(0, 30) };
fs.writeFileSync(path.join(OUT, 'motor-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, detail: undefined }, null, 1));
if (bad.length) { console.error(JSON.stringify(bad.slice(0, 10), null, 1)); process.exit(1); }
