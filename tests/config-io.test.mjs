// D2: config I/O - JSON and hash round trips, corrupt input, storage failures, read-only legacy import, precedence.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadData } from './load-data.mjs';

const req = createRequire(import.meta.url);
const S = req(path.join(ROOT, 'src', 'config-schema.js'));
const IO = req(path.join(ROOT, 'src', 'config-io.js'));
const data = loadData();
const mem = (init) => {
  const m = { ...(init || {}) }, log = [];
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { log.push(['set', k]); m[k] = String(v); }, removeItem: (k) => { log.push(['del', k]); delete m[k]; }, raw: m, log };
};
const broken = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
const custom = () => { const c = S.defaults(data); c.field.mouth = { x: 12.5, y: -40.25 }; c.robot.hood = { mode: 'fixed', angleText: '62,5 °', minDeg: 40, maxDeg: 70 }; c.robot.shooter.spin = 'top'; c.entry = { rule: 'maxSpeed', maxSpeedMps: 4.5 }; c.ext = { note: 'Größe ✓ 蜜蜂' }; c.savedAt = '2026-11-11T10:00:00.000Z'; return c; };

test('JSON round trip', () => {
  const c = custom(), r = IO.fromJson(IO.toJson(c), data);
  assert.deepEqual(r.cfg, c); assert.deepEqual(r.warnings, []);
});

test('hash round trip (incl. non-ASCII), prefix #cfg=, url-safe alphabet', () => {
  const c = custom(), h = IO.toHash(c);
  assert.ok(h.startsWith('#cfg=')); assert.match(h.slice(5), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(IO.fromHash(h, data).cfg, c);
  assert.deepEqual(IO.fromHash('#a=1&cfg=' + h.slice(5), data).cfg, c);   // cfg may follow other hash params
  assert.equal(IO.fromHash('#xcfg=' + h.slice(5), data), null);
});

test('hash of the default config is at most 2000 characters', () => {
  assert.ok(IO.toHash(S.defaults(data)).length <= 2000, String(IO.toHash(S.defaults(data)).length));
});

test('corrupt, empty or foreign hashes give null and never throw', () => {
  for (const h of ['', null, undefined, '#', '#cfg=', '#cfg=!!!', '#cfg=abc', '#cfg=a', '#cfg=' + Buffer.from('not json').toString('base64url'),
    '#cfg=' + Buffer.from('[1,2]').toString('base64url'), '#cfg=%E0%A4%A', '#other=1', '#cfg=' + 'A'.repeat(5000), '#cfg=' + Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')]) {
    assert.doesNotThrow(() => IO.fromHash(h, data), String(h));
    assert.equal(IO.fromHash(h, data), null, String(h));
  }
});

test('fromJson: invalid text or non-object gives cfg null with a warning; partial objects are completed', () => {
  assert.equal(IO.fromJson('{oops', data).cfg, null);
  assert.equal(IO.fromJson('[1]', data).cfg, null);
  const r = IO.fromJson('{"v":1,"field":{"h0":10}}', data);
  assert.equal(r.cfg.field.h0, 10); assert.equal(r.cfg.robot.motorId, 'yj6000');
});

test('save / load round trip; a storage that throws gives load null and save false', () => {
  const st = mem(), c = custom();
  assert.equal(IO.load(st, data), null);
  assert.equal(IO.save(c, st), true);
  assert.ok(IO.KEY in st.raw);
  assert.deepEqual(IO.load(st, data), c);
  assert.equal(IO.load(broken, data), null); assert.equal(IO.save(c, broken), false);
  st.raw[IO.KEY] = '{broken'; assert.equal(IO.load(st, data), null);
});

test('importLegacy reads the legacy keys and never writes or deletes', () => {
  const st = mem({
    'biobuzz-shot-sim.units': 'metric', 'biobuzz-shot-sim.origin': 'blue-far',
    'biobuzz-shot-sim.hood': JSON.stringify({ mode: 'fixed', angleText: '58', minDeg: 40, maxDeg: 70 }),
    'biobuzz-shot-sim.spin': '"top"', 'biobuzz-shot-sim.entry': JSON.stringify({ rule: 'descending', maxSpeedMps: 5 })
  });
  const before = JSON.stringify(st.raw), p = IO.importLegacy(st, data);
  assert.deepEqual(p, { display: { units: 'metric', origin: 'blue-far' }, robot: { hood: { mode: 'fixed', angleText: '58', minDeg: 40, maxDeg: 70 }, shooter: { spin: 'top' } }, entry: { rule: 'descending', maxSpeedMps: 5 } });
  assert.deepEqual(st.log, []); assert.equal(JSON.stringify(st.raw), before);
});

test('importLegacy: only what is stored; junk values and failing storage give an empty result', () => {
  assert.deepEqual(IO.importLegacy(mem(), data), {});
  assert.deepEqual(IO.importLegacy(mem({ 'biobuzz-shot-sim.units': 'metric' }), data), { display: { units: 'metric' } });
  assert.deepEqual(IO.importLegacy(mem({ 'biobuzz-shot-sim.units': 'x', 'biobuzz-shot-sim.origin': 'y', 'biobuzz-shot-sim.hood': '{bad', 'biobuzz-shot-sim.spin': '7', 'biobuzz-shot-sim.entry': 'null' }), data), {});
  assert.deepEqual(IO.importLegacy(broken, data), {});
  assert.deepEqual(IO.importLegacy(null, data), {});
});

test('resolve precedence: URL hash > stored v1 > legacy > defaults', () => {
  const legacy = { 'biobuzz-shot-sim.units': 'metric', 'biobuzz-shot-sim.spin': '"top"' };
  const hashCfg = custom(); hashCfg.display.units = 'imperial';
  const storedCfg = S.defaults(data); storedCfg.display.units = 'metric'; storedCfg.field.h0 = 22;
  const st = mem(legacy); IO.save(storedCfg, st);
  const a = IO.resolve(IO.toHash(hashCfg), st, data);
  assert.equal(a.source, 'hash'); assert.equal(a.cfg.display.units, 'imperial');
  const b = IO.resolve('', st, data);
  assert.equal(b.source, 'stored'); assert.equal(b.cfg.field.h0, 22); assert.equal(b.cfg.robot.shooter.spin, 'back');   // legacy spin ignored once v1 exists
  const c = IO.resolve('#cfg=garbage!', mem(legacy), data);
  assert.equal(c.source, 'legacy'); assert.equal(c.cfg.display.units, 'metric'); assert.equal(c.cfg.robot.shooter.spin, 'top'); assert.equal(c.cfg.field.h0, 16);
  const d = IO.resolve('', mem(), data);
  assert.equal(d.source, 'defaults'); assert.deepEqual(d.cfg, S.defaults(data));
});
