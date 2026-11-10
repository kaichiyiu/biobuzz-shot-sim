// #3 rectangular scoring window: rect-hit grid, rule at hand-made crossings, window ranges, rpm edges, back-compat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadBareEngine, BASE } from './load-data.mjs';
import { SPOTS, snapshot, load } from './fixtures/make-baseline.mjs';

const E = loadEngine(), I = E._internal, G = I.geometry(), R = I.ext('window');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const at = (x, y) => ({ ...BASE, robot: { x, y } });
// the 4 fixture spots + corner, no-rect-window (-12, 48), edge, and two mid-field spots with lower hit rates
const SPOTS8 = [...Object.values(SPOTS), at(-60, -60), at(-12, 48), at(0, -60), at(-12, -24)];

function setup(params) {
  const p = I.normParams(params), sh = p.shooter, bp = E.ballProps(p.ballId), S0 = E.shooterSpin(sh);
  const table = E.buildTable(p.ballId, S0), grid = I.getGrid(p, table), view = I.coarseView(grid);
  return { p, sh, bp, table, grid, view, mo: I.motorById()[p.motorId] };
}
const sum = (u) => u.reduce((s, x) => s + x, 0);

test('rectHits is a subset of hits on coarse and fine views at 8 spots (and strictly smaller somewhere)', () => {
  let strict = 0;
  for (const params of SPOTS8) {
    const s = setup(params), sel = I.selectAim(s.view, s.p, s.mo, s.sh, s.bp, false);
    const views = [s.view];
    if (sel) views.push(I.fineStage(s.p, s.table, s.grid, sel, s.mo, s.sh, s.bp).view);
    for (const v of views) {
      assert.ok(v.rectHits instanceof Uint8Array && v.rectHits.length === v.hits.length);
      for (let i = 0; i < v.hits.length; i++) assert.ok(v.rectHits[i] <= v.hits[i], `cell ${i} rect hit without pentagon hit`);
      if (sum(v.rectHits) < sum(v.hits)) strict++;
    }
  }
  assert.ok(strict >= 6, `rect set should be strictly smaller on most views (${strict})`);
});

// Synthetic parabola through a chosen crossing point (q, B) of the mouth plane, run through the real testTraj.
function synth(q, B) {
  const { ctx } = setup(BASE).grid, T = ctx.T, W = I.bodyToWorld(q, G.aOut, B + G.b0, T.hx, T.sg);
  const dx = W[0] - ctx.x0, dy = W[1] - ctx.y0, rhoT = Math.hypot(dx, dy), zT = W[2] - ctx.h0;
  const ra = 0.65 * rhoT, c = zT / (rhoT * (2 * ra - rhoT)), pts = [];
  for (let rho = 0; rho <= rhoT * 1.25; rho += 0.5) pts.push([Math.round(rho * 25.4), Math.round(c * (ra * ra - (rho - ra) ** 2) * 25.4)]);
  const P = new Int16Array(2 * pts.length);
  let apex = 0;
  pts.forEach((pt, i) => { P[2 * i] = pt[0]; P[2 * i + 1] = pt[1]; if (pt[1] >= pts[apex][1]) apex = i; });
  const hits = new Uint8Array(1), causes = new Uint8Array(1), rh = new Uint8Array(1);
  I.testTraj(ctx, [I.yawCtx(ctx, Math.atan2(dy, dx) * 180 / Math.PI)], P, pts.length, apex, 0, P[2 * pts.length - 2], hits, causes, 0, rh);
  return { hit: hits[0], rect: rh[0] };
}

test('rect rule at hand-made crossing points: inside, shoulder edge +/- 0.2 in, side and bottom edges', () => {
  const r = setup(BASE).grid.ctx.r, top = G.SH - r;
  assert.deepEqual(synth(0, 4), { hit: 1, rect: 1 }, 'inside');
  assert.deepEqual(synth(0, top - 0.2), { hit: 1, rect: 1 }, 'just under the shoulder line');
  assert.deepEqual(synth(0, top + 0.2), { hit: 1, rect: 0 }, 'just over the shoulder line: pentagon scores, rectangle does not');
  assert.deepEqual(synth(0, top + 2), { hit: 1, rect: 0 }, 'roof triangle');
  assert.deepEqual(synth(G.W2 - r - 0.2, 3), { hit: 1, rect: 1 }, 'just inside the side clearance');
  assert.deepEqual(synth(G.W2 - r + 0.2, 3), { hit: 0, rect: 0 }, 'side clearance violated (pentagon already misses)');
  assert.deepEqual(synth(0, r - 0.2), { hit: 0, rect: 0 }, 'bottom clearance violated');
});

test('testTraj without the rhits argument behaves as before (6th hook is optional)', () => {
  const s = setup(BASE), sel = I.selectAim(s.view, s.p, s.mo, s.sh, s.bp, false), t = s.table;
  const idx = sel.a * t.nV + sel.b, a = new Uint8Array(s.grid.nC), b = new Uint8Array(s.grid.nC), cz = new Uint8Array(s.grid.nC), rh = new Uint8Array(s.grid.nC);
  const n1 = I.testTraj(s.grid.ctx, s.grid.ycs, t.trajs[idx], t.lens[idx], t.apex[idx], t.mono[idx], t.preMax[idx], a, cz, 0);
  const n2 = I.testTraj(s.grid.ctx, s.grid.ycs, t.trajs[idx], t.lens[idx], t.apex[idx], t.mono[idx], t.preMax[idx], b, cz, 0, rh);
  assert.equal(n1, n2); assert.deepEqual(a, b);
});

// brute-force contiguous run of a boolean cell set through an anchor cell along one axis -> [lo, hi] indices
function run(H, v, anc, axis) {
  const at = (a, b, c) => b <= anc.cellMaxB && H[(a * v.nB + b) * v.nC + c] === 1;
  const n = { a: v.nA, b: v.nB, c: v.nC }[axis], at1 = (i) => at(axis === 'a' ? i : anc.a, axis === 'b' ? i : anc.b, axis === 'c' ? i : anc.c);
  let lo = anc[axis], hi = anc[axis];
  while (lo > 0 && at1(lo - 1)) lo--;
  while (hi < n - 1 && at1(hi + 1)) hi++;
  return [lo, hi];
}

test('scoringWindow ranges are the brute-force rect-hit runs through the aim (or the nearest rect hit when moved)', () => {
  let moved = 0, kept = 0;
  for (const params of SPOTS8) {
    const s = setup(params), sel = I.selectAim(s.view, s.p, s.mo, s.sh, s.bp, false);
    const sw = R.scoringWindow(s.view, sel, s.p, s.mo, s.sh, s.bp);
    if (!sw) continue;
    const H = s.view.rectHits, v = s.view, inRect = H[(sel.a * v.nB + sel.b) * v.nC + sel.c] === 1;
    assert.equal(sw.moved, !inRect, 'moved flag');
    if (sw.moved) assert.equal(v.hits[(sel.a * v.nB + sel.b) * v.nC + sel.c], 1, 'moved aim is a pentagon hit in the roof triangle');
    const anchor = sw.moved ? { ...R.nearestRectHit(v, sel, { theta: s.p.precision.sigThetaDeg, ln: sel.sigV, yaw: s.p.precision.sigYawDeg }), cellMaxB: sel.cellMaxB } : sel;
    for (const [axis, key, arr] of [['a', 'thetaDeg', v.thetas], ['b', 'v', v.speeds], ['c', 'yawDeg', v.yaws]]) {
      const [lo, hi] = run(H, v, anchor, axis);
      assert.deepEqual(sw[key], [arr[lo], arr[hi]], `${axis} range`);
    }
    if (sw.moved) moved++; else kept++;
  }
  assert.ok(moved > 0 && kept > 0, `need both cases covered (moved ${moved}, kept ${kept})`);
});

test('moved window: aim in the roof triangle -> runs through the nearest rect hit (synthetic view)', () => {
  const nA = 7, nB = 5, nC = 5, v = { nA, nB, nC, thStep: 1, lnStep: 0.02, yawStep: 1, thetas: [60, 61, 62, 63, 64, 65, 66], speeds: [4, 4.1, 4.2, 4.3, 4.4], yaws: [-2, -1, 0, 1, 2] };
  v.hits = new Uint8Array(nA * nB * nC).fill(1); v.rectHits = new Uint8Array(nA * nB * nC);
  for (let a = 0; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 0; c < nC; c++) v.rectHits[(a * nB + b) * nC + c] = 1;
  const sel = { a: 5, b: 2, c: 2, theta: 65, v: 4.2, yaw: 0, sigV: 0.03, cellMaxB: 4 };
  const p = { precision: { sigThetaDeg: 1, sigYawDeg: 1, sigShooter: 0.015 } };
  const nn = R.nearestRectHit(v, sel, { theta: 1, ln: 0.03, yaw: 1 });
  assert.deepEqual(nn, { a: 3, b: 2, c: 2 });
  const sw = R.scoringWindow(v, sel, p, I.motorById().yj6000, I.shooterNorm(BASE.shooter), E.ballProps('pollen'));
  assert.equal(sw.moved, true);
  assert.deepEqual(sw.thetaDeg, [60, 63]); assert.deepEqual(sw.v, [4.1, 4.3]); assert.deepEqual(sw.yawDeg, [-2, 2]);
  assert.equal(sw.clippedByMotor, false);
});

test('nearestRectHit: ties go to the lower speed index; cells above the motor cap are ignored; none -> null', () => {
  const v = { nA: 3, nB: 4, nC: 1, thStep: 1, lnStep: 0.02, yawStep: 1, rectHits: new Uint8Array(12) };
  v.rectHits[(1 * 4 + 0) * 1] = 1; v.rectHits[(1 * 4 + 2) * 1] = 1;           // equal distance from b = 1
  const sel = { a: 1, b: 1, c: 0, cellMaxB: 3 }, sig = { theta: 1, ln: 0.02, yaw: 1 };
  assert.deepEqual(R.nearestRectHit(v, sel, sig), { a: 1, b: 0, c: 0 });
  assert.deepEqual(R.nearestRectHit(v, { ...sel, b: 2, cellMaxB: 3 }, sig), { a: 1, b: 2, c: 0 });
  v.rectHits.fill(0); v.rectHits[(1 * 4 + 3) * 1] = 1;
  assert.equal(R.nearestRectHit(v, { ...sel, cellMaxB: 2 }, sig), null);
});

test('no rect hit anywhere (or no rectHits array) -> scoringWindow is null', () => {
  const v = { nA: 2, nB: 2, nC: 2, thStep: 1, lnStep: 0.02, yawStep: 1, thetas: [60, 61], speeds: [4, 4.1], yaws: [0, 1], hits: new Uint8Array(8).fill(1), rectHits: new Uint8Array(8) };
  const sel = { a: 0, b: 0, c: 0, theta: 60, v: 4, yaw: 0, sigV: 0.03, cellMaxB: 1 };
  const p = { precision: { sigThetaDeg: 1, sigYawDeg: 1, sigShooter: 0.015 } };
  assert.equal(R.scoringWindow(v, sel, p, null, null, null), null);
  assert.equal(R.scoringWindow({ ...v, rectHits: undefined }, sel, p, null, null, null), null);
  const r = E.evaluate(at(-12, 48), 'coarse');   // real spot: pentagon scores, nothing fits the rectangle
  assert.ok(r.best && r.best.windows && r.hitRate > 0);
  assert.equal(r.best.scoringWindow, null);
});

test('rpm at the window edges equals motorModel; rect window sits inside the pentagon window when not moved', () => {
  let kept = 0;
  for (const mode of ['coarse', 'full']) for (const params of SPOTS8) {
    const r = E.evaluate(params, mode), sw = r.best && r.best.scoringWindow, w = r.best && r.best.windows;
    if (!sw) continue;
    assert.equal(sw.basis, 'rect'); kept += sw.moved ? 0 : 1;
    for (let k = 0; k < 2; k++) {
      const m = E.motorModel(params.motorId, params.shooter, params.ballId, sw.v[k]);
      near(sw.motorRpm[k], m.motorRpm, 1e-9, 'motor rpm'); near(sw.wheelRpm[k], m.wheelRpm, 1e-9, 'wheel rpm');
    }
    assert.ok(sw.motorRpm[0] <= sw.motorRpm[1] && sw.v[0] <= sw.v[1]);
    if (!sw.moved) {
      assert.ok(sw.v[0] >= w.v[0] - 1e-9 && sw.v[1] <= w.v[1] + 1e-9);
      assert.ok(sw.thetaDeg[0] >= w.thetaDeg[0] - 1e-9 && sw.thetaDeg[1] <= w.thetaDeg[1] + 1e-9);
      assert.ok(sw.yawDeg[0] >= w.yawDeg[0] - 1e-9 && sw.yawDeg[1] <= w.yawDeg[1] + 1e-9);
    }
  }
  assert.ok(kept > 0, 'the not-moved branch was exercised');
});

test('opening is the engine geometry: 2 W2 x SH = 20 x 7.61 in; also public as E.rectOpening', () => {
  assert.deepEqual(R.opening(), { widthIn: 20, heightIn: 7.61 });
  assert.deepEqual(E.rectOpening(), { widthIn: 2 * G.W2, heightIn: G.SH });
  const r = E.evaluate(BASE, 'coarse');
  assert.deepEqual(r.best.scoringWindow.opening, { widthIn: 20, heightIn: 7.61 });
});

test('back-compat: with the window extension loaded, no-hood verdict / hit rate / aim / windows / reason equal efed636', () => {
  const base = load(), rows = [];
  for (const [spot, params] of Object.entries(SPOTS)) for (const mode of ['coarse', 'full']) rows.push({ spot, mode, ...snapshot(E.evaluate(params, mode)) });
  assert.deepEqual(rows, base);
  // and the engine without any extension still equals it
  const B = loadBareEngine(), bare = [];
  for (const [spot, params] of Object.entries(SPOTS)) for (const mode of ['coarse', 'full']) bare.push({ spot, mode, ...snapshot(B.evaluate(params, mode)) });
  assert.deepEqual(bare, base);
  assert.equal(B.evaluate(BASE, 'coarse').best.scoringWindow, undefined);
});
