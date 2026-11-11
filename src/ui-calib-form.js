/* BIOBUZZ Shot Sim - #11 calibration form (mounts in #calibHost): test plan, 5-shot entry grid, live checks, CSV in / out, video angle step.
   Browser only; the pure parts are in ui-calib-grid.js. API: window.ShotUI.calibForm = { rows, cfg, setpoints, angleOffsetDeg, ready, load }. */
(function (root) {
  'use strict';
  var UI = root.ShotUI = root.ShotUI || {}, G = UI.calibGrid, el = G.el;
  var ctx = null, grid = [], units = 'imperial', offset = null, planInfo = null, spinOf = null, els = {}, mounted = false, needPredict = false;

  function env() { return { ballId: ctx.state.ballId, h0In: ctx.state.h0, units: ctx.state.units, U: ctx.units }; }
  function cfg() { return G.cfgOf(ctx.state, spinOf ? spinOf() : 'back'); }
  function wheels() { return ctx.data.shooter.wheels; }
  function lenUnit() { return ctx.units.fmtLen(1, 0, units).replace(/^[\d.]+\s*/, ''); }
  function field(label, id, val, w) {
    var i = el('input', { type: 'text', id: id, inputmode: 'decimal', value: val == null ? '' : val, style: 'width:' + (w || 7) + 'ch', 'aria-label': label });
    return el('label', { class: 'calib-f' }, [el('span', { text: label }), i]);
  }

  function makePlan() {
    var lo = G.num(els.lo.value), hi = G.num(els.hi.value), degs = els.deg.value.split(',').map(G.num).filter(isFinite);
    try {
      planInfo = root.CalibPlan.plan(cfg(), [lo, hi], degs, { engine: ctx.engine, wheels: wheels() });
      grid = G.makeGrid(planInfo.settings);
      say(planInfo.balls + ' balls, about ' + planInfo.minutes + ' min. Tape the predicted landing distances, then shoot 5 balls per setting and enter what the encoder read.');
    } catch (e) { say('Cannot make a plan: ' + e.message); }
    draw();
  }
  function say(t) { els.say.textContent = t; }

  function draw() {
    var U = ctx.units, u = lenUnit(), head = el('tr', {}, ['Setting', 'Hood deg', 'Set rpm', 'Predicted landing (' + u + ')', 'Measured rpm'].concat([1, 2, 3, 4, 5].map(function (n) { return 'Shot ' + n + ' (' + u + ')'; })).map(function (t) { return el('th', { scope: 'col', text: t }); }));
    var body = grid.map(function (g, ri) {
      var tds = [g.settingId, g.hoodDeg, g.setpointRpm == null ? '-' : g.setpointRpm, g.predictedIn == null ? '-' : U.nf(U.toLen(g.predictedIn, units), 1)].map(function (t) { return el('td', { text: String(t) }); });
      function cell(get, set, label) {
        var i = el('input', { type: 'text', inputmode: 'decimal', value: get(), 'aria-label': g.settingId + ' ' + label, style: 'width:7ch' });
        i.addEventListener('input', function () { set(i.value); refresh(); });
        return el('td', {}, [i]);
      }
      tds.push(cell(function () { return g.rpm; }, function (v) { g.rpm = v; }, 'measured rpm'));
      g.shots.forEach(function (_, si) { tds.push(cell(function () { return g.shots[si]; }, function (v) { g.shots[si] = v; }, 'shot ' + (si + 1))); });
      return el('tr', { 'data-row': ri }, tds);
    });
    els.table.replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
    els.table.hidden = !grid.length;
    refresh();
  }

  function refresh() {
    var e = env(), V = root.CalibValidate, msgs = G.messages(grid, e, V), ok = G.ready(grid, e, V);
    els.msgs.replaceChildren.apply(els.msgs, msgs.map(function (m) { return el('li', { class: 'calib-' + m.level, text: (m.level === 'error' ? 'Error: ' : 'Check: ') + m.text }); }));
    els.fit.disabled = !ok;
    els.csv.disabled = !G.toRows(grid, e).length;
    var rows = els.table.querySelectorAll('tbody tr');
    rows.forEach(function (tr, i) { tr.classList.toggle('calib-bad', msgs.some(function (m) { return m.row === i && m.level === 'error'; })); });
    if (UI.calibReport && UI.calibReport.formChanged) UI.calibReport.formChanged();
  }

  function download(name, text) {
    var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function importCsv(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var r = root.CalibCsv.fromCsv(String(rd.result));
      if (r.errors.length) say('CSV: ' + r.errors.slice(0, 3).join(' '));
      if (r.rows.length) { grid = G.fromRows(r.rows, grid, env()); say('Imported ' + r.rows.length + ' rows from ' + file.name + '.'); draw(); }
    };
    rd.readAsText(file);
  }

  function videoStep() {
    var f = { x1: field('Ball A x', 'cv-x1', '0'), y1: field('A y (up)', 'cv-y1', '0'), x2: field('Ball B x', 'cv-x2'), y2: field('B y (up)', 'cv-y2'), fps: field('Frame rate', 'cv-fps', '240'), gap: field('Frames A to B', 'cv-gap', '1') };
    var out = el('p', { class: 'help', id: 'cv-out', 'aria-live': 'polite' });
    var go = el('button', { type: 'button', class: 'btn', id: 'cv-go', text: 'Measure angle' });
    function v(k) { return G.num(f[k].querySelector('input').value); }
    go.addEventListener('click', function () {
      var m = 0.0254 / ctx.units.toLen(1, ctx.state.units), deg = G.hoodDegsOf(ctx.state, ctx.current && ctx.current())[0] || (grid[0] && grid[0].hoodDeg);
      var r = root.CalibVideo.angleOffset({ x: v('x1') * m, y: v('y1') * m, frame: 0 }, { x: v('x2') * m, y: v('y2') * m, frame: v('gap') }, deg, v('fps'));
      offset = r.error ? null : r.offsetDeg;
      out.textContent = r.error ? r.error : 'Launch angle ' + r.launchDeg.toFixed(1) + ' deg, hood ' + deg + ' deg: offset ' + r.offsetDeg.toFixed(1) + ' deg will be used in the fit.' + (r.speedMps ? ' Exit speed about ' + r.speedMps.toFixed(1) + ' m/s.' : '');
      refresh();
    });
    var d = el('details', { class: 'calib-video' }, [el('summary', { text: 'Optional: measure the real launch angle from one video clip' }),
      el('p', { class: 'help', text: 'Film the ball against a ruler. Read two ball centres A (just after release) and B (a few frames later): x along the shot, y up, in ' + lenUnit() + ' from the ruler. Without this the fit assumes actual angle = hood angle.' })]);
    Object.keys(f).forEach(function (k) { d.appendChild(f[k]); });
    d.appendChild(go); d.appendChild(out);
    return d;
  }

  function mount(host) {
    els.say = el('p', { class: 'help', id: 'calibSay' });
    var fl = field('Rpm low', 'calib-lo'), fh = field('Rpm high', 'calib-hi'), fd = field('Hood angles (deg, comma separated)', 'calib-deg', '', 12);
    els.lo = fl.querySelector('input'); els.hi = fh.querySelector('input'); els.deg = fd.querySelector('input');
    var mk = el('button', { type: 'button', class: 'btn', id: 'calib-plan', text: 'Make test plan' });
    mk.addEventListener('click', makePlan);
    els.table = el('table', { class: 'calib-grid', id: 'calibGrid' });
    els.msgs = el('ul', { class: 'calib-msgs', 'aria-live': 'polite' });
    els.fit = el('button', { type: 'button', class: 'btn', id: 'calib-fit', text: 'Fit eta' });
    els.csv = el('button', { type: 'button', class: 'btn', id: 'calib-csv', text: 'Export CSV' });
    var imp = el('input', { type: 'file', accept: '.csv,text/csv', id: 'calib-import', 'aria-label': 'Import CSV' });
    els.fit.addEventListener('click', function () { if (UI.calibReport) UI.calibReport.run(); });
    els.csv.addEventListener('click', function () { download('calibration.csv', root.CalibCsv.toCsv(G.toRows(grid, env()))); });
    imp.addEventListener('change', function () { if (imp.files[0]) importCsv(imp.files[0]); imp.value = ''; });
    var sec = el('section', { class: 'calib-sec', id: 'calibForm', 'aria-labelledby': 'calib-h' }, [
      el('h3', { id: 'calib-h', text: 'Calibrate eta from landing distances (trial)' }),
      el('p', { class: 'help', text: 'The tool plans about 15 shots (20 minutes). You enter the measured motor rpm and where each ball first touched the floor, measured from the point under the shooter mouth along the shot line.' }),
      el('div', { class: 'calib-row' }, [fl, fh, fd, mk]),
      els.say, el('div', { class: 'table-wrap' }, [els.table]), els.msgs,
      el('div', { class: 'calib-row' }, [els.fit, els.csv, el('label', { class: 'btn' }, [el('span', { text: 'Import CSV ' }), imp])]), videoStep()]);
    host.replaceChildren(sec);
    mounted = true;
    draw();
  }

  function fillRange(r) {
    var rg = G.rangeOf(r, UI.exportRange && UI.exportRange()), hd = G.hoodDegsOf(ctx.state, r);
    if (rg && !els.lo.value) { els.lo.value = rg[0]; els.hi.value = rg[1]; }
    if (hd.length && !els.deg.value) els.deg.value = hd.join(', ');
    if (!grid.length && rg && hd.length) makePlan();
  }

  UI.calibForm = {
    rows: function () { return ctx ? G.toRows(grid, env()) : []; },
    cfg: cfg, wheels: wheels, setpoints: function () { var o = {}; grid.forEach(function (g) { if (g.setpointRpm != null) o[g.settingId] = g.setpointRpm; }); return o; },
    angleOffsetDeg: function () { return offset; },
    ready: function () { return mounted && G.ready(grid, env(), root.CalibValidate); },
    load: function (rows, setpoints, off) {
      if (!ctx) return;
      var old = Object.keys(setpoints || {}).map(function (k) { return { settingId: k, setpointRpm: setpoints[k] }; });
      grid = G.fromRows(rows || [], old, env()); offset = off == null ? null : off; units = ctx.state.units; needPredict = true; draw();   // predictions are not stored: recomputed at the next result
    }
  };
  UI.hooks = (UI.hooks || []).concat([{
    name: 'calib-form',
    onStart: function (c) {
      ctx = c; units = c.state.units;
      var spin = (UI.hooks || []).filter(function (h) { return h.name === 'spin'; })[0];
      spinOf = spin && spin.configSlice ? spin.configSlice.get : null;
      var host = document.getElementById('calibHost');
      if (host) mount(host);
    },
    onChange: function (state) {
      if (!mounted || state.units === units) return;
      G.convert(grid, units, state.units, ctx.units); units = state.units; draw();
    },
    onResult: function (r) {
      if (!mounted || !r) return;
      if (needPredict) {   // after load(): the state is hydrated, the engine has run - recompute what the plan showed
        needPredict = false;
        try { G.repredict(grid, { Core: root.CalibCore, engine: ctx.engine, cfg: cfg(), wheels: wheels(), ballId: ctx.state.ballId, h0In: ctx.state.h0 }); } catch (e) { /* predictions stay '-' */ }
        draw();
      }
      fillRange(r);
    }
  }]);
})(typeof window !== 'undefined' ? window : {});
