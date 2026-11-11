/* BIOBUZZ Shot Sim - worker feature "margin" (#15): the field margin-map scan. Concatenated into the worker source only (D3, wiring card later);
   runs in its OWN worker instance spawned by margin-runner.js. Needs ShotEngine (+ tolerance extensions) and ShotFootprint in the worker source.
   Protocol:  -> { type:'marginScan', id, params, step, robot, field, passes? }
              <- { type:'marginCell', id, cell, done, total } ... then { type:'marginDone', id } | { type:'marginError', id, message }
              -> { type:'cancelMargin' }   (a pending tick exits before computing; a new marginScan supersedes a running one)
   passes = list of grid steps in inches, default [12, step || 6]; a later pass skips the spots an earlier pass already did. total counts every spot.
   robot = { lengthIn, widthIn, mouthForwardIn } (default ShotFootprint.defaults()); field = data/field.json content (default SHOT_DATA.field).
   MarginCell = { x, y, pass, feasible, reason, margin, verdict, limitingAxis, lowerBound, capped, rpmWidthPct, motorRpm }; infeasible: only x, y, pass,
   feasible:false, reason (no evaluation). Each evaluation is E.evaluate(spot params, 'full') with params.tolerance.best forced false (D14, no search). */
(function () {
  'use strict';
  if (typeof importScripts !== 'function' || typeof self === 'undefined' || typeof self.addEventListener !== 'function') return;   // workers only
  var E = self.ShotEngine, token = 0, DEG = Math.PI / 180;

  function reply(msg) { self.postMessage(msg); }

  function spots(steps) {
    var seen = {}, list = [];
    steps.forEach(function (s, pass) {
      E.scanPoints(s).forEach(function (q) {
        var k = q.x + ',' + q.y;
        if (!seen[k]) { seen[k] = 1; list.push({ x: q.x, y: q.y, pass: pass }); }
      });
    });
    return list;
  }

  // one spot -> { cell, evaluated }
  function cellFor(m, q, field) {
    var FP = self.ShotFootprint, p = m.params, cell = { x: q.x, y: q.y, pass: q.pass, feasible: true, reason: '' };
    if (FP && field) {
      var cen = E._internal.mouthCentroid(p.target, p.hiveState[p.target]);
      var fp = FP.feasible({ x: q.x, y: q.y }, Math.atan2(cen[1] - q.y, cen[0] - q.x) / DEG, m.robot || FP.defaults(), field);
      if (!fp.ok) { cell.feasible = false; cell.reason = fp.reason; return { cell: cell, evaluated: false }; }
    }
    var sp = Object.assign({}, p, { mouth: Object.assign({}, p.mouth, { x: q.x, y: q.y }) });
    if (p.tolerance) sp.tolerance = Object.assign({}, p.tolerance, { best: false });
    var r = E.evaluate(sp, 'full'), t = r.tolerance, w = r.hood ? r.hood.rpmWindow : null;
    cell.margin = t ? t.margin : null; cell.verdict = t ? t.verdict : r.verdict;
    cell.limitingAxis = t ? t.limitingAxis : null; cell.lowerBound = t ? !!t.lowerBound : false; cell.capped = t ? !!t.capped : false;
    cell.rpmWidthPct = w ? w.widthPct : null; cell.motorRpm = w ? w.centerMotorRpm : null;
    return { cell: cell, evaluated: true };
  }

  function tick(m, list, i, t, field) {
    if (t !== token) return;
    var evaluated = false;
    try {
      while (i < list.length && !evaluated) {   // infeasible spots are free: emit them in the same tick as the next evaluation
        var r = cellFor(m, list[i], field);
        evaluated = r.evaluated; i++;
        reply({ type: 'marginCell', id: m.id, cell: r.cell, done: i, total: list.length });
        if (t !== token) return;   // cancelled from inside the reply
      }
    } catch (err) { reply({ type: 'marginError', id: m.id, message: String((err && err.message) || err) }); return; }
    if (i < list.length) setTimeout(function () { tick(m, list, i, t, field); }, 0);
    else reply({ type: 'marginDone', id: m.id });
  }

  self.addEventListener('message', function (ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'marginScan') {
      var t = ++token, list, field = m.field || (self.SHOT_DATA && self.SHOT_DATA.field) || null;
      try { list = spots(Array.isArray(m.passes) && m.passes.length ? m.passes : [12, m.step || 6]); }
      catch (err) { reply({ type: 'marginError', id: m.id, message: String((err && err.message) || err) }); return; }
      if (list.length) setTimeout(function () { tick(m, list, 0, t, field); }, 0); else reply({ type: 'marginDone', id: m.id });
    } else if (m.type === 'cancelMargin') {
      token++;
    }
  });
})();
