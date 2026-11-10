/* BIOBUZZ Shot Sim - SVG helpers for the RPM-vs-distance card: element factory, nice ticks, axes and the "now" marker.
   Browser: window.ShotUI.plotAxes. Node: module.exports (niceStep / ticks are pure). */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function node(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function niceStep(span, n) {
    var raw = span / n;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function ticks(lo, hi, n) {
    var st = niceStep(hi - lo, n);
    var out = [];
    for (var v = Math.ceil(lo / st - 1e-9) * st; v <= hi + 1e-9; v += st) out.push(v);
    return out;
  }

  // c: { d0, d1, y0, y1, X, Y }; g: { W, H, M } plot geometry; D: UiDeps
  function drawAxes(svg, D, c, g) {
    var M = g.M;
    ticks(c.y0, c.y1, 4).forEach(function (v) {
      svg.appendChild(node('line', { class: 'grid', x1: M.l, x2: g.W - M.r, y1: c.Y(v), y2: c.Y(v) }));
      svg.appendChild(node('text', { x: M.l - 6, y: c.Y(v) + 4, 'text-anchor': 'end' }, D.nf(v, 0)));
    });
    ticks(D.U.toLen(c.d0), D.U.toLen(c.d1), 6).forEach(function (v) {
      var x = c.X(D.U.fromLen(v));
      svg.appendChild(node('line', { class: 'axis', x1: x, x2: x, y1: g.H - M.b, y2: g.H - M.b + 4 }));
      svg.appendChild(node('text', { x: x, y: g.H - M.b + 17, 'text-anchor': 'middle' }, D.nf(v, 0)));
    });
    svg.appendChild(node('line', { class: 'axis', x1: M.l, x2: g.W - M.r, y1: g.H - M.b, y2: g.H - M.b }));
    svg.appendChild(node('text', { x: M.l + (g.W - M.l - M.r) / 2, y: g.H - 6, 'text-anchor': 'middle' },
      'distance to the CELL (' + D.U.lenUnit() + ')'));
    svg.appendChild(node('text', { x: 4, y: 12 }, 'motor rpm'));
  }

  function drawMark(svg, D, c, g, markD) {
    if (markD == null || markD < c.d0 || markD > c.d1) return;
    var right = markD > (c.d0 + c.d1) / 2;
    svg.appendChild(node('line', { class: 'mark', x1: c.X(markD), x2: c.X(markD), y1: g.M.t, y2: g.H - g.M.b }));
    svg.appendChild(node('text', {
      x: c.X(markD), y: g.M.t + 11, 'text-anchor': right ? 'end' : 'start', dx: right ? -4 : 4
    }, 'now ' + D.fmtLen(markD, 0)));
  }

  var api = { node: node, niceStep: niceStep, ticks: ticks, drawAxes: drawAxes, drawMark: drawMark };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.plotAxes = api; }
})(typeof window !== 'undefined' ? window : {});
