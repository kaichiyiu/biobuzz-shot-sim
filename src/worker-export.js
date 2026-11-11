/* BIOBUZZ Shot Sim - worker feature "export" (#4): the export-along-a-line sweep. Concatenated into the worker source only (D3, wiring card F8);
   runs in its OWN worker instance spawned by export-runner.js, so src/worker.js and the app's two workers are untouched.
   Protocol (PLAN 2.6):  -> { type:'exportSweep', id, params, settings, etaCurve? }   one full evaluation + row + bearing per setTimeout(0) tick
                         <- { type:'exportRow', id, row, done, total } ... then { type:'exportDone', id } | { type:'exportError', id, message }
                         -> { type:'cancelExport' }   (a pending tick exits before computing; a new exportSweep supersedes a running one)
   Every other message type is ignored (worker.js answers 'init' etc.). Needs ShotEngine with engine-sweep.js, engine-export.js (+ engine-export-bearing.js). */
(function () {
  'use strict';
  if (typeof importScripts !== 'function' || typeof self === 'undefined' || typeof self.addEventListener !== 'function') return;   // workers only
  var E = self.ShotEngine, token = 0;

  function reply(msg) { self.postMessage(msg); }

  function tick(m, pts, i, t) {
    if (t !== token) return;
    var row;
    try { row = E.exportPoint(m.params, pts[i], m.settings, m.etaCurve); }
    catch (err) { reply({ type: 'exportError', id: m.id, message: String((err && err.message) || err) }); return; }
    reply({ type: 'exportRow', id: m.id, row: row, done: i + 1, total: pts.length });
    if (t !== token) return;   // cancelled from inside the reply
    if (i + 1 < pts.length) setTimeout(function () { tick(m, pts, i + 1, t); }, 0);
    else reply({ type: 'exportDone', id: m.id });
  }

  self.addEventListener('message', function (ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'exportSweep') {
      var t = ++token, pts;
      try { pts = E.exportPoints(m.params, m.settings); }
      catch (err) { reply({ type: 'exportError', id: m.id, message: String((err && err.message) || err) }); return; }
      if (pts.length) setTimeout(function () { tick(m, pts, 0, t); }, 0); else reply({ type: 'exportDone', id: m.id });
    } else if (m.type === 'cancelExport') {
      token++;
    }
  });
})();
