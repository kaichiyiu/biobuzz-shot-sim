// O6: flight sections come from the export derivation template (same text as the .tex export); constants equal the export numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), F = require(path.join(ROOT, 'src', 'derive-flight.js')), D = require(path.join(ROOT, 'src', 'derive-tex.js'));
const S = require(path.join(ROOT, 'src', 'export-solver.js')), X = require(path.join(ROOT, 'src', 'export-tex.js'));
const E = loadEngine(), TPL = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'derivation.tex.txt'), 'utf8');
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } }, norm = (t) => t.replace(/\s+/g, ' ').trim();

test('three sections in order; every block is a substring of renderTex output (same template text)', () => {
  const secs = F.render(TPL, P, E, null), c = S.constantsFrom(P, [], E), tex = X.renderTex(c, null, TPL, { wheelDiameterMm: 96 });
  assert.deepEqual(secs.map((s) => s.title), ['Geometry and frame', 'Flight model (ordinary differential equations)', 'Numerical integration (RK4)']);
  assert.deepEqual(secs.map((s) => s.id), ['flight-geometry', 'flight-model', 'flight-rk4']);
  const flat = norm(tex);
  for (const s of secs) {
    assert.ok(s.blocks.length >= 2 && tex.includes(`\\section{${s.title}}`));
    for (const b of s.blocks) assert.ok(b.kind === 'eq' ? tex.includes(b.tex) : flat.includes(norm(b.tex)), b.tex.slice(0, 40));
  }
  assert.ok(secs[2].blocks.some((b) => b.kind === 'eq' && /k_1/.test(b.tex)));
});

test('k_d, k_l0, S0 and the RK4 step equal the export numbers; no {{ left, no verdict words', () => {
  const secs = F.render(TPL, P, E, null), c = S.constantsFrom(P, [], E), all = JSON.stringify(secs);
  const kd = 0.5 * c.rho * c.cd * c.areaM2 / c.massKg, kl0 = 0.5 * c.rho * c.areaM2 / c.massKg * c.clSlope;
  assert.ok(all.includes(X.tn(kd))); assert.ok(all.includes(X.tn(kl0))); assert.ok(all.includes(`S_0 = ${X.tn(c.S0)}`)); assert.ok(all.includes(`\\Delta t = ${X.tn(c.dt)}`));
  assert.doesNotMatch(all, /\{\{|POSSIBLE|NOT CONSISTENT|WON.T WORK/);
  const html = secs.flatMap((s) => s.blocks.map((b) => D.html(b.tex, { math: b.kind === 'eq' }))).join('');
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[\\{}$]/);
});

test('dual shooter: S0 is the dual spin ratio; skips cleanly without a template, library, engine or params', () => {
  const dual = { ...P, shooter: { ...BASE.shooter, type: 'dual', topRatio: 0.6 } }, c = S.constantsFrom(dual, [], E);
  assert.ok(JSON.stringify(F.render(TPL, dual, E, null)).includes(`S_0 = ${X.tn(c.S0)}`)); assert.notEqual(c.S0, 1);
  assert.deepEqual(F.render('', P, E), []); assert.deepEqual(F.render(null, P, E), []); assert.deepEqual(F.render(TPL, P, null), []); assert.deepEqual(F.render(TPL, null, E), []);
  assert.deepEqual(F.render(TPL + '{{NOPE}}', P, E), []);   // unknown placeholder: renderTex throws, never propagates
  assert.deepEqual(F.render(TPL, P, E, null, { S: null, X: null }).length, 3);   // falls back to the loaded libraries
  assert.deepEqual(F.sections(P, { E }), []);   // no window.SHOT_TEMPLATES in Node
});
