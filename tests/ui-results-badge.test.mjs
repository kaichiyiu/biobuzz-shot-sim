// I7: renderBadge on a fake DOM. Without r.tolerance the legacy text is unchanged; with a tolerance margin the badge shows the margin verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const E = loadEngine(), HOOD = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
function fakeEl() {
  return { hidden: false, className: '', _h: '', kids: [], _t: '', appendChild(c) { this.kids.push(c); return c; }, replaceChildren() { this.kids = []; },
    set innerHTML(v) { this._h = v; this.kids = []; }, get innerHTML() { return this._h; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; } };
}
function rig() {
  const els = { verdictBadge: fakeEl(), warnings: fakeEl(), reason: fakeEl() };
  const doc = { createElement: fakeEl, createTextNode: (t) => ({ text: t }) };
  const win = { ShotUI: { window: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'ui-results.js'), 'utf8'), { window: win, document: doc });
  win.ShotUI.results.init({ $: (id) => els[id], nf: (n, d) => Number(n).toFixed(d), L10n: (s) => s, ICON: { good: '<g/>', warn: '<w/>', bad: '<b/>', alert: '<a/>' },
    VCLASS: { 'POSSIBLE': 'good', 'NOT CONSISTENT': 'warn', "WON'T WORK": 'bad' } });
  return { render: (r) => { win.ShotUI.results.renderBadge(r); const b = els.verdictBadge; return { hidden: b.hidden, cls: b.className, icon: b.innerHTML, text: b.kids.map((k) => k.text).join('') }; }, els };
}
const legacy = (extra) => ({ verdict: 'POSSIBLE', hitRate: 0.8763, reason: 'ok', warnings: [], ...extra });
const tol = (extra) => ({ margin: 1.62, verdict: 'POSSIBLE', capped: false, lowerBound: false, sMax: 4, ...extra });

test('legacy branch: no r.tolerance (absent or null) -> text, class and icon exactly as before', () => {
  const { render } = rig();
  for (const r of [legacy(), legacy({ tolerance: null })]) assert.deepEqual(render(r), { hidden: false, cls: 'verdict-badge v-good', icon: '<g/>', text: 'POSSIBLE · 87%' });
  assert.equal(render(legacy({ verdict: 'NOT CONSISTENT', hitRate: 0.5 })).text, 'NOT CONSISTENT · 50%');
  assert.equal(render(legacy({ verdict: "WON'T WORK", hitRate: 0 })).cls, 'verdict-badge v-bad');
  assert.equal(render(legacy({ verdict: null })).hidden, true);
});

test('real engine results: no tolerance param -> legacy text; tolerance param -> margin text', () => {
  const { render } = rig(), plain = E.evaluate({ ...BASE, hood: HOOD }, 'full');
  assert.match(render(plain).text, /^(POSSIBLE|NOT CONSISTENT|WON'T WORK) · \d+%$/);
  const t = E.evaluate({ ...BASE, hood: HOOD, tolerance: { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2 } }, 'full'), b = render(t);
  assert.match(b.text, /^(POSSIBLE|NOT CONSISTENT|WON'T WORK) · \d\.\d× margin$/);
  assert.ok(b.text.startsWith(t.tolerance.verdict + ' · ' + t.tolerance.margin.toFixed(1) + '×'));
  assert.equal(b.cls, 'verdict-badge v-' + { 'POSSIBLE': 'good', 'NOT CONSISTENT': 'warn', "WON'T WORK": 'bad' }[t.tolerance.verdict]);
});

test('tolerance branch: verdict + margin, class follows the margin verdict (not the hit-rate one), bounds get a >= prefix', () => {
  const { render } = rig();
  assert.deepEqual(render(legacy({ tolerance: tol() })), { hidden: false, cls: 'verdict-badge v-good', icon: '<g/>', text: 'POSSIBLE · 1.6× margin' });
  assert.deepEqual(render(legacy({ verdict: 'POSSIBLE', tolerance: tol({ margin: 1.1, verdict: 'NOT CONSISTENT' }) })), { hidden: false, cls: 'verdict-badge v-warn', icon: '<w/>', text: 'NOT CONSISTENT · 1.1× margin' });
  assert.equal(render(legacy({ tolerance: tol({ margin: 0.4, verdict: "WON'T WORK" }) })).text, "WON'T WORK · 0.4× margin");
  assert.equal(render(legacy({ tolerance: tol({ margin: 0.996, verdict: "WON'T WORK" }) })).text, "WON'T WORK · 1.00× margin");   // never "1.0×" under a failing verdict
  assert.equal(render(legacy({ tolerance: tol({ margin: 4, capped: true }) })).text, 'POSSIBLE · ≥ 4× margin');
  assert.equal(render(legacy({ tolerance: tol({ margin: 1.8, lowerBound: true }) })).text, 'POSSIBLE · ≥ 1.8× margin');
});

test('tolerance with margin null (cannot be shot): its verdict alone; an error result (verdict null) still hides the badge', () => {
  const { render } = rig();
  assert.deepEqual(render(legacy({ tolerance: tol({ margin: null, verdict: "WON'T WORK", cappedBy: 'unreachable' }) })), { hidden: false, cls: 'verdict-badge v-bad', icon: '<b/>', text: "WON'T WORK" });
  assert.equal(render({ verdict: null, tolerance: tol() }).hidden, true);
  assert.equal(render(legacy({ tolerance: { margin: 2, sMax: 4 } })).text, 'POSSIBLE · 87%');   // a tolerance object without a verdict is ignored
});
