/* BIOBUZZ Shot Sim - #4 on-robot algorithm vs table. Browser: window.ExportCompare (needs window.ExportSolver). Node: module.exports.
   vectors(c, dList) -> [{dRobotIn, thetaDeg, vMps, motorRpm, ticksPerSec, ok, iterations}]   JS reference results = expected values for a port check (NaN numbers when !ok).
   vectorsCsv(list) -> string      header + one line per vector, full-precision numbers; the Java main reads the first column and prints its own results.
   compare(rows, c) -> [{dRobotIn, tableRpm, algoRpm, diffPctOfWindow, windowRpm, ok}]   one entry per REACHABLE row: tableRpm = motorRpm.c, algoRpm = solveSpeed rpm,
     diffPctOfWindow = |algoRpm - tableRpm| / (motorRpm.hi - motorRpm.lo) * 100; algoRpm and diffPctOfWindow are null when the solver is not ok.
   checkAt(params, E, c, q, etaCurve?) -> {dRobotIn, algoAngle, algoRpm, windowLo, windowHi, inWindow, offsetPctOfHalfWindow, ok, reachable}   G3c, the real question: at mouth point q
     (E.exportPoints entry {d, x, y}) the robot shoots at the ALGORITHM's angle, so evaluate the sim (full accuracy, hood fixed at that angle) and test whether the algorithm's rpm lies inside the
     scoring window AT THAT ANGLE. offsetPctOfHalfWindow = (algoRpm - centre) / ((hi - lo) / 2) * 100 (inside the window: |offset| <= 100). inWindow false (window null) when the solver is not ok or the
     angle cannot score from q. One E.evaluate per call (a few hundred ms).
   Maths and decisions: process_docs/issue-4/design.md sections 12 and 14. */
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

  function checkAt(params, E, c, q, etaCurve) {
    var dRobot = q.d + c.mouthForwardIn, s = Solver.solveSpeed(c, dRobot);
    var out = { dRobotIn: dRobot, algoAngle: s.thetaDeg, algoRpm: s.ok ? s.motorRpm : null, windowLo: null, windowHi: null, inWindow: false, offsetPctOfHalfWindow: null, ok: s.ok, reachable: false };
    if (!s.ok) return out;
    var at = Object.assign({}, params, { mouth: Object.assign({}, params.mouth, { x: q.x, y: q.y }), hood: { mode: 'fixed', angleDeg: s.thetaDeg } });
    var row = E.exportRow(E.evaluate(at, 'full'), q, at, { mouthForwardIn: c.mouthForwardIn }, etaCurve);
    if (!row.reachable) return out;
    var lo = row.motorRpm.lo, hi = row.motorRpm.hi, ctr = row.motorRpm.c;
    out.reachable = true; out.windowLo = lo; out.windowHi = hi;
    out.inWindow = s.motorRpm >= lo && s.motorRpm <= hi;
    out.offsetPctOfHalfWindow = hi > lo ? (s.motorRpm - ctr) / ((hi - lo) / 2) * 100 : null;
    return out;
  }

  return { vectors: vectors, vectorsCsv: vectorsCsv, compare: compare, checkAt: checkAt };
});
