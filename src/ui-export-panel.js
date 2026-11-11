/* BIOBUZZ Shot Sim - #4 export panel (DOM only; the model and hook are in ui-export.js). Browser: window.ShotUI.exportPanel.
   mount(host, deps) -> controller { sync(force), busy(on), progress(done,total), say(text), calibrated(bool), table(cells, note, canDownload) }
   deps = { settings(), set(partial), units(): {U, system}, run(), cancel(), download(fmt), formats: [[id,label]] } */
(function (root) {
  'use strict';
  var UI = root.ShotUI = root.ShotUI || {};

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function field(label, id, w, hint) {
    var i = el('input', { type: 'text', id: id, inputmode: 'decimal', style: 'width:' + w + 'ch', 'aria-label': label });
    if (hint) i.title = hint;
    return { input: i, node: el('label', { class: 'calib-f', title: hint || '' }, [el('span', { text: label }), i]) };
  }
  var HEAD = ['Distance', 'Motor rpm c [lo-hi]', 'Ticks/s', 'Angle', 'ToF', 'Bearing', 'Note'];

  function mount(host, deps) {
    var F = {
      step: field('Step', 'expStep', 6, 'Distance between table rows, 2 to 12 in'),
      ticks: field('Ticks per motor rev', 'expTicks', 8, 'Encoder counts per motor output revolution (empty = the selected motor)'),
      fwd: field('Mouth ahead of robot centre', 'expFwd', 6, 'The table is keyed by robot distance = mouth distance + this'),
      d1: field('Servo angle 1 (deg)', 'expDeg1', 6), p1: field('position 1', 'expPos1', 6), d2: field('Servo angle 2 (deg)', 'expDeg2', 6), p2: field('position 2', 'expPos2', 6)
    };
    var fmts = deps.formats.map(function (f) {
      var c = el('input', { type: 'checkbox', 'data-fmt': f[0], id: 'expFmt-' + f[0] });
      c.addEventListener('change', function () { deps.set({ formats: fmts.filter(function (x) { return x.c.checked; }).map(function (x) { return x.id; }) }); ctl.sync(); });
      return { id: f[0], c: c, node: el('label', { class: 'calib-f' }, [c, el('span', { text: f[1] })]) };
    });
    var badge = el('strong', { class: 'calib-badge', id: 'expCalib' });
    var run = el('button', { type: 'button', class: 'btn', id: 'expRun', text: 'Run export' });
    var cancel = el('button', { type: 'button', class: 'btn', id: 'expCancel', text: 'Cancel', disabled: '' });
    var bar = el('progress', { id: 'expProgress', max: '1', value: '0', hidden: '' });
    var msg = el('p', { class: 'calib-sum', id: 'expMsg', role: 'status' });
    var dl = el('div', { class: 'calib-row', id: 'expDownloads' });
    var tbl = el('table', { class: 'calib-grid', id: 'expTable' });
    var wrap = el('div', { class: 'table-wrap' }, [tbl]);
    wrap.hidden = true;
    var sec = el('div', { class: 'calib-sec', id: 'exportPanel' }, [
      el('h3', { text: 'Export shot table' }), badge,
      el('p', { class: 'help', text: 'One row per distance along the line from the robot to the CELL, full accuracy only. Rpm, ticks per second, hood angle, time of flight and the bearing range for an on-robot lookup.' }),
      el('div', { class: 'calib-row' }, [F.step.node, F.ticks.node, F.fwd.node]),
      el('div', { class: 'calib-row' }, [F.d1.node, F.p1.node, F.d2.node, F.p2.node]),
      el('div', { class: 'calib-row' }, fmts.map(function (f) { return f.node; }).concat([run, cancel])),
      bar, msg, wrap, dl]);
    host.replaceChildren(sec);

    function ints() { var u = deps.units(); return u; }
    function onNum(input, key, conv) {
      input.addEventListener('change', function () {
        var v = conv(input.value), o = {};
        o[key] = v;
        deps.set(o); ctl.sync();
      });
    }
    function plain(t) { var v = parseFloat(String(t).replace(/,/g, '')); return isFinite(v) ? v : null; }
    onNum(F.step.input, 'stepIn', function (t) { var u = ints(), v = u.U.parseLen(t, u.system); return isFinite(v) ? v : null; });
    onNum(F.fwd.input, 'mouthForwardIn', function (t) { var u = ints(), v = u.U.parseLen(t, u.system); return isFinite(v) ? v : 0; });
    onNum(F.ticks.input, 'ticksPerMotorRev', plain);
    function servo() {
      var v = { deg1: plain(F.d1.input.value), pos1: plain(F.p1.input.value), deg2: plain(F.d2.input.value), pos2: plain(F.p2.input.value) };
      deps.set({ servo: v }); ctl.sync();
    }
    [F.d1, F.p1, F.d2, F.p2].forEach(function (f) { f.input.addEventListener('change', servo); });
    run.addEventListener('click', function () { deps.run(); });
    cancel.addEventListener('click', function () { deps.cancel(); });

    var ctl = {
      sync: function (force) {
        var s = deps.settings(), u = ints(), busyEl = document.activeElement;   // a recalc result must not overwrite a field being edited
        function put(f, v) { if (f.input !== busyEl) f.input.value = v; }
        put(F.step, u.U.nf(u.U.toLen(s.stepIn, u.system), 1));
        put(F.fwd, u.U.nf(u.U.toLen(s.mouthForwardIn, u.system), 1));
        put(F.ticks, s.ticksPerMotorRev == null ? '' : String(s.ticksPerMotorRev));
        F.ticks.input.placeholder = String(deps.defaultTicks());
        F.step.node.querySelector('span').textContent = 'Step (' + u.U.lenUnit(u.system) + ', 2-12 in)';
        F.fwd.node.querySelector('span').textContent = 'Mouth ahead of robot centre (' + u.U.lenUnit(u.system) + ')';
        if (s.servo || force) {
          var v = s.servo || {};
          F.d1.input.value = v.deg1 == null ? '' : v.deg1; F.p1.input.value = v.pos1 == null ? '' : v.pos1;
          F.d2.input.value = v.deg2 == null ? '' : v.deg2; F.p2.input.value = v.pos2 == null ? '' : v.pos2;
        }
        fmts.forEach(function (f) { f.c.checked = s.formats.indexOf(f.id) >= 0; });
      },
      busy: function (on) { run.disabled = !!on; cancel.disabled = !on; bar.hidden = !on; },
      progress: function (done, total) { bar.max = total || 1; bar.value = done; },
      say: function (t) { msg.textContent = t; },
      calibrated: function (yes) { badge.textContent = yes ? 'calibrated: yes' : 'calibrated: no (eta is the simulator default; measure it before trusting the rpm at the field)'; badge.style.color = yes ? '' : 'var(--bad-mark, #c33)'; },
      table: function (cells, note, canDownload) {
        wrap.hidden = !cells.length;
        var head = el('tr', {}, HEAD.map(function (t) { return el('th', { scope: 'col', text: t }); }));
        var body = cells.map(function (c) {
          return el('tr', { class: c.bad ? 'calib-bad' : '' }, [c.dist, c.rpm, c.ticks, c.angle, c.tof, c.bearing, c.note].map(function (t) { return el('td', { text: t }); }));
        });
        tbl.replaceChildren.apply(tbl, [head].concat(body));
        dl.replaceChildren();
        if (canDownload) deps.formats.forEach(function (f) {
          if (deps.settings().formats.indexOf(f[0]) < 0) return;
          var b = el('button', { type: 'button', class: 'btn', 'data-dl': f[0], text: 'Download ' + f[1] });
          b.addEventListener('click', function () { deps.download(f[0]); });
          dl.appendChild(b);
        });
        if (note) ctl.say(note);
      }
    };
    ctl.sync(true);
    return ctl;
  }
  UI.exportPanel = { mount: mount, el: el };
})(typeof window !== 'undefined' ? window : {});
