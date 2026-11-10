// Writes tests/fixtures/baseline-efed636.json from the engine as it is NOW.
// Run once on the unchanged efed636 engine (plan P0); do not regenerate afterwards.
// Also exports SPOTS / snapshot() so the back-compat tests compute the same fields.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, BASE } from '../load-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FILE = path.join(here, 'baseline-efed636.json');
const S = (o) => ({ ...BASE, ...o });

export const SPOTS = {
  default: S({}),
  left: S({ robot: { x: -40, y: -50 } }),
  blueFar: S({ target: 'blue', robot: { x: 12.75, y: 48 } }),
  tall: S({ h0: 26, robot: { x: -12.75, y: -30 } }),
};

export function snapshot(r) {
  const b = r.best;
  return {
    verdict: r.verdict, code: r.code, hitRate: r.hitRate, reason: r.reason,
    best: b && { thetaDeg: b.thetaDeg, v: b.v, yawDeg: b.yawDeg, windows: b.windows },
    motorRpm: r.motor ? r.motor.motorRpm : null,
  };
}

export function build(E) {
  const out = [];
  for (const [spot, params] of Object.entries(SPOTS))
    for (const mode of ['coarse', 'full'])
      out.push({ spot, mode, ...snapshot(E.evaluate(params, mode)) });
  return out;
}

export function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = build(loadEngine());
  fs.writeFileSync(FILE, '[\n' + rows.map((x) => JSON.stringify(x)).join(',\n') + '\n]\n');
  console.log('wrote', FILE, rows.length, 'cases');
}
