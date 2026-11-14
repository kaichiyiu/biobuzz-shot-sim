// O3: hood section equals r.hood; fixed hood skips the search rows; no hood result -> null.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url), D = require(path.join(ROOT, 'src', 'derive-tex.js')), H = require(path.join(ROOT, 'src', 'derive-hood.js'));
const E = loadEngine(), ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 };
const run = (hood, mode = 'full') => { const p = { ...BASE, hood }; return { r: E.evaluate(p, mode), p }; };
const rowOf = (s, what) => s.rows.find((x) => x.what === what);

test('adjustable: angle, tie range, width % and setpoint rpm equal r.hood', () => {
  const { r, p } = run(ADJ), h = r.hood, s = H.hood(r, p, {}), rw = h.rpmWindow;
  assert.equal(s.id, 'hood');
  assert.equal(rowOf(s, 'Chosen angle').res.split('°')[0], D.n(h.angleDeg, 2));
  assert.equal(rowOf(s, 'Widest angles (tie)').num, `[${D.n(h.rangeDeg[0], 2)},\\ ${D.n(h.rangeDeg[1], 2)}]^\\circ`);
  assert.ok(rowOf(s, 'Speed window at an angle').res.includes(`${D.n(rw.widthPct, 2)} %`));
  assert.ok(rowOf(s, 'Setpoint rpm').res.startsWith(`${D.n(rw.centerMotorRpm, 1)} rpm`));
  assert.equal(rowOf(s, 'Hood range searched').num, `[45.0,\\ 80.0]^\\circ`);
  for (const sg of h.sensitivity.filter((x) => Math.abs(x.deltaDeg) === 1)) {
    const w = rowOf(s, `Hood 1.0° ${sg.deltaDeg < 0 ? 'low' : 'high'}`); assert.ok(w.num.startsWith(D.n(sg.widthRatio, 3)));
  }
  assert.equal(s.rows.filter((x) => /^Hood 1/.test(x.what)).length, 2);
  assert.ok(s.notes.some((x) => /maximises the width of the speed window/.test(x)));
  assert.doesNotMatch(JSON.stringify(s), /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined/i);
});

test('fixed hood: states the angle, no search rows, no sensitivity', () => {
  const { r, p } = run({ mode: 'fixed', angleDeg: 68 }), s = H.hood(r, p, {});
  assert.equal(rowOf(s, 'Launch angle').num, '68.00^\\circ');
  for (const w of ['Hood range searched', 'Speed window at an angle', 'Widest angles (tie)', 'Chosen angle']) assert.equal(rowOf(s, w), undefined);
  assert.ok(rowOf(s, 'Setpoint rpm')); assert.equal(s.rows.some((x) => /^Hood 1/.test(x.what)), false);
});

test('no hood / no window -> null; preview and limit notes; user units in the setpoint speed', () => {
  assert.equal(H.hood({ best: {} }, {}, {}), null); assert.equal(H.hood(null), null);
  const e = run({ mode: 'fixed', angleDeg: 5 }); assert.equal(H.hood(e.r, e.p, {}), null);
  const c = run(ADJ, 'coarse'); assert.ok(H.hood(c.r, c.p, {}).notes.some((x) => /^Preview/.test(x)));
  const lim = run({ mode: 'adjustable', minDeg: 70.5, maxDeg: 80 }), sl = H.hood(lim.r, lim.p, {});
  if (lim.r.hood.atLimit) assert.ok(sl.notes.some((x) => /end of the hood range/.test(x)));
  const f = run(ADJ), ft = { speedUnit: () => 'ft/s', toSpeed: (v) => v * 3.28084, lenUnit: () => 'in', toLen: (v) => v };
  assert.match(rowOf(H.hood(f.r, f.p, { units: ft }), 'Setpoint rpm').res, /ft\/s/);
});
