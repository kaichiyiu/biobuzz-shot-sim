/* BIOBUZZ Shot Sim - #4 / D14 coarse-result label: a "Preview - refining" chip in #warnings while the shown result is a coarse one.
   Browser: hook on window.ShotUI.hooks. Node: module.exports (sync(box, mode) works on any DOM-like box). */
(function (root) {
  'use strict';
  var ID = 'previewChip', TEXT = 'Preview — refining';

  // add (once) or remove the chip; `box` is the #warnings element
  function sync(box, mode, doc) {
    if (!box) return;
    var d = doc || (typeof document !== 'undefined' ? document : null), old = box.querySelector ? box.querySelector('#' + ID) : null;
    if (mode === 'coarse') {
      if (old) return;
      var c = d.createElement('span');
      c.className = 'chip'; c.id = ID; c.setAttribute('role', 'status');
      c.textContent = TEXT;
      box.appendChild(c);
    } else if (old) old.remove();
  }
  var api = { sync: sync, ID: ID, TEXT: TEXT };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShotUI = root.ShotUI || {};
  root.ShotUI.accuracy = api;
  root.ShotUI.hooks = (root.ShotUI.hooks || []).concat([{
    name: 'accuracy',
    onResult: function (r, p, mode) { sync(document.getElementById('warnings'), mode); }
  }]);
})(typeof window !== 'undefined' ? window : {});
