// I6: tolerance model (norm / presets / params / calibration spread), result text (describe) on real engine results, and the hook + panel on a tiny fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const T = req(path.join(ROOT, 'src', 'ui-tolerance.js')), PN = req(path.join(ROOT, 'src', 'ui-tolerance-panel.js')), U = req(path.join(ROOT, 'src', 'units.js'));
const E = loadEngine(), D = loadData(), PREC = D.shooter.precision;
const J = (v) => JSON.parse(JSON.stringify(v));
const HOOD = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const TOL = { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2 };
const run = (tol, extra) => E.evaluate({ ...BASE, hood: HOOD, ...(tol ? { tolerance: { ...tol } } : {}), ...extra }, 'full');

test('norm: junk / negative / NaN -> 0, source passes only preset; isActive needs one positive value', () => {
  assert.deepEqual(T.norm(null), { yawDeg: 0, angleDeg: 0, rpm: 0, posIn: 0, source: 'measured' });
  assert.deepEqual(T.norm({ yawDeg: -1, angleDeg: 'x', rpm: NaN, posIn: Infinity, source: 'zzz' }), T.norm(null));
  assert.equal(T.norm({ source: 'preset' }).source, 'preset');
  assert.equal(T.isActive(T.norm(null)), false); assert.equal(T.isActive({ rpm: 1 }), true);
  assert.equal(T.toParams(T.norm(null)), null);
  assert.deepEqual(T.toParams({ yawDeg: 1, rpm: 30 }), { yawDeg: 1, angleDeg: 0, rpm: 30, posIn: 0, source: 'measured', best: true });
});

test('presets: 2 sigma of data.shooter.precision (angle, yaw), 2 sigShooter x motor rpm, position 1 in, source preset; unknown rpm keeps the old value', () => {
  const typ = T.presetFor(PREC.typical, 2192.7, null);
  assert.deepEqual(typ, { yawDeg: 2, angleDeg: 2, rpm: Math.round(2 * 0.015 * 2192.7), posIn: 1, source: 'preset' });
  assert.deepEqual(T.presetFor(PREC.dialed, 2000, null), { yawDeg: 1, angleDeg: 1, rpm: 40, posIn: 1, source: 'preset' });
  assert.equal(T.presetFor(PREC.rough, 2000, null).rpm, 120); assert.equal(T.presetFor(PREC.rough, 2000, null).yawDeg, 4);
  assert.equal(T.presetFor(PREC.typical, 0, { rpm: 77 }).rpm, 77);
  assert.deepEqual(T.presetFor(undefined, 2000, { yawDeg: 3 }), T.norm({ yawDeg: 3 }));
});

test('calibSpread reads fit.spreadRpm (a 90 % half-width); no calibration / zero / junk -> null; parseField', () => {
  assert.equal(T.calibSpread({ fit: { spreadRpm: 41.26 } }), 41.3);
  for (const r of [null, {}, { fit: {} }, { fit: { spreadRpm: 0 } }, { fit: { spreadRpm: NaN } }]) assert.equal(T.calibSpread(r), null);
  U.setSystem('metric');
  assert.equal(T.parseField('posIn', '5.08', U), 2); assert.equal(T.parseField('rpm', ' ', U), 0); assert.ok(Number.isNaN(T.parseField('yawDeg', 'abc', U)));
  assert.equal(T.parseField('yawDeg', '1.5', U), 1.5);
  U.setSystem('imperial');
});

test('describe: margin text, limiter in words, per-axis, position, best setpoint (real BASE result)', () => {
  const t = run({ yawDeg: 2, angleDeg: 2, rpm: 100, posIn: 2 }).tolerance, d = PN.describe(t, U);
  assert.equal(d.head, '0.4×'); assert.equal(d.preview, false);
  assert.match(d.limit, /^Limited by launch angle, low side\./);
  assert.match(d.axes, /^Each error alone: launch angle 0\.9× · motor speed 0\.5× · aim \(yaw\) 1\.1×$/);
  assert.match(d.position, /^Position you can tolerate: ±1\.2 in sideways, −3\.3 in \/ \+8\.3 in along the line$/);
  assert.match(d.best, /^For your accuracy the most forgiving shot is 70\.0°, [\d,]+ rpm, yaw offset \+3\.0° — margin 0\.5×$/);
  const ok = run(TOL).tolerance, d2 = PN.describe(ok, U);
  assert.match(d2.head, /^\d\.\d×$/);
  assert.equal(PN.describe(null, U).head, '');
});

test('describe: capped, lowerBound, unreachable, headroom cap, coarse preview, best == current aim', () => {
  const base = { margin: 4, capped: true, sMax: 4, limitingAxis: null, perAxis: { yaw: 4, angle: Infinity, rpm: 4 }, tolerance: { yawDeg: 1, angleDeg: 1, rpm: 0 }, position: null, verdict: 'POSSIBLE', cappedBy: null, mode: 'coarse' };
  let d = PN.describe(base, U);
  assert.equal(d.head, '≥ 4×'); assert.equal(d.preview, true); assert.match(d.limit, /Nothing limits it within 4×/);
  assert.equal(d.axes, 'Each error alone: launch angle ≥ 4× · aim (yaw) ≥ 4×');   // rpm tolerance is 0: not listed
  d = PN.describe({ ...base, capped: false, margin: 1.8, lowerBound: true, limitingAxis: 'along', limitingSide: 1, mode: 'full' }, U);
  assert.equal(d.head, '≥ 1.8×'); assert.match(d.limit, /position along the shot line, away from the target\..*At least this much/);
  d = PN.describe({ ...base, margin: null, capped: false, verdict: "WON'T WORK", cappedBy: 'unreachable' }, U);
  assert.equal(d.head, "WON'T WORK"); assert.match(d.notes[0], /cannot produce this shot/);
  d = PN.describe({ ...base, capped: false, margin: 2, verdict: 'NOT CONSISTENT', cappedBy: 'headroom' }, U, { downgrade: 0.92 });
  assert.match(d.notes[0], /more than 92 % of its usable free speed/);
  d = PN.describe({ ...base, capped: false, margin: 1.5, bestSetpoint: { thetaDeg: 60, motorRpm: 2000, yawOffsetDeg: -2, margin: 1.5 } }, U);
  assert.match(d.best, /already the most forgiving/);
  d = PN.describe({ ...base, capped: false, margin: 1.2, bestSetpoint: { thetaDeg: 60, motorRpm: 2000.4, yawOffsetDeg: -2, margin: 1.4, viewLimited: true } }, U);
  assert.equal(d.best, 'For your accuracy the most forgiving shot is 60.0°, 2,000 rpm, yaw offset -2.0° — margin ≥ 1.4× (within the analysed range)');
  assert.equal(PN.fmtMargin(0.996), '1.00'); assert.equal(PN.fmtMargin(0.74), '0.7'); assert.equal(PN.fmtMargin(1.04), '1.0');
});

// ---- browser path: both files in one vm sandbox with a tiny DOM
function fakeEl(tag) {
  const cls = new Set();
  const e = { tag, attrs: {}, kids: [], hidden: false, listeners: {}, value: '', parentNode: null,
    classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }, has: (c) => cls.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.kids.push(c); return c; }, replaceChildren(...c) { this.kids = c; },
    addEventListener(t, f) { this.listeners[t] = f; },
    set textContent(v) { this._t = v; this.kids = []; }, get textContent() { return this._t; }, set id(v) { this.attrs.id = v; }, get id() { return this.attrs.id; } };
  return e;
}
const flat = (e) => e.kids.flatMap((k) => [k, ...flat(k)]);
const byId = (root, id) => flat(root).find((x) => x.attrs.id === id);

function browser(extraUI) {
  const host = fakeEl('div'), motorsHead = fakeEl('div'), cap = fakeEl('p'), body = fakeEl('body');
  motorsHead.appendChild(cap);
  const els = { toleranceHost: host, motorsCaption: cap };
  const win = { ShotUI: { ...(extraUI || {}) } }, ctx = { recalcs: 0 };
  const sb = { window: win, document: { createElement: fakeEl, getElementById: (id) => els[id] || null, body } };
  for (const f of ['ui-tolerance-panel.js', 'ui-tolerance.js']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sb);
  const hook = win.ShotUI.hooks.find((h) => h.name === 'tolerance');
  hook.onStart({ units: U, data: D, engine: E, recalc() { ctx.recalcs++; }, state: {} });
  const wrap = host.kids[0];
  return { win, hook, host, cap, body, ctx, wrap, input: (id) => byId(wrap, id), btn: (sel) => flat(wrap).find((x) => x.attrs['data-preset'] === sel || x.attrs.id === sel),
    type(id, text) { const i = byId(wrap, id); i.value = text; i.listeners.change(); } };
}

test('hook: default = no tolerance (extendParams leaves p alone, slice null, no body class, note hidden); registered with configSlice tolerance', () => {
  const b = browser();
  assert.equal(b.hook.configSlice.key, 'tolerance'); assert.equal(b.hook.configSlice.get(), null);
  const p = { a: 1 }; assert.equal(b.hook.extendParams(p, {}), p); assert.ok(!('tolerance' in p));
  assert.equal(b.body.classList.has('has-tolerance'), false);
  const note = b.cap.parentNode.kids[1];
  assert.equal(note.attrs.id, 'tolMotorsNote'); assert.equal(note.hidden, true);
  assert.deepEqual(flat(b.wrap).filter((x) => x.tag === 'input').map((x) => x.attrs.id), ['tolYaw', 'tolAngle', 'tolRpm', 'tolPos']);
  assert.equal(b.wrap.attrs['aria-live'], 'off');
});

test('typing a tolerance: recalc, params.tolerance (best:true, measured), body class, motors note, slice; position parsed in display units', () => {
  const b = browser();
  b.type('tolYaw', '1'); b.type('tolAngle', '1'); b.type('tolRpm', '50'); b.type('tolPos', '2');
  assert.equal(b.ctx.recalcs, 4);
  const p = b.hook.extendParams({}, {});
  assert.deepEqual(J(p.tolerance), { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2, source: 'measured', best: true });
  assert.equal(b.body.classList.has('has-tolerance'), true);
  const note = b.cap.parentNode.kids[1];
  assert.equal(note.hidden, false); assert.equal(note.textContent, 'Verdicts in this table use the old hit-rate model.');
  assert.deepEqual(J(b.hook.configSlice.get()), { yawDeg: 1, angleDeg: 1, rpm: 50, posIn: 2, source: 'measured' });
  b.type('tolYaw', 'abc'); assert.equal(b.input('tolYaw').value, '1'); assert.equal(b.ctx.recalcs, 4);   // junk keeps the old value, no recalc
  b.type('tolYaw', ''); assert.equal(b.hook.extendParams({}, {}).tolerance.yawDeg, 0);
  U.setSystem('metric'); b.type('tolPos', '5.08'); assert.equal(b.hook.extendParams({}, {}).tolerance.posIn, 2);
  b.hook.onChange({}); assert.equal(b.input('tolPos').value, '5.08'); U.setSystem('imperial');
});

test('Clear removes the tolerance (slice null, no body class, no params key); a typed value after a preset is source measured', () => {
  const b = browser();
  b.btn('typical').listeners.click(); assert.equal(b.hook.configSlice.get().source, 'preset');
  b.type('tolYaw', '3'); assert.equal(b.hook.configSlice.get().source, 'measured');
  b.btn('tolClear').listeners.click();
  assert.equal(b.hook.configSlice.get(), null); assert.equal(b.body.classList.has('has-tolerance'), false); assert.ok(!('tolerance' in b.hook.extendParams({}, {})));
});

test('presets fill 2 sigma starting values from the last result (motor rpm), source preset, labelled a guess; before any result the rpm is left alone', () => {
  const b = browser();
  b.btn('typical').listeners.click();
  assert.deepEqual(J(b.hook.configSlice.get()), { yawDeg: 2, angleDeg: 2, rpm: 0, posIn: 1, source: 'preset' });
  assert.match(flat(b.wrap).find((x) => x.attrs.role === 'status').textContent, /a guess.*No result yet/);
  b.hook.onResult(run(null), {}, 'full');
  b.btn('rough').listeners.click();
  const r = run(null).motor.motorRpm;
  assert.deepEqual(J(b.hook.configSlice.get()), { yawDeg: 4, angleDeg: 4, rpm: Math.round(2 * 0.03 * r), posIn: 1, source: 'preset' });
  assert.equal(b.input('tolYaw').value, '4'); assert.equal(b.input('tolPos').value, '1'); assert.equal(b.ctx.recalcs, 2);
  assert.ok(flat(b.wrap).some((x) => /guess — measure your robot/.test(x.textContent || '')));
});

test('calibration spread button: fills rpm from the record (calibReport.record or the calibration slice) and says it is a 90 % half-width; none -> message', () => {
  let b = browser({ calibReport: { record: () => ({ calibrated: true, fit: { spreadRpm: 41.26 } }) } });
  b.btn('tolCalib').listeners.click();
  assert.equal(b.hook.configSlice.get().rpm, 41.3); assert.equal(b.input('tolRpm').value, '41.3');
  assert.match(flat(b.wrap).find((x) => x.attrs.role === 'status').textContent, /90 % half-width/);
  assert.match(b.btn('tolCalib').attrs.title, /90 % half-width/);
  b = browser({ calibReport: { record: () => null } });
  b.btn('tolCalib').listeners.click();
  assert.equal(b.hook.configSlice.get(), null); assert.match(flat(b.wrap).find((x) => x.attrs.role === 'status').textContent, /No calibration yet/);
  b = browser({ hooks: [{ configSlice: { key: 'calibration', get: () => ({ fit: { spreadRpm: 12 } }) } }] });
  b.btn('tolCalib').listeners.click(); assert.equal(b.hook.configSlice.get().rpm, 12);
});

test('configSlice.set restores the values (reload), recalculates and turns the class on; set(junk) leaves it off', () => {
  const b = browser();
  b.hook.configSlice.set({ yawDeg: 1.5, angleDeg: 0, rpm: 80, posIn: 3, source: 'preset' });
  assert.equal(b.ctx.recalcs, 1); assert.equal(b.body.classList.has('has-tolerance'), true);
  assert.equal(b.input('tolYaw').value, '1.5'); assert.equal(b.input('tolAngle').value, ''); assert.equal(b.input('tolRpm').value, '80');
  assert.equal(b.wrap.attrs['data-source'], 'preset');
  b.hook.configSlice.set({ yawDeg: 'x' }); assert.equal(b.body.classList.has('has-tolerance'), false);
});

test('onResult renders the margin block (preview tag on coarse); a result without tolerance clears it', () => {
  const b = browser(), res = flat(b.wrap).find((x) => x.attrs.class === 'tol-res');
  b.hook.onResult(run(TOL), {}, 'full');
  const txt = () => res.kids.map((k) => k.textContent);
  assert.match(txt()[0], /^Margin \d\.\d×$/); assert.ok(txt().some((t) => /^Limited by|^Nothing limits/.test(t)));
  b.hook.onResult(E.evaluate({ ...BASE, hood: HOOD, tolerance: { ...TOL } }, 'coarse'), {}, 'coarse');
  assert.match(txt()[0], /\(preview\)$/);
  b.hook.onResult(run(null), {}, 'full'); assert.equal(res.kids.length, 0);
});
