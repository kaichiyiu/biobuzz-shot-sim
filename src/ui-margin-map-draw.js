/* BIOBUZZ Shot Sim - #15 margin map: pure helpers and the canvas drawing. Browser: window.MarginMapDraw. Node: module.exports.
   Cell = MarginCell of src/worker-margin.js. No verdicts (owner decision): one sequential ramp (token 'ramp' = --focus) + alpha, for margin (0 .. CAP x) and for the rpm window width.
   A thin contour marks margin = 1 (the reference "your +- limits just fit"). */
(function (root) {
  'use strict';
  var AXIS = { angle: 'launch angle', rpm: 'motor speed', yaw: 'aim (yaw)', along: 'position along the shot line' };
  var TOKEN_VAR = { ramp: '--focus' };
  var CAP = 2;   // margins >= CAP x get the strongest colour

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  // cache key of a run: every param except the mouth position (the height stays, it changes the results)
  function paramsKey(p) { return JSON.stringify(Object.assign({}, p, { mouth: { height: p && p.mouth ? p.mouth.height : undefined } })); }
  function rampMax(cells) {
    var m = 1;
    (cells || []).forEach(function (c) { if (c && c.feasible && typeof c.rpmWidthPct === 'number' && c.rpmWidthPct > m) m = c.rpmWidthPct; });
    return m;
  }
  // -> { token, alpha, hatch } | null (no fill). mode 'margin' | 'rpm'; max = rampMax(cells)
  function colourFor(cell, mode, max) {
    if (!cell) return null;
    if (cell.feasible === false) return { token: null, alpha: 0, hatch: true };
    if (mode === 'rpm') {
      if (typeof cell.rpmWidthPct !== 'number') return null;
      return { token: 'ramp', alpha: 0.12 + 0.78 * clamp01(cell.rpmWidthPct / (max || 1)), hatch: false };
    }
    var m = cell.margin;
    if (typeof m !== 'number' || !isFinite(m)) return null;
    return { token: 'ramp', alpha: 0.08 + 0.82 * clamp01(m / CAP), hatch: false };
  }
  // cell under (x, y) in engine inches: |dx|,|dy| <= steps[pass] / 2, nearest centre wins
  function nearestCell(cells, steps, x, y) {
    var best = null, bd = Infinity;
    (cells || []).forEach(function (c) {
      var h = (steps[c.pass] || steps[steps.length - 1]) / 2, dx = x - c.x, dy = y - c.y;
      if (Math.abs(dx) > h || Math.abs(dy) > h) return;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  function describe(c) {
    if (!c) return [];
    if (c.feasible === false) return ['Robot does not fit: ' + (c.reason === 'hive' ? 'touches the HIVE' : 'touches the wall')];
    var out = [], m = c.margin;
    if (typeof m === 'number' && isFinite(m)) out.push('Margin ' + (c.lowerBound || c.capped ? '≥ ' : '') + m.toFixed(2) + '×');
    else out.push('No margin');
    if (c.limitingAxis && !c.capped) out.push('Limited by ' + (AXIS[c.limitingAxis] || c.limitingAxis));
    if (typeof c.rpmWidthPct === 'number') out.push('Motor window ' + c.rpmWidthPct.toFixed(1) + ' % wide');
    if (typeof c.motorRpm === 'number') out.push('Motor ≈ ' + Math.round(c.motorRpm) + ' rpm');
    return out;
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
  function hatchPattern(ctx, colour) {
    var pc = document.createElement('canvas'); pc.width = pc.height = 6;
    var g = pc.getContext('2d'); g.fillStyle = colour; g.globalAlpha = 0.18; g.fillRect(0, 0, 6, 6);
    g.globalAlpha = 0.55; g.strokeStyle = colour; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke();
    return ctx.createPattern(pc, 'repeat');
  }
  // o: { mode, steps, final (run finished: every cell is drawn at the fine step, no double-blended coarse underlay), field: {sx, sy, k}, size (css px), dpr }
  function draw(canvas, cells, o) {
    var ctx = canvas.getContext('2d'), F = o.field, K = F.k(), max = rampMax(cells), pat = null;
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); ctx.clearRect(0, 0, o.size, o.size);
    var col = {}; Object.keys(TOKEN_VAR).forEach(function (t) { col[t] = cssVar(TOKEN_VAR[t]); });
    var order = (cells || []).slice().sort(function (a, b) { return a.pass - b.pass; });   // coarse first, fine on top
    order.forEach(function (c) {
      var f = colourFor(c, o.mode, max); if (!f) return;
      var s = o.final ? o.steps[o.steps.length - 1] : o.steps[c.pass] || o.steps[o.steps.length - 1], px = F.sx(c.x - s / 2), py = F.sy(c.y + s / 2), w = s * K;
      if (f.hatch) { pat = pat || hatchPattern(ctx, cssVar('--ink-3')); ctx.globalAlpha = 1; ctx.fillStyle = pat; }
      else { ctx.globalAlpha = f.alpha; ctx.fillStyle = col[f.token]; }
      ctx.fillRect(px, py, w, w);
    });
    ctx.globalAlpha = 1;
    if (o.mode === 'margin') contour(ctx, order, o);
  }
  // margin = 1 reference: an edge of a cell with margin >= 1 that touches a same-pass neighbour with margin < 1
  function contour(ctx, cells, o) {
    var F = o.field, at = {}, num = function (c) { return c && typeof c.margin === 'number' && isFinite(c.margin); };
    cells.forEach(function (c) { at[(o.final ? 0 : c.pass) + ':' + c.x + ',' + c.y] = c; });
    ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 1.5; ctx.beginPath();
    cells.forEach(function (c) {
      if (!num(c) || c.margin < 1) return;
      var s = o.final ? o.steps[o.steps.length - 1] : o.steps[c.pass] || o.steps[o.steps.length - 1], h = s / 2;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var n = at[(o.final ? 0 : c.pass) + ':' + (c.x + d[0] * s) + ',' + (c.y + d[1] * s)];
        if (!num(n) || n.margin >= 1) return;
        var x0 = c.x + (d[0] ? d[0] * h : -h), y0 = c.y + (d[1] ? d[1] * h : -h), x1 = c.x + (d[0] ? d[0] * h : h), y1 = c.y + (d[1] ? d[1] * h : h);
        ctx.moveTo(F.sx(x0), F.sy(y0)); ctx.lineTo(F.sx(x1), F.sy(y1));
      });
    });
    ctx.stroke(); ctx.lineWidth = 1;
  }

  var api = { AXIS: AXIS, TOKEN_VAR: TOKEN_VAR, paramsKey: paramsKey, CAP: CAP, colourFor: colourFor, rampMax: rampMax, nearestCell: nearestCell, describe: describe, draw: draw };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarginMapDraw = api;
})(typeof self !== 'undefined' ? self : this);
