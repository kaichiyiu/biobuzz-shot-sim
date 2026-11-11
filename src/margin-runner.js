/* BIOBUZZ Shot Sim - #15 margin-map runner. Browser: window.MarginRunner. Node: module.exports.
   run(params, opts) -> { promise: Promise<MarginCell[]>, cancel() }
     opts: step (fine grid, in, default 6) | passes (list of steps, default [12, step]) | robot {lengthIn,widthIn,mouthForwardIn} | field (default SHOT_DATA.field)
           onCell(cell, done, total) | workerFactory | forceMain | engine | footprint | firstCellTimeoutMs (30000)
     Cells and the worker protocol: src/worker-margin.js (MarginCell shape, footprint first, tolerance.best forced false, full mode only).
     workerFactory: () => Worker-like | Promise<Worker-like> | null; default (browser) a dedicated worker from window.SHOT_WORKER_SRC, like export-runner.
       The worker source must contain worker-margin.js, footprint.js and the tolerance engine modules (wiring is a later card).
     No factory, a failing factory or a silent worker -> main-thread fallback: same cells, up to one evaluation per setTimeout(0) tick
       (engine = opts.engine || ShotEngine, footprint = opts.footprint || ShotFootprint).
     The promise resolves with the cells; after cancel() with the cells so far and cells.cancelled === true; rejects with an Error on an engine / worker error. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.MarginRunner = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var seq = 0, DEG = Math.PI / 180;

  function defaultFactory() {
    var w = typeof window !== 'undefined' ? window : null;
    if (!w || !w.Worker || !w.SHOT_WORKER_SRC || !w.Blob || !w.URL || /[?&]noworker\b/.test((w.location && w.location.search) || '')) return null;
    return function () {
      return new Promise(function (resolve, reject) {
        var url = w.URL.createObjectURL(new w.Blob([w.SHOT_WORKER_SRC], { type: 'text/javascript' })), wk = new w.Worker(url);
        var timer = setTimeout(function () { wk.terminate(); reject(new Error('worker did not answer')); }, 2000);
        wk.onmessage = function (e) { if (e.data && e.data.type === 'ready') { clearTimeout(timer); w.URL.revokeObjectURL(url); resolve(wk); } };
        wk.onerror = function (err) { clearTimeout(timer); wk.terminate(); reject(err); };
        wk.postMessage({ type: 'init', data: w.SHOT_DATA });
      });
    };
  }

  function spots(E, steps) {
    var seen = {}, list = [];
    steps.forEach(function (s, pass) {
      E.scanPoints(s).forEach(function (q) {
        var k = q.x + ',' + q.y;
        if (!seen[k]) { seen[k] = 1; list.push({ x: q.x, y: q.y, pass: pass }); }
      });
    });
    return list;
  }

  // same cell logic as worker-margin.js
  function cellFor(E, FP, params, robot, field, q) {
    var cell = { x: q.x, y: q.y, pass: q.pass, feasible: true, reason: '' };
    if (FP && field) {
      var cen = E._internal.mouthCentroid(params.target, params.hiveState[params.target]);
      var fp = FP.feasible({ x: q.x, y: q.y }, Math.atan2(cen[1] - q.y, cen[0] - q.x) / DEG, robot || FP.defaults(), field);
      if (!fp.ok) { cell.feasible = false; cell.reason = fp.reason; return { cell: cell, evaluated: false }; }
    }
    var sp = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: q.x, y: q.y }) });
    if (params.tolerance) sp.tolerance = Object.assign({}, params.tolerance, { best: false });
    var r = E.evaluate(sp, 'full'), t = r.tolerance, w = r.hood ? r.hood.rpmWindow : null;
    cell.margin = t ? t.margin : null; cell.verdict = t ? t.verdict : r.verdict;
    cell.limitingAxis = t ? t.limitingAxis : null; cell.lowerBound = t ? !!t.lowerBound : false; cell.capped = t ? !!t.capped : false;
    cell.rpmWidthPct = w ? w.widthPct : null; cell.motorRpm = w ? w.centerMotorRpm : null;
    return { cell: cell, evaluated: true };
  }

  function run(params, opts) {
    opts = opts || {};
    var id = 'margin-' + (++seq), cells = [], done = false, cancelled = false, stop = null, resolveP, rejectP;
    var steps = Array.isArray(opts.passes) && opts.passes.length ? opts.passes : [12, opts.step || 6];
    var field = opts.field || (root.SHOT_DATA && root.SHOT_DATA.field) || (typeof window !== 'undefined' && window.SHOT_DATA && window.SHOT_DATA.field) || null;
    var promise = new Promise(function (res, rej) { resolveP = res; rejectP = rej; });

    function end(err) {
      if (done) return;
      done = true;
      if (stop) { try { stop(); } catch (e) { /* worker already gone */ } }
      if (err) { rejectP(err instanceof Error ? err : new Error(String((err && err.message) || err))); return; }
      if (cancelled) cells.cancelled = true;
      resolveP(cells);
    }
    function emit(cell, n, total) {
      cells.push(cell);
      if (opts.onCell) { try { opts.onCell(cell, n, total); } catch (e) { /* a UI callback must not break the run */ } }
    }

    function runMain() {
      var E = opts.engine || root.ShotEngine || globalThis.ShotEngine, list, i = 0, FP = opts.footprint || root.ShotFootprint || globalThis.ShotFootprint;
      if (!FP && typeof require === 'function') { try { FP = require('./footprint.js'); } catch (e) { FP = null; } }
      try { list = spots(E, steps); } catch (e) { end(e); return; }
      if (!list.length) { end(); return; }
      (function next() {
        if (done) return;
        var evaluated = false;
        try {
          while (i < list.length && !evaluated) {
            var r = cellFor(E, FP, params, opts.robot, field, list[i]);
            evaluated = r.evaluated; i++;
            emit(r.cell, i, list.length);
            if (done) return;
          }
        } catch (e) { end(e); return; }
        if (i < list.length) setTimeout(next, 0); else end();
      })();
    }

    function runWorker(wk) {
      var heard = false, timer = null;
      function fallback() {
        try { wk.terminate(); } catch (e) { /* ignore */ }
        stop = null; runMain();
      }
      stop = function () { clearTimeout(timer); try { wk.postMessage({ type: 'cancelMargin' }); } catch (e) { /* ignore */ } wk.terminate(); };
      wk.onmessage = function (ev) {
        var m = ev && ev.data;
        if (done || !m || m.id !== id) return;
        heard = true; clearTimeout(timer);
        if (m.type === 'marginCell') emit(m.cell, m.done, m.total);
        else if (m.type === 'marginDone') end();
        else if (m.type === 'marginError') end(new Error(m.message));
      };
      wk.onerror = function (err) { if (!done) end(err && err.message ? new Error(err.message) : new Error('margin worker failed')); };
      timer = setTimeout(function () { if (!heard && !done) fallback(); }, opts.firstCellTimeoutMs > 0 ? opts.firstCellTimeoutMs : 30000);
      wk.postMessage({ type: 'marginScan', id: id, params: params, step: opts.step || 6, passes: steps, robot: opts.robot, field: field });
    }

    var factory = opts.forceMain ? null : (opts.workerFactory !== undefined ? opts.workerFactory : defaultFactory()), started;
    try { started = factory ? Promise.resolve(factory()) : Promise.resolve(null); } catch (e) { started = Promise.resolve(null); }
    started.then(function (wk) { return wk || null; }, function () { return null; }).then(function (wk) {
      if (cancelled || done) { if (wk) { try { wk.terminate(); } catch (e) { /* ignore */ } } end(); return; }
      if (wk) runWorker(wk); else setTimeout(runMain, 0);
    });

    return { promise: promise, cancel: function () { if (done) return; cancelled = true; end(); } };
  }

  return { run: run };
});
