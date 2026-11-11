/* BIOBUZZ Shot Sim - #11 calibration report: fit, predicted vs measured ("repeat this one"), single / per-rpm, +/- rpm, Apply / Clear.
   Stores a CalibRecord through configSlice 'calibration'. Widens and relabels the eta slider (#eta) while calibrated.
   Browser: window.ShotUI.calibReport (+ hook). Node: module.exports (pure helpers). */
(function (root) {
  'use strict';
  var STEP = 0.01, TOL = 0.0051;
  var MANUAL = ' (manual)', MAN_HELP = ' Set by hand; the calibration below fits it from landing tests.';

  function stripTag(t) { return String(t).replace(/ \((manual|calibrated)[^)]*\)$/, ''); }
  function appliedOf(fit) { return fit.eta && fit.eta.dual != null ? { key: 'etaDual', value: round4(fit.eta.dual) } : { key: 'etaSingle', value: round4(fit.eta && fit.eta.single) }; }
  function round4(x) { return Math.round(x * 1e4) / 1e4; }
  function makeRecord(fit, raw, setpoints, offsetDeg, now) {
    return { calibrated: true, date: new Date(now == null ? Date.now() : now).toISOString(), mode: fit.mode, applied: appliedOf(fit), fit: fit, raw: raw, setpoints: setpoints || {}, angleOffsetDeg: offsetDeg == null ? null : offsetDeg };
  }
  // slider bounds that include the stored value (the app resets them to its usual range on every sync)
  function wideRange(min, max, val) { var r2 = function (x) { return Math.round(x * 100) / 100; }; return [Math.min(min, r2(Math.floor(val / STEP + 1e-9) * STEP)), Math.max(max, r2(Math.ceil(val / STEP - 1e-9) * STEP))]; }
  // 'none' | 'calibrated' | 'changed' for the eta control
  function etaStatus(record, shooter) {
    if (!record || !record.calibrated || !record.applied) return 'none';
    if ((shooter.type === 'dual') !== (record.applied.key === 'etaDual')) return 'none';   // calibrated the other wheel type
    var v = shooter[record.applied.key];
    return Math.abs(v - record.applied.value) <= TOL ? 'calibrated' : 'changed';
  }
  // fit.rows -> table cells in display units (U = ShotUnits)
  function rowCells(fit, U, units) {
    return fit.rows.map(function (r) {
      var f = function (x) { return x == null || !isFinite(x) ? '-' : U.nf(U.toLen(x, units), 1); };
      return { id: r.settingId || String(r.i + 1), rpm: Math.round(r.rpm), pred: f(r.predictedIn), meas: f(r.meanIn), res: f(r.residualIn), spread: f(r.spreadIn), repeat: r.flag === 'repeat', reason: r.reason || '' };
    });
  }

  var api = { appliedOf: appliedOf, makeRecord: makeRecord, wideRange: wideRange, etaStatus: etaStatus, rowCells: rowCells, stripTag: stripTag };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var UI = root.ShotUI = root.ShotUI || {}, G = UI.calibGrid, el = G.el;
  var ctx = null, record = null, last = null, run0 = null, mode = 'single', els = {};
  var $ = function (id) { return document.getElementById(id); };

  function say(t) { if (els.msg) els.msg.textContent = t; }

  function run() {
    var F = UI.calibForm, rows = F.rows();
    try {
      last = root.CalibFit.fit(rows, F.cfg(), { engine: ctx.engine, mode: mode, angleOffsetDeg: F.angleOffsetDeg(), wheels: F.wheels() });
      run0 = { raw: rows, setpoints: F.setpoints(), offset: F.angleOffsetDeg() };
      say('');
    } catch (e) { last = null; say('Cannot fit: ' + e.message); }
    draw();
  }

  function draw() {
    els.box.hidden = !last;
    if (!last) return;
    var U = ctx.units, u = ctx.state.units, dual = last.eta.dual != null, eta = dual ? last.eta.dual : last.eta.single;
    var nRep = last.rows.filter(function (r) { return r.flag === 'repeat'; }).length;
    els.sum.textContent = 'Fitted ' + (dual ? 'dual-wheel ' : 'single-wheel ') + 'eta = ' + eta.toFixed(3) + ' (exit speed factor ' + last.factor.toFixed(3) + ', ' + (last.mode === 'perRpm' ? 'per-rpm curve; the live model uses its value at mid rpm' : 'one value') + '). Shot spread is equivalent to +/-' + Math.round(last.spreadRpm) + ' rpm.' +
      (nRep ? ' ' + nRep + ' setting(s) marked repeat.' : '') + ' ' + (last.angleOffsetDeg ? 'Launch angle offset ' + last.angleOffsetDeg.toFixed(1) + ' deg applied.' : 'Assumed actual angle = hood angle.');
    var th = ['Setting', 'Measured rpm', 'Predicted (' + U.fmtLen(1, 0, u).replace(/^[\d.]+\s*/, '') + ')', 'Measured mean', 'Residual', 'Spread', ''].map(function (t) { return el('th', { scope: 'col', text: t }); });
    var body = rowCells(last, U, u).map(function (c) {
      return el('tr', { class: c.repeat ? 'calib-repeat' : '' }, [c.id, c.rpm, c.pred, c.meas, c.res, c.spread, c.repeat ? 'repeat this one' + (c.reason ? ' (' + c.reason + ')' : '') : ''].map(function (t) { return el('td', { text: String(t) }); }));
    });
    els.table.replaceChildren(el('thead', {}, [el('tr', {}, th)]), el('tbody', {}, body));
    els.notes.replaceChildren.apply(els.notes, (last.assumptions || []).map(function (t) { return el('li', { text: t }); }));
    els.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === mode)); });
    els.apply.disabled = !(eta > 0);
  }

  function apply() {
    if (!last) return;
    record = api.makeRecord(last, run0.raw, run0.setpoints, run0.offset);
    var a = record.applied;
    ctx.state.shooter[a.key] = a.value;
    say('Applied ' + a.key + ' = ' + a.value + '. Every rpm in the tool now uses it.');
    ctx.recalc();
  }
  function clear() { record = null; say('Calibration cleared. The eta value stays; it is manual again.'); ctx.recalc(); }

  // eta slider + badge: runs after the app's syncControls (which resets min / max / labels)
  function syncEta() {
    var eta = $('eta'), what = $('etaWhat'), help = $('etaHelp'), st = etaStatus(record, ctx.state.shooter);
    if (!eta || !what || !help) return;
    var base = stripTag(what.textContent), badge = $('calibBadge');
    var sh = ctx.state.shooter, v = sh.type === 'dual' ? sh.etaDual : sh.etaSingle, rg = wideRange(Number(eta.min), Number(eta.max), v);
    if (rg[0] !== Number(eta.min) || rg[1] !== Number(eta.max) || Number(eta.value) !== v) {   // the slider must show the real value, never snap it
      eta.min = rg[0]; eta.max = rg[1]; eta.value = v; $('etaOut').textContent = ctx.fmt.nf(v, st === 'none' ? 2 : 3);
    }
    if (st === 'none') { what.textContent = base + MANUAL; if (!/Set by hand/.test(help.textContent)) help.textContent += MAN_HELP; }
    else {
      what.textContent = base + (st === 'calibrated' ? ' (calibrated ' + record.date.slice(0, 10) + ')' : ' (calibrated value changed by hand)');
      if (st === 'calibrated') help.textContent = 'Fitted from your landing tests on ' + record.date.slice(0, 10) + '; the slider may sit outside its usual range. Moving it makes it a manual value.';
    }
    if (badge) badge.textContent = st === 'none' ? '' : (st === 'calibrated' ? 'Calibrated ' + record.date.slice(0, 10) : 'Calibration ' + record.date.slice(0, 10) + ' (value changed by hand)');
    if (els.clear) els.clear.disabled = !record;
  }

  function mount(host) {
    els.msg = el('p', { class: 'help', id: 'calibMsg', 'aria-live': 'polite' });
    els.sum = el('p', { class: 'calib-sum', id: 'calibSum' });
    els.table = el('table', { class: 'calib-grid', id: 'calibReportTable' });
    els.notes = el('ul', { class: 'calib-msgs' });
    els.seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Fit mode' }, [el('button', { type: 'button', 'data-v': 'single', text: 'Single eta' }), el('button', { type: 'button', 'data-v': 'perRpm', text: 'Per-rpm' })]);
    els.seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { mode = b.getAttribute('data-v'); run(); } });
    els.apply = el('button', { type: 'button', class: 'btn', id: 'calib-apply', text: 'Apply eta' });
    els.clear = el('button', { type: 'button', class: 'btn', id: 'calib-clear', text: 'Clear calibration' });
    els.apply.addEventListener('click', apply); els.clear.addEventListener('click', clear);
    els.box = el('div', { class: 'calib-sec', id: 'calibReport', hidden: '' }, [els.sum, els.seg, el('div', { class: 'table-wrap' }, [els.table]), els.notes, el('div', { class: 'calib-row' }, [els.apply])]);
    host.appendChild(el('section', { class: 'calib-sec' }, [els.box, el('div', { class: 'calib-row' }, [els.clear]), els.msg]));
    els.box.hidden = true;
    var lab = $('eta') && $('eta').parentNode;
    if (lab) lab.appendChild(el('span', { class: 'help calib-badge', id: 'calibBadge' }));
  }

  UI.calibReport = { run: run, record: function () { return record; } };
  UI.hooks = (UI.hooks || []).concat([{
    name: 'calib-report',
    onStart: function (c) { ctx = c; var h = $('calibHost'); if (h) mount(h); syncEta(); },
    onChange: function () { if (ctx) syncEta(); },
    onResult: function () { if (ctx) syncEta(); },
    configSlice: {
      key: 'calibration',
      get: function () { return record; },
      set: function (v) {
        record = v && v.calibrated ? v : null;
        if (record && UI.calibForm) UI.calibForm.load(record.raw, record.setpoints, record.angleOffsetDeg);
        if (ctx) syncEta();
      }
    }
  }]);
})(typeof window !== 'undefined' ? window : {});
