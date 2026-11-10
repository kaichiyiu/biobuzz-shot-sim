import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './load-data.mjs';

const U = createRequire(import.meta.url)(path.join(ROOT, 'src', 'units.js'));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const CORNERS = Object.keys(U.CORNERS);
// counter-clockwise distance from `from` to `x`, 0..360
const ccw = (from, x) => (((x - from) % 360) + 360) % 360;

test('headingRangeToUser: every engine heading inside the range lands inside the user range, all 4 corners', () => {
  for (const c of CORNERS) {
    for (const [lo, hi] of [[84.9, 90.3], [10, 40], [170, 200], [-20, 15], [260, 275]]) {
      const r = U.headingRangeToUser(lo, hi, c);
      const width = hi - lo;
      near(ccw(r.from, r.to === 360 ? 0 : r.to), width % 360, `${c} ${lo}..${hi} width`);
      for (let i = 0; i <= 20; i++) {
        const h = U.headingToUser(lo + (width * i) / 20, c);
        assert.ok(ccw(r.from, h) <= width + 1e-9, `${c} ${lo}..${hi}: ${h} not within ${r.from}..${r.to}`);
      }
      assert.ok(r.from >= 0 && r.from < 360 && r.to >= 0 && r.to <= 360, `${c} bounds`);
    }
  }
});

test('headingRangeToUser: red-audience is the identity frame', () => {
  const r = U.headingRangeToUser(84.9, 90.3, 'red-audience');
  near(r.from, 84.9, 'from'); near(r.to, 90.3, 'to');
  assert.equal(r.wraps, false);
});

test('headingRangeToUser: mirrored corners swap the ends but stay ordered counter-clockwise', () => {
  const a = U.headingRangeToUser(84.9, 90.3, 'blue-audience');   // 180 - h
  near(a.from, 180 - 90.3, 'blue-audience from'); near(a.to, 180 - 84.9, 'blue-audience to');
  const b = U.headingRangeToUser(84.9, 90.3, 'red-far');         // -h
  near(b.from, 360 - 90.3, 'red-far from'); near(b.to, 360 - 84.9, 'red-far to');
  const d = U.headingRangeToUser(84.9, 90.3, 'blue-far');        // h + 180 (rotation, not a mirror)
  near(d.from, 84.9 + 180, 'blue-far from'); near(d.to, 90.3 + 180, 'blue-far to');
  for (const r of [a, b, d]) { assert.ok(r.from < r.to); assert.equal(r.wraps, false); }
});

test('headingRangeToUser: a range crossing 0 / 360 is flagged and never reversed', () => {
  const r = U.headingRangeToUser(-5, 5, 'red-audience');
  near(r.from, 355, 'from'); near(r.to, 5, 'to');
  assert.equal(r.wraps, true);
  const m = U.headingRangeToUser(85, 95, 'red-far');             // mirrored: 360-95 .. 360-85 = 265..275, no wrap
  assert.equal(m.wraps, false);
  const w = U.headingRangeToUser(175, 185, 'blue-audience');     // 180-185 = -5 -> 355 .. 5
  near(w.from, 355, 'blue-audience wrap from'); near(w.to, 5, 'blue-audience wrap to');
  assert.equal(w.wraps, true);
});

test('headingRangeToUser: uses the current corner when none is given', () => {
  U.setCorner('blue-audience');
  const r = U.headingRangeToUser(84.9, 90.3);
  near(r.from, 89.7, 'from'); near(r.to, 95.1, 'to');
  U.setCorner(U.DEFAULT_CORNER);
});
