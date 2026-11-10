/* BIOBUZZ Shot Sim - #2 error state: fixed hood without a valid launch angle. Every calculated field shows an error
   mark + the reminder (never a fourth verdict label); drawing and engine requests stop. Browser: window.ShotUI.hoodError. */
(function (root) {
  'use strict';
  var D = null;
  var on = false;
  var FIELDS = {   // calculated readouts and their row labels
    arcReadout: ['Mouth yaw', 'Launch angle', 'Launch speed'],
    windowReadout: ['Yaw', 'Launch angle', 'Speed'],
    refReadout: ['Angle to CELL center', 'Offset angle', 'Distance', 'Apex', 'Time to CELL'],
    motorReadout: ['Wheel speed', 'Motor speed', 'Dip per shot', 'Spin-up', 'Speed scatter', 'Backspin']
  };

  function init(deps) { D = deps; }
  function active() { return on; }
  function reminder(err) {
    if (err.code === 'HOOD_ANGLE_RANGE') return 'The fixed hood angle must be a number between 1° and 89°.';
    return 'The hood is fixed, so enter its launch angle to see the arc.';
  }

  function fillAll(text, isErr) {
    Object.keys(FIELDS).forEach(function (id) {
      D.fillKV(D.$(id), FIELDS[id].map(function (label) { return { label: label, value: text, error: isErr }; }));
    });
  }

  // all-motors table: keep the motor name, replace every calculated column with one error cell
  function tableRows(text) {
    var body = D.$('motorRows');
    if (!body.rows.length) body.appendChild(document.createElement('tr'));
    Array.prototype.forEach.call(body.rows, function (tr) {
      Array.prototype.slice.call(tr.cells, 1).forEach(function (td) { td.remove(); });
      if (!tr.cells.length) tr.appendChild(document.createElement('td'));
      var td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'err-text err-mark';
      td.textContent = text;
      tr.appendChild(td);
    });
  }

  function enterButton(after, onEnterAngle) {
    var box = D.$('hoodMsg');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hoodMsg';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = 'Enter angle';
      box.appendChild(b);
      after.after(box);
    }
    box.hidden = false;
    box.firstChild.onclick = onEnterAngle;
  }

  function show(err, onEnterAngle) {
    var first = !on;
    on = true;
    var msg = reminder(err);
    var badge = D.$('verdictBadge');
    badge.hidden = false;
    badge.className = 'verdict-badge v-err';
    badge.innerHTML = D.ICON.alert;
    badge.appendChild(document.createTextNode(err.message));
    var reason = D.$('reason');
    reason.textContent = msg;
    reason.classList.add('is-error');
    D.$('warnings').replaceChildren();
    enterButton(reason, onEnterAngle);
    fillAll(err.message, true);
    D.$('windowBlock').hidden = false;
    D.$('windowNote').textContent = '';
    D.$('headroomMeter').hidden = true;
    D.$('meterFill').style.width = '0';
    tableRows(err.message);
    ['scanBtn', 'mathBtn'].forEach(function (id) {
      var e = D.$(id);
      e.disabled = true;
      e.title = msg;
    });
    if (first) D.applyEmpty();   // clears the field, side and 3-D arcs through the existing draw functions
    var cap = D.$('viewsCaption');
    cap.textContent = msg;
    cap.classList.add('is-error');
    // the RPM card stays visible (the error only exists for a fixed hood) but disabled, with the reminder
    var card = D.$('rpmCard');
    card.hidden = false;
    card.classList.add('is-disabled');
    root.ShotUI.rpmPlot.clear(msg);
  }

  // leave the error state: neutral placeholders until the next result arrives
  function hide() {
    if (!on) return;
    on = false;
    fillAll('—', false);
    D.$('reason').textContent = 'Calculating the best arc…';
    D.$('reason').classList.remove('is-error');
    D.$('verdictBadge').hidden = true;
    D.$('hoodMsg').hidden = true;
    D.$('headroomMeter').hidden = false;
    D.$('viewsCaption').classList.remove('is-error');
    D.$('rpmCard').classList.remove('is-disabled');
    ['scanBtn', 'mathBtn'].forEach(function (id) {
      var e = D.$(id);
      e.disabled = false;
      e.removeAttribute('title');
    });
    root.ShotUI.rpmPlot.clear('Calculating…');
  }

  var api = { init: init, show: show, hide: hide, active: active };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.hoodError = api; }
})(typeof window !== 'undefined' ? window : {});
