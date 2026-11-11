// #7 tolerance core: largest all-ones box on synthetic grids H[(a * nB + b) * nC + c]; summed-volume table; breakpoint exactness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { largestBox, summedVolume, boxSum } = createRequire(import.meta.url)('../src/engine-tolerance-core.js');
const idx = (d, a, b, c) => (a * d[1] + b) * d[2] + c;
const ones = (d) => new Uint8Array(d[0] * d[1] * d[2]).fill(1);
const below = (s, x, msg) => assert.ok(s < x && s > x * (1 - 1e-6), `${msg}: ${s} just under ${x}`);
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
  below(r.s, 5, 'edge'); assert.equal(r.viewLimited, true);
  assert.deepEqual([r.limitingAxis, r.limitingSide], [0, -1]);
  const e = q(ones(d), d, [4, 4, 1], [1, 1, 1], [1, 1, 1]);   // yaw centre one cell from the low edge
  below(e.s, 2, 'yaw edge'); assert.deepEqual([e.limitingAxis, e.limitingSide, e.viewLimited], [2, -1, true]);
  const o = q(ones(d), d, [4, 7, 4], [1, 1, 1], [1, 1, 1]);   // speed centre one cell from the high edge: step 2 leaves the view
  below(o.s, 2, 'speed edge'); assert.deepEqual([o.limitingAxis, o.limitingSide], [1, 1]);
});

test('single hole at distance 3 along b, pos[1] = 1: s just under 3, axis 1, side +1, exact (not view-limited)', () => {
  const d = [15, 15, 15], H = ones(d); H[idx(d, 7, 10, 7)] = 0;
  const r = q(H, d, [7, 7, 7], [1, 1, 1], [1, 1, 1]);
  below(r.s, 3, 'hole'); assert.deepEqual([r.limitingAxis, r.limitingSide, r.viewLimited], [1, 1, false]);
  assert.equal(r.sHi, 3); assert.equal(r.sLo, 2); assert.equal(r.resolution, 1);
  below(r.perAxis[1], 3, 'perAxis b'); below(r.perAxis[0], 8, 'perAxis a'); below(r.perAxis[2], 8, 'perAxis c');
  const z = q(H, d, [7, 7, 7], [1, 1, 1], [1, 0, 1]);   // pos[1] = 0: that side never extends, the hole is never reached
  assert.notEqual(z.limitingAxis, 1); assert.ok(z.s > 7);
});

test('asymmetric neg / pos are honoured per side', () => {
  const d = [15, 15, 15], H = ones(d); H[idx(d, 4, 7, 7)] = 0;   // hole at a = centre - 3
  const r = q(H, d, [7, 7, 7], [2, 1, 1], [1, 1, 1]);
  below(r.s, 1.5, 'neg[0] = 2 reaches distance 3 at s = 1.5'); assert.deepEqual([r.limitingAxis, r.limitingSide], [0, -1]);
  const p = q(H, d, [7, 7, 7], [1, 1, 1], [2, 1, 1]);   // the hole is on the low side: pos[0] = 2 must not reach it
  below(p.s, 3, 'neg[0] = 1'); assert.deepEqual([p.limitingAxis, p.limitingSide], [0, -1]);
  const w = q(H, d, [7, 7, 7], [0, 1, 1], [5, 1, 1]);   // low side of a is fixed: the hole is never reached
  below(w.s, 8 / 5, 'a+ runs out of view at m = 8'); assert.deepEqual([w.limitingAxis, w.limitingSide, w.viewLimited], [0, 1, true]);
  const yaw = ones(d); yaw[idx(d, 7, 7, 11)] = 0;   // hole at c + 4
  const y = q(yaw, d, [7, 7, 7], [1, 1, 1], [1, 1, 2]);
  below(y.s, 2, 'pos[2] = 2'); assert.deepEqual([y.limitingAxis, y.limitingSide], [2, 1]);
});

test('centre cell 0 -> s = 0; zero tolerance axes are unconstrained', () => {
  const d = [7, 7, 7], H = ones(d); H[idx(d, 3, 3, 3)] = 0;
  const r = q(H, d, [3, 3, 3], [1, 1, 1], [1, 1, 1]);
  assert.equal(r.s, 0); assert.deepEqual(r.perAxis, [0, 0, 0]); assert.equal(r.limitingAxis, null);
  const G = ones(d); G[idx(d, 3, 5, 3)] = 0;
  const u = q(G, d, [3, 3, 3], [0, 1, 0], [0, 1, 0], { sMax: 10 });   // only b constrained
  below(u.s, 2, 'only b'); assert.deepEqual([u.limitingAxis, u.limitingSide], [1, 1]);
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

// independent reference: integer k, breakpoint s = m / kd, extent_j = floor(m * k_j / kd) in exact integer arithmetic
function reference(H, d, cen, neg, pos) {
  const ks = [neg[0], pos[0], neg[1], pos[1], neg[2], pos[2]], fr = [];
  for (const kd of ks) if (kd > 0) for (let m = 1; m <= 20; m++) fr.push([m / kd, m, kd]);
  fr.sort((x, y) => x[0] - y[0]);
  const okBox = (m, kd) => {
    const e = ks.map((k) => Math.floor((m * k) / kd)), lo = [cen[0] - e[0], cen[1] - e[2], cen[2] - e[4]], hi = [cen[0] + e[1], cen[1] + e[3], cen[2] + e[5]];
    for (let i = 0; i < 3; i++) if (lo[i] < 0 || hi[i] >= d[i]) return false;
    for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) if (!H[idx(d, a, b, c)]) return false;
    return true;
  };
  for (const [v, m, kd] of fr) if (!okBox(m, kd)) return v;
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
    assert.equal(r.sHi, want, `t${t} first failing breakpoint`); assert.ok(r.s < want && r.s >= r.sLo, `t${t} just under`);
  }
});

test('breakpoint exactness: k = 49, hole at distance 1 -> s < 1/49 (naive floor((1/49) * 49) = 0 would miss it)', () => {
  assert.equal(Math.floor((1 / 49) * 49), 0);   // the float trap this module avoids
  const d = [5, 5, 5], H = ones(d); H[idx(d, 3, 2, 2)] = 0;
  const r = q(H, d, [2, 2, 2], [49, 49, 49], [49, 49, 49]);
  assert.equal(r.sHi, 1 / 49); below(r.s, 1 / 49, '1/49'); assert.deepEqual([r.limitingAxis, r.limitingSide], [0, 1]);
});

test('monotone in s: the box is all ones for every s up to the result and fails right after it', () => {
  const rnd = prng(3), d = [12, 12, 12];
  for (let t = 0; t < 30; t++) {
    const H = new Uint8Array(1728).map(() => (rnd() < 0.97 ? 1 : 0)), cen = [6, 6, 6]; H[idx(d, ...cen)] = 1;
    const neg = [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3], pos = [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3];
    const r = q(H, d, cen, neg, pos);
    const box = (s) => {
      const lo = cen.map((c, i) => c - Math.floor(s * neg[i])), hi = cen.map((c, i) => c + Math.floor(s * pos[i]));
      if (lo.some((v) => v < 0) || hi.some((v, i) => v >= d[i])) return 'edge';
      for (let a = lo[0]; a <= hi[0]; a++) for (let b = lo[1]; b <= hi[1]; b++) for (let c = lo[2]; c <= hi[2]; c++) if (!H[idx(d, a, b, c)]) return 'hole';
      return 'ok';
    };
    for (let i = 0; i <= 40; i++) assert.equal(box((r.s * i) / 40), 'ok', `t${t} s*${i}/40`);
    assert.notEqual(box(r.sHi * (1 + 1e-6)), 'ok', `t${t} just over`);
    assert.equal(r.viewLimited, box(r.sHi * (1 + 1e-6)) === 'edge' && r.viewLimited);
  }
});
