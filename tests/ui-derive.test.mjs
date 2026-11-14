// O7: Show the derivation hook: sections in the documented order, idempotent, preview label, throwing section skipped, no verdict words.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), src = (f) => path.join(ROOT, 'src', f);
const UD = require(src('ui-derive.js')), DW = require(src('derive-window.js')), D = require(src('derive-tex.js'));
const E = loadEngine(), TPL = fs.readFileSync(src('templates/derivation.tex.txt'), 'utf8'), ctx = { E, template: TPL };

function mkDoc() {
  const mk = (tag) => {
    const n = { tag, className: '', id: '', children: [], parentNode: null, html: '', text: '', attrs: {},
      set innerHTML(v) { n.html = v; }, get innerHTML() { return n.html; }, set textContent(v) { n.text = v; }, get textContent() { return n.text; },
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; }, removeChild(c) { n.children = n.children.filter((k) => k !== c); c.parentNode = null; return c; },
      querySelectorAll(sel) { const out = [], cls = sel.replace(/^[a-z]*\./, ''); (function w(x) { x.children.forEach((k) => { if (k.className.split(' ').includes(cls)) out.push(k); w(k); }); })(n); return out; } };
    return n;
  };
  return { createElement: mk };
}
const html = (n) => n.html + n.text + n.children.map(html).join('\n');
const visible = (n) => html(n).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const P = { ...BASE, hood: ADJ, entry: { rule: 'descending' }, tolerance: { yawDeg: 0.3, angleDeg: 0.3, rpm: 15, posIn: 1, burstShots: 3, burstIntervalS: 2 }, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control: 'power' } };
const R = E.evaluate(P, 'full');
const withDoc = (fn) => { globalThis.document = mkDoc(); try { return fn(); } finally { delete globalThis.document; } };

test('build: sections in the documented order, every model present for a full result with tolerance and burst', () => {
  assert.deepEqual(UD.build(R, P, ctx).map((s) => s.id), ['flight-geometry', 'flight-model', 'flight-rk4', 'window', 'hood', 'eta', 'margin', 'burst']);
  assert.deepEqual(UD.build(null, P, ctx), []);
  const bare = { ...BASE }, r0 = E.evaluate(bare, 'full');   // no hood, no tolerance: window and eta only after the flight text
  assert.deepEqual(UD.build(r0, bare, ctx).map((s) => s.id), ['flight-geometry', 'flight-model', 'flight-rk4', 'window', 'eta']);
});

test('mount: closed <details class="derive"> with the summary, all numbers of the result, idempotent re-render, no verdict words / NaN / raw TeX', () => withDoc(() => {
  const body = document.createElement('div'), secs = UD.build(R, P, ctx), det = UD.mount(body, secs, R);
  assert.equal(det.tag, 'details'); assert.equal(det.className, 'derive'); assert.equal(det.children[0].tag, 'summary'); assert.equal(det.children[0].text, 'Show the derivation'); assert.equal(det.attrs.open, undefined);
  UD.mount(body, secs, R); UD.mount(body, secs, R); assert.equal(body.querySelectorAll('.derive').length, 1); assert.equal(body.children.length, 1);
  const txt = visible(det), t = R.tolerance, sw = R.best.scoringWindow;
  for (const s of [D.n(t.boxMargin, 3), D.n(t.margin, 3), `${t.bias.cells}`, D.n(sw.thetaDeg[0], 2), D.n(sw.v[1], 3), D.n(R.hood.rpmWindow.centerMotorRpm, 1), D.n(t.setpoint.motorRpm, 1), D.n(R.distIn, 2), D.n(t.burstSetpoint.motorRpm, 1), D.n(t.grid.kY, 3), `${R.entry.dropped}`])
    assert.ok(txt.includes(s), `missing ${s}`);
  for (const id of ['flight-geometry', 'window', 'hood', 'eta', 'margin', 'burst']) assert.ok(det.children[1].children.some((c) => c.id === `dv-${id}`), id);
  assert.doesNotMatch(txt, /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined|[\\{}$]/i);
  assert.doesNotMatch(html(det), /<script/i); assert.match(html(det), /dv-frac/);
}));

test('coarse result shows the preview label; r null or no section -> nothing appended; a throwing section is skipped', () => withDoc(() => {
  const c = E.evaluate(P, 'coarse'), body = document.createElement('div'), det = UD.mount(body, UD.build(c, P, ctx), c);
  assert.match(visible(det), /This is a preview/);
  const b2 = document.createElement('div'); assert.equal(UD.mount(b2, UD.build(null, P, ctx), null), null); assert.equal(b2.children.length, 0); assert.equal(UD.mount(null, []), null);
  const orig = DW.window; DW.window = () => { throw new Error('boom'); };
  try { const ids = UD.build(R, P, ctx).map((s) => s.id); assert.ok(!ids.includes('window') && ids.includes('hood') && ids.includes('eta')); } finally { DW.window = orig; }
}));

test('browser: registers a hook "derive" that appends the block on onMathRender', () => {
  const doc = mkDoc(), win = { ShotEngine: E, DeriveTex: D, DeriveFlight: require(src('derive-flight.js')), DeriveWindow: DW, DeriveHood: require(src('derive-hood.js')), DeriveMargin: require(src('derive-margin.js')), DeriveBurst: require(src('derive-burst.js')), SHOT_TEMPLATES: { 'derivation.tex': TPL } };
  vm.runInNewContext(fs.readFileSync(src('ui-derive.js'), 'utf8'), { window: win, document: doc, console });
  const h = win.ShotUI.hooks.find((x) => x.name === 'derive'), body = doc.createElement('div');
  assert.equal(typeof win.ShotUI.derive.build, 'function'); h.onStart({ units: null }); h.onMathRender(body, R, P); h.onMathRender(body, R, P);
  assert.equal(body.children.length, 1); h.onMathRender(body, null, null);
  assert.equal(body.children.length, 0);   // an older block is removed when the dialog is re-rendered without a result
});
