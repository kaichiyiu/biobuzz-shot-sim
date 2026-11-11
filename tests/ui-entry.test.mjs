// C5: ui-entry model (load / save / toParams / rows), idempotent Reference rows on a tiny fake DOM, mount and hook behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const SRC = path.join(ROOT, 'src', 'ui-entry.js');
const require = createRequire(import.meta.url);
const S = require(SRC);
const U = require(path.join(ROOT, 'src', 'units.js'));
const KEY = 'biobuzz-shot-sim.entry';
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };
const nf = (n, d) => n.toFixed(d);
const J = (v) => JSON.parse(JSON.stringify(v));   // objects made inside the vm sandbox are cross-realm

test('load: default any; invalid, corrupt or missing storage fall back to any', () => {
  assert.equal(S.load(mem()).rule, 'any');
  assert.equal(S.load(null).rule, 'any');
  for (const bad of ['{not json', '"x"', '42', 'null', '{"rule":"sideways"}']) {
    const st = mem(); st.setItem(KEY, bad);
    assert.equal(S.load(st).rule, 'any', bad);
  }
});

test('save / load round-trip; junk speed limits fall back to the default', () => {
  const st = mem();
  S.save({ rule: 'maxSpeed', maxSpeedMps: 7.5 }, st);
  assert.deepEqual(S.load(st), { rule: 'maxSpeed', maxSpeedMps: 7.5 });
  S.save({ rule: 'maxSpeed', maxSpeedMps: -3 }, st);
  assert.equal(S.load(st).maxSpeedMps, 6);
  assert.doesNotThrow(() => S.save({ rule: 'descending' }, { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } }));
});

test('toParams: the speed limit only travels with maxSpeed', () => {
  assert.deepEqual(S.toParams({ rule: 'any', maxSpeedMps: 5 }), { rule: 'any' });
  assert.deepEqual(S.toParams({ rule: 'descending', maxSpeedMps: 5 }), { rule: 'descending' });
  assert.deepEqual(S.toParams({ rule: 'maxSpeed', maxSpeedMps: 5 }), { rule: 'maxSpeed', maxSpeedMps: 5 });
  assert.deepEqual(S.toParams(null), { rule: 'any' });
});

test('rows: speed in display units, descending / rising words, dashes without a best shot', () => {
  U.setSystem('metric');
  let r = S.rows({ entryAngleDeg: -30.34, entrySpeed: 5.5 }, { rule: 'any' }, U, nf);
  assert.deepEqual(r.map((x) => x.label), ['Entry speed', 'Entry direction']);
  assert.equal(r[0].value, '5.5 m/s');
  assert.equal(r[1].value, 'Descending 30.3°');
  r = S.rows({ entryAngleDeg: 13.4, entrySpeed: 5.5 }, { rule: 'maxSpeed', maxSpeedMps: 6 }, U, nf);
  assert.equal(r[1].value, 'Rising 13.4°');
  assert.match(r[0].small, /at most 6\.0 m\/s/);
  U.setSystem('imperial');
  assert.match(S.rows({ entryAngleDeg: 1, entrySpeed: 5.5 }, { rule: 'any' }, U, nf)[0].value, /ft\/s$/);
  r = S.rows(null, { rule: 'descending' }, U, nf);
  assert.deepEqual(r.map((x) => x.value), ['—', '—']);
  assert.equal(S.rows({ entryAngleDeg: null, entrySpeed: null }, {}, U, nf)[1].value, '—');
});

// ---- fake DOM
function fakeEl(tag) {
  const e = { tag, attrs: {}, kids: [], hidden: false, listeners: {}, parent: null, value: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parent = this; this.kids.push(c); return c; },
    replaceChildren(...c) { this.kids = c; c.forEach((x) => { x.parent = this; }); },
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; },
    addEventListener(t, f) { this.listeners[t] = f; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const all = flat(this);
      if (sel === 'button') return all.filter((x) => x.tag === 'button');
      if (sel === '[data-entry]') return all.filter((x) => 'data-entry' in x.attrs);
      if (sel === '.err') return all.filter((x) => x.attrs.class === 'err');
      return [];
    } };
  return e;
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);

function browser(stored) {
  const host = fakeEl('div'), dl = fakeEl('dl'), st = mem();
  if (stored) st.setItem(KEY, stored);
  const win = { localStorage: st };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: { createElement: fakeEl, getElementById: (id) => (id === 'entryHost' ? host : id === 'refReadout' ? dl : null) } });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'entry');
  let recalcs = 0;
  U.setSystem('metric');
  hook.onStart({ state: {}, recalc: () => { recalcs++; }, units: U, fmt: { nf } });
  return { win, hook, host, dl, st, recalcs: () => recalcs };
}
const legacy = (dl) => { dl.replaceChildren(fakeEl('div'), fakeEl('div')); };   // what the legacy renderReference leaves behind
const R = { best: { entryAngleDeg: -20, entrySpeed: 5 } };

test('onResult appends exactly two rows after the legacy rows, once, across repeated renders', () => {
  const b = browser();
  for (let i = 0; i < 4; i++) { legacy(b.dl); b.hook.onResult(R, {}, 'full'); }
  assert.equal(b.dl.kids.length, 4);
  assert.equal(b.dl.querySelectorAll('[data-entry]').length, 2);
  assert.ok(!('data-entry' in b.dl.kids[0].attrs) && !('data-entry' in b.dl.kids[1].attrs), 'legacy rows first');
  b.hook.onResult(R, {}, 'coarse');   // without a legacy re-render in between
  assert.equal(b.dl.querySelectorAll('[data-entry]').length, 2);
  assert.equal(b.dl.kids[2].kids[1].textContent, '5.0 m/s');
});

test('hood error state (.err rows): no entry rows are added', () => {
  const b = browser();
  const err = fakeEl('div'); err.attrs.class = 'err';
  b.dl.replaceChildren(err);
  b.hook.onResult(R, {}, 'full');
  assert.equal(b.dl.querySelectorAll('[data-entry]').length, 0);
});

test('extendParams always sets params.entry; clicking a rule saves, flips aria-pressed, shows the limit and recalcs', () => {
  const b = browser();
  const p = {};
  assert.equal(b.hook.extendParams(p, {}), p);
  assert.deepEqual(J(p.entry), { rule: 'any' });
  const wrap = b.host.kids[0], btns = flat(wrap).filter((x) => x.tag === 'button');
  const seg = flat(wrap).find((x) => x.attrs.role === 'group');
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['true', 'false', 'false']);
  seg.listeners.click({ target: { closest: () => btns[2] } });
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['false', 'false', 'true']);
  assert.equal(b.recalcs(), 1);
  assert.deepEqual(JSON.parse(b.st.raw[KEY]), { rule: 'maxSpeed', maxSpeedMps: 6 });
  assert.deepEqual(J(b.hook.extendParams({}, {}).entry), { rule: 'maxSpeed', maxSpeedMps: 6 });
  // typing a limit in display units (metric here) stores m/s and recalcs; junk is ignored
  const input = flat(wrap).find((x) => x.tag === 'input');
  assert.equal(input.value, '6');
  input.value = '4.5'; input.listeners.change();
  assert.equal(b.hook.configSlice.get().maxSpeedMps, 4.5);
  assert.equal(b.recalcs(), 2);
  input.value = 'abc'; input.listeners.change();
  assert.equal(b.hook.configSlice.get().maxSpeedMps, 4.5);
  assert.equal(input.value, '4.5');
  assert.equal(b.recalcs(), 2);
});

test('stored rule is restored; configSlice.set round-trips', () => {
  const b = browser('{"rule":"descending","maxSpeedMps":6}');
  assert.deepEqual(J(b.hook.extendParams({}, {}).entry), { rule: 'descending' });
  assert.equal(b.hook.configSlice.key, 'entry');
  b.hook.configSlice.set({ rule: 'any' });
  assert.equal(b.hook.configSlice.get().rule, 'any');
  assert.equal(b.recalcs(), 1);
});
