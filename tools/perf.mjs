// Performance baseline: median ms of evaluate(., 'coarse'|'full') at 12 fixed spots, with and without a hood.
// Usage: node tools/perf.mjs [--json]    (read-only; writes nothing to the repo)
import { loadEngine, BASE } from '../tests/load-data.mjs';

const E = loadEngine();
const HOOD = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const SPOTS = [
  [-12.75, -48], [-12.75, -30], [-12.75, 0], [-12, 48], [24, -60], [-40, -60],
  [0, -24], [20, -20], [-30, -10], [12, 20], [30, 40], [-24, 30],
];
const REPS = { coarse: 9, full: 5 };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function time(p, mode) {
  E.evaluate(p, mode);                                   // warm-up (tables, JIT)
  const t = [];
  for (let i = 0; i < REPS[mode]; i++) { const a = process.hrtime.bigint(); E.evaluate(p, mode); t.push(Number(process.hrtime.bigint() - a) / 1e6); }
  return median(t);
}

const rows = [];
for (const [x, y] of SPOTS) {
  const row = { x, y };
  for (const [label, hood] of [['nohood', undefined], ['hood', HOOD]]) {
    const p = { ...BASE, robot: { x, y }, ...(hood ? { hood } : {}) };
    for (const mode of ['coarse', 'full']) row[`${mode}_${label}`] = +time(p, mode).toFixed(2);
  }
  rows.push(row);
}
const cols = ['coarse_nohood', 'coarse_hood', 'full_nohood', 'full_hood'];
const summary = Object.fromEntries(cols.map((c) => [c, +median(rows.map((r) => r[c])).toFixed(2)]));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ node: process.version, reps: REPS, unit: 'ms (median)', rows, median: summary }, null, 2));
} else {
  console.log(`node ${process.version}  evaluate() median ms (reps coarse=${REPS.coarse}, full=${REPS.full})`);
  console.log(['x', 'y', ...cols].map((s) => s.padStart(14)).join(''));
  for (const r of rows) console.log([r.x, r.y, ...cols.map((c) => r[c])].map((v) => String(v).padStart(14)).join(''));
  console.log(['MEDIAN', '', ...cols.map((c) => summary[c])].map((v) => String(v).padStart(14)).join(''));
}
