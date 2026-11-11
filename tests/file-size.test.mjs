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
];
// UI side (other developer): checked when present; split seams are in the plan
const UI = [
  'src/ui-panels.js', 'src/ui-results.js', 'src/ui-window.js', 'src/ui-hood.js', 'src/ui-hood-error.js', 'src/ui-rpm-plot.js',
  'src/panel.css', 'tests/ui-hood.test.mjs', 'tests/units-range.test.mjs', 'tests/ui-window.test.mjs',
  // seam files the plan allows when a budget is exceeded
  'src/engine-hood-sens.js', 'src/engine-hood-result.js', 'src/ui-reference.js', 'src/ui-hood-model.js', 'src/ui-plot-axes.js', 'src/ui-spin.js', 'tests/ui-spin.test.mjs', 'tests/spin.test.mjs', 'src/ui-entry.js', 'tests/ui-entry.test.mjs', 'tests/entry-capture.test.mjs', 'tests/entry-filter.test.mjs', 'tests/entry-evaluate.test.mjs',
  'src/config-schema.js', 'src/config-io.js', 'src/ui-config.js', 'tests/config-schema.test.mjs', 'tests/config-io.test.mjs', 'tests/ui-config.test.mjs',
  'src/hood.css',
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
