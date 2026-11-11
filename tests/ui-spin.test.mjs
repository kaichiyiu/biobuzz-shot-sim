// B3: ui-spin model (load / save / toParams), mount against a tiny fake DOM, and the hook's dual-wheel hiding.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const SRC = path.join(ROOT, 'src', 'ui-spin.js');
const S = createRequire(import.meta.url)(SRC);
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };

test('load: default back; invalid, corrupt or missing storage fall back to back', () => {
  assert.equal(S.load(mem()), 'back');
  assert.equal(S.load(null), 'back');
  for (const bad of ['{not json', '"sideways"', '42', 'null', '{}']) {
    const st = mem(); st.setItem('biobuzz-shot-sim.spin', bad);
    assert.equal(S.load(st), 'back', bad);
  }
});

test('save / load round-trip under biobuzz-shot-sim.spin; invalid values are stored as back', () => {
  const st = mem();
  S.save('top', st);
  assert.equal(st.raw['biobuzz-shot-sim.spin'], '"top"');
  assert.equal(S.load(st), 'top');
  S.save('bogus', st);
  assert.equal(S.load(st), 'back');
  assert.doesNotThrow(() => S.save('top', { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } }));
});

test('toParams: only top maps to top', () => {
  assert.equal(S.toParams('top'), 'top');
  for (const v of ['back', 'TOP', '', null, undefined, 1]) assert.equal(S.toParams(v), 'back');
});

// ---- browser path: run ui-spin.js in a vm sandbox with a minimal DOM
function fakeEl(tag) {
  const e = { tag, attrs: {}, kids: [], hidden: false, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.kids.push(c); return c; }, replaceChildren(...c) { this.kids = c; },
    addEventListener(t, f) { this.listeners[t] = f; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; },
    querySelectorAll() { return flat(this).filter((x) => x.tag === 'button'); } };
  return e;
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);

function browser(stored, shooterType) {
  const host = fakeEl('div'), st = mem();
  if (stored) st.setItem('biobuzz-shot-sim.spin', stored);
  const win = { localStorage: st };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: { createElement: fakeEl, getElementById: (id) => (id === 'spinHost' ? host : null) } });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'spin');
  let recalcs = 0;
  hook.onStart({ state: { shooter: { type: shooterType || 'single' } }, recalc: () => { recalcs++; } });
  return { win, hook, host, st, recalcs: () => recalcs };
}

test('hook: registered on ShotUI.hooks, extendParams sets p.shooter.spin from the stored value', () => {
  const b = browser('"top"');
  assert.equal(typeof b.win.ShotUI.spin.mount, 'function');
  assert.equal(b.hook.configSlice.key, 'spin');
  assert.equal(b.hook.configSlice.get(), 'top');
  const p = { shooter: { type: 'single' } };
  assert.equal(b.hook.extendParams(p, {}), p);
  assert.equal(p.shooter.spin, 'top');
  assert.equal(browser().hook.extendParams({ shooter: {} }, {}).shooter.spin, 'back');
});

test('mount: label text, clicking Topspin saves, flips aria-pressed and calls recalc; configSlice.set round-trips', () => {
  const b = browser();
  const wrap = b.host.kids[0], btns = flat(wrap).filter((x) => x.tag === 'button');
  assert.equal(flat(wrap).find((x) => x.attrs.id === 'spin-l').textContent, 'Spin: Backspin (wheel below) / Topspin (wheel above)');
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['true', 'false']);
  const seg = flat(wrap).find((x) => x.attrs.role === 'group');
  seg.listeners.click({ target: { closest: () => btns[1] } });
  assert.equal(b.st.raw['biobuzz-shot-sim.spin'], '"top"');
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['false', 'true']);
  assert.equal(b.recalcs(), 1);
  assert.equal(b.hook.extendParams({ shooter: {} }, {}).shooter.spin, 'top');
  b.hook.configSlice.set('back');
  assert.equal(b.hook.configSlice.get(), 'back');
  assert.deepEqual(btns.map((x) => x.attrs['aria-pressed']), ['true', 'false']);
});

test('hidden for a dual-wheel shooter (at start and on change), visible again for single', () => {
  const b = browser(null, 'dual'), wrap = b.host.kids[0];
  assert.equal(wrap.hidden, true);
  b.hook.onChange({ shooter: { type: 'single' } });
  assert.equal(wrap.hidden, false);
  b.hook.onChange({ shooter: { type: 'dual' } });
  assert.equal(wrap.hidden, true);
});
