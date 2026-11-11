// renderBadge on a fake DOM (owner decision 2026-11-11: no verdicts). Without r.tolerance the badge is hidden; with one it shows a neutral margin; the reason line has no hit rate.
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
    VCLASS: { 'POSSIBLE': 'good', 'NOT CONSISTENT': 'warn', "WON'T WORK": 'bad' }, U: { headingRangeToUser: (a, b) => ({ from: a, to: b, wraps: false }) } });
  return { reason: () => els.reason.textContent, render: (r) => { win.ShotUI.results.renderBadge(r); const b = els.verdictBadge; return { hidden: b.hidden, cls: b.className, icon: b.innerHTML, text: b.kids.map((k) => k.text).join('') }; }, els };
}
const legacy = (extra) => ({ verdict: 'POSSIBLE', hitRate: 0.8763, reason: 'ok', warnings: [], ...extra });
const tol = (extra) => ({ margin: 1.62, verdict: 'POSSIBLE', capped: false, lowerBound: false, sMax: 4, ...extra });

const NEUTRAL = /POSSIBLE|NOT CONSISTENT|WON'T WORK|%\s*of shots|hit rate/i;

test('no tolerance (absent or null): the badge is hidden, whatever the engine verdict', () => {
  const { render } = rig();
  for (const r of [legacy(), legacy({ tolerance: null }), legacy({ verdict: "WON'T WORK", hitRate: 0 })]) assert.equal(render(r).hidden, true);
  assert.equal(render({ verdict: null, tolerance: tol() }).hidden, true);   // error result
});

test('real engine results: no tolerance -> hidden badge; tolerance -> neutral "N.N× margin", one style, no verdict word', () => {
  const { render } = rig(), plain = E.evaluate({ ...BASE, hood: HOOD }, 'full');
  assert.equal(render(plain).hidden, true);
  const t = E.evaluate({ ...BASE, hood: HOOD, tolerance: { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2 } }, 'full'), b = render(t);
  assert.match(b.text, /^\d\.\d× margin$/);
  assert.equal(b.text, t.tolerance.margin.toFixed(1) + '× margin'); assert.equal(b.cls, 'verdict-badge v-neutral'); assert.equal(b.icon, '');
});

test('tolerance branch: neutral text for every engine verdict, bounds get a >= prefix, margin null -> "out of reach"', () => {
  const { render } = rig();
  for (const v of ['POSSIBLE', 'NOT CONSISTENT', "WON'T WORK"]) assert.deepEqual(render(legacy({ tolerance: tol({ verdict: v }) })), { hidden: false, cls: 'verdict-badge v-neutral', icon: '', text: '1.6× margin' });
  assert.equal(render(legacy({ tolerance: tol({ margin: 0.996, verdict: "WON'T WORK" }) })).text, '1.00× margin');   // never "1.0×" on a margin still below 1
  assert.equal(render(legacy({ tolerance: tol({ margin: 4, capped: true }) })).text, '≥ 4× margin');
  assert.equal(render(legacy({ tolerance: tol({ margin: 1.8, lowerBound: true }) })).text, '≥ 1.8× margin');
  const o = render(legacy({ tolerance: tol({ margin: null, verdict: "WON'T WORK", cappedBy: 'unreachable' }) }));
  assert.deepEqual(o, { hidden: false, cls: 'verdict-badge v-neutral', icon: '', text: 'out of reach' });
  assert.doesNotMatch(o.text, NEUTRAL);
});

test('reason line: hit-rate wording is replaced by the scoring window and the share of free speed used; NO_ARC / TOO_SLOW texts stay', () => {
  const { render, reason } = rig(), ids = [];
  for (const [x, y] of [[0, 0], [-40, -20], [30, 50], [-60, -60], [50, -50], [10, 60], [-20, 30], [60, 0]]) {
    for (const hood of [HOOD, undefined]) {
      const p = { ...BASE, ...(hood ? { hood } : {}) }; p.mouth = { ...p.mouth, x, y };
      const r = E.evaluate(p, 'full'); render(r); ids.push(r.code);
      assert.doesNotMatch(reason(), NEUTRAL, r.code + ': ' + reason());
      if (r.best && ['OK', 'LOW_HEADROOM', 'MISSES_OFTEN', 'RARELY_SCORES'].includes(r.code))
        assert.match(reason(), /^Scoring window: launch angle [\d.]+°–[\d.]+°, [\d,]+–[\d,]+ rpm, yaw -?[\d.]+°–-?[\d.]+° · \d+ % of free speed used$/);
      else assert.equal(reason(), r.reason, r.code);
    }
  }
  assert.ok(ids.some((c) => c === 'OK' || c === 'MISSES_OFTEN' || c === 'RARELY_SCORES' || c === 'LOW_HEADROOM'), 'saw a hit-rate worded result: ' + ids);
  const fake = { code: 'NO_ARC', reason: 'Every arc from here hits the floor first', verdict: "WON'T WORK" };
  render(fake); assert.equal(reason(), fake.reason);
});
