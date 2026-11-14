// Plan rule 0.1: every NEW file is at most 200 lines (list = plan section 1.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load-data.mjs';

const MAX = 200;
// engine side: must exist
const ENGINE = [
  'src/engine-rect.js', 'src/engine-hood-core.js', 'src/engine-hood.js', 'src/engine-sweep.js', 'src/engine-entry.js',
  'tests/rect-window.test.mjs', 'tests/hood-core.test.mjs', 'tests/hood.test.mjs', 'tests/hood-aim.test.mjs', 'tests/hood-search.test.mjs', 'tests/backcompat.test.mjs', 'tests/file-size.test.mjs',
  'tests/fixtures/make-baseline.mjs',
  // tolerance model (issue #7 / #8, I1-I4) and robot footprint (J1)
  'src/engine-tolerance-core.js', 'src/engine-tolerance-along.js', 'src/engine-tolerance.js', 'src/footprint.js', 'src/engine-burst.js', 'tests/burst.test.mjs', 'tests/tolerance-bias.test.mjs',
  'tests/tolerance-core.test.mjs', 'tests/tolerance-along.test.mjs', 'tests/tolerance.test.mjs', 'tests/tolerance-evaluate.test.mjs', 'tests/footprint.test.mjs',
];
// UI side (other developer): checked when present; split seams are in the plan
const UI = [
  'src/ui-panels.js', 'src/ui-results.js', 'src/ui-window.js', 'src/ui-hood.js', 'src/ui-hood-error.js', 'src/ui-rpm-plot.js',
  'src/panel.css', 'tests/ui-hood.test.mjs', 'tests/units-range.test.mjs', 'tests/ui-window.test.mjs',
  // seam files the plan allows when a budget is exceeded
  'src/engine-hood-sens.js', 'src/engine-hood-result.js', 'src/ui-reference.js', 'src/ui-hood-model.js', 'src/ui-plot-axes.js', 'src/ui-spin.js', 'tests/ui-spin.test.mjs', 'tests/spin.test.mjs', 'src/ui-entry.js', 'tests/ui-entry.test.mjs', 'tests/entry-capture.test.mjs', 'tests/entry-filter.test.mjs', 'tests/entry-evaluate.test.mjs',
  'src/config-schema.js', 'src/config-io.js', 'src/ui-config.js', 'tests/config-schema.test.mjs', 'tests/config-io.test.mjs', 'tests/ui-config.test.mjs',
  'src/hood.css',
  // eta calibration (issue #11, E1-E7)
  'src/calib-core.js', 'src/calib-plan.js', 'src/calib-fit.js', 'src/calib-csv.js', 'src/calib-video.js', 'src/calib-validate.js',
  'src/ui-calib-grid.js', 'src/ui-calib-form.js', 'src/ui-calib-report.js',
  // export (issue #4, F1-F7)
  'src/engine-export.js', 'src/engine-export-bearing.js', 'src/worker-export.js', 'src/export-format.js', 'src/export-runner.js', 'src/ui-export.js', 'src/ui-export-panel.js', 'src/ui-accuracy.js',
  'tests/export-row.test.mjs', 'tests/export-bearing.test.mjs', 'tests/worker-export.test.mjs', 'tests/export-format.test.mjs', 'tests/export-runner.test.mjs', 'tests/ui-export.test.mjs', 'tests/ui-accuracy.test.mjs',
  // on-robot solver (issue #4, G1-G5)
  'src/export-solver.js', 'src/export-java.js', 'src/export-compare.js', 'src/ui-export-algo.js', 'src/templates/ShotSolver.java.txt',
  'src/export-tex.js', 'src/templates/derivation.tex.txt', 'tests/export-tex.test.mjs', 'tests/export-rpm-map.test.mjs',
  'tests/export-solver.test.mjs', 'tests/export-java.test.mjs', 'tests/export-compare.test.mjs', 'tests/java-port.test.mjs', 'tests/ui-export-algo.test.mjs',
  'tests/calib-core.test.mjs', 'tests/calib-plan.test.mjs', 'tests/calib-fit.test.mjs', 'tests/calib-io.test.mjs', 'tests/calib-validate.test.mjs',
  'tests/ui-calib-form.test.mjs', 'tests/ui-calib-report.test.mjs', 'tests/config-schema-calib.test.mjs',
  // tolerance UI (issue #7, I6)
  'src/ui-tolerance.js', 'src/ui-noverdict.js', 'tests/ui-noverdict.test.mjs', 'src/ui-tolerance-panel.js', 'tests/ui-tolerance.test.mjs', 'tests/ui-tolerance-typing.test.mjs', 'tests/ui-results-badge.test.mjs',
  // field margin map (issue #15, J2-J3)
  'src/worker-margin.js', 'src/margin-runner.js', 'src/ui-margin-map.js', 'src/ui-margin-map-draw.js',
  'tests/worker-margin.test.mjs', 'tests/margin-runner.test.mjs', 'tests/ui-margin-map.test.mjs',
  // burst fire (issue #9, K3)
  'src/ui-burst.js', 'tests/ui-burst.test.mjs',
];
const lines = (f) => { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); return s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0); };
const has = (f) => fs.existsSync(path.join(ROOT, f));

test('engine-side new files exist and are at most 200 lines', () => {
  for (const f of ENGINE) { assert.ok(has(f), `${f} is missing`); assert.ok(lines(f) <= MAX, `${f} has ${lines(f)} lines (max ${MAX})`); }
});

test('UI-side new files that exist are at most 200 lines', () => {
  for (const f of UI) if (has(f)) assert.ok(lines(f) <= MAX, `${f} has ${lines(f)} lines (max ${MAX})`);
});

test('baseline fixture stays one line per case (< 40 lines)', () => {
  assert.ok(lines('tests/fixtures/baseline-efed636.json') < 40);
});
