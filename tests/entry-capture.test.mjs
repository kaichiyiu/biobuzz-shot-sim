// C1 (#12): entry angle / speed captured per rect-hit cell by testTraj; classifyCore gains entryAngleDeg and rectHit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, BASE } from './load-data.mjs';

const E = loadEngine(), I = E._internal;

function setup(params) {
  const p = I.normParams(params), sh = p.shooter, bp = E.ballProps(p.ballId), S0 = E.shooterSpin(sh);
  const table = E.buildTable(p.ballId, S0), grid = I.getGrid(p, table), view = I.coarseView(grid);
  return { p, sh, bp, table, grid, view, mo: I.motorById()[p.motorId] };
}
// deterministic sampler (no Math.random: the suite must be repeatable)
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function pick(list, n, rand) { const a = list.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; }
function cell(view, i) { const c = i % view.nC, b = Math.floor(i / view.nC) % view.nB, a = Math.floor(i / (view.nC * view.nB)); return { a, b, c, th: view.thetas[a], v: view.speeds[b], yaw: view.yaws[c] }; }
const core = (s, view, i) => { const k = cell(view, i); return I.classifyCore(s.p, s.grid.ctx, s.table.K, s.table.S0, k.th, k.v, k.yaw); };

const s = setup(BASE), V = s.view;
const rectIdx = [], missIdx = [], pentOnly = [];
for (let i = 0; i < V.hits.length; i++) {
  if (V.rectHits[i]) rectIdx.push(i); else if (V.hits[i]) pentOnly.push(i); else missIdx.push(i);
}

test('view.entry: Float32Array(2 N), carried from the grid, NaN everywhere except rect-hit cells', () => {
  assert.ok(V.entry instanceof Float32Array);
  assert.equal(V.entry.length, 2 * V.hits.length);
  assert.equal(V.entry, s.grid.entry);
  assert.ok(rectIdx.length > 50, 'BASE has enough rect hits: ' + rectIdx.length);
  for (let i = 0; i < V.hits.length; i++) {
    if (V.rectHits[i]) {
      assert.ok(Number.isFinite(V.entry[2 * i]) && Math.abs(V.entry[2 * i]) < 90, 'angle at rect cell ' + i);
      assert.ok(V.entry[2 * i + 1] > 0.5 && V.entry[2 * i + 1] < 40, 'speed at rect cell ' + i);
    } else assert.ok(Number.isNaN(V.entry[2 * i]) && Number.isNaN(V.entry[2 * i + 1]), 'non-rect cell ' + i + ' must be NaN');
  }
});

test('50 random rect-hit cells: entry matches classifyCore within 1 deg and 2 % speed', () => {
  for (const i of pick(rectIdx, 50, rng(12))) {
    const r = core(s, V, i);
    assert.ok(r.hit && r.rectHit, 'cell ' + i);
    assert.ok(Math.abs(V.entry[2 * i] - r.entryAngleDeg) <= 1, `angle ${V.entry[2 * i]} vs ${r.entryAngleDeg}`);
    assert.ok(Math.abs(V.entry[2 * i + 1] / r.entrySpeed - 1) <= 0.02, `speed ${V.entry[2 * i + 1]} vs ${r.entrySpeed}`);
  }
});

test('classifyCore().rectHit equals view.rectHits: 50 rect hits, 50 misses, 50 pentagon-only hits', () => {
  const rand = rng(7), sets = [[rectIdx, true], [missIdx, false], [pentOnly, false]];
  for (const [list, want] of sets) {
    const sample = pick(list, 50, rand);
    assert.ok(sample.length >= (want ? 50 : 1), 'sample size ' + sample.length);
    for (const i of sample) assert.equal(core(s, V, i).rectHit, want, 'cell ' + i);
  }
});

test('classifyShot: angle null without a crossing; descending shots have a negative angle', () => {
  const miss = E.classifyShot(BASE, 10, 3, 0);
  assert.equal(miss.hit, false);
  assert.equal(miss.rectHit, false);
  assert.equal(miss.entryAngleDeg, null);
  const desc = rectIdx.filter((i) => V.entry[2 * i] < 0).length;
  assert.ok(desc > 0, 'some BASE rect hits enter on the way down');
});

test('fine view carries entry with the same NaN rule; grid cache returns the same entry object', () => {
  const sel = I.selectAim(s.view, s.p, s.mo, s.sh, s.bp, false), fine = I.fineStage(s.p, s.table, s.grid, sel, s.mo, s.sh, s.bp).view;
  assert.equal(fine.entry.length, 2 * fine.hits.length);
  let n = 0;
  for (let i = 0; i < fine.hits.length; i++) {
    assert.equal(Number.isNaN(fine.entry[2 * i]), !fine.rectHits[i], 'fine cell ' + i);
    if (fine.rectHits[i]) n++;
  }
  assert.ok(n > 0);
  const again = setup(BASE);
  assert.equal(again.grid, s.grid, 'cache hit');
  assert.equal(again.view.entry, V.entry);
  E.evaluate(BASE, 'coarse');
  assert.equal(I.getGrid(s.p, s.table).entry, V.entry);
});

// ---- exact entry angle (#12a): fly() stores the flight-path angle, testTraj / classifyCore interpolate it at the crossing
const DEG = Math.PI / 180;
// float reference: angle atan2(vz, vx) of flyFloat (dt 0.5 ms) linearly interpolated at time t
function refAngle(S0, th, v, t) {
  const dt = 0.0005, o = I.flyFloat('pollen', S0, th, v, { dt, tEnd: t + 0.01 }), f = t / dt, i0 = Math.floor(f), fr = f - i0;
  const an = (q) => Math.atan2(q[3], q[2]) / DEG;
  return an(o[i0]) * (1 - fr) + an(o[i0 + 1]) * fr;
}
function rectCells(view) { const l = []; for (let i = 0; i < view.hits.length; i++) if (view.rectHits[i]) l.push(i); return l; }

test('engine entry angle vs float reference (dt 0.5 ms at tToCell): <= 0.1 deg, no sign errors, 3 spots', () => {
  let total = 0, slow = 0, zero = 0, maxAbs = 0;
  for (const [x, y] of [[-12.75, -48], [-60, -60], [24, -60]]) {
    const q = setup({ ...BASE, robot: { x, y } }), rc = rectCells(q.view), rand = rng(x * 7 + y);
    const bySpeed = rc.slice().sort((i, j) => q.view.entry[2 * i + 1] - q.view.entry[2 * j + 1]).slice(0, 60);   // the slowest entries are the hard ones
    const sample = [...new Set([...bySpeed, ...pick(rc, 60, rand)])];
    assert.ok(sample.length >= 70, `spot ${x},${y}: ${sample.length} cells`);
    for (const i of sample) {
      const k = cell(q.view, i), r = I.classifyCore(q.p, q.grid.ctx, q.table.K, q.table.S0, k.th, k.v, k.yaw);
      assert.ok(r.rectHit && r.tToCell > 0, 'cell ' + i);
      const ref = refAngle(q.table.S0, k.th, k.v, r.tToCell);
      for (const [what, a] of [['classifyCore', r.entryAngleDeg], ['view.entry', q.view.entry[2 * i]]]) {
        assert.ok(Math.abs(a - ref) <= 0.1, `${what} ${a} vs ${ref} (${x},${y} cell ${i}, ${q.view.entry[2 * i + 1].toFixed(2)} m/s)`);
        if (ref < -0.05) assert.ok(a < 0, `${what} sign: ${a} vs true ${ref}`);
        if (ref > 0.05) assert.ok(a > 0, `${what} sign: ${a} vs true ${ref}`);
      }
      maxAbs = Math.max(maxAbs, Math.abs(ref));
      total++; if (q.view.entry[2 * i + 1] < 2.5) slow++; if (r.entryAngleDeg === 0) zero++;
    }
  }
  assert.ok(total >= 200, 'cells compared: ' + total);
  assert.ok(slow >= 30, 'slow entries included: ' + slow);
  assert.equal(zero, 0, 'no cell collapses to exactly 0.0 deg any more');
  assert.ok(maxAbs < 88, 'entry angles stay away from +-90 deg (sine encoding: truncation < 1/32767/cos(angle) rad, 0.05 deg at 88): max |angle| ' + maxAbs);
});

test("'descending' at BASE: no angle is exactly 0, more cells pass than with the segment formula, no rising cell passes", () => {
  const X = I.ext('entry'), fine = I.fineStage(s.p, s.table, s.grid, I.selectAim(V, s.p, s.mo, s.sh, s.bp, false), s.mo, s.sh, s.bp).view;
  const rc = rectCells(fine), fd = X.filterView(fine, { rule: 'descending' }), sm = X.summary(fd.unfiltered, fd);
  assert.equal(rc.length, 6061);
  assert.equal(rc.filter((i) => fine.entry[2 * i] === 0).length, 0);
  assert.ok(sm.kept > 5085 + 300, `descending kept ${sm.kept} (segment formula: 5085 of 6061, 776 exact zeros)`);
  const nearZero = rc.filter((i) => Math.abs(fine.entry[2 * i]) < 6), rand = rng(3);
  for (const i of pick(nearZero, 150, rand)) {
    const k = cell(fine, i), r = I.classifyCore(s.p, s.grid.ctx, s.table.K, s.table.S0, k.th, k.v, k.yaw);
    const ref = refAngle(s.table.S0, k.th, k.v, r.tToCell), kept = fd.rectHits[i] === 1;
    if (kept) assert.ok(ref < 0.1, `rising cell admitted: true ${ref}`);        // never admits a rising cell
    else assert.ok(ref > -0.1, `descending cell dropped: true ${ref}`);          // no false drop beyond the 0.1 deg tolerance
  }
});

test('abuf is optional and does not change the path: fly() with and without it gives identical positions', () => {
  const t = s.table, a = new Int16Array(2 * 400), b = new Int16Array(2 * 400), ab = new Int16Array(400), ia = new Int32Array(4), ib = new Int32Array(4);
  for (const [th, v] of [[55, 6], [20, 3.2], [80, 1.4]]) {
    const na = I.fly(t.K, t.S0, th, v, a, ia), nb = I.fly(t.K, t.S0, th, v, b, ib, undefined, ab);
    assert.equal(na, nb);
    assert.deepEqual(a.slice(0, 2 * na), b.slice(0, 2 * nb));
    assert.deepEqual(Array.from(ia), Array.from(ib));
    assert.equal(ab[0], Math.trunc(32767 * Math.sin(th * DEG)));   // sine encoding, Int16 x 32767
    assert.ok(ab[nb - 1] < 0 && ab[nb - 1] > -32767, 'descending at the end of a lob: ' + ab[nb - 1]);
  }
  for (let idx = 0; idx < t.trajs.length; idx += 997) assert.equal(t.angs[idx].length, t.lens[idx]);
});

// ---- res.entry.coarse (#12b): what the rule removed from the coarse grid, even when the final (fine) view reads dropped = 0
test('res.entry.coarse: non-zero dropped at (-60,-60), adjustable hood 45-80, descending; final dropped may be 0', () => {
  const sp = { ...BASE, robot: { x: -60, y: -60 }, hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 } };
  const any = E.evaluate({ ...sp, entry: { rule: 'any' } }, 'full').entry, d = E.evaluate({ ...sp, entry: { rule: 'descending' } }, 'full').entry;
  assert.deepEqual(Object.keys(d.coarse), ['kept', 'dropped']);
  assert.ok(d.coarse.dropped > 0 && d.coarse.kept > 0, JSON.stringify(d.coarse));
  assert.equal(d.coarse.kept + d.coarse.dropped, any.coarse.kept, 'coarse before-filter count = the any-rule coarse count');
  assert.deepEqual(any.coarse, { kept: any.coarse.kept, dropped: 0 });
  assert.ok(d.kept > 0 && d.best.angleDeg < 0, 'final view unchanged in meaning: kept ' + d.kept + ', best ' + d.best.angleDeg);
  assert.ok(d.coarse.dropped > d.dropped, `coarse dropped ${d.coarse.dropped} vs final dropped ${d.dropped}`);
  const c = E.evaluate({ ...sp, entry: { rule: 'descending' } }, 'coarse').entry;   // coarse mode: final view IS the coarse view
  assert.deepEqual(c.coarse, { kept: c.kept, dropped: c.dropped });
});

// ---- asin decode needs vx >= 0 at the crossing: backspin lobs (launch >= 84 deg, v >= 5.5 m/s) have backward-moving segments (#12d)
test('lobs with backward-moving segments: the crossing segment moves forward and the angle matches the float reference within 0.1 deg', () => {
  const q0 = setup(BASE), t = q0.table, buf = new Int16Array(4000), info = new Int32Array(4);
  const backward = (th, v) => { I.fly(t.K, t.S0, th, v, buf, info); for (let k = 1; k < info[0]; k++) if (buf[2 * k] < buf[2 * k - 2]) return true; return false; };
  let nb = 0; for (const P of t.trajs) for (let k = 1; k < P.length / 2; k++) if (P[2 * k] < P[2 * k - 2]) { nb++; break; }
  assert.ok(nb >= 100, 'table has trajectories that move backwards: ' + nb);
  let checked = 0, steep = 0, maxAbs = 0;
  for (const [x, y] of [[-42, -18], [-36, -18], [-36, -24]]) {
    const q = setup({ ...BASE, robot: { x, y } }), ps = q.grid.ctx.psi0;
    const fine = I.fineStage(q.p, q.table, q.grid, { theta: 87, v: 15, yaw: ps, sigV: 0.02 }, q.mo, q.sh, q.bp, { theta: 87, thSpan: 3, vSpanLn: 0.5, yawSpan: 6, skipAim: true }).view;
    for (const view of [q.view, fine]) {
      const cs = rectCells(view).filter((i) => { const k = cell(view, i); return k.th >= 84 && backward(k.th, k.v); });
      cs.sort((i, j) => Math.abs(view.entry[2 * j]) - Math.abs(view.entry[2 * i]));   // steepest first, then a deterministic spread
      for (const i of [...cs.slice(0, 25), ...cs.slice(25).filter((_, n) => n % 12 === 0)]) {
        const k = cell(view, i), r = I.classifyCore(q.p, q.grid.ctx, t.K, t.S0, k.th, k.v, k.yaw);
        I.fly(t.K, t.S0, k.th, k.v, buf, info);
        const seg = Math.floor(r.tToCell / 0.005 + 1e-9) + 1;
        assert.ok(buf[2 * seg] - buf[2 * seg - 2] > 0, `crossing segment moves backwards: cell ${i} th ${k.th} v ${k.v.toFixed(2)}`);
        const ref = refAngle(t.S0, k.th, k.v, r.tToCell);
        assert.ok(Math.abs(r.entryAngleDeg - ref) <= 0.1, `${r.entryAngleDeg} vs ${ref}`);
        assert.ok(Math.abs(view.entry[2 * i] - ref) <= 0.1, `view.entry ${view.entry[2 * i]} vs ${ref}`);
        checked++; maxAbs = Math.max(maxAbs, Math.abs(ref)); if (Math.abs(ref) > 84) steep++;
      }
    }
  }
  assert.ok(checked >= 100 && steep >= 20, `cells checked ${checked}, steeper than 84 deg ${steep}, max |angle| ${maxAbs}`);
});
