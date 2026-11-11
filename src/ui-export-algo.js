/* BIOBUZZ Shot Sim - #4 "On-robot algorithm" section under the export table (G4). Browser: window.ShotUI.exportAlgo (+ hook). Node: module.exports (pure helpers).
   Pure: prepare(rows, params, E, etaCurve?) -> {c, usable, reason}   javaText(c, tpl)   texText(c, cfg, tpl, params) (H2, derivation .tex)   vectorDistances(rows)   vectorsText(c, rows)   compareCells(cmp, U, system)   checkCells(list, U, system)
         summary(list, stepIn?) -> {n, inside, outside, noWindow, text}   (P1-F7: a point not inside adds the 2 in step hint)   midpointQs(E, params, rows, c) -> mouth points between the table rows   runChecks(E, params, c, qs, {etaCurve, schedule, onPoint, onDone}) -> {cancel}
   Browser: setTable({rows, params, cfg, etaCurve, ready}) is called by ui-export.js when a table is finished; the section lives in a child div of #exportHost.
   Design: process_docs/issue-4/design.md section 14. */
(function (root) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  function lib() {
    return isNode ? { S: require('./export-solver.js'), J: require('./export-java.js'), X: require('./export-compare.js'), T: require('./export-tex.js') } : { S: root.ExportSolver, J: root.ExportJava, X: root.ExportCompare, T: root.ExportTex };
  }
  var FILES = { java: ['ShotSolver.java', 'text/x-java-source'], csv: ['biobuzz-solver-vectors.csv', 'text/csv'], tex: ['biobuzz-derivation.tex', 'application/x-tex'] };

  function prepare(rows, params, E, etaCurve) {
    var c = lib().S.constantsFrom(params, rows, E, etaCurve), fin = function (x) { return typeof x === 'number' && isFinite(x); };
    var ok = !c.rpmMapError && fin(c.rpmPerMps) && fin(c.ticksPerMotorRev) && c.aim.length > 0 && (c.hood.mode === 'fixed' ? fin(c.hood.angleDeg) : c.hood.table.length > 0);
    return { c: c, usable: ok, reason: ok ? '' : c.rpmMapError || 'The export table has no reachable row, so the solver has nothing to be built from.' };
  }
  function javaText(c, tpl) {
    if (typeof tpl !== 'string' || !tpl) throw new Error('The ShotSolver.java template is not loaded.');
    return lib().J.renderJava(c, tpl);
  }
  // robot distances for the port-check CSV: every inch across the table range, plus 3 in outside each end (the solver clamps the tables there)
  function vectorDistances(rows) {
    var d = (rows || []).filter(function (r) { return r.reachable; }).map(function (r) { return r.dRobotIn; });
    if (!d.length) return [];
    var lo = Math.min.apply(null, d), hi = Math.max.apply(null, d), out = [lo - 3], x;
    for (x = Math.ceil(lo); x < hi; x++) out.push(x);
    out.push(hi, hi + 3);
    return out;
  }
  function texText(c, cfg, tpl, params) {
    var D = params && params.shooter && params.shooter.wheelDiameterMm;
    return lib().T.renderTex(c, cfg || null, tpl, { wheelDiameterMm: D });
  }
  function vectorsText(c, rows) { var X = lib().X; return X.vectorsCsv(X.vectors(c, vectorDistances(rows))); }

  function compareCells(cmp, U, system) {
    return cmp.map(function (e) {
      var bad = !e.ok || e.diffPctOfWindow >= 50;
      return { dist: U.nf(U.toLen(e.dRobotIn, system), 1), table: U.nf(e.tableRpm, 0), algo: e.ok ? U.nf(e.algoRpm, 0) : '-', diff: e.ok ? U.nf(e.diffPctOfWindow, 1) + ' %' : 'no solution', bad: bad };
    });
  }
  function checkCells(list, U, system) {
    return list.map(function (o) {
      var st = o.error ? 'error' : !o.ok ? 'no solution' : !o.reachable ? 'no window' : o.inWindow ? 'in window' : 'OUT';
      return {
        dist: U.nf(U.toLen(o.dRobotIn, system), 1), angle: o.algoAngle == null || o.algoAngle !== o.algoAngle ? '-' : U.nf(o.algoAngle, 1) + '°', rpm: o.algoRpm == null ? '-' : U.nf(o.algoRpm, 0),
        win: o.reachable ? U.nf(o.windowLo, 0) + '-' + U.nf(o.windowHi, 0) : '-', status: st, off: o.offsetPctOfHalfWindow == null ? '-' : U.nf(o.offsetPctOfHalfWindow, 0) + ' %', bad: st !== 'in window'
      };
    });
  }
  var HINT_STEP = ' Interpolating between rows is the weak spot: export with a 2 in step (rows closer together; the review measured every point between rows inside the window at 2 in) to bring them inside.';
  function summary(list, stepIn) {
    var n = list.length, inside = 0, out = 0, none = 0;
    list.forEach(function (o) { if (o.reachable && o.inWindow) inside++; else if (o.reachable) out++; else none++; });
    return { n: n, inside: inside, outside: out, noWindow: none, text: inside + ' of ' + n + ' points between the rows are inside the scoring window at the algorithm\'s own angle' + (out ? ', ' + out + ' outside it' : '') + (none ? ', ' + none + ' with no window (that angle cannot score from there)' : '') + '.' + (out + none === 0 ? '' : stepIn <= 2.0001 ? ' The export step is already the finest (2 in).' : HINT_STEP) };
  }

  // mouth points halfway between the table rows (the half-step grid minus the table grid), strictly inside the reachable range
  function midpointQs(E, params, rows, c) {
    var reach = (rows || []).filter(function (r) { return r.reachable; });
    if (reach.length < 2 || rows.length < 2) return [];
    var step = rows[1].dMouthIn - rows[0].dMouthIn;
    if (!(step > 0)) return [];
    var grid = {}, lo = Math.min.apply(null, reach.map(function (r) { return r.dRobotIn; })), hi = Math.max.apply(null, reach.map(function (r) { return r.dRobotIn; }));
    E.exportPoints(params, { stepIn: step }).forEach(function (q) { grid[q.d.toFixed(6)] = 1; });
    return E.exportPoints(params, { stepIn: step / 2 }).filter(function (q) { var d = q.d + c.mouthForwardIn; return !grid[q.d.toFixed(6)] && d > lo && d < hi; });
  }
  // one evaluate per timer tick keeps the page responsive; cancel() ends it with onDone(list, true)
  function runChecks(E, params, c, qs, o) {
    o = o || {};
    var X = lib().X, sched = o.schedule || function (f) { return setTimeout(f, 0); }, out = [], i = 0, dead = false;
    function tick() {
      if (dead) return;
      if (i >= qs.length) { dead = true; if (o.onDone) o.onDone(out, false); return; }
      var r;
      try { r = X.checkAt(params, E, c, qs[i], o.etaCurve); }
      catch (e) { r = { dRobotIn: qs[i].d + c.mouthForwardIn, algoAngle: NaN, algoRpm: null, windowLo: null, windowHi: null, inWindow: false, offsetPctOfHalfWindow: null, ok: true, reachable: false, error: String(e && e.message || e) }; }
      out.push(r); i++;
      if (o.onPoint) o.onPoint(r, i, qs.length);
      sched(tick);
    }
    sched(tick);
    return { cancel: function () { if (dead) return; dead = true; if (o.onDone) o.onDone(out, true); } };
  }

  var api = { FILES: FILES, prepare: prepare, javaText: javaText, texText: texText, vectorDistances: vectorDistances, vectorsText: vectorsText, compareCells: compareCells, checkCells: checkCells, summary: summary, midpointQs: midpointQs, runChecks: runChecks };
  if (isNode) { module.exports = api; return; }

  var UI = root.ShotUI = root.ShotUI || {};
  var ctx = null, data = null, prep = null, job = null, results = [], box = null, N = {};
  var PROS = 'Table: you tune each row at the field (every row is one calibration shot series), no model needed on the robot. Algorithm: far fewer calibration shots, continuous in distance (no steps between rows), and ONE constant (RPM_PER_MPS) to retune instead of every row; ' +
    'the price is code that integrates the flight (about 25-75 short RK4 flights per solve) and a model that must match your robot. Solve time on a Control Hub is not measured yet: the class reports it in lastSolveNanos, please read it on your robot before relying on it in a fast loop.';

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function fill(tbl, head, keys, cells) {
    var body = cells.map(function (c) { return el('tr', { class: c.bad ? 'calib-bad' : '' }, keys.map(function (k) { return el('td', { text: c[k] }); })); });
    tbl.replaceChildren.apply(tbl, [el('tr', {}, head.map(function (t) { return el('th', { scope: 'col', text: t }); }))].concat(body));
    tbl.parentNode.hidden = !cells.length;
  }
  function save(id, text) {
    var f = FILES[id], a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: f[1] }));
    a.href = url; a.download = f[0]; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function say(t) { N.msg.textContent = t; }
  function sys() { return ctx.state.units; }

  function render() {
    if (!box) return;
    var ready = !!(data && data.ready && prep && prep.usable);
    ['java', 'csv', 'tex'].forEach(function (k) { N[k].disabled = !ready; });
    N.check.disabled = !ready && !job;
    N.check.textContent = job ? 'Cancel check' : 'Check between rows';
    if (!data || !data.ready) say('Run an export first: the algorithm is built from the finished table.');
    else if (!prep.usable) say(prep.reason);
    else if (!job && !results.length) say('Built from ' + prep.c.aim.length + ' reachable rows. "Check between rows" evaluates the simulator at the points halfway between them.');
    var cmp = ready ? lib().X.compare(data.rows, prep.c) : [];
    fill(N.cmp, ['Distance', 'Table rpm', 'Algorithm rpm', 'Difference (% of window)'], ['dist', 'table', 'algo', 'diff'], compareCells(cmp, ctx.units, sys()));
    fill(N.chk, ['Distance', 'Angle', 'Algorithm rpm', 'Window rpm', 'Result', 'Offset (% of half window)'], ['dist', 'angle', 'rpm', 'win', 'status', 'off'], checkCells(results, ctx.units, sys()));
  }
  function startCheck() {
    if (job) { job.cancel(); return; }
    var qs = midpointQs(ctx.engine, data.params, data.rows, prep.c);
    if (!qs.length) { say('Not enough reachable rows to check between them.'); return; }
    results = []; N.prog.hidden = false; N.prog.max = qs.length; N.prog.value = 0;
    var mine = job = runChecks(ctx.engine, data.params, prep.c, qs, {
      etaCurve: data.etaCurve,
      onPoint: function (r, i, n) { if (job !== mine) return; results.push(r); N.prog.value = i; say('Checking ' + i + ' / ' + n + '...'); render(); },
      onDone: function (list, cancelled) {
        if (job !== mine) return;
        job = null; N.prog.hidden = true; results = list; render();
        say((cancelled ? 'Cancelled after ' + list.length + ' points. ' : '') + summary(list, data.rows.length > 1 ? data.rows[1].dMouthIn - data.rows[0].dMouthIn : undefined).text);
      }
    });
    render();
  }
  function onDownload(id, make) {
    try { save(id, make()); } catch (e) { say('Download failed: ' + (e && e.message ? e.message : e)); }
  }
  function build(host) {
    N.java = el('button', { type: 'button', class: 'btn', id: 'expAlgoJava', text: 'Download ShotSolver.java' });
    N.csv = el('button', { type: 'button', class: 'btn', id: 'expAlgoCsv', text: 'Download test vectors (CSV)' });
    N.tex = el('button', { type: 'button', class: 'btn', id: 'expAlgoTex', text: 'Download derivation (.tex)' });
    N.check = el('button', { type: 'button', class: 'btn', id: 'expAlgoCheck', text: 'Check between rows' });
    N.prog = el('progress', { id: 'expAlgoProg', max: '1', value: '0', hidden: '' });
    N.msg = el('p', { class: 'calib-sum', id: 'expAlgoMsg', role: 'status' });
    N.cmp = el('table', { class: 'calib-grid', id: 'expAlgoCmp' }); N.chk = el('table', { class: 'calib-grid', id: 'expAlgoChk' });
    N.row = el('div', { class: 'calib-row', id: 'expAlgoButtons' }, [N.java, N.csv, N.tex, N.check]);
    var cap = function (t) { return el('p', { class: 'help', text: t }); };
    var w1 = el('div', { class: 'table-wrap' }, [cap('Table vs algorithm at the table distances (difference = |algorithm - table| / window width)'), N.cmp]);
    var w2 = el('div', { class: 'table-wrap' }, [cap('Between the rows: the simulator is evaluated with the hood fixed at the algorithm\'s angle; the algorithm\'s rpm must lie in that window'), N.chk]);
    w1.hidden = w2.hidden = true;
    box = el('div', { class: 'calib-sec', id: 'exportAlgo' }, [
      el('h3', { text: 'On-robot algorithm' }),
      el('p', { class: 'help', text: 'Instead of a lookup table, the robot can integrate the same flight model and solve for the speed that hits the aim height, using the hood angle interpolated between the table rows. Download the Java class and the vectors to check the port.' }),
      N.row, N.prog, N.msg, w1, w2, el('p', { class: 'help', text: PROS })]);
    host.appendChild(box);
    N.java.addEventListener('click', function () { onDownload('java', function () { return javaText(prep.c, root.SHOT_TEMPLATES && root.SHOT_TEMPLATES['ShotSolver.java']); }); });
    N.csv.addEventListener('click', function () { onDownload('csv', function () { return vectorsText(prep.c, data.rows); }); });
    N.tex.addEventListener('click', function () { onDownload('tex', function () { return texText(prep.c, data.cfg, root.SHOT_TEMPLATES && root.SHOT_TEMPLATES['derivation.tex'], data.params); }); });
    N.check.addEventListener('click', startCheck);
    UI.exportAlgo.N = N;
  }
  function setTable(d) {
    if (job) job.cancel();
    data = d; results = [];
    prep = d && d.ready ? prepare(d.rows, d.params, ctx.engine, d.etaCurve) : null;
    var host = document.getElementById('exportHost');
    if (box && host && box.parentNode !== host) host.appendChild(box);
    render();
  }

  UI.exportAlgo = Object.assign({ setTable: setTable }, api);
  UI.hooks = (UI.hooks || []).concat([{
    name: 'export-algo',
    onStart: function (c) { ctx = c; var host = document.getElementById('exportHost'); if (host) { build(host); render(); } },
    onChange: function () { if (data) render(); }
  }]);
})(typeof window !== 'undefined' ? window : {});
