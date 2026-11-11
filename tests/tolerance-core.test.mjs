// #7 tolerance core: largest all-ones box on synthetic grids H[(a * nB + b) * nC + c]; summed-volume table; breakpoint exactness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { largestBox, summedVolume, boxSum } = createRequire(import.meta.url)('../src/engine-tolerance-core.js');
const idx = (d, a, b, c) => (a * d[1] + b) * d[2] + c;
const ones = (d) => new Uint8Array(d[0] * d[1] * d[2]).fill(1);
const at = (s, x, msg) => assert.ok(Math.abs(s - x) < 1e-12, `${msg}: ${s} == ${x}`);   // conservative core: s is the last good breakpoint, attained
const q = (H, dims, center, neg, pos, extra = {}) => largestBox({ H, dims, center, neg, pos, ...extra });
function prng(seed) { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; }

test('full grid: s = sMax, not view-limited, no limiting axis', () => {
  const d = [9, 9, 9], r = q(ones(d), d, [4, 4, 4], [1, 1, 1], [1, 1, 1], { sMax: 2.5 });
  assert.equal(r.s, 2.5); assert.equal(r.viewLimited, false); assert.equal(r.limitingAxis, null); assert.equal(r.limitingSide, null);
  assert.deepEqual(r.perAxis, [2.5, 2.5, 2.5]);
  assert.ok(r.resolution > 0 && r.resolution <= 1);
});

test('full grid without sMax: the view edge limits, margin is a lower bound (viewLimited), tie -> lowest axis, low side', () => {
  const d = [9, 9, 9], r = q(ones(d), d, [4, 4, 4], [1, 1, 1], [1, 1, 1]);
  at(r.s, 4, 'edge: ceil(5) = 5 cells leaves the 4-cell room'); assert.equal(r.viewLimited, true);
  assert.deepEqual([r.limitingAxis, r.limitingSide], [0, -1]);
  const e = q(ones(d), d, [4, 4, 1], [1, 1, 1], [1, 1, 1]);   // yaw centre one cell from the low edge
  at(e.s, 1, 'yaw edge'); assert.deepEqual([e.limitingAxis, e.limitingSide, e.viewLimited], [2, -1, true]);
  const o = q(ones(d), d, [4, 7, 4], [1, 1, 1], [1, 1, 1]);   // speed centre one cell from the high edge: step 2 leaves the view
  at(o.s, 1, 'speed edge'); assert.deepEqual([o.limitingAxis, o.limitingSide], [1, 1]);
});

test('single hole at distance 3 along b, pos[1] = 1: s = 2 (ceil(2.01) = 3 cells would reach it), axis 1, side +1, exact (not view-limited)', () => {
  const d = [15, 15, 15], H = ones(d); H[idx(d, 7, 10, 7)] = 0;
  const r = q(H, d, [7, 7, 7], [1, 1, 1], [1, 1, 1]);
  at(r.s, 2, 'hole'); assert.deepEqual([r.limitingAxis, r.limitingSide, r.viewLimited], [1, 1, false]);
  assert.equal(r.sHi, 3); assert.equal(r.sLo, 2); assert.equal(r.resolution, 1);
  at(r.perAxis[1], 2, 'perAxis b'); at(r.perAxis[0], 7, 'perAxis a'); at(r.perAxis[2], 7, 'perAxis c');
  const z = q(H, d, [7, 7, 7], [1, 1, 1], [1, 0, 1]);   // pos[1] = 0: that side never extends, the hole is never reached
  assert.notEqual(z.limitingAxis, 1); at(z.s, 7, 'edge of the 7-cell room');
});

test('asymmetric neg / pos are honoured per side', () => {
  const d = [15, 15, 15], H = ones(d); H[idx(d, 4, 7, 7)] = 0;   // hole at a = centre - 3
  const r = q(H, d, [7, 7, 7], [2, 1, 1], [1, 1, 1]);
  at(r.s, 1, 'neg[0] = 2: ceil(2s) = 3 cells for s > 1'); assert.deepEqual([r.limitingAxis, r.limitingSide], [0, -1]);
  const p = q(H, d, [7, 7, 7], [1, 1, 1], [2, 1, 1]);   // the hole is on the low side: pos[0] = 2 must not reach it
  at(p.s, 2, 'neg[0] = 1: ceil(s) = 3 for s > 2'); assert.deepEqual([p.limitingAxis, p.limitingSide], [0, -1]);
  const w = q(H, d, [7, 7, 7], [0, 1, 1], [5, 1, 1]);   // low side of a is fixed: the hole is never reached
  at(w.s, 7 / 5, 'a+: ceil(5s) = 8 > room 7 for s > 7/5'); assert.deepEqual([w.limitingAxis, w.limitingSide, w.viewLimited], [0, 1, true]);
  const yaw = ones(d); yaw[idx(d, 7, 7, 11)] = 0;   // hole at c + 4
  const y = q(yaw, d, [7, 7, 7], [1, 1, 1], [1, 1, 2]);
  at(y.s, 1.5, 'pos[2] = 2: ceil(2s) = 4 for s > 1.5'); assert.deepEqual([y.limitingAxis, y.limitingSide], [2, 1]);
});

test('centre cell 0 -> s = 0; zero tolerance axes are unconstrained', () => {
  const d = [7, 7, 7], H = ones(d); H[idx(d, 3, 3, 3)] = 0;
  const r = q(H, d, [3, 3, 3], [1, 1, 1], [1, 1, 1]);
  assert.equal(r.s, 0); assert.deepEqual(r.perAxis, [0, 0, 0]); assert.equal(r.limitingAxis, null);
  const G = ones(d); G[idx(d, 3, 5, 3)] = 0;
  const u = q(G, d, [3, 3, 3], [0, 1, 0], [0, 1, 0], { sMax: 10 });   // only b constrained
  at(u.s, 1, 'only b'); assert.deepEqual([u.limitingAxis, u.limitingSide], [1, 1]);
  assert.equal(u.perAxis[0], 10); assert.equal(u.perAxis[2], 10);
  const n = q(G, d, [3, 3, 3], [0, 0, 0], [0, 0, 0], { sMax: 4 });   // nothing constrained
  assert.equal(n.s, 4); assert.equal(n.viewLimited, false);
  assert.equal(q(G, d, [3, 3, 3], [0, 0, 0], [0, 0, 0]).s, Infinity);
});

test('a centre outside the view is unknown: s = 0, viewLimited', () => {
  const d = [5, 5, 5], r = q(ones(d), d, [5, 2, 2], [1, 1, 1], [1, 1, 1]);
  assert.equal(r.s, 0); assert.equal(r.viewLimited, true);
});

test('summed-volume box sums equal brute force on 200 random boxes', () => {
  const rnd = prng(7), d = [6, 9, 7], H = new Uint8Array(d[0] * d[1] * d[2]).map(() => (rnd() < 0.6 ? 1 : 0)), S = summedVolume(H, d);
  assert.ok(S instanceof Int32Array); assert.equal(S.length, 7 * 10 * 8);
  for (let t = 0; t < 200; t++) {
    const lo = d.map((n) => Math.floor(rnd() * n)), hi = lo.map((l, i) => l + Math.floor(rnd() * (d[i] - l)));
    let n = 0;
    for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) n += H[idx(d, a, b, c)];
    assert.equal(boxSum(S, d, lo, hi), n);
  }
});

// independent reference: integer k, breakpoint s = m / kd, extent_j = ceil(m * k_j / kd) in exact integer arithmetic.
// Returns [first failing breakpoint, last good breakpoint before it (0 if none)], or null when nothing ever fails.
function reference(H, d, cen, neg, pos) {
  const ks = [neg[0], pos[0], neg[1], pos[1], neg[2], pos[2]], fr = [];
  for (const kd of ks) if (kd > 0) for (let m = 1; m <= 20; m++) fr.push([m / kd, m, kd]);
  fr.sort((x, y) => x[0] - y[0]);
  const okBox = (m, kd) => {
    const e = ks.map((k) => Math.floor((m * k + kd - 1) / kd)), lo = [cen[0] - e[0], cen[1] - e[2], cen[2] - e[4]], hi = [cen[0] + e[1], cen[1] + e[3], cen[2] + e[5]];
    for (let i = 0; i < 3; i++) if (lo[i] < 0 || hi[i] >= d[i]) return false;
    for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) if (!H[idx(d, a, b, c)]) return false;
    return true;
  };
  let prev = 0;
  for (const [v, m, kd] of fr) { if (!okBox(m, kd)) return [v, prev]; prev = v; }
  return null;
}

test('bisection over breakpoints == linear scan with exact integer arithmetic (random grids, integer k incl. 49)', () => {
  const rnd = prng(11), d = [11, 13, 9];
  for (let t = 0; t < 60; t++) {
    const H = new Uint8Array(d[0] * d[1] * d[2]).map(() => (rnd() < 0.985 ? 1 : 0)), cen = [5, 6, 4];
    H[idx(d, ...cen)] = 1;
    const k = () => [1, 2, 3, 7, 49, 0][Math.floor(rnd() * 6)], neg = [k(), k(), k()], pos = [k(), k(), k()];
    const r = q(H, d, cen, neg, pos, { sMax: 1e9 }), want = reference(H, d, cen, neg, pos);
    if (want === null) { assert.equal(r.s, 1e9, `t${t} unconstrained`); continue; }
    assert.equal(r.sHi, want[0], `t${t} first failing breakpoint`); assert.equal(r.sLo, want[1], `t${t} last good breakpoint`);
    assert.equal(r.s, r.sLo, `t${t} s = last good breakpoint`);
  }
});

test('breakpoint exactness: k = 49, hole at distance 1 -> s = 0; hole at distance 2 -> s = 1/49 exactly (no float tolerance)', () => {
  assert.equal(Math.floor((1 / 49) * 49), 0);   // the float trap the exact breakpoint list avoids
  const d = [5, 5, 5], H = ones(d); H[idx(d, 3, 2, 2)] = 0;
  const r = q(H, d, [2, 2, 2], [49, 49, 49], [49, 49, 49]);
  assert.equal(r.sHi, 1 / 49); assert.equal(r.s, 0); assert.deepEqual([r.limitingAxis, r.limitingSide], [0, 1]);   // any s > 0 already needs the neighbour cell
  const G = ones(d); G[idx(d, 4, 2, 2)] = 0;
  const g = q(G, d, [2, 2, 2], [49, 49, 49], [49, 49, 49]);
  assert.equal(g.s, 1 / 49); assert.equal(g.sHi, 2 / 49); assert.deepEqual([g.limitingAxis, g.limitingSide], [0, 1]);
});

test('monotone in s: the box (ceil extents) is all ones for every s up to the result and fails anywhere in (sLo, sHi]', () => {
  const rnd = prng(3), d = [12, 12, 12];
  for (let t = 0; t < 30; t++) {
    const H = new Uint8Array(1728).map(() => (rnd() < 0.97 ? 1 : 0)), cen = [6, 6, 6]; H[idx(d, ...cen)] = 1;
    const neg = [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3], pos = [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3];
    const r = q(H, d, cen, neg, pos);
    const box = (s) => {
      const lo = cen.map((c, i) => c - Math.ceil(s * neg[i])), hi = cen.map((c, i) => c + Math.ceil(s * pos[i]));
      if (lo.some((v) => v < 0) || hi.some((v, i) => v >= d[i])) return 'edge';
      for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) if (!H[idx(d, a, b, c)]) return 'hole';
      return 'ok';
    };
    for (let i = 0; i <= 40; i++) assert.equal(box((r.s * (1 - 1e-9) * i) / 40), 'ok', `t${t} s*${i}/40`);
    const over = (r.sLo + r.sHi) / 2;
    assert.notEqual(box(over), 'ok', `t${t} just over`); assert.notEqual(box(r.sHi), 'ok', `t${t} at sHi`);
    assert.equal(r.viewLimited, box(over) === 'edge' && r.viewLimited);
  }
});

test('sMax is checked like a breakpoint: a hole at distance 3 stops s = 2.5 at 2 (ceil(2.5) = 3 cells), a hole at 4 does not', () => {
  const d = [15, 15, 15], H = ones(d); H[idx(d, 7, 10, 7)] = 0;
  const r = q(H, d, [7, 7, 7], [1, 1, 1], [1, 1, 1], { sMax: 2.5 });
  assert.equal(r.s, 2); assert.deepEqual([r.limitingAxis, r.limitingSide], [1, 1]); assert.equal(r.sHi, 2.5);
  const G = ones(d); G[idx(d, 7, 11, 7)] = 0;
  assert.equal(q(G, d, [7, 7, 7], [1, 1, 1], [1, 1, 1], { sMax: 2.5 }).s, 2.5);
});
