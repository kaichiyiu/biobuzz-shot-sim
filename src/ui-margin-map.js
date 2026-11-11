/* BIOBUZZ Shot Sim - #15 field margin map. A "Margin map" toggle in the field toolbar: for a grid of mouth positions the largest tolerance box that still scores
   (full accuracy only, D14), drawn as an overlay canvas in #mapHost (pointer-events none; the field canvas keeps its own pointer handling).
   Needs MarginRunner, ShotFootprint, MarginMapDraw. Colours and the hover text: ui-margin-map-draw.js. Robot: ShotFootprint.defaults() (18 x 18 in, mouth at the centre). */
(function (root) {
  'use strict';
  var UI = root.ShotUI = root.ShotUI || {}, D = root.MarginMapDraw, STEPS = [12, 6], DEBOUNCE_MS = 350;
  var done = false, on = false, mode = 'margin', cells = [], runner = null, token = 0, runKey = '', lastP = null, ctx = null, timer = 0, drawQ = false;
  var el = {};

  function hasTol() { return !!(lastP && lastP.tolerance); }
  function effMode() { return mode === 'margin' && hasTol() ? 'margin' : 'rpm'; }
  function mk(tag, props, parent) { var e = document.createElement(tag); Object.keys(props || {}).forEach(function (k) { e[k] = props[k]; }); if (parent) parent.appendChild(e); return e; }

  function layout() {
    var f = document.getElementById('field'), c = el.canvas; if (!f || !c) return false;
    var size = f.clientWidth || parseInt(f.style.width, 10) || 0, dpr = Math.min(2.5, root.devicePixelRatio || 1);
    c.style.cssText = 'position:absolute;left:' + f.offsetLeft + 'px;top:' + f.offsetTop + 'px;width:' + size + 'px;height:' + size + 'px';
    if (c.width !== Math.round(size * dpr)) { c.width = c.height = Math.round(size * dpr); }
    el.size = size; el.dpr = dpr; return size > 0;
  }
  function redraw() {
    if (!el.canvas) return;
    if (!on || !layout()) { el.canvas.getContext('2d').clearRect(0, 0, el.canvas.width, el.canvas.height); return; }
    D.draw(el.canvas, cells, { mode: effMode(), steps: STEPS, final: done, field: ctx.field, size: el.size, dpr: el.dpr });
  }
  function queueDraw() { if (drawQ) return; drawQ = true; requestAnimationFrame(function () { drawQ = false; redraw(); }); }

  function legend() {
    var m = effMode(), L = el.legend; if (!L) return;
    L.hidden = !on; if (!on) return;
    var sw = function (a) { return '<i class="swatch" style="background:var(--focus);opacity:' + a + '"></i>'; };
    var fit = ' <i class="swatch mm-hatch"></i>robot does not fit \u00b7 18 \u00d7 18 in, mouth at the centre';
    L.innerHTML = m === 'margin'
      ? sw(0.08) + 'margin 0\u00d7 ' + sw(0.9) + '\u2265 ' + D.CAP + '\u00d7 (dark line: 1\u00d7 = your \u00b1 limits just fit)' + fit
      : sw(0.12) + 'narrow ' + sw(0.9) + 'wide motor-rpm window (up to ' + D.rampMax(cells).toFixed(1) + ' %)' + fit
        + (mode === 'margin' ? ' \u00b7 no tolerance set, so no margin colours: set a tolerance' : '');
  }
  function say(t) { if (el.prog) { el.prog.textContent = t; el.prog.hidden = !t; } }

  function stop() {
    token++; clearTimeout(timer);
    if (runner) { try { runner.cancel(); } catch (e) { /* already done */ } runner = null; }
  }
  function start() {
    stop(); if (!on || !lastP || !root.MarginRunner) return;
    var my = token, p = lastP, FP = root.ShotFootprint;
    runKey = D.paramsKey(p); cells = []; done = false; say('Map 0 %'); legend(); redraw();
    try {
      runner = root.MarginRunner.run(p, {
        passes: STEPS, robot: FP ? FP.defaults() : undefined, field: ctx.data && ctx.data.field,
        onCell: function (c, done, total) { if (my !== token) return; cells.push(c); say('Map ' + Math.round(done / total * 100) + ' %'); queueDraw(); }
      });
      runner.promise.then(function (all) {
        if (my !== token) return; runner = null; done = !all.cancelled; say('Map ready'); legend(); redraw();
        el.cellCount = all.length;
      }).catch(function (e) { if (my === token) { runner = null; say('Map failed: ' + (e && e.message || e)); } });
    } catch (e) { say('Map failed: ' + e.message); }
  }
  function schedule() {
    if (!on || !lastP) return;
    if (D.paramsKey(lastP) === runKey && (runner || cells.length)) { legend(); queueDraw(); return; }   // same settings (only the mouth moved)
    clearTimeout(timer); timer = setTimeout(start, DEBOUNCE_MS);
  }
  function setOn(v) {
    on = !!v; el.btn.setAttribute('aria-pressed', String(on)); el.sel.hidden = !on; el.lab.hidden = !on;
    if (on) start();
    else { stop(); runKey = ''; cells = []; say(''); done = false; legend(); redraw(); el.tip.hidden = true; }
  }

  function hover(e) {
    if (!on || !cells.length) { el.tip.hidden = true; return; }
    var f = document.getElementById('field'), r = f.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < 0 || py < 0 || px > r.width || py > r.height) { el.tip.hidden = true; return; }
    var w = ctx.field.toWorld(px, py), c = D.nearestCell(cells, STEPS, w.x, w.y), lines = D.describe(c);
    if (!lines.length) { el.tip.hidden = true; return; }
    el.tip.textContent = ''; lines.forEach(function (t) { mk('div', { textContent: t }, el.tip); });
    el.tip.hidden = false;
    var wr = ctx.field.wrap.getBoundingClientRect();
    el.tip.style.left = Math.min(e.clientX - wr.left + 14, wr.width - 190) + 'px'; el.tip.style.top = (e.clientY - wr.top + 14) + 'px';
  }

  function build(c) {
    ctx = c; var host = document.getElementById('mapHost'), scan = document.getElementById('scanBtn'), legendBox = document.getElementById('fieldLegend');
    if (!host || !scan || !scan.parentNode || !D) return;
    document.body.classList.add('has-margin-map');   // the legacy Verdict map button is hidden for good (owner decision: no verdicts)
    el.canvas = mk('canvas', { id: 'marginMap' }, host);
    var bar = mk('span', { className: 'mm-bar' }); scan.parentNode.insertBefore(bar, scan);
    el.prog = mk('span', { className: 'scan-progress', id: 'mmProgress', hidden: true }, bar);
    el.btn = mk('button', { type: 'button', className: 'btn', id: 'mmBtn', textContent: 'Margin map' }, bar); el.btn.setAttribute('aria-pressed', 'false');
    el.lab = mk('label', { className: 'mm-colour', hidden: true, textContent: 'colour by ' }, bar);
    el.sel = mk('select', { id: 'mmColour' }, el.lab); el.sel.hidden = true;
    [['margin', 'margin'], ['rpm', 'rpm window width']].forEach(function (o) { mk('option', { value: o[0], textContent: o[1] }, el.sel); });
    el.legend = mk('span', { id: 'mmLegend', hidden: true }, legendBox);
    el.tip = mk('div', { className: 'mm-tip', hidden: true }, c.field.wrap);
    el.btn.addEventListener('click', function () { setOn(!on); });
    el.sel.addEventListener('change', function () { mode = el.sel.value; legend(); redraw(); });
    c.field.wrap.addEventListener('mousemove', hover);
    c.field.wrap.addEventListener('mouseleave', function () { el.tip.hidden = true; });
    if (root.ResizeObserver) new ResizeObserver(function () { requestAnimationFrame(redraw); }).observe(c.field.wrap);
    if (root.MutationObserver) new MutationObserver(function () { requestAnimationFrame(redraw); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    if (root.matchMedia) { var mq = root.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', redraw); }
  }

  UI.marginMap = { isOn: function () { return on; }, cells: function () { return cells; }, running: function () { return !!runner; }, setOn: function (v) { if (el.btn) setOn(v); } };
  UI.hooks = (UI.hooks || []).concat([{
    name: 'marginMap',
    onStart: build,
    onResult: function (r, p, m) {
      if (m !== 'full' || !p) return;
      lastP = p; schedule();
    }
  }]);
})(typeof self !== 'undefined' ? self : this);
