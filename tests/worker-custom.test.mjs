// L3: the custom wheel / motor reach the worker through params. The REAL worker source (engine files + worker.js + worker extras, as tools/build.mjs
// builds it) runs in a vm; the file lists are read from build.mjs so a missing wiring entry fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadData, BASE, ROOT } from './load-data.mjs';

const BUILD = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
const list = (name) => JSON.parse(BUILD.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
const ENGINE_FILES = list('ENGINE_FILES'), WORKER_EXT = list('WORKER_EXT'), UI_FILES = list('UI_FILES');
const src = (files) => files.map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot() {
  const out = [], self = Object.assign(new EventTarget(), { postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) });
  vm.runInNewContext(src(ENGINE_FILES) + '\n' + fs.readFileSync(path.join(ROOT, 'src', 'worker.js'), 'utf8') + '\n' + src(WORKER_EXT), { self, setTimeout, importScripts: () => {} });
  self.onmessage({ data: { type: 'init', data: loadData() } });
  return { out, send: (m) => self.onmessage({ data: m }), post: (data) => self.dispatchEvent(new MessageEvent('message', { data })) };
}
const YJ = loadData().motors.motors.find((m) => m.id === 'yj6000');
const CM = { freeRpm: YJ.freeRpm, stallTorqueNm: YJ.stallTorqueNm, encoderPPR: YJ.encoderPPR };
const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.timings; delete c.motor.motorId; delete c.motor.label; return c; };

test('wiring: motor-custom.js is an engine file after engine.js; flywheel-custom.js before ui-flywheel.js before config-schema.js (order rule)', () => {
  assert.equal(ENGINE_FILES.indexOf('motor-custom.js'), 1);
  const f = UI_FILES.indexOf('flywheel-custom.js'), u = UI_FILES.indexOf('ui-flywheel.js'), c = UI_FILES.indexOf('config-schema.js');
  assert.ok(f >= 0 && f < u && u < c, `${f} ${u} ${c}`);
  assert.ok(UI_FILES.indexOf('ui-config.js') === UI_FILES.length - 1);
});

test('worker evaluate: custom motor with yj6000 numbers equals yj6000; a custom wheel (diameter + inertia) is used; motors table unchanged', async () => {
  const w = boot();
  w.send({ type: 'evaluate', id: 1, mode: 'full', params: BASE });
  w.send({ type: 'evaluate', id: 2, mode: 'full', params: { ...BASE, motorId: 'custom', customMotor: CM } });
  w.send({ type: 'evaluate', id: 3, mode: 'full', params: { ...BASE, shooter: { ...BASE.shooter, wheelDiameterMm: 72, inertiaKgM2: 1e-3 } } });
  w.send({ type: 'motors', id: 4, params: { ...BASE, motorId: 'custom', customMotor: CM } });
  w.send({ type: 'motors', id: 5, params: BASE });
  const by = (id) => w.out.find((m) => m.id === id);
  assert.equal(by(2).result.motor.motorId, 'custom');
  assert.deepEqual(strip(by(2).result), strip(by(1).result));
  assert.equal(by(3).result.motor.details.inertiaKgM2, 1e-3);
  assert.ok(by(3).result.motor.motorRpm > by(1).result.motor.motorRpm);
  assert.equal(by(4).rows.length, loadData().motors.motors.length);
  assert.deepEqual(by(4).rows, by(5).rows);
  assert.equal(w.out.filter((m) => m.type === 'error').length, 0);
});

test('worker export sweep with a custom motor: rows follow the custom numbers (and equal yj6000 for the same numbers)', async () => {
  const sweep = async (params) => {
    const w = boot(), id = 'e' + Math.random();
    w.post({ type: 'exportSweep', id, params, settings: { stepIn: 24 } });
    for (let t = 0; t < 400 && !w.out.some((m) => m.type === 'exportDone'); t++) await sleep(25);
    assert.ok(w.out.some((m) => m.type === 'exportDone'), JSON.stringify(w.out.slice(-2)));
    return w.out.filter((m) => m.type === 'exportRow').map((m) => m.row);
  };
  const P = { ...BASE, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } };
  const a = await sweep(P), b = await sweep({ ...P, motorId: 'custom', customMotor: CM }), c = await sweep({ ...P, motorId: 'custom', customMotor: { ...CM, freeRpm: 1500 } });
  assert.ok(a.length >= 3);
  assert.deepEqual(b, a);
  assert.notDeepEqual(c, a);
});
