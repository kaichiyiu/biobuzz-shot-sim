// #2 hood: engine integration (adjustable / fixed / error), back-compat, sensitivity brute force, sweep, worker protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadEngine, loadData, BASE, ROOT } from './load-data.mjs';

const E = loadEngine(), I = E._internal, G = I.geometry(), HX = I.ext('hood'), PRE = loadData().shooter.precision;
const ADJ = { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, FIX = (a) => ({ mode: 'fixed', angleDeg: a });
const at = (x, y, o = {}) => ({ ...BASE, robot: { x, y }, ...o });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const sig = (r) => ({ ang: r.hood.angleDeg, rng: r.hood.rangeDeg, yaw: r.best.yawDeg, v: r.best.v, rpm: r.hood.rpmWindow.motorRpm });

test('norm: defaults, swap, clamp, narrow range -> fixed at the midpoint, fixed angle validation', () => {
  assert.deepEqual([HX.norm({}).mode, HX.norm({}).lo, HX.norm({}).hi], ['adjustable', 45, 80]);
  assert.deepEqual([HX.norm({ mode: 'adjustable', minDeg: 70, maxDeg: 50 }).lo, HX.norm({ mode: 'adjustable', minDeg: 70, maxDeg: 50 }).hi], [50, 70]);
  assert.deepEqual([HX.norm({ minDeg: 2, maxDeg: 120 }).lo, HX.norm({ minDeg: 2, maxDeg: 120 }).hi], [10, 89]);
  const n = HX.norm({ mode: 'adjustable', minDeg: 45, maxDeg: 45.5 });
  assert.deepEqual([n.mode, n.angleDeg, n.error], ['fixed', 45.25, null]);
  for (const [a, code] of [[null, 'HOOD_ANGLE_REQUIRED'], [undefined, 'HOOD_ANGLE_REQUIRED'], [NaN, 'HOOD_ANGLE_REQUIRED'], ['62', 'HOOD_ANGLE_REQUIRED'], [0.9, 'HOOD_ANGLE_RANGE'], [89.1, 'HOOD_ANGLE_RANGE'], [-5, 'HOOD_ANGLE_RANGE']])
    assert.equal(HX.norm(FIX(a)).error.code, code, String(a));
  for (const a of [1, 62.5, 89]) assert.equal(HX.norm(FIX(a)).error, null);
});

test('error state: invalid fixed hood gives an error result without numbers; compareMotors gives []; valid / adjustable / no hood never error', () => {
  for (const a of [undefined, null, NaN, 0.5, 95]) for (const mode of ['coarse', 'full']) {
    const r = E.evaluate({ ...BASE, hood: FIX(a) }, mode), code = a == null || Number.isNaN(a) ? 'HOOD_ANGLE_REQUIRED' : 'HOOD_ANGLE_RANGE';
    assert.equal(r.code, code); assert.equal(r.error.code, code); assert.equal(r.error.field, 'hood.angleDeg'); assert.equal(r.reason, r.error.message);
    for (const k of ['verdict', 'hitRate', 'best', 'motor', 'trajectory', 'psi0Deg', 'distIn', 'aimHeadingDeg', 'missCause']) assert.equal(r[k], null, k);
    assert.deepEqual(r.ghosts, []); assert.ok(Array.isArray(r.warnings)); assert.equal(r.mode, mode); assert.ok(!('hood' in r));
  }
  assert.deepEqual(E.compareMotors({ ...BASE, hood: FIX(null) }), []);
  assert.equal(E.compareMotors({ ...BASE, hood: FIX(62.5) }).length, 11);
  for (const h of [ADJ, FIX(62.5), undefined]) assert.ok(!('error' in E.evaluate({ ...BASE, hood: h }, 'coarse')));
});

test('adjustable: range, middle angle, rpm window, setpoint, +-1/+-2 deg rows; coarse is a preview without sensitivity', () => {
  const c = E.evaluate({ ...BASE, hood: ADJ }, 'coarse'), f = E.evaluate({ ...BASE, hood: ADJ }, 'full'), h = f.hood;
  assert.equal(c.hood.preview, true); assert.equal(c.hood.sensitivity, null); assert.equal(h.preview, false);
  assert.deepEqual(h.range, [45, 80]); assert.equal(h.mode, 'adjustable');
  assert.ok(h.rangeDeg[0] <= h.angleDeg && h.angleDeg <= h.rangeDeg[1] && h.angleDeg === f.best.thetaDeg);
  assert.deepEqual(h.rpmWindow.vExit, f.best.scoringWindow.v, 'the rpm window IS the scoring window speed range (D14)');
  assert.deepEqual(h.rpmWindow.motorRpm, f.best.scoringWindow.motorRpm);
  const [lo, hi] = h.rpmWindow.vExit, mid = (lo + hi) / 2;
  assert.ok(f.best.v >= lo && f.best.v <= hi && Math.abs(f.best.v - mid) / mid <= 0.0055, 'setpoint at the window middle (within one 0.5 % step)');
  assert.deepEqual(h.sensitivity.map((s) => s.deltaDeg), [-1, 1, -2, 2]);
  near(h.rpmWindow.widthPct, 100 * (hi / lo - 1), 1e-9, 'widthPct'); near(h.rpmWindow.centerMotorRpm, (h.rpmWindow.motorRpm[0] + h.rpmWindow.motorRpm[1]) / 2, 1e-9, 'centre');
  assert.equal(h.atLimit, null);
  assert.equal(E.evaluate(at(24, -60, { hood: ADJ }), 'coarse').hood.atLimit, 'min');
  assert.equal(E.evaluate(at(-12.75, -30, { hood: ADJ }), 'full').hood.atLimit, 'max');
});

test('adjustable: the optimum is identical across precision presets, control mode and shot interval (cap not binding)', () => {
  for (const [x, y] of [[-12.75, -48], [-40, -50]]) for (const mode of ['coarse', 'full']) {
    const ref = sig(E.evaluate(at(x, y, { hood: ADJ }), mode));
    for (const [k, pr] of Object.entries(PRE)) assert.deepEqual(sig(E.evaluate(at(x, y, { hood: ADJ, precision: pr }), mode)), ref, `${k} ${x},${y} ${mode}`);
    for (const control of ['pid', 'power']) for (const shotInterval of [0.3, 1])
      assert.deepEqual(sig(E.evaluate(at(x, y, { hood: ADJ, shooter: { ...BASE.shooter, control, shotInterval } }), mode)), ref, `${control} ${shotInterval} ${x},${y} ${mode}`);
  }
});

test('adjustable: members of the reported range are within one step of the widest window; the neighbours outside are not (brute force)', () => {
  const p = I.normParams({ ...BASE, hood: ADJ }), sh = p.shooter, bp = E.ballProps('pollen'), mo = I.motorById()[p.motorId], table = E.buildTable('pollen', 1);
  const grid = I.getGrid(p, table), cv = I.coarseView(grid), hn = HX.norm(ADJ), cs = HX.coarseAim(cv, p, mo, sh, bp, hn, false);
  const fine = I.fineStage(p, table, grid, cs, mo, sh, bp, HX.fineOpts(cs, hn)), v = fine.view, fs_ = HX.fineAim(v, p, mo, sh, bp, hn, cs), top = fs_.cellMaxB;
  const width = (a) => { let w = 0; for (let c = 0; c < v.nC; c++) { let lo = -1; for (let b = 0; b <= top + 1; b++) { const on = b <= top && v.rectHits[(a * v.nB + b) * v.nC + c]; if (on && lo < 0) lo = b; if (!on && lo >= 0) { w = Math.max(w, v.speeds[b - 1] - v.speeds[lo]); lo = -1; } } } return w; };
  const W = v.thetas.map((_, a) => width(a)), mx = Math.max(...W), step = v.speeds[fs_.hood.aw.bHi + 1] - v.speeds[fs_.hood.aw.bHi];
  const [iLo, iHi] = fs_.hood.rangeDeg.map((t) => v.thetas.indexOf(t));
  for (let a = iLo; a <= iHi; a++) assert.ok(W[a] >= mx - step - 1e-9, `angle ${v.thetas[a]} width ${W[a]} vs max ${mx}`);
  if (iLo > 0) assert.ok(W[iLo - 1] < mx - step, 'angle below the range is outside'); if (iHi < W.length - 1) assert.ok(W[iHi + 1] < mx - step, 'angle above the range is outside');
  assert.ok(fs_.hood.opt.a >= fs_.hood.opt.aLo && fs_.hood.opt.a <= fs_.hood.opt.aHi);
});

test('fixed: the entered angle is reported exactly and is on the fine grid; integer angle matches the coarse table row within a step', () => {
  const r = E.evaluate({ ...BASE, hood: FIX(62.5) }, 'full');
  assert.equal(r.hood.angleDeg, 62.5); assert.equal(r.best.thetaDeg, 62.5); assert.equal(r.hood.rangeDeg, null); assert.equal(r.hood.range, null); assert.equal(r.hood.sensitivity, null);
  const odd = E.evaluate({ ...BASE, hood: FIX(66.3) }, 'full');   // not a multiple of the 1 deg table or of 0.25 deg
  assert.equal(odd.hood.angleDeg, 66.3); assert.equal(odd.best.thetaDeg, 66.3, 'the fine theta grid is centred on the exact angle');
  const c = E.evaluate({ ...BASE, hood: FIX(70) }, 'coarse').hood.rpmWindow.vExit, ff = E.evaluate({ ...BASE, hood: FIX(70) }, 'full').hood.rpmWindow.vExit;
  near(ff[0], c[0], 0.021 * c[0], 'low edge'); near(ff[1], c[1], 0.021 * c[1], 'high edge');
  assert.equal(E.evaluate({ ...BASE, hood: FIX(70) }, 'coarse').hood.preview, true);
});

test('hit rate and verdict are evaluated at the setpoint and never beat the free search (same grids)', () => {
  for (const [x, y] of [[-12.75, -48], [-40, -50], [24, -60], [-12.75, -30]]) for (const h of [ADJ, FIX(65)]) {
    const free = E.evaluate(at(x, y), 'coarse'), r = E.evaluate(at(x, y, { hood: h }), 'coarse');
    if (r.best) { assert.ok(r.hitRate <= free.hitRate + 1e-6, `${x},${y} ${h.mode}: ${r.hitRate} vs ${free.hitRate}`); assert.ok(['POSSIBLE', 'NOT CONSISTENT', "WON'T WORK"].includes(r.verdict)); }
  }
});

test('no window / too slow / capped: NO_ARC with a hood reason, TOO_SLOW without rpm window, clippedByMotor at the cap', () => {
  const none = E.evaluate(at(-12.75, -30, { hood: FIX(62.5) }), 'full');
  assert.equal(none.code, 'NO_ARC'); assert.equal(none.best, null); assert.match(none.reason, /62\.5/); assert.equal(none.hood.rpmWindow, null); assert.equal(none.hood.angleDeg, 62.5);
  const under = E.evaluate(at(-12.75, 0, { hood: ADJ }), 'full');
  assert.equal(under.code, 'NO_ARC'); assert.equal(under.hood.rpmWindow, null);
  const slow = E.evaluate({ ...BASE, motorId: 'yj30', hood: ADJ }, 'full');
  assert.equal(slow.code, 'TOO_SLOW'); assert.equal(slow.hood.rpmWindow, null); assert.equal(slow.hood.sensitivity, null); assert.match(slow.reason, /tops out/);
  assert.equal(E.compareMotors({ ...BASE, hood: ADJ }).find((m) => m.motorId === 'yj30').code, 'TOO_SLOW');
  const free = E.evaluate({ ...BASE, hood: ADJ }, 'full').hood.rpmWindow, vCap = E.motorModel('yj6000', BASE.shooter, 'pollen', 1).vCap;
  const gear = BASE.shooter.gear * ((free.vExit[0] + free.vExit[1]) / 2) / vCap;   // vCap is proportional to gear: put the cap in the middle of the window
  const cap = E.evaluate({ ...BASE, hood: ADJ, shooter: { ...BASE.shooter, gear } }, 'full'), w = cap.hood.rpmWindow;
  assert.equal(w.clippedByMotor, true); assert.equal(cap.best.scoringWindow.clippedByMotor, true);
  assert.ok(w.vExit[1] <= cap.motor.vCap * (1 + 1e-9) && w.vExit[1] < free.vExit[1]);
});

// pentagon hit + crossing of the mouth plane inside the rectangle, from classifyShot's path (independent of the grid code)
function rectHit(params, th, v, yaw) {
  const r = E.classifyShot(params, th, v, yaw);
  if (!r.hit) return false;
  const p = I.normParams(params), rb = E.ballProps(p.ballId).rIn, T = I.obstaclesFor(p.hiveState, p.target).T, b = r.path.map((q) => I.worldToBody(q[0], q[1], q[2], T.hx, T.sg));
  let x = null;
  for (let i = 0; i + 1 < b.length; i++) if (b[i][1] >= G.aOut && b[i + 1][1] < G.aOut) { const t = (b[i][1] - G.aOut) / (b[i][1] - b[i + 1][1]); x = [b[i][0] + t * (b[i + 1][0] - b[i][0]), b[i][2] + t * (b[i + 1][2] - b[i][2])]; }
  return !!x && Math.abs(x[0]) <= G.W2 - rb && x[1] - G.b0 >= rb && x[1] - G.b0 <= G.SH - rb;
}

test('sensitivity rows match a classifyShot brute force (v in 0.5 % steps, fixed yaw) and nominalStillScores', () => {
  for (const [x, y] of [[-12.75, -48], [-40, -50]]) {
    const params = at(x, y, { hood: ADJ }), r = E.evaluate(params, 'full'), v0 = r.best.v;
    for (const s of r.hood.sensitivity) {
      const th = r.best.thetaDeg + s.deltaDeg, on = [];
      for (let k = -40; k <= 40; k++) on.push(rectHit(params, th, v0 * Math.exp(0.005 * k), r.best.yawDeg));
      assert.equal(s.nominalStillScores, on[40], `still scores ${s.deltaDeg}`);
      const runs = []; let lo = -1;
      for (let i = 0; i <= on.length; i++) { if (i < on.length && on[i] && lo < 0) lo = i; if (!(i < on.length && on[i]) && lo >= 0) { runs.push([lo, i - 1]); lo = -1; } }
      const dist = (q) => (40 < q[0] ? q[0] - 40 : (40 > q[1] ? 40 - q[1] : 0)), best = runs.sort((a, b) => dist(a) - dist(b))[0];
      if (!best) { assert.equal(s.rpmWindow, null); continue; }
      const bf = best.map((i) => v0 * Math.exp(0.005 * (i - 40)));
      near(s.rpmWindow.vExit[0], bf[0], 0.0051 * bf[0], `${x},${y} ${s.deltaDeg} low`); near(s.rpmWindow.vExit[1], bf[1], 0.0051 * bf[1], `${x},${y} ${s.deltaDeg} high`);
    }
  }
});

test('window-grid contract: a narrower rectHits changes the rpm window and the optimum without other code changes', () => {
  const p = I.normParams(BASE), table = E.buildTable('pollen', 1), cv = I.coarseView(I.getGrid(p, table)), mo = I.motorById()[p.motorId], bp = E.ballProps('pollen'), hn = HX.norm(FIX(70));
  const narrow = Uint8Array.from(cv.rectHits);
  for (let a = 0; a < cv.nA; a++) for (let c = 0; c < cv.nC; c++) { let n = 0; for (let b = 0; b < cv.nB; b++) { const i = (a * cv.nB + b) * cv.nC + c; if (narrow[i]) { if (++n > 1) narrow[i] = 0; } else n = 0; } }   // keep one cell per run
  const base = HX.coarseAim(cv, p, mo, p.shooter, bp, hn, false), nar = HX.coarseAim({ ...cv, rectHits: narrow }, p, mo, p.shooter, bp, hn, false);
  assert.ok(base.hood.aw.bHi > base.hood.aw.bLo, 'the real window spans several cells');
  assert.equal(nar.hood.aw.bHi, nar.hood.aw.bLo, 'the narrowed grid gives a one-cell window');
  assert.ok(nar.hood.aw.bLo >= base.hood.aw.bLo && nar.hood.aw.bHi <= base.hood.aw.bHi);
  const cap = (rectHits) => HX.result({ ...cv, rectHits }, HX.coarseAim({ ...cv, rectHits }, p, mo, p.shooter, bp, hn, false), { best: {}, code: 'OK' }, hn, 'coarse', { mo, sh: p.shooter, bp }).rpmWindow;
  assert.ok(cap(narrow).widthRpm < cap(cv.rectHits).widthRpm, 'the rpm window follows the grid it is read from');
});

test('sweep points: on the mouth-centroid ray at 10, 14, ... in, ending at the clamp; the ray does not depend on where the mouth is', () => {
  const params = at(-40, -50, { hood: FIX(62.5) }), pts = E.sweepPoints(params), p = I.normParams(params), cen = I.mouthCentroid(p.target, p.hiveState[p.target]);
  assert.equal(pts[0].d, 10); assert.equal(pts[1].d, 14); assert.ok(pts.length > 8);
  const psi = Math.atan2(cen[1] - p.launch.y, cen[0] - p.launch.x);
  pts.forEach((q, i) => {
    near(Math.hypot(cen[0] - q.x, cen[1] - q.y), q.d, 1e-6, 'distance to centroid = d');
    near(Math.atan2(cen[1] - q.y, cen[0] - q.x), psi, 1e-9, 'bearing kept'); assert.ok(Math.abs(q.x) <= p.mouthLimit + 1e-9 && Math.abs(q.y) <= p.mouthLimit + 1e-9);
    if (i) assert.ok(q.d > pts[i - 1].d);
  });
  const last = pts.at(-1), out = { x: cen[0] - (last.d + 0.5) * Math.cos(psi), y: cen[1] - (last.d + 0.5) * Math.sin(psi) };
  assert.ok(Math.abs(out.x) > p.mouthLimit || Math.abs(out.y) > p.mouthLimit, 'the last point is the farthest inside the clamp');
  const moved = E.sweepPoints({ ...params, robot: undefined, mouth: { x: pts[4].x, y: pts[4].y } });
  assert.equal(moved.length, pts.length); moved.forEach((q, i) => near(q.x, pts[i].x, 1e-9, 'x')); assert.equal(E.sweepPoints(params, 8)[1].d, 18);
});

test('sweepRow at a point equals the standalone fixed evaluation there; null rpm where there is no window', () => {
  const params = at(-40, -50, { hood: FIX(62.5) }), q = E.sweepPoints(params)[8];   // d = 42 in: a scoring window exists
  const at3 = { ...params, robot: undefined, mouth: { x: q.x, y: q.y } }, r = E.evaluate(at3, 'full'), row = E.sweepRow(r, q.d);
  assert.ok(r.hood.rpmWindow, 'this point has a window');
  assert.deepEqual(row, { d: q.d, verdict: r.verdict, hitRate: r.hitRate, motorRpm: r.hood.rpmWindow.motorRpm, wheelRpm: r.hood.rpmWindow.wheelRpm });
  near(row.d, r.distIn, 1e-6, 'row distance = res.distIn');
  const hard = E.sweepRow(E.evaluate(at(-12.75, -30, { hood: FIX(62.5) }), 'full'), 20);
  assert.deepEqual([hard.motorRpm, hard.wheelRpm, hard.verdict], [null, null, "WON'T WORK"]);
});

function worker() {
  const msgs = [], self = { ShotEngine: E, postMessage: (m) => msgs.push(m) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'worker.js'), 'utf8'), { self, setTimeout }, { filename: 'worker.js' });
  return { msgs, send: (m) => self.onmessage({ data: m }) };
}
const until = async (f) => { for (let i = 0; i < 3000 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f(), 'timed out'); };

test('worker: sweep streams rows then sweepDone; cancelSweep stops it; cancelScan does not; invalid hood errors at once', async () => {
  const params = at(-40, -50, { hood: FIX(62.5) }), n = E.sweepPoints(params, 30).length;
  let w = worker(); w.send({ type: 'sweep', id: 7, params, step: 30 });
  await until(() => w.msgs.some((m) => m.type === 'sweepDone'));
  const rows = w.msgs.filter((m) => m.type === 'sweepRow');
  assert.equal(rows.length, n); rows.forEach((m, i) => { assert.equal(m.id, 7); assert.equal(m.done, i + 1); assert.equal(m.total, n); assert.equal(typeof m.row.d, 'number'); });
  assert.deepEqual(rows.map((m) => m.row.d), E.sweepPoints(params, 30).map((q) => q.d));
  w = worker(); w.send({ type: 'sweep', id: 1, params, step: 30 }); w.send({ type: 'cancelScan' }); await until(() => w.msgs.some((m) => m.type === 'sweepDone'));
  w = worker(); w.send({ type: 'sweep', id: 2, params, step: 30 }); w.send({ type: 'cancelSweep' }); await new Promise((r) => setTimeout(r, 400));
  assert.equal(w.msgs.filter((m) => m.type === 'sweepRow').length, 1, 'only the synchronous first row'); assert.ok(!w.msgs.some((m) => m.type === 'sweepDone'));
  w = worker(); w.send({ type: 'sweep', id: 3, params: { ...params, hood: FIX(null) }, step: 30 });
  assert.equal(w.msgs.length, 1); assert.equal(w.msgs[0].type, 'error'); assert.equal(w.msgs[0].error.code, 'HOOD_ANGLE_REQUIRED');
});
