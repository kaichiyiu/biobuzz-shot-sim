// F5: the tolerance panel reacts to `input` (typing) after a short pause, without rewriting the field being typed in; `change` still applies at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const PN = createRequire(import.meta.url)('../src/ui-tolerance-panel.js');
function el(tag) {
  return { tag, attrs: {}, kids: [], listeners: {}, value: '', textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.kids.push(c); return c; }, replaceChildren(...c) { this.kids = c; }, addEventListener(t, f) { this.listeners[t] = f; } };
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);
globalThis.document = { createElement: el };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mount() {
  const host = el('div'), seen = [], model = { yawDeg: 0, angleDeg: 0, rpm: 0, posIn: 0, source: 'measured' };
  const u = { toLen: (x) => x, lenUnit: () => 'in' };
  const p = PN.mount(host, { get: () => model, units: u, onField(k, t) { seen.push([k, t]); model[k] = Number(t) || 0; p.sync(); }, onPreset() {}, onCalib() {}, onClear() {} });
  return { seen, y: flat(host).find((x) => x.attrs.id === 'tolYaw') };
}

test('input events: one update after the pause, the field being typed in is not rewritten; change then adds no second update', async () => {
  const { seen, y } = mount();
  y.value = '1'; y.listeners.input(); y.value = '1.'; y.listeners.input(); y.value = '1.5'; y.listeners.input();   // three keystrokes, one update
  assert.equal(seen.length, 0); await wait(350);
  assert.deepEqual(seen, [['yawDeg', '1.5']]);
  y.value = '1.50'; y.listeners.input(); await wait(350);
  assert.equal(seen.length, 2); assert.equal(y.value, '1.50', 'the field being typed in is left alone');
  y.listeners.change(); assert.equal(seen.length, 2); assert.equal(y.value, '1.5');   // blur: already applied, only the display is normalised
});

test('change before the pause applies at once and cancels the timer; change alone still works as before', async () => {
  const { seen, y } = mount();
  y.value = '2'; y.listeners.input(); y.listeners.change(); await wait(350);
  assert.deepEqual(seen, [['yawDeg', '2']]);
  y.value = '3'; y.listeners.change(); assert.deepEqual(seen[1], ['yawDeg', '3']);
});
