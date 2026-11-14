// Motor snapshots for the dual-wheel impulse-momentum split (issue M2, Block N, cards N1 / N9).
//   node tests/fixtures/make-baseline-dual.mjs pre    -> baseline-motor-pre-m2.json   (run ONCE on the engine before the split; never regenerate)
//   node tests/fixtures/make-baseline-dual.mjs post   -> baseline-motor-post-m2.json  (run once after the split, card N9)
// Content: full E.motorModel JSON (all fields incl. details) for 6 single-wheel and 12 dual-wheel configs, plus evaluate('full')
// snapshots of 2 dual spots. Non-finite numbers are written as the strings 'Infinity' / '-Infinity' / 'NaN' so the file is exact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, BASE } from '../load-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FILES = { pre: path.join(here, 'baseline-motor-pre-m2.json'), post: path.join(here, 'baseline-motor-post-m2.json') };
const SH = { wheelDiameterMm: 96, motorsPerWheel: 1, gear: 1, topRatio: 0.6, inertiaKgM2: 4e-4, shotInterval: 0.5 };

export const SINGLES = [
  { id: 's-pid-yj6000', motor: 'yj6000', v: 9, shooter: { ...SH, type: 'single', control: 'pid' } },
  { id: 's-power-yj6000', motor: 'yj6000', v: 9, shooter: { ...SH, type: 'single', control: 'power' } },
  { id: 's-pid-gear2', motor: 'yj6000', v: 6, shooter: { ...SH, type: 'single', gear: 2, control: 'pid' } },
  { id: 's-pid-yj1620', motor: 'yj1620', v: 5.05, shooter: { ...SH, type: 'single', control: 'pid', motorsPerWheel: 2 } },
  { id: 's-pid-I8e-4', motor: 'yj6000', v: 9, shooter: { ...SH, type: 'single', inertiaKgM2: 8e-4, control: 'pid' } },
  { id: 's-power-yj1620-I8e-4', motor: 'yj1620', v: 5.05, shooter: { ...SH, type: 'single', inertiaKgM2: 8e-4, control: 'power', spin: 'top' } },
];

export const DUALS = [];
for (const k of [0.2, 0.3, 0.45, 0.6, 0.8, 1.0])
  for (const control of ['pid', 'power'])
    for (const v of [5.05, 9]) if (v === 9 || [0.2, 0.45, 1.0].includes(k))   // v 5.05 only for three k
      DUALS.push({ id: `d-k${k}-${control}-v${v}`, motor: 'yj6000', v, shooter: { ...SH, type: 'dual', topRatio: k, control } });

export const SPOTS = {
  'dual-k0.45-pid': { ...BASE, shooter: { ...SH, type: 'dual', topRatio: 0.45, control: 'pid', shotInterval: 0.5 } },
  'dual-k0.3-power': { ...BASE, robot: { x: -40, y: -50 }, shooter: { ...SH, type: 'dual', topRatio: 0.3, control: 'power', shotInterval: 0.25 } },
};

export const clean = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v)));

export function motorRow(E, c) { return { id: c.id, in: { motor: c.motor, v: c.v, shooter: c.shooter }, out: clean(E.motorModel(c.motor, c.shooter, 'pollen', c.v)) }; }

export function snapshotEval(r) {
  const m = r.motor;
  return { hitRate: r.hitRate, code: r.code, verdict: r.verdict, motor: m && { dip: m.dip, residual: m.residual, sigmaRecovery: m.sigmaRecovery, recoveryMs: clean(m.recoveryMs) },
    best: r.best && { thetaDeg: r.best.thetaDeg, v: r.best.v, yawDeg: r.best.yawDeg } };
}

export function build(E) {
  return {
    note: 'motorModel snapshots (pollen) + evaluate(full) snapshots for dual spots; see tests/fixtures/make-baseline-dual.mjs',
    single: SINGLES.map((c) => motorRow(E, c)),
    dual: DUALS.map((c) => motorRow(E, c)),
    evalDual: Object.entries(SPOTS).map(([spot, p]) => ({ spot, ...clean(snapshotEval(E.evaluate(p, 'full'))) })),
  };
}

export function load(which) { return JSON.parse(fs.readFileSync(FILES[which], 'utf8')); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const which = process.argv[2];
  if (!FILES[which]) { console.error('usage: make-baseline-dual.mjs pre|post'); process.exit(2); }
  if (fs.existsSync(FILES[which]) && process.argv[3] !== '--force') { console.error('exists; never regenerate (use --force only on purpose)'); process.exit(2); }
  const out = build(loadEngine());
  fs.writeFileSync(FILES[which], JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', FILES[which], out.single.length, 'single', out.dual.length, 'dual', out.evalDual.length, 'eval');
}
