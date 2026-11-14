// O1: TeX subset -> HTML for Show the derivation. The flight sections of the export derivation template must convert completely.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), D = require(path.join(ROOT, 'src', 'derive-tex.js'));
const S = require(path.join(ROOT, 'src', 'export-solver.js')), X = require(path.join(ROOT, 'src', 'export-tex.js'));
const TPL = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'derivation.tex.txt'), 'utf8');
const visible = (h) => h.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, '');

function flightBlocks() {
  const E = loadEngine(), c = S.constantsFrom({ ...BASE }, [], E), tex = X.renderTex(c, null, TPL, { wheelDiameterMm: 96 });
  const i = tex.indexOf('\\section{Geometry'), j = tex.indexOf('\\section{Aim condition');
  assert.ok(i > 0 && j > i);
  return D.blocks(tex.slice(i, j));
}

test('flight sections: section / equation / align / $..$ all convert, no leftover backslash, brace or dollar', () => {
  const bl = flightBlocks();
  assert.deepEqual([...new Set(bl.map((b) => b.kind))].sort(), ['eq', 'h', 'p']);
  assert.equal(bl.filter((b) => b.kind === 'h').length, 3);
  let n = 0;
  for (const b of bl) {
    const h = D.html(b.tex, { math: b.kind === 'eq' }), v = visible(h);
    assert.doesNotMatch(v, /[\\{}$]/, `${b.kind}: ${b.tex.slice(0, 50)} -> ${v.slice(0, 80)}`);
    assert.doesNotMatch(D.plain(b.tex, { math: b.kind === 'eq' }), /[\\{}$]/); n++;
  }
  assert.ok(n >= 15);
  const all = bl.map((b) => D.html(b.tex, { math: b.kind === 'eq' })).join('');
  for (const m of ['dv-frac', 'dv-sqrt', '<sub>', '<sup>', 'ρ', 'θ', 'Δ', '<br>']) assert.ok(all.includes(m), m);
});

test('HTML is escaped: < > & and an injected script stay text', () => {
  for (const [src, opt] of [['a < b & <script>alert(1)</script> "q"', undefined], ['x < y > z & <script>', { math: true }], ['$a<b$ \\text{<b>}', undefined]]) {
    const h = D.html(src, opt);
    assert.doesNotMatch(h, /<script|<b>|<\/script/i);
    assert.match(h, /&lt;/);
  }
});

test('constructs: \\frac, scripts, sqrt, symbols, text, operators', () => {
  assert.match(D.html('\\frac{a}{b}', { math: true }), /<span class="dv-frac"><span class="dv-n"><i>a<\/i><\/span><span class="dv-d"><i>b<\/i><\/span><\/span>/);
  assert.match(D.html('x_1^2', { math: true }), /<i>x<\/i><sub>1<\/sub><sup>2<\/sup>/);
  assert.equal(D.plain('\\lceil s \\cdot k \\rceil \\le \\sqrt{2} \\approx 1.41', { math: true }).replace(/\s/g, ''), '⌈s·k⌉≤√(2)≈1.41');
  assert.equal(D.plain('$\\ln(1 - d)$ and \\emph{up} \\textbf{b} \\texttt{t}; a -- b'), 'ln (1−d) and up b t; a – b'.replace('ln (', 'ln ('));
  assert.equal(D.plain('\\max_\\psi \\left( x \\right)\\big|', { math: true }), 'max _ψ(x)|');
});

test('unknown commands pass through as text and never throw; unbalanced input is tolerated', () => {
  assert.match(D.html('$\\foo{x} \\bar$'), /\\foo/);
  for (const bad of ['$unterminated', '}{', '\\frac{a', '^', '\\sqrt[3', '', null, undefined, '\\'])
    assert.doesNotThrow(() => { D.html(bad); D.plain(bad, { math: true }); D.html(bad, { math: true }); });
});

test('idempotent on plain text; blocks keep order and drop comments', () => {
  const t = 'Plain words, 12.5 percent (about) fine.';
  assert.equal(D.html(t), t); assert.equal(D.html(D.html(t)), t); assert.equal(D.plain(t), t);
  const b = D.blocks('% c\n\\section{A}\nText one\nmore.\n\n\\begin{equation}\n x = 1\n\\end{equation}\nTail $y$.');
  assert.deepEqual(b, [{ kind: 'h', tex: 'A' }, { kind: 'p', tex: 'Text one more.' }, { kind: 'eq', tex: 'x = 1' }, { kind: 'p', tex: 'Tail $y$.' }]);
});

test('number helpers: no NaN, no negative zero, user units appended only when they differ', () => {
  assert.equal(D.n(NaN), 'n/a'); assert.equal(D.n(undefined, 1), 'n/a'); assert.equal(D.n(-0.001, 2), '0.00'); assert.equal(D.n(1.005, 1), '1.0'); assert.equal(D.rng(1, 2.5, 1), '1.0–2.5');
  const ft = { speedUnit: () => 'ft/s', toSpeed: (v) => v * 3.28084, lenUnit: () => 'cm', toLen: (v) => v * 2.54 }, si = { speedUnit: () => 'm/s', toSpeed: (v) => v, lenUnit: () => 'in', toLen: (v) => v };
  assert.equal(D.spd(5, null, 2, ft), '5.00 m/s (16.4 ft/s)'); assert.equal(D.spd(5, 6, 1, ft), '5.0–6.0 m/s (16.4–19.7 ft/s)'); assert.equal(D.spd(5, null, 2, si), '5.00 m/s'); assert.equal(D.spd(5, null, 2), '5.00 m/s');
  assert.equal(D.lng(10, null, 1, ft), '10.0 in (25.4 cm)'); assert.equal(D.lng(10, 12, 0, si), '10–12 in'); assert.equal(D.lng(NaN, null, 1, ft), 'n/a in');
});
