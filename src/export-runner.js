/* BIOBUZZ Shot Sim - #4 export runner. Browser: window.ExportRunner. Node: module.exports.
   run(params, xs, opts) -> { promise: Promise<ExportRow[]>, cancel() }
     opts: onRow(row, done, total) | etaCurve | workerFactory | engine | forceMain | firstRowTimeoutMs (20000)
     workerFactory: () => Worker-like | Promise<Worker-like> | null. Default (browser): a dedicated worker from window.SHOT_WORKER_SRC (blob URL), 'init' with
       window.SHOT_DATA, waits for 'ready' (2 s), like app.js spawnWorker; null under ?noworker / without Worker, Blob, URL or SHOT_WORKER_SRC.
     The worker source must contain worker-export.js (wiring card F8). No factory, a failing factory, or a worker that stays silent for firstRowTimeoutMs
     -> main-thread fallback: engine.exportPoint, one point per setTimeout(0) tick (engine = opts.engine, else the global ShotEngine).
     The promise resolves with the rows; after cancel() with the rows so far and rows.cancelled === true; it rejects with an Error on an engine / worker error.
     The worker is terminated when the run ends. Protocol: src/worker-export.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ExportRunner = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var seq = 0;

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

  function run(params, xs, opts) {
    opts = opts || {};
    var id = 'export-' + (++seq), rows = [], done = false, cancelled = false, stop = null, resolveP, rejectP;
    var promise = new Promise(function (res, rej) { resolveP = res; rejectP = rej; });

    function end(err) {
      if (done) return;
      done = true;
      if (stop) { try { stop(); } catch (e) { /* worker already gone */ } }
      if (err) { rejectP(err instanceof Error ? err : new Error(String((err && err.message) || err))); return; }
      if (cancelled) rows.cancelled = true;
      resolveP(rows);
    }
    function emit(row, n, total) {
      rows.push(row);
      if (opts.onRow) { try { opts.onRow(row, n, total); } catch (e) { /* a UI callback must not break the run */ } }
    }

    function runMain() {
      var E = opts.engine || root.ShotEngine || globalThis.ShotEngine, pts, i = 0;
      try { pts = E.exportPoints(params, xs); } catch (e) { end(e); return; }
      if (!pts.length) { end(); return; }
      (function next() {
        if (done) return;
        try { emit(E.exportPoint(params, pts[i], xs, opts.etaCurve), i + 1, pts.length); } catch (e) { end(e); return; }
        if (done) return;
        i++;
        if (i < pts.length) setTimeout(next, 0); else end();
      })();
    }

    function runWorker(wk) {
      var heard = false, timer = null;
      function fallback() {
        try { wk.terminate(); } catch (e) { /* ignore */ }
        stop = null; runMain();
      }
      stop = function () { clearTimeout(timer); try { wk.postMessage({ type: 'cancelExport' }); } catch (e) { /* ignore */ } wk.terminate(); };
      wk.onmessage = function (ev) {
        var m = ev && ev.data;
        if (done || !m || m.id !== id) return;
        heard = true; clearTimeout(timer);
        if (m.type === 'exportRow') emit(m.row, m.done, m.total);
        else if (m.type === 'exportDone') end();
        else if (m.type === 'exportError') end(new Error(m.message));
      };
      wk.onerror = function (err) { if (!done) end(err && err.message ? new Error(err.message) : new Error('export worker failed')); };
      timer = setTimeout(function () { if (!heard && !done) fallback(); }, opts.firstRowTimeoutMs > 0 ? opts.firstRowTimeoutMs : 20000);
      wk.postMessage({ type: 'exportSweep', id: id, params: params, settings: xs, etaCurve: opts.etaCurve });
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
