/* BIOBUZZ Shot Sim - #2 RPM-vs-distance card (fixed hood): the motor rpm band that scores along the line from the mouth to the
   CELL, filled progressively by a background sweep. Colours come from CSS classes (tokens), so themes need no redraw.
   Browser: window.ShotUI.rpmPlot. */
(function (root) {
  'use strict';
  var W = 640;
  var H = 250;
  var M = { l: 58, r: 14, t: 28, b: 40 };
  var G = { W: W, H: H, M: M };
  var A = null;   // ShotUI.plotAxes
  var D = null;
  var svg = null;
  var rows = [];
  var dom = null;
  var markD = null;
  var msg = '';
  var total = 0;
  var running = false;
  var curKey = '';
  var stop = null;
  var gen = 0;   // bumped on every start / cancel, so rows of an older sweep are dropped

  function init(deps) {
    D = deps;
    A = root.ShotUI.plotAxes;
    svg = D.$('rpmPlot');
  }
  function mount(host) {
    svg = host;
    draw();
  }
  function node(tag, attrs, text) { return A.node(tag, attrs, text); }
  function hasWindow(r) { return !!r.motorRpm; }

  function start(key, pts) {
    gen++;
    rows = [];
    total = pts ? pts.length : 0;
    dom = pts && pts.length ? [pts[0].d, pts[pts.length - 1].d] : null;
    msg = '';
    running = true;
    curKey = key;
    draw();
  }
  function add(row, done, tot) {
    rows.push(row);
    rows.sort(function (a, b) { return a.d - b.d; });
    if (tot) total = tot;
    draw();
  }
  function done() {
    running = false;
    stop = null;
    if (!rows.some(hasWindow)) msg = 'No rpm window at any distance on this line.';
    draw();
  }
  function cancel() {
    gen++;
    if (stop) { stop(); stop = null; }
    running = false;
  }
  function clear(message) {
    cancel();
    rows = [];
    dom = null;
    curKey = '';
    msg = message || '';
    draw();
  }
  function mark(dIn) {
    markD = dIn;
    draw();
  }
  function redraw() { draw(); }

  // entry point from app.apply(): shows / hides the card, moves the marker, (re)starts the sweep after a full result.
  // The card is shown for a fixed hood and for an adjustable range under 1 degree (the engine runs it as fixed).
  function update(backend, p, r, mode) {
    var fixed = root.ShotUI.hood.isFixedLike(p.hood);
    D.$('rpmCard').hidden = !fixed;
    if (!fixed) {
      cancel();
      curKey = '';
      return;
    }
    markD = r.distIn;
    var q = Object.assign({}, p, { mouth: { height: p.mouth.height } });
    var key = JSON.stringify(q) + '|' + Math.round(r.psi0Deg * 10);
    if (mode !== 'full' || key === curKey) return draw();   // coarse results never restart the sweep
    if (!backend || !backend.sweep || !D.E.sweepPoints) return clear('The rpm sweep needs a newer engine build.');
    cancel();
    start(key, D.E.sweepPoints(p, 4));
    var mine = gen;
    stop = backend.sweep(p, function (row, n, tot) {
      if (mine === gen) add(row, n, tot);
    }, function () {
      if (mine === gen) done();
    });
  }

  function drawMessage(text) {
    svg.appendChild(node('text', { class: 'msg', x: W / 2, y: H / 2 }, text));
    svg.setAttribute('aria-label', 'Motor rpm against distance: ' + text);
  }

  // contiguous runs of rows that have a window; gaps stay gaps
  function segments() {
    var seg = [];
    rows.forEach(function (r) {
      if (hasWindow(r)) {
        if (!seg.length || seg[seg.length - 1].closed) seg.push({ pts: [], closed: false });
        seg[seg.length - 1].pts.push(r);
      } else if (seg.length) {
        seg[seg.length - 1].closed = true;
      }
    });
    return seg;
  }

  function drawBands(c) {
    segments().forEach(function (s) {
      var up = s.pts.map(function (r) { return c.X(r.d) + ',' + c.Y(r.motorRpm[1]); });
      var dn = s.pts.slice().reverse().map(function (r) { return c.X(r.d) + ',' + c.Y(r.motorRpm[0]); });
      svg.appendChild(node('polygon', { class: 'band', points: up.concat(dn).join(' ') }));
      var mid = s.pts.map(function (r) { return { x: c.X(r.d), y: c.Y((r.motorRpm[0] + r.motorRpm[1]) / 2) }; });
      if (mid.length > 1) {
        var pts = mid.map(function (q) { return q.x + ',' + q.y; }).join(' ');
        svg.appendChild(node('polyline', { class: 'mid', points: pts }));
      } else {
        svg.appendChild(node('circle', { class: 'band', cx: mid[0].x, cy: mid[0].y, r: 3 }));
      }
    });
    var gaps = rows.filter(function (r) { return !hasWindow(r); });
    gaps.forEach(function (r) {
      var x = c.X(r.d);
      var y = H - M.b - 1;
      svg.appendChild(node('path', { class: 'gapx', d: 'M' + (x - 4) + ' ' + y + 'l4 -7l4 7z' }));
    });
    if (gaps.length) svg.appendChild(node('text', { x: W - M.r, y: 12, 'text-anchor': 'end' }, '▲ no window here'));
  }

  function draw() {
    if (!svg || !D) return;
    svg.replaceChildren();
    var have = rows.filter(hasWindow);
    if (!have.length) {
      var wait = running ? 'Sweeping distances… ' + rows.length + (total ? ' / ' + total : '') : 'Waiting for a full calculation…';
      return drawMessage(msg || wait);
    }
    var pw = W - M.l - M.r;
    var ph = H - M.t - M.b;
    var d0 = dom ? dom[0] : rows[0].d;
    var d1 = dom ? dom[1] : rows[rows.length - 1].d;
    if (d1 - d0 < 1) d1 = d0 + 1;
    var lo = Math.min.apply(null, have.map(function (r) { return r.motorRpm[0]; }));
    var hi = Math.max.apply(null, have.map(function (r) { return r.motorRpm[1]; }));
    var pad = Math.max((hi - lo) * 0.1, 50);
    var c = { d0: d0, d1: d1, y0: Math.max(0, lo - pad), y1: hi + pad };
    c.X = function (d) { return M.l + (d - d0) / (d1 - d0) * pw; };
    c.Y = function (v) { return M.t + (1 - (v - c.y0) / (c.y1 - c.y0)) * ph; };
    A.drawAxes(svg, D, c, G);
    drawBands(c);
    A.drawMark(svg, D, c, G, markD);
    if (running) {
      svg.appendChild(node('text', { x: W - M.r, y: M.t + 11, 'text-anchor': 'end' }, 'sweeping ' + rows.length + (total ? ' / ' + total : '')));
    }
    svg.setAttribute('aria-label', 'Motor rpm that scores, from ' + D.nf(lo, 0) + ' to ' + D.nf(hi, 0) +
      ' rpm, against distance from ' + D.fmtLen(d0, 0) + ' to ' + D.fmtLen(d1, 0) + (running ? ' (still sweeping)' : ''));
  }

  var api = { init: init, mount: mount, start: start, add: add, done: done, clear: clear, mark: mark, redraw: redraw, update: update, cancel: cancel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.rpmPlot = api; }
})(typeof window !== 'undefined' ? window : {});
