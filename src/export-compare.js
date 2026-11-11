/* BIOBUZZ Shot Sim - #4 on-robot algorithm vs table. Browser: window.ExportCompare (needs window.ExportSolver). Node: module.exports.
   vectors(c, dList) -> [{dRobotIn, thetaDeg, vMps, motorRpm, ticksPerSec, ok, iterations}]   JS reference results = expected values for a port check (NaN numbers when !ok).
   vectorsCsv(list) -> string      header + one line per vector, full-precision numbers; the Java main reads the first column and prints its own results.
   compare(rows, c) -> [{dRobotIn, tableRpm, algoRpm, diffPctOfWindow, windowRpm, ok}]   one entry per REACHABLE row: tableRpm = motorRpm.c, algoRpm = solveSpeed rpm,
     diffPctOfWindow = |algoRpm - tableRpm| / (motorRpm.hi - motorRpm.lo) * 100; algoRpm and diffPctOfWindow are null when the solver is not ok.
   Maths and decisions: process_docs/issue-4/design.md section 12. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./export-solver.js'));
  else root.ExportCompare = factory(root.ExportSolver);
})(typeof self !== 'undefined' ? self : this, function (Solver) {
  'use strict';

  function vectors(c, dList) {
    return dList.map(function (d) {
      var s = Solver.solveSpeed(c, d);
      return { dRobotIn: d, thetaDeg: s.thetaDeg, vMps: s.vMps, motorRpm: s.motorRpm, ticksPerSec: s.ticksPerSec, ok: s.ok, iterations: s.iterations };
    });
  }

  function vectorsCsv(list) {
    var out = ['dRobotIn,thetaDeg,vMps,motorRpm,ticksPerSec,ok,iterations'];
    list.forEach(function (v) { out.push([v.dRobotIn, v.thetaDeg, v.vMps, v.motorRpm, v.ticksPerSec, v.ok, v.iterations].join(',')); });
    return out.join('\n') + '\n';
  }

  function compare(rows, c) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.reachable || !r.motorRpm) return;
      var s = Solver.solveSpeed(c, r.dRobotIn), win = r.motorRpm.hi - r.motorRpm.lo;
      out.push({
        dRobotIn: r.dRobotIn, tableRpm: r.motorRpm.c, algoRpm: s.ok ? s.motorRpm : null, windowRpm: win, ok: s.ok,
        diffPctOfWindow: s.ok && win > 0 ? Math.abs(s.motorRpm - r.motorRpm.c) / win * 100 : null
      });
    });
    return out;
  }

  return { vectors: vectors, vectorsCsv: vectorsCsv, compare: compare };
});
