/* BIOBUZZ Shot Sim - #18 panels: fold state (Robot config, Reference data), alliance colour attribute,
   "open Robot config and focus". Browser: window.ShotUI.panels. Node: module.exports (pure parts only). */
(function (root) {
  'use strict';
  var KEY = 'biobuzz-shot-sim.folds';
  var EL = { robotConfig: 'robotConfig', referenceData: 'refData' };   // FoldState key -> element id
  var $ = null, folds = loadFolds();

  function loadFolds() {
    var out = { robotConfig: false, referenceData: false };       // both closed by default (D18-4)
    try {
      var o = JSON.parse(root.localStorage.getItem(KEY) || '{}');
      Object.keys(out).forEach(function (k) { if (o[k] === true) out[k] = true; });
    } catch (e) { /* storage off or corrupt: defaults */ }
    return out;
  }
  function saveFolds() { try { root.localStorage.setItem(KEY, JSON.stringify(folds)); } catch (e) { /* storage off */ } }

  function init(deps) {
    $ = deps.$;
    Object.keys(EL).forEach(function (k) {
      var el = $(EL[k]);
      if (!el) return;
      el.open = folds[k];
      el.addEventListener('toggle', function () { folds[k] = el.open; saveFolds(); });
    });
  }
  function setAlliance(target) { var c = $ && $('sideCol'); if (c) c.setAttribute('data-target', target === 'blue' ? 'blue' : 'red'); }
  function openRobotConfig(focusId) {
    var el = $('robotConfig');
    el.open = true;
    folds.robotConfig = true;
    saveFolds();
    var f = focusId && $(focusId);
    if (!f) return;
    if (f.scrollIntoView) f.scrollIntoView({ block: 'center' });
    f.focus();
  }

  var api = { init: init, setAlliance: setAlliance, openRobotConfig: openRobotConfig, loadFolds: loadFolds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.panels = api; }
})(typeof window !== 'undefined' ? window : {});
