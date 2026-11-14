// #9 K3: ui-burst model (norm / toParams / describe) and the hook against a tiny fake DOM, with the real engine's burstPlan.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadEngine, BASE } from './load-data.mjs';

const SRC = path.join(ROOT, 'src', 'ui-burst.js'), req = createRequire(import.meta.url);
const B = req(SRC), E = loadEngine();
req('../src/engine-burst.js');
const nf = (x, d) => Number(x).toFixed(d);
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const OPEN = { ...BASE, hood: ADJ, shooter: { ...BASE.shooter, inertiaKgM2: 4.17e-4, shotInterval: 0.5, control: 'power' } };
const VERDICT = /POSSIBLE|NOT CONSISTENT|WON'T WORK|WON.T WORK|verdict/i;

test('norm: shots clamp to 1..5 (junk -> 3), include is a boolean', () => {
  assert.deepEqual(B.norm(null), { shots: 3, include: false });
  assert.deepEqual(B.norm({ shots: 9, include: 1 }), { shots: 5, include: true });
  assert.deepEqual(B.norm({ shots: '2', include: 'x' }), { shots: 2, include: true });
  for (const j of [0, -2, NaN, 'abc', undefined]) assert.equal(B.norm({ shots: j }).shots, 3);
});

test('toParams: burstShots only with include, a tolerance on the params and more than one shot', () => {
  const t = () => ({ tolerance: { rpm: 20 } });
  assert.equal(B.toParams({ shots: 4, include: true }, t()).tolerance.burstShots, 4);
  for (const m of [{ shots: 4, include: false }, { shots: 1, include: true }, null]) assert.ok(!('burstShots' in B.toParams(m, t()).tolerance));
  const none = { a: 1 };
  assert.equal(B.toParams({ shots: 4, include: true }, none), none); assert.ok(!('tolerance' in none));
  assert.equal(B.toParams({ shots: 4, include: true }, null), null);
});

test('describe: 5 rows with rpm, deficit % and in / below window wording; min interval; bars inside 0..1; no verdict words', () => {
  const r = E.evaluate(OPEN, 'full'), plan = E.burstPlan(r, OPEN, { shots: 5 }), d = B.describe(plan, nf, null);
  assert.equal(d.rows.length, 5);
  assert.deepEqual(d.rows.map((x) => x.state), ['in', 'below', 'below', 'below', 'below']);
  assert.match(d.rows[0].text, /^Shot 1: \d+ rpm · 0\.0 % below setpoint · in window$/);
  assert.match(d.rows[4].text, /^Shot 5: \d+ rpm · 9\.2 % below setpoint · below window$/);
  assert.match(d.minText, /^Min interval for all in window: \d\.\d+ s$/);
  assert.match(d.windowText, /^Window \d+ – \d+ rpm · setpoint \d+ rpm · fixed power · 0\.50 s between shots$/);
  assert.match(d.steadyText, /settles 12\.\d % below/);
  assert.ok(d.band[0] > 0 && d.band[1] < 1 && d.band[0] < d.band[1]);
  d.rows.forEach((x) => assert.ok(x.pos >= 0 && x.pos <= 1));
  assert.ok(d.rows[0].pos > d.rows[4].pos);
  assert.doesNotMatch(JSON.stringify(d), VERDICT);
  const hi = B.describe(E.burstPlan(r, OPEN, { shots: 3, setpointRpm: plan.windowRpm[1] * 1.01 }), nf, null);
  assert.equal(hi.rows[0].state, 'above'); assert.match(hi.rows[0].text, /above window$/);
});

test('describe: one shot has no interval line; an unreachable aim says so; the bias note shows the largest loss', () => {
  const r = E.evaluate(OPEN, 'full'), one = B.describe(E.burstPlan(r, OPEN, { shots: 1 }), nf, null);
  assert.equal(one.rows.length, 1); assert.equal(one.minText, ''); assert.equal(one.steadyText, '');
  const none = B.describe(null, nf, null);
  assert.deepEqual(none.rows, []); assert.match(none.note, /no reachable aim/);
  assert.match(B.describe(E.burstPlan(r, OPEN, { shots: 5 }), nf, { speedPct: 9.16, shots: 5 }).note, /speed bias of 9\.2 % .* 5 shots/);
  const pid = B.describe(E.burstPlan(E.evaluate({ ...OPEN, shooter: { ...OPEN.shooter, control: 'pid' } }, 'full'), OPEN, { shots: 5 }), nf, null);
  assert.ok(pid.rows.every((x) => x.state === 'in')); assert.match(pid.windowText, /PID/);
  const never = B.describe({ ...E.burstPlan(r, OPEN, { shots: 3 }), minIntervalS: null }, nf, null);
  assert.match(never.minText, /none up to 60 s/);
});

// ---- hook, with a minimal DOM
function fakeEl(tag) {
  const e = { tag, attrs: {}, kids: [], listeners: {}, checked: false, _t: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.kids.push(c); return c; }, replaceChildren(...c) { this.kids = c; },
    addEventListener(t, f) { this.listeners[t] = f; },
    set textContent(v) { this._t = v; this.kids = []; }, get textContent() { return this._t; },
    querySelectorAll() { return flat(this).filter((x) => x.tag === 'button'); } };
  return e;
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);

function browser() {
  const host = fakeEl('div'), win = {};
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: { createElement: fakeEl, getElementById: (id) => (id === 'burstHost' ? host : null) } });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'burst'); let recalcs = 0;
  hook.onStart({ recalc: () => { recalcs++; }, engine: E, fmt: { nf } });
  return { win, hook, host, recalcs: () => recalcs, rows: () => flat(host).filter((x) => x.attrs.class === 'burst-row'), texts: () => flat(host).map((x) => x.textContent).join('\n') };
}

test('hook: slice key burst; shows one bar per shot after a result; clicking shots re-renders without recalc; include recalcs and sets burstShots', () => {
  const b = browser(), r = E.evaluate(OPEN, 'full');
  assert.equal(b.hook.configSlice.key, 'burst'); assert.equal(JSON.stringify(b.hook.configSlice.get()), '{"shots":3,"include":false}');
  assert.equal(b.rows().length, 0);
  b.hook.onResult(r, OPEN, 'full');
  assert.equal(b.rows().length, 3);
  const seg = flat(b.host).find((x) => x.attrs.role === 'group'), btns = seg.kids;
  seg.listeners.click({ target: { closest: () => btns[4] } });
  assert.equal(b.rows().length, 5); assert.equal(b.recalcs(), 0);
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['false', 'false', 'false', 'false', 'true']);
  assert.match(b.texts(), /Min interval for all in window: \d/); assert.match(b.texts(), /Only matters when a tolerance is set/);
  assert.doesNotMatch(b.texts(), VERDICT);
  const chk = flat(b.host).find((x) => x.tag === 'input'); chk.checked = true; chk.listeners.change();
  assert.equal(b.recalcs(), 1);
  assert.equal(b.hook.extendParams({ tolerance: { rpm: 10 } }, {}).tolerance.burstShots, 5);
  assert.ok(!('tolerance' in b.hook.extendParams({}, {})));
  b.hook.configSlice.set({ shots: 2, include: false });
  assert.equal(b.rows().length, 2); assert.equal(b.recalcs(), 2);
  assert.ok(!('burstShots' in b.hook.extendParams({ tolerance: { rpm: 10 } }, {}).tolerance));
});

test('hook: a result with a tolerance bias shows the note; a result without an aim shows the empty message; render never throws', () => {
  const b = browser(); b.hook.configSlice.set({ shots: 5, include: true });
  const t = { rpm: 20, yawDeg: 0.5, angleDeg: 0.5 }, r = E.evaluate({ ...OPEN, tolerance: { ...t, burstShots: 5 } }, 'full');
  b.hook.onResult(r, OPEN, 'full');
  assert.match(b.texts(), /margin includes a speed bias of 9\.2 %/);
  b.hook.onResult(E.evaluate({ ...OPEN, robot: { x: -12.75, y: 0 } }, 'full'), OPEN, 'full');
  assert.equal(b.rows().length, 0); assert.match(b.texts(), /no reachable aim/);
  assert.doesNotThrow(() => b.hook.onResult(null, null, 'coarse'));
});
