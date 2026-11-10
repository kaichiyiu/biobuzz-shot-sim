import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './load-data.mjs';

const require = createRequire(import.meta.url);
const W = require(path.join(ROOT, 'src', 'ui-window.js'));
const U = require(path.join(ROOT, 'src', 'units.js'));

const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
W.init({ nf, U, fmtSpeed: (v, d) => U.fmtSpeed(v, d), E: { motorModel: (id, sh, ball, v) => ({ motorRpm: v * 100 }) } });

const row = (deltaDeg, widthRatio, rpmWindow, nominalStillScores = true) => ({ deltaDeg, widthRatio, rpmWindow, nominalStillScores });
const WINDOW = { motorRpm: [2000, 2100] };

test('sensitivityItem: widthRatio 0 or a missing rpm window reads "no window", never "0% as wide"', () => {
  const h = { sensitivity: [row(-1, 0, null, false), row(1, 0.88, WINDOW), row(-2, 0.5, WINDOW), row(2, 0.4, WINDOW)] };
  const it = W.sensitivityItem(h);
  assert.equal(it.value, '−1°: no window · +1°: 88% as wide');
  assert.ok(!/0% as wide/.test(it.value.replace('88% as wide', '')));
  assert.match(it.small, /stops scoring/);
  assert.equal(W.sensitivityText(row(1, null, WINDOW)), '+1°: no window');
  assert.equal(W.sensitivityText(row(1, 0, WINDOW)), '+1°: no window');
  assert.equal(W.sensitivityText(row(-1, 0.5, null)), '−1°: no window');
});

test('sensitivityItem: both sides fine, and nothing for fixed / missing data', () => {
  const it = W.sensitivityItem({ sensitivity: [row(1, 0.9, WINDOW), row(-1, 0.95, WINDOW)] });
  assert.equal(it.value, '−1°: 95% as wide · +1°: 90% as wide');
  assert.match(it.small, /still scores at both/);
  assert.equal(W.sensitivityItem({ sensitivity: null }), null);
  assert.equal(W.sensitivityItem(undefined), null);
  assert.equal(W.sensitivityItem({ sensitivity: [row(2, 0.5, WINDOW)] }), null);
});

const P = { motorId: 'm', ballId: 'pollen', shooter: { type: 'single', etaSingle: 0.45 } };
const best = (extra) => ({ best: Object.assign({ windows: { thetaDeg: [60, 64], v: [6, 7], yawDeg: [85, 95] } }, extra) });

test('items: rectangular window rows, note, moved line; pentagon fallback; null window message', () => {
  const sw = { thetaDeg: [61, 63], v: [6.2, 6.8], yawDeg: [86, 94], motorRpm: [2600, 2720], clippedByMotor: true,
    moved: true, opening: { widthIn: 20, heightIn: 7.61 } };
  const rows = W.items(best({ scoringWindow: sw }), P);
  assert.deepEqual(rows.map((r) => r.label), ['Yaw', 'Launch angle', 'Speed', 'Note', 'Exit efficiency']);
  assert.equal(rows[0].value, '86.0° – 94.0°');
  assert.equal(rows[2].small, '2,600–2,720 rpm · limited by motor');
  assert.equal(W.note(sw), 'Rectangular opening assumed (20.0 × 7.6 in), so results stay consistent across the yaw range');
  const fallback = W.items(best({}), P);               // scoringWindow absent: pentagon windows, no note, rpm from motorModel
  assert.equal(fallback[1].value, '60.0° – 64.0°');
  assert.equal(fallback[2].small, '600–700 rpm');
  assert.equal(W.note(undefined), '');
  const none = W.items(best({ scoringWindow: null }), P);
  assert.equal(none.length, 1);
  assert.match(none[0].value, /No shot fits the rectangular opening/);
  assert.deepEqual(W.items({ best: null }, P), []);
});

test('items: a yaw range crossing 0 / 360 is printed as an arrow range', () => {
  const sw = { thetaDeg: [60, 62], v: [6, 7], yawDeg: [-5, 5], motorRpm: [1, 2], opening: { widthIn: 20, heightIn: 7.6 } };
  assert.equal(W.items(best({ scoringWindow: sw }), P)[0].value, '355.0° → 5.0°');
});
