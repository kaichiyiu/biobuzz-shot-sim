// O9: derivation sections as LaTeX for the .tex export: balanced braces, paired $, pure ASCII, compiles when pdflatex exists; the Block H text is unchanged without a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), src = (f) => path.join(ROOT, 'src', f);
const DL = require(src('derive-latex.js')), UD = require(src('ui-derive.js')), D = require(src('derive-tex.js')), AL = require(src('ui-export-algo.js')), S = require(src('export-solver.js')), X = require(src('export-tex.js'));
const E = loadEngine(), TPL = fs.readFileSync(src('templates/derivation.tex.txt'), 'utf8');
const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, entry: { rule: 'descending' }, tolerance: { yawDeg: 0.3, angleDeg: 0.3, rpm: 15, posIn: 1, burstShots: 3, burstIntervalS: 2 }, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control: 'power' } };
const R = E.evaluate(P, 'full'), secs = UD.build(R, P, { E, template: TPL }), tex = DL.latex(secs);

function balanced(s) {
  let d = 0; const t = s.replace(/\\[\\{}$%&#_]/g, '');
  for (const c of t) { if (c === '{') d++; if (c === '}') d--; if (d < 0) return false; }
  return d === 0;
}

test('latex: sections without the flight ones, one align* per row, balanced braces, paired $, pure ASCII', () => {
  assert.match(tex, /^\\section\*\{Derivation for the current spot\}/);
  for (const t of ['Scoring window', 'Hood angle and setpoint', 'Exit speed to motor rpm', 'Margin', 'Burst']) assert.ok(tex.includes(`\\subsection*{${t}}`), t);
  assert.doesNotMatch(tex, /Geometry and frame|Flight model|RK4/);
  const rows = secs.filter((s) => !/^flight-/.test(s.id)).reduce((n, s) => n + s.rows.length, 0);
  assert.equal((tex.match(/\\begin\{align\*\}/g) || []).length, rows); assert.equal((tex.match(/\\end\{align\*\}/g) || []).length, rows);
  assert.ok(balanced(tex)); assert.equal((tex.replace(/\\\$/g, '').match(/\$/g) || []).length % 2, 0);
  assert.doesNotMatch(tex, /[^\x00-\x7f]/); assert.doesNotMatch(tex, /NaN|undefined|POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict/);
  assert.ok(tex.includes(D.n(R.hood.rpmWindow.centerMotorRpm, 1)) && tex.includes(D.n(R.tolerance.margin, 3)));
  assert.equal(DL.latex([]), ''); assert.equal(DL.latex(secs.filter((s) => /^flight-/.test(s.id))), ''); assert.equal(DL.latex(null), '');
  assert.match(DL.latex(secs, { preview: true }), /coarse preview grid/);
});

test('escaping: specials, math segments kept, stray $, unicode mapped or ?, % in math', () => {
  assert.equal(DL.texEsc('a_b & 50% #1 {x} ~ ^ \\'), 'a\\_b \\& 50\\% \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}');
  assert.equal(DL.texEsc('x $\\theta_1$ y'), 'x $\\theta_1$ y'); assert.equal(DL.texEsc('cost $5'), 'cost \\$5');
  assert.equal(DL.texEsc('68.5° – 72° × η ≈ 5 ± 1 ☃'), '68.5$^\\circ$ -- 72$^\\circ$ $\\times$ $\\eta $ $\\approx$ 5 $\\pm$ 1 ?');
  assert.equal(DL.texMath('2\\,\\% \\pm 3% °'), '2\\,\\% \\pm 3\\% ^\\circ');
});

test('texText: extra goes before \\end{document}; without it the Block H text is unchanged', () => {
  const c = S.constantsFrom(P, [], E), base = X.renderTex(c, null, TPL, { wheelDiameterMm: 96 });
  assert.equal(AL.texText(c, null, TPL, P), base); assert.equal(AL.texText(c, null, TPL, P, ''), base);
  const withX = AL.texText(c, null, TPL, P, tex);
  assert.ok(withX.startsWith(base.replace(/\\end\{document\}\s*$/, ''))); assert.ok(/\\end\{document\}\n$/.test(withX)); assert.equal(withX.split('\\end{document}').length, 2);
  assert.ok(withX.indexOf('Derivation for the current spot') < withX.indexOf('\\end{document}') && withX.includes('\\section{Geometry and frame}'));
});

test('the .tex with the derivation compiles when pdflatex is available', (t) => {
  if (spawnSync('pdflatex', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('pdflatex not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-tex-')), c = S.constantsFrom(P, [], E);
  fs.writeFileSync(path.join(dir, 'd.tex'), AL.texText(c, null, TPL, P, tex));
  const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'd.tex'], { cwd: dir, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.status, 0, (r.stdout || '').split('\n').filter((l) => /^!|^l\.\d/.test(l)).join('\n')); assert.ok(fs.existsSync(path.join(dir, 'd.pdf')));
});
