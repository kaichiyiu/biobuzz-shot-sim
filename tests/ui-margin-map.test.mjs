// J3: margin map pure helpers (colour mapping, nearest cell, params key, tooltip text) + wiring contract (build.mjs, ext.css).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, ROOT } from './load-data.mjs';

const D = createRequire(import.meta.url)(path.join(ROOT, 'src', 'ui-margin-map-draw.js'));
const cell = (o) => ({ x: 0, y: 0, pass: 0, feasible: true, reason: '', margin: 1.5, verdict: 'POSSIBLE', limitingAxis: 'angle', lowerBound: false, capped: false, rpmWidthPct: 6, motorRpm: 3200, ...o });

test('colourFor margin: one ramp token, alpha grows with margin, clamps at 2x, ignores the verdict', () => {
  const lo = D.colourFor(cell({ margin: 0 }), 'margin'), mid = D.colourFor(cell({ margin: 1 }), 'margin'), hi = D.colourFor(cell({ margin: 2 }), 'margin'), big = D.colourFor(cell({ margin: 4 }), 'margin');
  for (const c of [lo, mid, hi, big]) assert.equal(c.token, 'ramp');
  assert.ok(lo.alpha < mid.alpha && mid.alpha < hi.alpha); assert.equal(hi.alpha, big.alpha);
  assert.equal(D.colourFor(cell({ margin: 1, verdict: "WON'T WORK" }), 'margin').alpha, mid.alpha);
  assert.deepEqual(Object.keys(D.TOKEN_VAR), ['ramp']);
});

test('colourFor: null margin -> no fill; infeasible -> hatch in both modes; rpm mode is a one-token ramp', () => {
  assert.equal(D.colourFor(cell({ margin: null }), 'margin'), null);
  assert.equal(D.colourFor(null, 'margin'), null);
  for (const m of ['margin', 'rpm']) assert.deepEqual(D.colourFor(cell({ feasible: false, reason: 'wall' }), m), { token: null, alpha: 0, hatch: true });
  const lo = D.colourFor(cell({ rpmWidthPct: 0 }), 'rpm', 10), hi = D.colourFor(cell({ rpmWidthPct: 20 }), 'rpm', 10);
  assert.equal(lo.token, 'ramp'); assert.equal(hi.token, 'ramp'); assert.ok(hi.alpha > lo.alpha && hi.alpha <= 0.9 + 1e-9);
  assert.equal(D.colourFor(cell({ rpmWidthPct: null }), 'rpm', 10), null);
});

test('rampMax: largest feasible width, at least 1', () => {
  assert.equal(D.rampMax([]), 1);
  assert.equal(D.rampMax([cell({ rpmWidthPct: 7.5 }), cell({ feasible: false, rpmWidthPct: 99 }), cell({ rpmWidthPct: 3 })]), 7.5);
});

test('nearestCell: uses the cell pass step; nearest centre wins; outside -> null', () => {
  const cells = [cell({ x: 0, y: 0, pass: 0 }), cell({ x: 6, y: 0, pass: 1 })], steps = [12, 6];
  assert.equal(D.nearestCell(cells, steps, 5, 1).x, 6);      // inside both, nearer to the fine one
  assert.equal(D.nearestCell(cells, steps, -5, 5).x, 0);     // only the coarse square (half 6) reaches here
  assert.equal(D.nearestCell(cells, steps, 20, 0), null);
  assert.equal(D.nearestCell([], steps, 0, 0), null);
});

test('paramsKey: ignores the mouth position, keeps the height and every other param', () => {
  const p = { ...BASE, mouth: { x: 0, y: 0, height: 16 }, tolerance: { yawDeg: 1 } };
  const k = D.paramsKey({ ...p, mouth: { ...p.mouth, x: 10, y: -20 } });
  assert.equal(k, D.paramsKey({ ...p, mouth: { ...p.mouth, x: -40, y: 33 } }));
  assert.notEqual(k, D.paramsKey({ ...p, mouth: { ...p.mouth, height: p.mouth.height + 1 } }));
  assert.notEqual(k, D.paramsKey({ ...p, tolerance: { yawDeg: 2 } }));
});

test('describe: margin, bound prefix, limiting axis in words, window, rpm; infeasible reasons', () => {
  const t = D.describe(cell({ margin: 1.5 })).join(' | ');
  assert.match(t, /Margin 1\.50/); assert.doesNotMatch(t, /POSSIBLE|WORK|CONSISTENT/); assert.match(t, /Limited by launch angle/); assert.match(t, /6\.0 % wide/); assert.match(t, /3200 rpm/);
  assert.match(D.describe(cell({ lowerBound: true }))[0], /≥ 1\.50/);
  assert.equal(D.describe(cell({ margin: null, verdict: "WON'T WORK", limitingAxis: null }))[0], 'No margin');
  assert.match(D.describe(cell({ feasible: false, reason: 'hive' }))[0], /does not fit.*HIVE/);
  assert.match(D.describe(cell({ feasible: false, reason: 'wall' }))[0], /does not fit.*wall/);
  assert.deepEqual(D.describe(null), []);
});

test('wiring: build order (footprint < margin-runner < draw < map < config-schema), worker string, ext.css rule', () => {
  const b = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
  const ui = b.match(/const UI_FILES = \[(.*?)\];/s)[1], ix = (f) => ui.indexOf(`'${f}'`);
  assert.ok(ix('footprint.js') > 0 && ix('footprint.js') < ix('margin-runner.js') && ix('margin-runner.js') < ix('ui-margin-map-draw.js'));
  assert.ok(ix('ui-margin-map-draw.js') < ix('ui-margin-map.js') && ix('ui-margin-map.js') < ix('config-schema.js'));
  const wx = b.match(/const WORKER_EXT = \[(.*?)\];/)[1];
  assert.ok(wx.includes("'footprint.js'") && wx.includes("'worker-margin.js'"));
  assert.ok(!ui.includes('worker-margin.js'));
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'ext.css'), 'utf8'), /body\.has-margin-map[^{]*#scanBtn[^{]*\{\s*display:\s*none/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'ui-margin-map.js'), 'utf8'), /classList\.add\('has-margin-map'\)/);
});
