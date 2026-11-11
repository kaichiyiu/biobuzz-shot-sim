/* BIOBUZZ Shot Sim - no verdicts (owner decision 2026-11-11). Show the math: section 6 is kept for reference only (retitled, Verdict row removed,
   "verdict map" hint reworded). Browser: window.ShotUI.noVerdict + an onMathRender hook. Node: module.exports (fix works on any DOM-like body). */
(function (root) {
  'use strict';
  var TITLE = '6 · Hit rate (old scatter model, for reference)';

  // body = #mathBody (or a DOM-like with querySelectorAll); idempotent
  function fix(body) {
    if (!body || !body.querySelectorAll) return;
    Array.prototype.forEach.call(body.querySelectorAll('h3'), function (h) {
      if (/^6 · Hit rate and verdict/.test(h.textContent || '')) h.textContent = TITLE;
    });
    Array.prototype.forEach.call(body.querySelectorAll('.eq'), function (row) {
      var w = row.querySelector('.eq-what');
      if (w && (w.textContent || '') === 'Verdict' && row.parentNode) row.parentNode.removeChild(row);
    });
    Array.prototype.forEach.call(body.querySelectorAll('.math-note'), function (n) {
      var t = n.textContent || '';
      if (/verdict map/i.test(t)) n.textContent = 'Move the robot on the field to find spots where an arc exists.';
      else if (/POSSIBLE|NOT CONSISTENT|WON.T WORK/.test(t)) n.textContent = t.replace(/ \(WON.T WORK\)/, '').replace(/, so even a good shot is capped at NOT CONSISTENT/, ', so the motor may not hold its speed between shots').replace(/POSSIBLE|NOT CONSISTENT|WON.T WORK/g, 'not shown');
    });
  }

  var api = { fix: fix, TITLE: TITLE };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  var UI = root.ShotUI = root.ShotUI || {};
  UI.noVerdict = api;
  UI.hooks = (UI.hooks || []).concat([{ name: 'noverdict', onMathRender: function (body) { fix(body); } }]);
})(typeof window !== 'undefined' ? window : {});
