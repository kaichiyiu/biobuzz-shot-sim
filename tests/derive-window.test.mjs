// O2: window and exit-speed / rpm sections quote the engine result exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), D = require(path.join(ROOT, 'src', 'derive-tex.js')), W = require(path.join(ROOT, 'src', 'derive-window.js'));
const E = loadEngine(), ctx = { E }, ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const P = { ...BASE, hood: ADJ }, run = (p, mode = 'full') => ({ r: E.evaluate(p, mode), p });
const text = (s) => JSON.stringify(s), has = (s, str) => text(s).includes(str);
const rowOf = (s, what) => s.rows.find((x) => x.what === what);

test('window: rows quote best.scoringWindow ranges and the opening exactly; no verdict words, no NaN', () => {
  const { r, p } = run(P), s = W.window(r, p, ctx), sw = r.best.scoringWindow;
  assert.equal(s.id, 'window');
  assert.equal(rowOf(s, 'Angle window').num, `[${D.n(sw.thetaDeg[0], 2)},\\ ${D.n(sw.thetaDeg[1], 2)}]^\\circ`);
  assert.equal(rowOf(s, 'Yaw window').num, `[${D.n(sw.yawDeg[0], 2)},\\ ${D.n(sw.yawDeg[1], 2)}]^\\circ`);
  assert.equal(rowOf(s, 'Speed window').num, `[${D.n(sw.v[0], 3)},\\ ${D.n(sw.v[1], 3)}]\\,\\text{m/s}`);
  assert.ok(rowOf(s, 'Speed window').res.startsWith(`${D.n(sw.v[0], 3)}–${D.n(sw.v[1], 3)} m/s`));
  const op = rowOf(s, 'Scoring cell: mouth opening'), rad = E.ballProps(P.ballId).rIn;
  assert.ok(op.num.includes(D.n(sw.opening.widthIn / 2, 2)) && op.num.includes(D.n(rad, 2)) && op.res.includes(D.n(sw.opening.heightIn, 2)));
  assert.doesNotMatch(text(s), /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined/i);
});

test('entry rule: descending adds kept / dropped rows, any omits them, maxSpeed names the limit', () => {
  const any = W.window(...Object.values(run(P)), ctx), a = run({ ...P, entry: { rule: 'descending' } }), desc = W.window(a.r, a.p, ctx);
  assert.equal(any.rows.some((x) => /^Entry/.test(x.what)), false);
  const er = rowOf(desc, 'Entry rule: descending entry only');
  assert.ok(er.num === `\\text{kept}\\ ${a.r.entry.kept}\\ \\text{of}\\ ${a.r.entry.kept + a.r.entry.dropped}` && er.res.includes(`${a.r.entry.dropped} dropped`));
  assert.ok(rowOf(desc, 'Entry of the aim cell').num.includes(D.n(a.r.entry.best.angleDeg, 1)));
  const m = run({ ...P, entry: { rule: 'maxSpeed', maxSpeedMps: 4 } }), ms = W.window(m.r, m.p, ctx);
  assert.ok(ms.rows.some((x) => /entry speed limit/.test(x.what) && x.num.includes('4.00')));
});

test('eta: exit factor, wheel speed, kappa and the rpm window equal the engine numbers', () => {
  const { r, p } = run(P), s = W.eta(r, p, ctx), d = r.motor.details, rw = r.hood.rpmWindow;
  assert.equal(rowOf(s, 'Exit-speed factor').res, D.n(d.exitFactor, 4));
  assert.equal(rowOf(s, 'Wheel speed for the exit speed').res, `${D.n(r.motor.wheelRpm, 1)} rpm`);
  const kap = 60 / (d.exitFactor * Math.PI * d.wheelDiameterM * d.gear);
  assert.equal(rowOf(s, 'Rpm per m/s').res, `${D.n(kap, 1)} rpm per m/s`);
  assert.equal(rowOf(s, 'Rpm window').res, `${D.n(rw.motorRpm[0], 1)}–${D.n(rw.motorRpm[1], 1)} rpm`);
  assert.equal(rowOf(s, 'Window width').res, `${D.n(rw.widthPct, 2)} % = ${D.n(rw.widthRpm, 1)} rpm`);
  assert.ok(Math.abs(kap * rw.vExit[0] - rw.motorRpm[0]) < 1e-6);
  assert.equal(rowOf(s, 'Share of the usable free speed').res, `${D.n(100 * r.motor.motorRpm / r.motor.usableFreeRpm, 1)} %`);
});

test('eta: dual wheels show eta_dual (1 + k) / 2; without a hood the scoring window supplies the rpm window', () => {
  const dual = { ...BASE, shooter: { ...BASE.shooter, type: 'dual', topRatio: 0.6 } }, { r, p } = run(dual), s = W.eta(r, p, ctx);
  assert.match(rowOf(s, 'Exit-speed factor').tex, /eta_\{dual\}/);
  assert.equal(rowOf(s, 'Exit-speed factor').res, D.n(r.motor.details.exitFactor, 4));
  assert.ok(has(s, 'Dual wheels'));
  const sw = r.best.scoringWindow;
  assert.equal(rowOf(s, 'Rpm window').res, `${D.n(sw.motorRpm[0], 1)}–${D.n(sw.motorRpm[1], 1)} rpm`);
});

test('no aim / no motor -> null; coarse result is labelled a preview grid; user units appended', () => {
  assert.equal(W.window({}, P, ctx), null); assert.equal(W.eta({ best: null }, P, ctx), null); assert.equal(W.window(null, P, ctx), null);
  const c = run(P, 'coarse'), s = W.window(c.r, c.p, ctx);
  assert.match(s.lead, /preview grid/); assert.match(s.lead, /θ 1\.00°/);
  const f = run(P), ft = { speedUnit: () => 'ft/s', toSpeed: (v) => v * 3.28084, lenUnit: () => 'in', toLen: (v) => v };
  assert.match(rowOf(W.window(f.r, f.p, { E, units: ft }), 'Speed window').res, /ft\/s/);
});
