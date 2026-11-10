// Back-compat (plan rule 0.4): without params.hood, evaluate equals the efed636 fixture; with or without the extensions loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadEngine, loadBareEngine, loadData, BASE, ROOT } from './load-data.mjs';
import { SPOTS, snapshot, load } from './fixtures/make-baseline.mjs';

const E = loadEngine(), FIX = (a) => ({ mode: 'fixed', angleDeg: a });

test('back-compat: without params.hood the results equal efed636 and carry no hood / error keys', () => {
  const rows = [];
  for (const [spot, p] of Object.entries(SPOTS)) for (const mode of ['coarse', 'full']) rows.push({ spot, mode, ...snapshot(E.evaluate(p, mode)) });
  assert.deepEqual(rows, load());
  const r = E.evaluate(BASE, 'full');
  assert.ok(!('hood' in r) && !('error' in r));
  for (const h of [undefined, null]) assert.deepEqual(snapshot(E.evaluate({ ...BASE, hood: h }, 'full')), snapshot(r), 'hood undefined / null = legacy path');
  const B = loadBareEngine();   // an engine with no extension ignores params.hood
  assert.deepEqual(snapshot(B.evaluate({ ...BASE, hood: FIX(62.5) }, 'full')), snapshot(B.evaluate(BASE, 'full')));
});

test('back-compat: with the extensions loaded and no hood, whole results equal the bare engine apart from timings, scoringWindow and the ghost edge arcs', () => {
  const B = loadBareEngine();
  const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.timings; delete c.ghosts; /* edge arcs follow the rect window (plan 4.1) */ if (c.best) delete c.best.scoringWindow; return c; };
  for (const p of [...Object.values(SPOTS), { ...BASE, robot: { x: -12.75, y: 0 } }, { ...BASE, motorId: 'yj30' }, { ...BASE, robot: { x: -12, y: 48 } }])
    for (const mode of ['coarse', 'full']) assert.deepEqual(strip(E.evaluate(p, mode)), strip(B.evaluate(p, mode)), `${JSON.stringify(p.robot)} ${p.motorId} ${mode}`);
  assert.deepEqual(E.compareMotors(BASE), B.compareMotors(BASE));
});

test('browser / worker load: sources concatenated in plan order (no module object) register every extension', () => {
  const files = ['engine.js', 'engine-rect.js', 'engine-hood-core.js', 'engine-hood.js', 'engine-sweep.js'];
  const self = {};   // no `module`: the UMD wrappers take the root.ShotEngine / root.ShotHoodCore path
  vm.runInNewContext(files.map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n;\n'), { self }, { filename: 'concat.js' });
  const W = self.ShotEngine; W.init(loadData());
  assert.ok(self.ShotHoodCore && ['window', 'hood', 'sweep'].every((n) => W._internal.ext(n)));
  assert.equal(typeof W.sweepPoints, 'function'); assert.equal(typeof W.rectOpening, 'function');
  const hood = FIX(62.5), a = W.evaluate({ ...BASE, hood }, 'full'), b = E.evaluate({ ...BASE, hood }, 'full');
  const pick = (r) => JSON.stringify([r.hitRate, r.hood.angleDeg, r.hood.rpmWindow.motorRpm]);   // JSON: arrays from another vm realm
  assert.equal(pick(a), pick(b));
});
