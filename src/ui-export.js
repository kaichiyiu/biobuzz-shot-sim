/* BIOBUZZ Shot Sim - #4 export: settings model, soundness flag, table build, preview cells (pure) + hook for #exportHost (browser).
   Browser: window.ShotUI.export (+ hook, ShotUI.exportRange). Node: module.exports (pure helpers). DOM panel: ui-export-panel.js.
   Config slice 'export' = { stepIn 2..12 (inch), ticksPerMotorRev number | null (null = the motor's encoderPPR), mouthForwardIn (inch), servo | null, formats }.
   Soundness (engine review): with a per-rpm eta curve the engine does not re-check the motor's usable free speed, so limitRows() marks rows whose
   highest rpm exceeds it "over motor limit" and exports them as reachable:false (so the Java arrays skip them). Design: process_docs/issue-4/design.md section 7.
   Stale settings (P1-F3, design section 15): start() captures params, calibration record, cfg(), eta curve and the usable free rpm ONCE; the finished table, its header, the motor-limit flag and the algorithm section use only those.
   The run is not cancelled when the simulator settings change meanwhile; isStale() (params or calibration differ at the end) labels the result "computed for the settings at start". */
(function (root) {
  'use strict';
  var FORMATS = [['csv', 'CSV'], ['json', 'JSON'], ['java', 'Java arrays']];
  var FILES = { csv: ['biobuzz-shot-table.csv', 'text/csv'], json: ['biobuzz-shot-table.json', 'application/json'], java: ['ShooterTable.java', 'text/x-java-source'] };

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function normServo(s) {
    if (!s || !fin(s.deg1) || !fin(s.pos1) || !fin(s.deg2) || !fin(s.pos2) || s.deg1 === s.deg2) return null;
    return { deg1: s.deg1, pos1: s.pos1, deg2: s.deg2, pos2: s.pos2 };
  }
  function normSettings(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var fm = Array.isArray(r.formats) ? FORMATS.map(function (f) { return f[0]; }).filter(function (id) { return r.formats.indexOf(id) >= 0; }) : ['csv', 'json', 'java'];
    return {
      stepIn: fin(r.stepIn) ? Math.min(12, Math.max(2, r.stepIn)) : 4,
      ticksPerMotorRev: fin(r.ticksPerMotorRev) && r.ticksPerMotorRev > 0 ? r.ticksPerMotorRev : null,
      mouthForwardIn: fin(r.mouthForwardIn) ? r.mouthForwardIn : 0,
      servo: normServo(r.servo), formats: fm
    };
  }
  // counts per motor output rev of the selected motor (engine data: encoderPPR)
  function defaultTicks(engine, params) { return engine.exportSettings({}, params).ticksPerMotorRev; }
  // settings (ticks null -> default) -> ExportSettings for the runner
  function runSettings(s, engine, params) {
    var o = normSettings(s);
    return { stepIn: o.stepIn, ticksPerMotorRev: o.ticksPerMotorRev == null ? defaultTicks(engine, params) : o.ticksPerMotorRev, mouthForwardIn: o.mouthForwardIn, servo: o.servo, formats: o.formats };
  }
  function usableFreeRpm(engine, p) { return engine.motorModel(p.motorId, p.shooter, p.ballId, 1).usableFreeRpm; }

  function limitRows(rows, free) {
    var over = 0;
    var out = rows.map(function (r) {
      if (r.reachable && r.motorRpm && fin(free) && r.motorRpm.hi > free * (1 + 1e-9)) { over++; return Object.assign({}, r, { reachable: false, overMotorLimit: true }); }
      return r;
    });
    return { rows: out, over: over };
  }
  // calib = CalibRecord | null; fmt = ExportFormat. Rows are copied, never changed.
  function buildTable(cfg, calib, rows, free, fmt, opts) {
    var L = limitRows(rows, free), h = fmt.header(cfg, calib, L.rows, opts);
    if (L.over) h.notes.push('Over motor limit: ' + L.over + ' row(s) need a highest rpm above the motor\'s usable free speed (' + Math.round(free) + ' rpm), which a per-rpm eta curve does not re-check. They are marked reachable=false (overMotorLimit in JSON) and left out of the Java arrays.');
    return { header: h, rows: L.rows };
  }
  var STALE_NOTE = 'Computed for the settings at the start of the run: the simulator settings changed while it ran. Run the export again to get the current settings.';
  function sigOf(x) { try { return JSON.stringify(x === undefined ? null : x); } catch (e) { return ''; } }
  // cap = what start() captured ({p, calib}); now* = the live params / calibration record when the run ends
  function isStale(cap, nowP, nowCalib) { return sigOf(cap.p) !== sigOf(nowP) || sigOf(cap.calib) !== sigOf(nowCalib); }
  function etaCurveOf(calib) { return calib && calib.calibrated && calib.mode === 'perRpm' && calib.fit && calib.fit.curve ? calib.fit.curve : undefined; }
  function rangeOf(rows) {
    var lo = Infinity, hi = -Infinity;
    (rows || []).forEach(function (r) { if (r.reachable && r.motorRpm) { lo = Math.min(lo, r.motorRpm.lo); hi = Math.max(hi, r.motorRpm.hi); } });
    return lo <= hi ? [lo, hi] : null;
  }
  // preview table cells; U = ShotUnits, system = 'imperial' | 'metric'
  function rowCells(rows, U, system) {
    var d = function (x) { return U.nf(U.toLen(x, system), 1); }, n = function (x, k) { return x == null ? '-' : U.nf(x, k); };
    return rows.map(function (r) {
      var c = { dist: d(r.dRobotIn), bad: !r.reachable };
      if (!r.reachable) {
        var why = r.overMotorLimit ? 'over motor limit' : 'not reachable';
        var rp = r.overMotorLimit && r.motorRpm ? n(r.motorRpm.c, 0) + ' [' + n(r.motorRpm.lo, 0) + '-' + n(r.motorRpm.hi, 0) + ']' : '-';
        return Object.assign(c, { rpm: rp, ticks: '-', angle: '-', tof: '-', bearing: '-', note: why });
      }
      var b = r.bearingDeg;
      return Object.assign(c, {
        rpm: n(r.motorRpm.c, 0) + ' [' + n(r.motorRpm.lo, 0) + '-' + n(r.motorRpm.hi, 0) + ']', ticks: n(r.ticksPerSec.c, 0),
        angle: n(r.launchDeg, 1) + '°', tof: n(r.tofS, 2) + ' s', bearing: b ? n(b.lo, 1) + ' to ' + n(b.hi, 1) + '°' : '-', note: ''
      });
    });
  }
  function textOf(fmt, id, table) {
    return id === 'csv' ? fmt.toCsv(table) : id === 'json' ? fmt.toJson(table) : fmt.toJavaArrays(table, 'ShooterTable');
  }

  var api = { FORMATS: FORMATS, normSettings: normSettings, normServo: normServo, defaultTicks: defaultTicks, runSettings: runSettings, usableFreeRpm: usableFreeRpm,
    limitRows: limitRows, buildTable: buildTable, isStale: isStale, STALE_NOTE: STALE_NOTE, etaCurveOf: etaCurveOf, rangeOf: rangeOf, rowCells: rowCells, textOf: textOf, FILES: FILES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var UI = root.ShotUI = root.ShotUI || {};
  var ctx = null, panel = null, settings = normSettings(null), lastP = null, run = null, table = null, tableRows = null, range = null;

  function calib() {
    try { var r = UI.calibReport && UI.calibReport.record && UI.calibReport.record(); if (r) return r; } catch (e) { /* none */ }
    var h = (UI.hooks || []).filter(function (x) { return x.configSlice && x.configSlice.key === 'calibration'; })[0];
    try { return h ? h.configSlice.get() || null : null; } catch (e) { return null; }
  }
  function cfg() {
    try { return UI.config.collect(ctx.state, (UI.hooks || []).map(function (h) { return h.configSlice; }).filter(Boolean)); } catch (e) { return null; }
  }
  // cap = the values captured by start(); the live lastP / calib / cfg are used only to decide whether the result is stale
  function show(rows, done, cap) {
    table = buildTable(cap.cfg, cap.calib, rows, cap.free, root.ExportFormat);
    var stale = isStale(cap, lastP, calib());
    if (stale) table.header.notes.push(STALE_NOTE);
    tableRows = table.rows;
    range = rangeOf(tableRows);
    panel.table(rowCells(tableRows, ctx.units, ctx.state.units), null, done && tableRows.length > 0);
    if (UI.exportAlgo) UI.exportAlgo.setTable({ rows: tableRows, params: cap.p, cfg: cap.cfg, etaCurve: cap.etaCurve, ready: !!done && tableRows.length > 0 });   // G4 hook-in: the algorithm section is built from the finished table
    return stale;
  }
  function start() {
    if (run) return;
    if (!lastP) { panel.say('No result yet. Wait for the simulator to finish its first calculation.'); return; }
    var p = lastP, c = calib(), rows = [], xs = runSettings(settings, ctx.engine, p);
    var cap = { p: p, calib: c, cfg: cfg(), etaCurve: etaCurveOf(c), free: usableFreeRpm(ctx.engine, p) };   // P1-F3: everything the table is built from, captured now
    panel.busy(true); panel.progress(0, 1); panel.say('Running at full accuracy...');
    var runP = p.tolerance ? Object.assign({}, p, { tolerance: Object.assign({}, p.tolerance, { best: false }) }) : p;   // rows only need the margin: skip the best-setpoint search (cap.p stays the live params)
    run = root.ExportRunner.run(runP, xs, {
      etaCurve: cap.etaCurve,
      onRow: function (row, done, total) { rows.push(row); panel.progress(done, total); }
    });
    var mine = run;
    run.promise.then(function (res) {
      if (run !== mine) return;
      run = null; panel.busy(false);
      var cancelled = res && res.cancelled;
      var stale = show(res, !cancelled, cap);
      panel.say((cancelled ? 'Cancelled after ' + res.length + ' rows. Run again for a complete table.' : res.length + ' rows (step ' + ctx.units.nf(ctx.units.toLen(xs.stepIn, ctx.state.units), 1) + ' ' + ctx.units.lenUnit(ctx.state.units) + ').') + (stale ? ' ' + STALE_NOTE : ''));
    }, function (err) {
      if (run !== mine) return;
      run = null; panel.busy(false); panel.say('Export failed: ' + (err && err.message ? err.message : err));
    });
  }
  function download(id) {
    if (!table) return;
    var f = FILES[id], a = document.createElement('a'), url = URL.createObjectURL(new Blob([textOf(root.ExportFormat, id, table)], { type: f[1] }));
    a.href = url; a.download = f[0]; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // a recalc is the only way to reach ui-config's debounced save (it saves on onResult)
  function set(partial) { settings = normSettings(Object.assign({}, settings, partial)); if (ctx) ctx.recalc(); }

  UI.exportRange = function () { return range; };
  UI.export = api;
  UI.hooks = (UI.hooks || []).concat([{
    name: 'export',
    onStart: function (c) {
      ctx = c;
      var host = document.getElementById('exportHost');
      if (!host || !UI.exportPanel) return;
      panel = UI.exportPanel.mount(host, {
        formats: FORMATS, settings: function () { return settings; }, set: set,
        units: function () { return { U: ctx.units, system: ctx.state.units }; },
        defaultTicks: function () { return lastP ? defaultTicks(ctx.engine, lastP) : 28; },
        run: start, cancel: function () { if (run) run.cancel(); }, download: download
      });
      panel.calibrated(!!(calib() && calib().calibrated));
    },
    onResult: function (r, p) { lastP = p; if (panel) { panel.calibrated(!!(calib() && calib().calibrated)); panel.sync(); } },
    onChange: function () { if (panel) { panel.sync(); if (tableRows && !run) panel.table(rowCells(tableRows, ctx.units, ctx.state.units), null, true); } },
    configSlice: { key: 'export', get: function () { return JSON.parse(JSON.stringify(settings)); }, set: function (v) { settings = normSettings(v); if (panel) panel.sync(true); } }
  }]);
})(typeof window !== 'undefined' ? window : {});
