// L2: ui-flywheel model (parse / norm / setField / extend), the engine effect of the params it builds, and the mounted hook (fake DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url), SRC = path.join(ROOT, 'src', 'ui-flywheel.js');
const U = req(SRC), FC = req(path.join(ROOT, 'src', 'flywheel-custom.js')), MC = req(path.join(ROOT, 'src', 'motor-custom.js'));
const CS = req(path.join(ROOT, 'src', 'config-schema.js'));
const E = loadEngine();
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; };
const ON = { wheel: { on: true, diameterMm: 80, mode: 'inertia', inertiaKgM2: 1e-3 }, motor: { on: true, freeRpm: 5400, stallTorqueNm: 0.3, encoderPPR: 2048 } };

test('parse: decimal comma, thousands comma, exponent, junk', () => {
  assert.equal(U.parse('0,5'), 0.5); assert.equal(U.parse('96.5'), 96.5); assert.equal(U.parse(' 1,234.5 '), 1234.5);
  assert.equal(U.parse('4,5e-4'), 0.00045); assert.equal(U.parse(7), 7);
  for (const bad of ['', 'abc', '1.2.3', '--1', null, undefined]) assert.ok(Number.isNaN(U.parse(bad)), String(bad));
});

test('norm: defaults off; bad or out-of-range fields fall back per field; booleans must be true', () => {
  const d = U.norm(null);
  assert.equal(d.wheel.on, false); assert.equal(d.motor.on, false); assert.equal(d.wheel.diameterMm, 96); assert.equal(d.motor.encoderPPR, 28);
  const n = U.norm({ wheel: { on: 'yes', diameterMm: 1e6, mode: 'mass', massKg: 0.2, shape: 'rim' }, motor: { on: true, freeRpm: -3, stallTorqueNm: 0.5 } });
  assert.equal(n.wheel.on, false); assert.equal(n.wheel.diameterMm, 96); assert.equal(n.wheel.mode, 'mass'); assert.equal(n.wheel.massKg, 0.2); assert.equal(n.wheel.shape, 'rim');
  assert.equal(n.motor.on, true); assert.equal(n.motor.freeRpm, 6000); assert.equal(n.motor.stallTorqueNm, 0.5);
  assert.deepEqual(U.norm(U.norm(ON)), U.norm(ON));
});

test('setField: converts display units (g -> kg), rejects out-of-range, keeps the model on error', () => {
  let r = U.setField(U.norm(null), 'fcMass', '152,5');
  assert.ok(r.ok); assert.equal(r.value.wheel.massKg, 0.1525);
  r = U.setField(U.norm(null), 'fcDiameter', '3');
  assert.ok(!r.ok && /Wheel diameter/.test(r.error)); assert.equal(r.value.wheel.diameterMm, 96);
  assert.ok(!U.setField(U.norm(null), 'fcStall', '0').ok);
  assert.ok(!U.setField(U.norm(null), 'fcFree', 'fast').ok);
  assert.ok(!U.setField(U.norm(null), 'nope', '1').ok);
});

test('load / save: round trip under biobuzz-shot-sim.flywheelCustom; corrupt or missing storage gives the default', () => {
  const st = mem();
  U.save(ON, st);
  assert.ok('biobuzz-shot-sim.flywheelCustom' in st.raw);
  assert.deepEqual(U.load(st), U.norm(ON));
  for (const bad of ['{x', '5', 'null']) { const s = mem(); s.setItem(U.KEY, bad); assert.deepEqual(U.load(s), U.norm(null)); }
  assert.deepEqual(U.load(null), U.norm(null));
  assert.doesNotThrow(() => U.save(ON, { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } }));
});

test('extend: everything off returns the same params object; wheel and motor overrides land in params', () => {
  const p = { ...BASE };
  assert.equal(U.extend(p, U.norm(null)), p);
  const q = U.extend(p, U.norm(ON));
  assert.equal(q.shooter.wheelDiameterMm, 80); assert.equal(q.shooter.inertiaKgM2, 1e-3);
  assert.equal(q.motorId, 'custom'); assert.deepEqual(q.customMotor, { freeRpm: 5400, stallTorqueNm: 0.3, encoderPPR: 2048 });
  assert.equal(p.motorId, 'yj6000');
  const calls = []; U.extend(p, U.norm(ON), (c) => calls.push(c)); U.extend(p, U.norm(null), (c) => calls.push(c));
  assert.deepEqual(calls, [{ freeRpm: 5400, stallTorqueNm: 0.3, encoderPPR: 2048 }, null]);
  const motorOnly = U.extend(p, U.norm({ motor: { on: true } }));
  assert.equal(motorOnly.shooter, p.shooter); assert.equal(motorOnly.customMotor.encoderPPR, 28);
});

test('engine effect: custom inertia changes the dip per shot, not the wheel rpm; custom motor changes the headroom', () => {
  const base = E.evaluate(BASE, 'full').motor;
  const wheel = E.evaluate(U.extend({ ...BASE }, U.norm({ wheel: { on: true, diameterMm: 96, mode: 'inertia', inertiaKgM2: 1e-3 } })), 'full').motor;
  assert.equal(wheel.wheelRpm, base.wheelRpm); assert.ok(wheel.dip < base.dip);
  const motor = E.evaluate(U.extend({ ...BASE }, U.norm({ motor: { on: true, freeRpm: 12000, stallTorqueNm: 0.1442 } })), 'full').motor;
  assert.equal(motor.motorId, 'custom'); assert.ok(motor.headroom < base.headroom * 0.6);
});

test('config: the slice survives ConfigV1 normalize (cfg.ext.flywheelCustom)', () => {
  const data = loadData(), cfg = CS.defaults(data);
  cfg.ext = { flywheelCustom: U.norm(ON) };
  const r = CS.normalize(JSON.parse(JSON.stringify(cfg)), data);
  assert.deepEqual(U.norm(r.cfg.ext.flywheelCustom), U.norm(ON));
});

// ---- browser path: run ui-flywheel.js in a vm sandbox with a minimal DOM
function fakeEl(tag) {
  const e = { tag, attrs: {}, kids: [], hidden: false, listeners: {}, value: '', checked: false, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.kids.push(c); return c; }, replaceChildren(...c) { this.kids = c; c.forEach((x) => { x.parentNode = this; }); },
    addEventListener(t, f) { this.listeners[t] = f; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; },
    querySelectorAll() { return flat(this).filter((x) => x.tag === 'button'); } };
  return e;
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);
function browser(stored) {
  const host = fakeEl('div'), st = mem();
  if (stored) st.setItem(U.KEY, JSON.stringify(stored));
  const installed = [];
  const win = { localStorage: st, ShotFlywheelCustom: FC, ShotMotorCustom: MC, ShotEngine: { _internal: { ext: () => ({ install: (c) => installed.push(c) }) } } };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: { createElement: fakeEl, getElementById: (id) => (id === 'flywheelHost' ? host : null), activeElement: null } });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'flywheel');
  let recalcs = 0;
  hook.onStart({ recalc: () => { recalcs++; } });
  const by = (id) => flat(host).find((x) => x.attrs.id === id);
  return { win, hook, host, st, installed, by, recalcs: () => recalcs };
}

test('hook: stored settings are applied; note text is shown; slice key is flywheelCustom', () => {
  const b = browser(ON);
  assert.equal(b.hook.configSlice.key, 'flywheelCustom');
  assert.ok(flat(b.host).some((x) => x.textContent === U.NOTE));
  assert.match(U.NOTE, /After η calibration, wheel diameter no longer affects rpm; inertia affects burst recovery and the speed dip per shot/);
  const q = b.hook.extendParams({ ...BASE }, {});
  assert.equal(q.shooter.wheelDiameterMm, 80); assert.equal(q.motorId, 'custom');
  assert.deepEqual(b.installed.at(-1), { freeRpm: 5400, stallTorqueNm: 0.3, encoderPPR: 2048 });
  assert.equal(b.by('fcDiameter').value, '80'); assert.equal(b.by('fcInertia').value, '1e-3'); assert.equal(b.by('fcPpr').value, '2048');
});

test('hook: toggles show / hide the sections, save, recalc; typing validates (comma ok, junk reverts with a message)', () => {
  const b = browser();
  const wOn = b.by('fcWheelOn'), mOn = b.by('fcMotorOn'), dia = b.by('fcDiameter');
  assert.equal(b.hook.extendParams({ ...BASE }, {}).motorId, 'yj6000');
  assert.equal(dia.parentNode.parentNode.hidden, true);
  wOn.checked = true; wOn.listeners.change.call(wOn);
  assert.equal(dia.parentNode.parentNode.hidden, false); assert.equal(b.recalcs(), 1);
  dia.value = '88,5'; dia.listeners.change.call(dia);
  assert.equal(b.hook.extendParams({ ...BASE }, {}).shooter.wheelDiameterMm, 88.5); assert.equal(b.recalcs(), 2);
  dia.value = '5'; dia.listeners.change.call(dia);
  assert.equal(dia.value, '88.5'); assert.equal(dia.attrs['aria-invalid'], 'true'); assert.equal(b.recalcs(), 2);
  assert.match(flat(b.host).find((x) => x.attrs.role === 'status').textContent, /Wheel diameter/);
  mOn.checked = true; mOn.listeners.change.call(mOn);
  assert.equal(b.hook.extendParams({ ...BASE }, {}).customMotor.freeRpm, 6000);
  mOn.checked = false; mOn.listeners.change.call(mOn);
  assert.equal(b.hook.extendParams({ ...BASE }, {}).motorId, 'yj6000'); assert.equal(b.installed.at(-1), null);
  assert.equal(JSON.parse(b.st.raw[U.KEY]).wheel.diameterMm, 88.5);
});

test('hook: mass + shape mode computes the inertia; configSlice get / set round-trip', () => {
  const b = browser({ wheel: { on: true, diameterMm: 100, mode: 'mass', massKg: 0.2, shape: 'rim' } });
  assert.equal(b.hook.extendParams({ ...BASE }, {}).shooter.inertiaKgM2, 0.2 * 0.05 ** 2);
  assert.equal(b.by('fcComputed').textContent, 'Inertia = 5e-4 kg·m²');
  b.hook.configSlice.set(U.norm(ON));
  assert.equal(JSON.stringify(b.hook.configSlice.get()), JSON.stringify(U.norm(ON))); assert.equal(b.by('fcDiameter').value, '80');   // JSON: objects from another vm realm
  b.hook.configSlice.set({ wheel: { on: true, diameterMm: 'junk' } });
  assert.equal(b.hook.configSlice.get().wheel.diameterMm, 96);
});

// ---- F3: overrides shown on the rest of the page
test('F3 overrides / withNote: pure helpers; the caption note is added once and removed again', () => {
  const o = U.overrides(U.norm(ON));
  assert.equal(o.motor, true); assert.equal(o.wheel, true); assert.equal(o.inertiaText, '1e-3'); assert.equal(o.wheelLabel, 'custom wheel (80 mm)');
  assert.deepEqual([U.overrides(U.norm(null)).motor, U.overrides(U.norm(null)).wheel], [false, false]);
  assert.equal(U.overrides(U.norm({ wheel: { on: true, diameterMm: 80, inertiaKgM2: 1e-3 }, motor: { on: true, freeRpm: 5400 } })).motor, true);
  const t = U.withNote('Click a row to use that motor.', true);
  assert.equal(t, 'Click a row to use that motor. (overridden by Custom motor)'); assert.equal(U.withNote(t, true), t); assert.equal(U.withNote(t, false), 'Click a row to use that motor.');
});

test('F3 hook: custom motor disables #motor and annotates the motors caption; custom wheel replaces the inertia hint and the Show-the-math wheel label', () => {
  const host = fakeEl('div'), st = mem(), page = { flywheelHost: host, motor: fakeEl('select'), motorsCaption: fakeEl('p'), inertiaHelp: fakeEl('p'), mathSub: fakeEl('p') };
  page.motorsCaption.textContent = 'Same wheel. Click a row to use that motor.';
  page.inertiaHelp.textContent = 'Flywheel inertia per shaft: 4.17e-4 kg·m² (x).'; page.mathSub.textContent = 'x · Wheel A · fixed power at 12 V.';
  const win = { localStorage: st, ShotFlywheelCustom: FC, ShotMotorCustom: MC, ShotEngine: { _internal: { ext: () => ({ install() {} }) } } };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: { createElement: fakeEl, getElementById: (id) => page[id] || null, activeElement: null } });
  const hook = win.ShotUI.hooks.find((h) => h.name === 'flywheel'), data = { shooter: { wheels: [{ id: 'a', label: 'Wheel A' }] } };
  hook.onStart({ recalc() {}, data, state: { shooter: { wheelId: 'a' } } });
  assert.equal(!!page.motor.disabled, false); assert.ok(!/overridden/.test(page.motorsCaption.textContent));
  hook.configSlice.set(ON);
  assert.equal(page.motor.disabled, true); assert.equal(page.motorsCaption.textContent, 'Same wheel. Click a row to use that motor. (overridden by Custom motor)');
  hook.onResult({}, {}, 'full');   // app.js rewrote the caption in the meantime: re-annotated, once
  page.motorsCaption.textContent = 'Fresh text.'; hook.onResult({}, {}, 'full'); hook.onChange({});
  assert.equal(page.motorsCaption.textContent, 'Fresh text. (overridden by Custom motor)');
  assert.match(page.inertiaHelp.textContent, /Flywheel inertia per shaft: 1e-3 kg·m² \(custom wheel/);
  hook.onMathRender(fakeEl('div'), {}, { shooter: { wheelDiameterMm: 80, inertiaKgM2: 1e-3 } });
  assert.equal(page.mathSub.textContent, 'x · custom wheel (80 mm) · fixed power at 12 V.');
  hook.configSlice.set(null);
  assert.equal(page.motor.disabled, false); assert.equal(page.motorsCaption.textContent, 'Fresh text.');
});
