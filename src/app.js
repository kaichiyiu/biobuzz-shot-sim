/* BIOBUZZ Shot Sim — UI. Needs window.SHOT_DATA, window.ShotEngine and (optionally) window.SHOT_WORKER_SRC / window.THREE. */
(function () {
  'use strict';

  var D = window.SHOT_DATA, E = window.ShotEngine, U = window.ShotUnits, UI = window.ShotUI;
  E.init(D);
  var F = D.field, SH = D.shooter, MODEL = SH.model;
  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;

  function nf(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function pct(x, d) { return x == null || !isFinite(x) ? '—' : nf(x * 100, d || 0) + '%'; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ------------------------------------------------------------------ display units (issue #16)
  // The engine works in inches / m/s / kg. Every length, speed and mass shown or typed goes through
  // these helpers; rpm, degrees, seconds, volts and percentages are never converted.
  var UNITS_KEY = 'biobuzz-shot-sim.units';
  function loadUnits() {
    var m = /[?&]units=(metric|imperial)\b/.exec(location.search);
    if (m) return m[1];
    try { return window.localStorage.getItem(UNITS_KEY) || 'imperial'; } catch (e) { return 'imperial'; }
  }
  function saveUnits(u) { try { window.localStorage.setItem(UNITS_KEY, u); } catch (e) { /* storage off */ } }
  U.setSystem(loadUnits());
  // origin corner of the user's field frame (persisted like units; ?origin=red-audience etc.)
  var ORIGIN_KEY = 'biobuzz-shot-sim.origin';
  function loadOrigin() {
    var m = /[?&]origin=([a-z-]+)/.exec(location.search);
    if (m && U.CORNERS[m[1]]) return m[1];
    try { return U.normCorner(window.localStorage.getItem(ORIGIN_KEY)); } catch (e) { return U.DEFAULT_CORNER; }
  }
  function saveOrigin(c) { try { window.localStorage.setItem(ORIGIN_KEY, c); } catch (e) { /* storage off */ } }
  U.setFieldHalf(F.field.half);
  U.setCorner(loadOrigin());
  function fmtLen(inches, d) { return U.fmtLen(inches, d); }
  function fmtSpeed(ms, d) { return U.fmtSpeed(ms, d); }
  function fmtMass(kg, d) { return U.fmtMass(kg, d); }
  function parseLen(text) { return U.parseLen(text); }
  function lenVal(inches) { return Math.round(U.toLen(inches) * 100) / 100; }  // value for a number input
  function L10n(text) { return U.localizeText(text); }                      // engine strings (in, m/s)

  // ------------------------------------------------------------------ state
  var def = SH.defaults || {};
  var wheelById = {};
  SH.wheels.forEach(function (w) { wheelById[w.id] = w; });
  // the shooter mouth stays one ball radius inside the walls (matches the engine clamp)
  function mouthLimit() { return F.field.half - E.ballProps(state.ballId).rIn; }
  var state = {
    ballId: 'pollen',
    target: 'red',
    hive: { red: F.hive.upSideStart.red, blue: F.hive.upSideStart.blue },
    mouth: { x: F.hive.hiveX.red, y: -48 },   // engine frame (in, field centre origin)
    h0: def.h0 || 16,
    units: U.getSystem(),
    origin: U.getCorner(),
    precision: def.precision || 'typical',
    motorId: (D.motors.motors.find(function (m) { return m.freeRpm === 6000; }) || D.motors.motors[0]).id,
    shooter: {
      type: def.type || 'single', wheelId: wheelById[def.wheelId] ? def.wheelId : SH.wheels[0].id,
      motorsPerWheel: def.motorsPerWheel || 1, gear: def.gear || 1, topRatio: def.topRatio != null ? def.topRatio : 0.6,
      wheelCount: def.wheelsPerShaft || 2, addOn: def.addOn || 'steel82', shotInterval: def.shotInterval || 0.5,
      control: def.control || 'pid', batteryV: def.batteryV || (MODEL.batteryV || 12),
      etaSingle: MODEL.etaSingle, etaDual: MODEL.etaDual
    },
    heat: false,
    hood: UI.hood.load(def.hood)
  };


  // flywheel inertia per shaft: wheels + optional steel flywheel + hubs (data/shooter.json)
  var addOnById = {};
  (SH.addOns || []).forEach(function (a) { addOnById[a.id] = a; });
  var HUB_I = addOnById.hubShaft ? addOnById.hubShaft.inertiaKgM2 : 5e-6;
  var ADDONS = [{ id: 'none', label: 'None', I: 0, n: 0 }];
  if (addOnById.steel60) ADDONS.push({ id: 'steel60', label: 'goBILDA 60 mm steel flywheel', I: addOnById.steel60.inertiaKgM2, n: 1, base: 'steel60' });
  if (addOnById.steel82) {
    ADDONS.push({ id: 'steel82', label: 'goBILDA 82 mm steel flywheel', I: addOnById.steel82.inertiaKgM2, n: 1, base: 'steel82' });
    ADDONS.push({ id: 'steel82x2', label: '2 × 82 mm steel flywheels', I: 2 * addOnById.steel82.inertiaKgM2, n: 2, base: 'steel82' });
  }
  function sci(x) { return (x * 1e4).toFixed(2) + '×10⁻⁴'; }
  function flywheelInertia(s, wheelId) {
    var w = wheelById[wheelId || s.wheelId], n = s.wheelCount || 1;
    var add = ADDONS.find(function (a) { return a.id === s.addOn; }) || ADDONS[0];
    var total = n * w.inertiaKgM2 + add.I + n * HUB_I;
    var text = n + ' × ' + sci(w.inertiaKgM2) + ' wheel' + (add.I ? ' + ' + sci(add.I) + ' steel' : '') + ' + ' + n + ' × ' + sci(HUB_I) + ' hub';
    return { total: total, wheelI: w.inertiaKgM2, n: n, addOn: add, hub: HUB_I, text: text };
  }

  // UI hook bus (window.ShotUI.hooks, see PLAN 2.9): a throwing hook is logged and never breaks the legacy flow
  var HOOKS = (UI.hooks || []);
  function callHooks(name) {
    var a = Array.prototype.slice.call(arguments, 1);
    HOOKS.forEach(function (h) {
      if (!h || typeof h[name] !== 'function') return;
      try { h[name].apply(h, a); } catch (e) { console.warn('ShotUI hook "' + (h.name || '?') + '".' + name + ' failed:', e); }
    });
  }
  function extendParams(p) {
    return HOOKS.reduce(function (q, h) {
      if (!h || typeof h.extendParams !== 'function') return q;
      try { var r = h.extendParams(q, state); return r && typeof r === 'object' ? r : q; }
      catch (e) { console.warn('ShotUI hook "' + (h.name || '?') + '".extendParams failed:', e); return q; }
    }, p);
  }

  function params(at) {
    var pr = SH.precision[state.precision], s = state.shooter;
    var inert = flywheelInertia(s);
    var p = {
      ballId: state.ballId, target: state.target, hiveState: { red: state.hive.red, blue: state.hive.blue },
      mouth: { x: at ? at.x : state.mouth.x, y: at ? at.y : state.mouth.y, height: state.h0 },
      precision: { sigThetaDeg: pr.sigThetaDeg, sigYawDeg: pr.sigYawDeg, sigShooter: pr.sigShooter },
      motorId: state.motorId, hood: UI.hood.toParams(state.hood),
      shooter: {
        type: s.type, wheelDiameterMm: wheelById[s.wheelId].diameterMm, motorsPerWheel: s.motorsPerWheel, gear: s.gear,
        topRatio: s.topRatio, inertiaKgM2: inert.total, shotInterval: s.shotInterval,
        etaSingle: s.etaSingle, etaDual: s.etaDual, control: s.control, batteryV: s.batteryV
      }
    };
    return extendParams(p);
  }

  // ------------------------------------------------------------------ palette
  var P = {};
  var PALETTE_KEYS = ['ground', 'panel', 'panel-2', 'ink', 'ink-2', 'ink-3', 'rule', 'tile', 'tile-seam', 'pollen', 'pollen-ink',
    'red', 'blue', 'good-mark', 'warn-mark', 'bad-mark', 'robot'];
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    PALETTE_KEYS.forEach(function (k) { P[k] = cs.getPropertyValue('--' + k).trim() || '#888'; });
  }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var VCLASS = { 'POSSIBLE': 'good', 'NOT CONSISTENT': 'warn', "WON'T WORK": 'bad' };
  var ICON = {
    good: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 5"/></svg>',
    warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M8 3v6.2M8 12.6v.4"/></svg>',
    bad: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    alert: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 15 14H1Z"/><path d="M8 6.3v3.4M8 11.8v.2"/></svg>'
  };

  // ------------------------------------------------------------------ UI modules (src/ui-*.js), see plan section 5.2
  var deps = { $: $, nf: nf, pct: pct, fmtLen: fmtLen, fmtSpeed: fmtSpeed, U: U, E: E, L10n: L10n, fillKV: fillKV, ICON: ICON, VCLASS: VCLASS,
    applyEmpty: function () {
      if (!current) return;
      current = Object.assign({}, current, { best: null, motor: null, trajectory: null, ghosts: [], closestMiss: null, verdict: null });
      drawField();
      drawSide();
      three.update();
    } };
  ['panels', 'results', 'window', 'hoodError', 'rpmPlot'].forEach(function (k) { UI[k].init(deps); });

  // ------------------------------------------------------------------ backend (worker or main thread)
  function mainBackend() {
    return {
      kind: 'main thread',
      evaluate: function (p, mode) { return new Promise(function (res) { setTimeout(function () { res(E.evaluate(p, mode)); }, 0); }); },
      motors: function (p) { return new Promise(function (res) { setTimeout(function () { res(E.compareMotors(p)); }, 0); }); },
      scan: function (p, onCell, onDone) {
        var pts = E.scanPoints(6), i = 0, stop = false;
        (function chunk() {
          if (stop) return;
          var t = performance.now();
          while (i < pts.length && performance.now() - t < 12) {
            var q = pts[i++];
            var r = E.evaluate(Object.assign({}, p, { mouth: Object.assign({}, p.mouth, { x: q.x, y: q.y }) }), 'coarse');
            onCell(q.x, q.y, r.verdict, i, pts.length);
          }
          if (i < pts.length) setTimeout(chunk, 0); else onDone();
        })();
        return function () { stop = true; };
      },
      sweep: function (p, onRow, onDone) {
        var pts = E.sweepPoints(p, 4), i = 0, stop = false;
        (function next() {
          if (stop) return;
          if (i >= pts.length) return onDone();
          var q = pts[i++], r = E.evaluate(Object.assign({}, p, { mouth: Object.assign({}, p.mouth, { x: q.x, y: q.y }) }), 'full');
          onRow(E.sweepRow(r, q.d), i, pts.length);
          setTimeout(next, 0);
        })();
        return function () { stop = true; };
      }
    };
  }

  function spawnWorker() {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([window.SHOT_WORKER_SRC], { type: 'text/javascript' }));
      var w = new Worker(url);
      var timer = setTimeout(function () { w.terminate(); reject(new Error('worker did not answer')); }, 2000);
      w.onmessage = function (e) { if (e.data && e.data.type === 'ready') { clearTimeout(timer); resolve(w); } };
      w.onerror = function (err) { clearTimeout(timer); w.terminate(); reject(err); };
      w.postMessage({ type: 'init', data: D });
    });
  }

  function makeBackend() {
    var noWorker = /[?&]noworker\b/.test(location.search);
    if (noWorker || !window.Worker || !window.SHOT_WORKER_SRC || !window.Blob || !window.URL) return Promise.resolve(mainBackend());
    var p;
    try { p = Promise.all([spawnWorker(), spawnWorker()]); } catch (e) { return Promise.resolve(mainBackend()); }
    return p.then(function (ws) {
      var live = ws[0], scanner = ws[1], pending = {}, seq = 0, scanId = 0, scanCbs = null, sweepSeq = 0, sweepId = '', sweepCbs = null;
      live.onmessage = function (e) {
        var m = e.data, cb = pending[m.id];
        if (!cb) return;
        delete pending[m.id];
        if (m.type === 'error') cb.reject(new Error(m.message)); else cb.resolve(m.type === 'motors' ? m.rows : m.result);
      };
      scanner.onmessage = function (e) {
        var m = e.data;
        if (typeof m.id === 'string') {   // sweep ids are strings, so they never collide with scan ids
          if (!sweepCbs || m.id !== sweepId) return;
          if (m.type === 'sweepRow') sweepCbs.onRow(m.row, m.done, m.total); else if (m.type === 'sweepDone' || m.type === 'error') sweepCbs.onDone();
          return;
        }
        if (!scanCbs || m.id !== scanId) return;
        if (m.type === 'scanCell') scanCbs.onCell(m.x, m.y, m.verdict, m.done, m.total);
        else if (m.type === 'scanDone' || m.type === 'error') scanCbs.onDone();
      };
      function call(msg) {
        return new Promise(function (resolve, reject) {
          var id = ++seq;
          pending[id] = { resolve: resolve, reject: reject };
          msg.id = id;
          live.postMessage(msg);
        });
      }
      return {
        kind: 'web worker',
        evaluate: function (pp, mode) { return call({ type: 'evaluate', params: pp, mode: mode }); },
        motors: function (pp) { return call({ type: 'motors', params: pp }); },
        scan: function (pp, onCell, onDone) {
          var my = ++scanId;
          scanCbs = { onCell: onCell, onDone: onDone };
          scanner.postMessage({ type: 'scan', id: my, params: pp, step: 6 });
          return function () { if (scanId === my) { scanCbs = null; scanner.postMessage({ type: 'cancelScan' }); } };
        },
        sweep: function (pp, onRow, onDone) {
          var my = sweepId = 's' + (++sweepSeq);
          sweepCbs = { onRow: onRow, onDone: onDone };
          scanner.postMessage({ type: 'sweep', id: my, params: pp, step: 4 });
          return function () { if (sweepId === my) { sweepCbs = null; scanner.postMessage({ type: 'cancelSweep' }); } };
        }
      };
    }).catch(function () { return mainBackend(); });
  }

  var backend = null;
  var mathDialog = $('mathDialog');

  // ------------------------------------------------------------------ jobs
  var current = null;          // last applied result
  var currentParams = null;
  var queued = null, running = false, jobSeq = 0, motorsSeq = 0, fullTimer = 0;

  function request(mode) {
    if (UI.hoodError.active()) return;
    queued = { mode: mode, params: params(), seq: ++jobSeq };
    pump();
  }
  function pump() {
    if (running || !queued || !backend) return;
    var job = queued;
    queued = null;
    running = true;
    setBusy(true);
    backend.evaluate(job.params, job.mode).then(function (r) {
      apply(r, job.params, job.mode);
    }).catch(function (err) {
      $('reason').textContent = 'Something went wrong while calculating: ' + err.message;
    }).then(function () {
      running = false;
      if (queued) pump(); else setBusy(false);
    });
  }
  function requestFull(delay) {
    clearTimeout(fullTimer);
    fullTimer = setTimeout(function () {
      request('full');
      requestMotors();
      if (state.heat) startScan();
    }, delay == null ? 150 : delay);
  }
  function requestMotors() {
    if (!backend || UI.hoodError.active()) return;
    var my = ++motorsSeq;
    backend.motors(params()).then(function (rows) { if (my === motorsSeq) renderMotors(rows); }).catch(function () {});
  }
  function setBusy(on) { $('arcPanel').classList.toggle('busy', !!on); }

  function apply(r, p, mode) {
    if (UI.hoodError.active()) return;   // a result that was in flight when the error state began
    current = r;
    currentParams = p;
    renderResults(r, p);
    renderMotor(r, p);
    drawField();
    if (mode === 'full') { drawSide(); three.update(); if (mathDialog.open) renderMath(); }
    UI.rpmPlot.update(backend, p, r, mode);
    callHooks('onResult', r, p, mode);
  }
  function renderResults(r, p) {
    if (!UI.hoodError.active()) { UI.results.renderBadge(r); UI.results.renderArc(r, p); UI.results.renderReference(r); }
  }

  // ------------------------------------------------------------------ readouts
  function fillKV(dl, items) {
    dl.replaceChildren();
    items.forEach(function (it) {
      var d = document.createElement('div');
      if (it.wide) d.className = 'wide';
      if (it.error) d.classList.add('err');
      var dt = document.createElement('dt');
      dt.textContent = it.label;
      var dd = document.createElement('dd');
      dd.textContent = it.value;
      if (it.small) {
        var sm = document.createElement('small');
        sm.textContent = it.small;
        dd.appendChild(sm);
      }
      d.appendChild(dt);
      d.appendChild(dd);
      dl.appendChild(d);
    });
  }

  function renderMotor(r, p) {
    var m = r.motor, dl = $('motorReadout');
    var mo = D.motors.motors.find(function (x) { return x.id === p.motorId; });
    var fill = $('meterFill');
    if (!m) {
      fillKV(dl, [{ label: 'Motor', value: mo ? mo.label : '—', wide: true, small: 'No arc from here, so there is no speed to check' }]);
      fill.style.width = '0';
      return;
    }
    var bp = E.ballProps(p.ballId);
    var spinRpm = m.S0 * (r.best ? r.best.v : 0) / (bp.rIn * 0.0254) * 60 / (2 * Math.PI);
    var sg = r.sigma || {};
    fillKV(dl, [
      { label: 'Wheel speed', value: nf(m.wheelRpm, 0) + ' rpm', small: fmtLen(p.shooter.wheelDiameterMm / 25.4, 1) + ' wheel' },
      { label: 'Motor speed', value: nf(m.motorRpm, 0) + ' rpm', small: 'of ' + nf(m.usableFreeRpm, 0) + ' usable (' + pct(m.headroom) + ')' },
      { label: 'Dip per shot', value: pct(m.dip, 1), small: !isFinite(m.recoveryMs) ? 'never recovers' : (m.control === 'power' ? 'within 1% after ' : 'back to speed in ') + (m.recoveryMs >= 1000 ? nf(m.recoveryMs / 1000, 1) + ' s' : nf(m.recoveryMs, 0) + ' ms') },
      { label: 'Spin-up', value: isFinite(m.spinUpMs) ? nf(m.spinUpMs / 1000, 2) + ' s' : '—', small: 'from a standstill' },
      { label: 'Speed scatter', value: sg.v != null ? '±' + pct(sg.v, 1) : '—',
        small: sg.v != null ? 'shots ' + pct(sg.shooter, 1) + ' · motor ' + pct(sg.motor, 1) + ' · recovery ' + pct(sg.recovery, 1) : '' },
      { label: 'Backspin', value: nf(spinRpm, 0) + ' rpm', small: 'spin ratio ' + nf(m.S0, 2) }
    ]);
    var h = m.headroom;
    fill.style.width = clamp(h * 100, 0, 100) + '%';
    fill.className = 'meter-fill' + (h > 1 ? ' bad' : h > 0.8 ? ' warn' : '');
  }

  var lastMotorRows = null;
  function renderMotors(rows) {
    lastMotorRows = rows;
    var body = $('motorRows'), fsf = MODEL.freeSpeedFactor || 1, g = state.shooter.gear;
    body.replaceChildren();
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      if (row.motorId === state.motorId) { tr.className = 'sel'; tr.setAttribute('aria-selected', 'true'); }
      var mo = D.motors.motors.find(function (x) { return x.id === row.motorId; });
      var td0 = document.createElement('td');
      td0.textContent = row.label;
      var sku = document.createElement('small');
      sku.textContent = mo ? mo.sku : '';
      td0.appendChild(sku);
      tr.appendChild(td0);
      var need = row.motorRpm != null ? row.motorRpm / (row.freeRpm * fsf * 0.8) * g : null;
      var cells = [
        nf(row.freeRpm, 0) + ' rpm',
        row.motorRpm != null ? nf(row.motorRpm, 0) + ' rpm' : '—',
        row.headroom != null ? pct(row.headroom) : '—',
        need == null ? '—' : need <= g + 1e-9 ? 'not needed' : nf(need, 1) + ' : 1',
        row.recoveryMs != null && isFinite(row.recoveryMs) && row.headroom <= 1 ? (row.recoveryMs >= 1000 ? nf(row.recoveryMs / 1000, 1) + ' s' : nf(row.recoveryMs, 0) + ' ms') : '—',
        pct(row.hitRate)
      ];
      cells.forEach(function (c) { var td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
      var tdv = document.createElement('td');
      var cls = VCLASS[row.verdict] || 'bad';
      var chip = document.createElement('span');
      chip.className = 'vchip v-' + cls;
      chip.innerHTML = ICON[cls];
      chip.appendChild(document.createTextNode(row.verdict));
      chip.title = row.reason;
      tdv.appendChild(chip);
      tr.appendChild(tdv);
      function pick() { state.motorId = row.motorId; syncControls(); requestFull(0); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      body.appendChild(tr);
    });
    $('motorsCaption').textContent = 'Same wheel (' + fmtLen(wheelById[state.shooter.wheelId].diameterMm / 25.4, 1) + '), gearing (' + g + ' : 1), ' + (state.shooter.control === 'pid' ? 'PID' : 'fixed power') + ' at ' + nf(state.shooter.batteryV, 1) + ' V and shooter. "Gear-up for 80%" is the wheel : motor ratio that would run the motor at 80% of its free speed. Click a row to use that motor.';
  }

  // ------------------------------------------------------------------ field view
  var fieldCanvas = $('field'), fctx = fieldCanvas.getContext('2d');
  var FV = { size: 600, ext: F.field.half + 9, dpr: 1 };
  var hiveCache = { key: '', model: null };
  function hive() {
    var key = state.hive.red + ',' + state.hive.blue;
    if (hiveCache.key !== key) { hiveCache.key = key; hiveCache.model = E.hiveModel(state.hive); }
    return hiveCache.model;
  }
  function layoutField() {
    var wrap = $('fieldWrap');
    var avail = wrap.clientWidth;
    var maxH = Math.max(340, window.innerHeight - 140);
    var size = Math.max(260, Math.floor(Math.min(avail, maxH)));
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    FV.size = size; FV.dpr = dpr;
    fieldCanvas.style.width = size + 'px';
    fieldCanvas.style.height = size + 'px';
    fieldCanvas.width = Math.round(size * dpr);
    fieldCanvas.height = Math.round(size * dpr);
  }
  function sx(x) { return (x + FV.ext) / (2 * FV.ext) * FV.size; }
  function sy(y) { return (FV.ext - y) / (2 * FV.ext) * FV.size; }
  function k() { return FV.size / (2 * FV.ext); }
  function toWorld(px, py) { return { x: px / FV.size * 2 * FV.ext - FV.ext, y: FV.ext - py / FV.size * 2 * FV.ext }; }

  function hull2(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (pts.length < 3) return pts;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
  }
  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }

  var heatCells = {}, heatKey = '', heatStop = null, heatCount = 0;

  function drawField() {
    var c = fctx, s = FV.size, K = k(), half = F.field.half;
    c.setTransform(FV.dpr, 0, 0, FV.dpr, 0, 0);
    c.clearRect(0, 0, s, s);
    c.fillStyle = P.ground;
    c.fillRect(0, 0, s, s);

    // alliance areas (outside the walls)
    ['red', 'blue'].forEach(function (al) {
      var a = F.allianceAreas[al];
      var x0 = Math.max(a.x0, -FV.ext), x1 = Math.min(a.x1, FV.ext);
      c.fillStyle = rgba(P[al], 0.16);
      c.fillRect(sx(x0), sy(a.y1), (x1 - x0) * K, (a.y1 - a.y0) * K);
      c.save();
      c.translate(sx(al === 'red' ? -half - 4.5 : half + 4.5), sy(0));
      c.rotate(al === 'red' ? -Math.PI / 2 : Math.PI / 2);
      c.fillStyle = P['ink-2'];
      c.font = '600 ' + Math.max(10, Math.round(3.4 * K)) + 'px "Barlow Semi Condensed", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(al.toUpperCase() + ' ALLIANCE', 0, 0);
      c.restore();
    });
    c.fillStyle = P['ink-3'];
    c.font = '600 ' + Math.max(10, Math.round(3.2 * K)) + 'px "Barlow Semi Condensed", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('AUDIENCE', sx(0), sy(-half - 4.5));

    // tiles
    c.fillStyle = P.tile;
    c.fillRect(sx(-half), sy(half), 2 * half * K, 2 * half * K);
    c.strokeStyle = P['tile-seam'];
    c.lineWidth = 1;
    (F.field.tileSeams || []).forEach(function (v) {
      line(c, [sx(v), sy(half)], [sx(v), sy(-half)]);
      line(c, [sx(-half), sy(v)], [sx(half), sy(v)]);
    });

    // heat map
    if (state.heat) {
      var step = 6;
      Object.keys(heatCells).forEach(function (key) {
        var cell = heatCells[key], cls = VCLASS[cell.v];
        c.fillStyle = rgba(P[cls + '-mark'], 0.5);
        c.fillRect(sx(cell.x - step / 2) + 0.5, sy(cell.y + step / 2) + 0.5, step * K - 1, step * K - 1);
      });
    }

    // zones
    ['red', 'blue'].forEach(function (al) {
      var z = F.loadingZones[al];
      c.strokeStyle = P[al];
      c.lineWidth = Math.max(2, 1.2 * K);
      c.strokeRect(sx(z.x0) + c.lineWidth / 2, sy(z.y1) + c.lineWidth / 2, (z.x1 - z.x0) * K - c.lineWidth, (z.y1 - z.y0) * K - c.lineWidth);
      var g = F.gardens[al];
      c.fillStyle = P[al];
      c.fillRect(sx(g.x0), sy(g.y1), (g.x1 - g.x0) * K, Math.max(2, (g.y1 - g.y0) * K));
    });

    // walls
    c.strokeStyle = P['ink-2'];
    c.lineWidth = Math.max(2, (F.field.wallThickness || 1) * K);
    c.strokeRect(sx(-half) - c.lineWidth / 2, sy(half) - c.lineWidth / 2, 2 * half * K + c.lineWidth, 2 * half * K + c.lineWidth);

    // flowers
    F.flowers.forEach(function (fl) {
      var alongX = fl.wall === '+y' || fl.wall === '-y';
      var wx = (alongX ? fl.alongWall : fl.depth) * K, wy = (alongX ? fl.depth : fl.alongWall) * K;
      c.fillStyle = P['panel-2'];
      c.strokeStyle = P['ink-3'];
      c.lineWidth = 1.2;
      c.fillRect(sx(fl.x) - wx / 2, sy(fl.y) - wy / 2, wx, wy);
      c.strokeRect(sx(fl.x) - wx / 2, sy(fl.y) - wy / 2, wx, wy);
      c.beginPath();
      c.arc(sx(fl.x), sy(fl.y), Math.max(2, fl.openingDia / 2 * K), 0, 2 * Math.PI);
      c.stroke();
    });

    // HIVE frame
    var hm = hive(), fr = hm.frame;
    c.strokeStyle = P['ink-3'];
    c.lineCap = 'round';
    c.lineWidth = Math.max(1.5, 2 * fr.tubeRadius * K);
    if (fr.footBars) fr.footBars.segments.forEach(function (sg) { line(c, [sx(sg[0][0]), sy(sg[0][1])], [sx(sg[1][0]), sy(sg[1][1])]); });
    fr.legs.forEach(function (sg) { line(c, [sx(sg[0][0]), sy(sg[0][1])], [sx(sg[1][0]), sy(sg[1][1])]); });
    line(c, [sx(fr.crossbar[0][0]), sy(fr.crossbar[0][1])], [sx(fr.crossbar[1][0]), sy(fr.crossbar[1][1])]);

    // CELLs (down first, then up, target last)
    var order = [];
    hm.hives.forEach(function (h) { h.cells.forEach(function (cell) { order.push({ h: h, cell: cell }); }); });
    order.sort(function (a, b) {
      var ra = (a.cell.role === 'up' ? 1 : 0) + (a.h.alliance === state.target && a.cell.role === 'up' ? 1 : 0);
      var rb = (b.cell.role === 'up' ? 1 : 0) + (b.h.alliance === state.target && b.cell.role === 'up' ? 1 : 0);
      return ra - rb;
    });
    order.forEach(function (o) {
      var isT = o.h.alliance === state.target && o.cell.role === 'up';
      var pts = hull2(o.cell.vertices.map(function (v) { return [sx(v[0]), sy(v[1])]; }));
      poly(c, pts);
      c.fillStyle = rgba(P[o.h.alliance], o.cell.role === 'up' ? (isT ? 0.34 : 0.22) : 0.10);
      c.fill();
      c.strokeStyle = isT ? P.ink : rgba(P[o.h.alliance], 0.9);
      c.lineWidth = isT ? 2 : 1.2;
      c.stroke();
    });
    hm.hives.forEach(function (h) {
      c.strokeStyle = P['ink-3'];
      c.lineWidth = Math.max(1.5, 2 * h.armRadius * K);
      for (var i = 0; i + 1 < h.armBar.length; i++) line(c, [sx(h.armBar[i][0]), sy(h.armBar[i][1])], [sx(h.armBar[i + 1][0]), sy(h.armBar[i + 1][1])]);
    });
    // target mouth lip
    var th = hm.hives.find(function (h) { return h.alliance === state.target; });
    var mouth = th.cells[0].mouth;
    c.strokeStyle = P.pollen;
    c.lineWidth = Math.max(3, 1.3 * K);
    line(c, [sx(mouth[0][0]), sy(mouth[0][1])], [sx(mouth[1][0]), sy(mouth[1][1])]);
    var mc = hm.mouthCentroid[state.target];
    c.fillStyle = P['ink-2'];
    c.font = '700 ' + Math.max(10, Math.round(3.4 * K)) + 'px "Barlow Semi Condensed", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var lx = th.hx + (th.alliance === 'red' ? -1 : 1) * 17;
    c.fillText('UP', sx(lx), sy(mc[1]));

    // ground track + aim
    var r = current, aimHeading = r ? (r.best ? r.best.yawDeg : r.psi0Deg) : 90;
    var lp = { x: state.mouth.x, y: state.mouth.y };
    if (r && r.trajectory && r.best && r.best.reachable !== false) {
      c.strokeStyle = P.pollen;
      c.lineWidth = 3;
      c.lineJoin = 'round';
      c.beginPath();
      r.trajectory.forEach(function (q, i) { if (i) c.lineTo(sx(q[0]), sy(q[1])); else c.moveTo(sx(q[0]), sy(q[1])); });
      c.stroke();
    } else {
      c.strokeStyle = rgba(P['ink-2'], 0.6);
      c.lineWidth = 1.5;
      line(c, [sx(lp.x), sy(lp.y)], [sx(mc[0]), sy(mc[1])]);
    }
    c.beginPath();
    c.arc(sx(mc[0]), sy(mc[1]), Math.max(3, 1.2 * K), 0, 2 * Math.PI);
    c.fillStyle = P.ink;
    c.fill();

    // origin corner + axes of the user frame
    var oc = U.CORNERS[state.origin], ox = oc.fx * half, oy = oc.fy * half, al = 14;
    c.strokeStyle = P.ink;
    c.fillStyle = P.ink;
    c.lineWidth = 2;
    line(c, [sx(ox), sy(oy)], [sx(ox + oc.fx * -al), sy(oy)]);
    line(c, [sx(ox), sy(oy)], [sx(ox), sy(oy + oc.fy * -al)]);
    c.beginPath();
    c.arc(sx(ox), sy(oy), Math.max(3, 1.1 * K), 0, 2 * Math.PI);
    c.fill();
    c.font = '700 ' + Math.max(10, Math.round(3.2 * K)) + 'px "Barlow Semi Condensed", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('x', sx(ox - oc.fx * (al + 3)), sy(oy - oc.fy * 3));
    c.fillText('y', sx(ox - oc.fx * 3), sy(oy - oc.fy * (al + 3)));
    c.fillText('(0,0)', sx(ox - oc.fx * 7), sy(oy - oc.fy * 7));

    // shooter mouth marker + heading tick
    var mx = sx(lp.x), my = sy(lp.y), mr = Math.max(5, 2.2 * K);
    c.strokeStyle = P.ink;
    c.lineWidth = 2.5;
    line(c, [mx, my], [mx + Math.cos(aimHeading * DEG) * mr * 2.6, my - Math.sin(aimHeading * DEG) * mr * 2.6]);
    c.fillStyle = P.pollen;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(mx, my, mr, 0, 2 * Math.PI);
    c.fill();
    c.stroke();
    c.fillStyle = P.ink;
    c.beginPath();
    c.arc(mx, my, Math.max(1.5, 0.5 * K), 0, 2 * Math.PI);
    c.fill();
    if (document.activeElement === fieldCanvas) {
      c.strokeStyle = P.pollen;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(mx, my, mr * 2.2, 0, 2 * Math.PI);
      c.stroke();
    }
  }

  // pointer + keyboard
  var dragging = false, dragFrame = 0;
  // x, y in the engine frame (in). Snap to the display step in the user frame, then clamp.
  function moveMouthTo(x, y, mode, exact) {
    var L = mouthLimit();
    x = clamp(x, -L, L); y = clamp(y, -L, L);
    if (!exact) {
      var st = U.lenStep(), q = U.fieldToDisplay(x, y);
      var w = U.displayToField(Math.round(q.x / st) * st, Math.round(q.y / st) * st);
      x = clamp(w.x, -L, L); y = clamp(w.y, -L, L);
    }
    state.mouth.x = x;
    state.mouth.y = y;
    syncMouthInputs();
    drawField();
    if (mode === 'coarse') {
      if (!dragFrame) dragFrame = requestAnimationFrame(function () { dragFrame = 0; request('coarse'); });
    } else {
      request('coarse');
      requestFull(250);
    }
  }
  function eventWorld(e) {
    var rect = fieldCanvas.getBoundingClientRect();
    return toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }
  fieldCanvas.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    fieldCanvas.setPointerCapture(e.pointerId);
    fieldCanvas.classList.add('dragging');
    fieldCanvas.focus({ preventScroll: true });
    var w = eventWorld(e);
    moveMouthTo(w.x, w.y, 'coarse');
    e.preventDefault();
  });
  fieldCanvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var w = eventWorld(e);
    moveMouthTo(w.x, w.y, 'coarse');
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    fieldCanvas.classList.remove('dragging');
    try { fieldCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    requestFull(0);
  }
  fieldCanvas.addEventListener('pointerup', endDrag);
  fieldCanvas.addEventListener('pointercancel', endDrag);
  fieldCanvas.addEventListener('keydown', function (e) {
    var d = e.shiftKey ? 6 : 1, dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -d; else if (e.key === 'ArrowRight') dx = d;
    else if (e.key === 'ArrowUp') dy = d; else if (e.key === 'ArrowDown') dy = -d;
    else return;
    e.preventDefault();
    var step = U.fromLen(d * U.lenStep() * (U.getSystem() === 'metric' ? 1 : 2));   // 1 in / 1 cm (Shift: 6)
    moveMouthTo(state.mouth.x + Math.sign(dx) * step, state.mouth.y + Math.sign(dy) * step, 'key');
  });
  fieldCanvas.addEventListener('focus', drawField);
  fieldCanvas.addEventListener('blur', drawField);

  // heat map
  function heatParamsKey(p) { var q = Object.assign({}, p, { mouth: { height: p.mouth.height } }); return JSON.stringify(q); }
  function startScan() {
    if (!backend || UI.hoodError.active()) return;
    var p = params(), key = heatParamsKey(p);
    if (key === heatKey && heatStop === null && heatCount > 0) return; // finished for these settings
    if (heatStop) heatStop();
    heatKey = key;
    heatCells = {};
    heatCount = 0;
    var prog = $('scanProgress');
    prog.hidden = false;
    var drawQueued = false;
    heatStop = backend.scan(p, function (x, y, verdict, done, total) {
      heatCells[x + ',' + y] = { x: x, y: y, v: verdict };
      heatCount = done;
      prog.textContent = 'Map ' + Math.round(done / total * 100) + '%';
      if (!drawQueued) { drawQueued = true; requestAnimationFrame(function () { drawQueued = false; drawField(); }); }
    }, function () {
      heatStop = null;
      prog.textContent = 'Map ready';
      drawField();
    });
  }
  $('scanBtn').addEventListener('click', function () {
    state.heat = !state.heat;
    this.setAttribute('aria-pressed', String(state.heat));
    $('heatLegend').hidden = !state.heat;
    if (state.heat) startScan();
    else {
      if (heatStop) { heatStop(); heatStop = null; }
      heatKey = ''; heatCells = {}; heatCount = 0;
      $('scanProgress').hidden = true;
      drawField();
    }
  });

  // ------------------------------------------------------------------ side view
  var sideCanvas = $('side'), sctx = sideCanvas.getContext('2d');
  function drawSide() {
    var r = current, p = currentParams;
    if (!r || !p) return;
    var cssW = sideCanvas.clientWidth || 500, cssH = Math.round(Math.max(250, Math.min(420, cssW * 0.72)));
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    sideCanvas.style.height = cssH + 'px';
    sideCanvas.width = Math.round(cssW * dpr);
    sideCanvas.height = Math.round(cssH * dpr);
    var c = sctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = P['panel-2'];
    c.fillRect(0, 0, cssW, cssH);

    var sv = E.sideView(p, r);
    var arc = sv.arcs.trajectory || (r.closestMiss ? r.closestMiss.path.map(function (q) {
      return [(q[0] - sv.origin[0]) * sv.uAxis[0] + (q[1] - sv.origin[1]) * sv.uAxis[1], q[2]];
    }) : null);
    var s0 = -14, s1 = 14, zTop = 80;
    function grow(q) { if (q[0] < s0) s0 = q[0]; if (q[0] > s1) s1 = q[0]; if (q[1] + 8 > zTop) zTop = q[1] + 8; }
    sv.polys.forEach(function (pl) { if (pl.role === 'target' || pl.role === 'cell') pl.pts.forEach(grow); });
    if (arc) arc.forEach(grow);
    s0 -= 6; s1 += 6;
    var m = { l: 34, r: 10, t: 10, b: 26 };
    var kk = Math.min((cssW - m.l - m.r) / (s1 - s0), (cssH - m.t - m.b) / zTop);
    var ox = m.l + ((cssW - m.l - m.r) - (s1 - s0) * kk) / 2;
    function X(s) { return ox + (s - s0) * kk; }
    function Y(z) { return cssH - m.b - z * kk; }

    c.strokeStyle = P.rule;
    c.lineWidth = 1;
    c.font = '500 11px "JetBrains Mono", monospace';
    c.fillStyle = P['ink-3'];
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (var z = 0; z <= zTop; z += 12) { line(c, [X(s0), Y(z)], [X(s1), Y(z)]); c.fillText(nf(U.toLen(z), 0), m.l - 6, Y(z)); }
    c.textAlign = 'center';
    c.textBaseline = 'top';
    var stepS = (s1 - s0) > 160 ? 48 : 24;
    for (var sVal = Math.ceil(s0 / stepS) * stepS; sVal <= s1; sVal += stepS) c.fillText(nf(U.toLen(sVal), 0), X(sVal), Y(0) + 6);
    c.strokeStyle = P['ink-2'];
    c.lineWidth = 1.5;
    line(c, [X(s0), Y(0)], [X(s1), Y(0)]);

    sv.polys.forEach(function (pl) {
      var pts = pl.pts.map(function (q) { return [X(q[0]), Y(q[1])]; });
      poly(c, pts);
      if (pl.role === 'target') { c.fillStyle = rgba(P.pollen, 0.16); c.strokeStyle = P.ink; c.lineWidth = 1.5; }
      else if (pl.role === 'cell') { c.fillStyle = rgba(P[pl.alliance] || P['ink-3'], 0.12); c.strokeStyle = rgba(P['ink-3'], 0.8); c.lineWidth = 1; }
      else { c.fillStyle = rgba(P['ink-3'], 0.35); c.strokeStyle = 'transparent'; c.lineWidth = 0; }
      c.fill();
      if (c.lineWidth) c.stroke();
    });
    if (sv.mouth) {
      var mh = hull2(sv.mouth.map(function (q) { return [X(q[0]), Y(q[1])]; }));
      c.strokeStyle = P.pollen;
      c.lineWidth = 3;
      poly(c, mh);
      c.stroke();
    }

    // shooter mouth: s = 0, a post from the tiles up to the mouth height (robot body not modelled)
    var h0 = p.h0;
    c.strokeStyle = P['ink-2'];
    c.lineWidth = 3;
    line(c, [X(0), Y(0)], [X(0), Y(h0)]);
    c.fillStyle = P.ink;
    c.beginPath();
    c.arc(X(0), Y(h0), 3.5, 0, 2 * Math.PI);
    c.fill();

    (sv.arcs.ghosts || []).forEach(function (g) {
      c.strokeStyle = P['ink-3'];
      c.lineWidth = 1.5;
      c.beginPath();
      g.forEach(function (q, i) { if (i) c.lineTo(X(q[0]), Y(q[1])); else c.moveTo(X(q[0]), Y(q[1])); });
      c.stroke();
    });
    if (arc) {
      var ok = !!sv.arcs.trajectory && r.best && r.best.reachable !== false;
      c.strokeStyle = ok ? P.pollen : P['bad-mark'];
      c.lineWidth = ok ? 3 : 2;
      c.lineJoin = 'round';
      c.beginPath();
      arc.forEach(function (q, i) { if (i) c.lineTo(X(q[0]), Y(q[1])); else c.moveTo(X(q[0]), Y(q[1])); });
      c.stroke();
      var end = arc[arc.length - 1], rIn = E.ballProps(p.ballId).rIn;
      c.beginPath();
      c.arc(X(end[0]), Y(end[1]), Math.max(3, rIn * kk), 0, 2 * Math.PI);
      c.fillStyle = ok ? P.pollen : P['bad-mark'];
      c.fill();
      var apex = arc.reduce(function (a, q) { return q[1] > a[1] ? q : a; }, arc[0]);
      c.fillStyle = P.ink;
      c.font = '600 12px "Barlow Semi Condensed", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillText((ok ? 'apex ' : 'closest try · apex ') + fmtLen(apex[1], 0), X(apex[0]), Y(apex[1]) - 6);
    }
    c.fillStyle = P['ink-2'];
    c.font = '500 11px "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(U.lenUnit() + ' · along the shot from the mouth', m.l, 4);
    if (!UI.hoodError.active()) $('viewsCaption').textContent = r.best ? 'Launch ' + nf(r.best.thetaDeg, 1) + '° at ' + fmtSpeed(r.best.v) + ' from ' + fmtLen(p.h0, 0) + ' up. Side view and 3-D view are to scale.' : 'No clean arc from this spot — the red line is the closest try.';
  }

  // ------------------------------------------------------------------ 3-D view
  var three = (function () {
    var host = $('threeHost'), T = window.THREE, api = { update: function () {}, rebuild: function () {}, resize: function () {} };
    if (!T) {
      host.classList.add('no3d');
      host.textContent = '3-D view unavailable (three.js did not load). Everything else works.';
      return api;
    }
    var renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); } catch (e) {
      host.classList.add('no3d');
      host.textContent = '3-D view unavailable (WebGL is off). Everything else works.';
      return api;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    var scene = new T.Scene(), camera = new T.PerspectiveCamera(38, 4 / 3, 1, 3000);
    var hemi = new T.HemisphereLight(0xffffff, 0x777777, 0.62), sun = new T.DirectionalLight(0xffffff, 0.5);
    sun.position.set(-120, 220, 160);
    scene.add(hemi, sun);
    var staticGroup = new T.Group(), dynGroup = new T.Group();
    scene.add(staticGroup, dynGroup);
    var orbit = { az: 2.2, el: 0.5, dist: 235, target: new T.Vector3(0, 22, 0) };
    var needs = true, userOrbited = false;

    function V(p) { return new T.Vector3(p[0], p[2], -p[1]); }
    function col(k) { return new T.Color(P[k]); }
    function clear(g) {
      while (g.children.length) {
        var o = g.children.pop();
        o.traverse(function (n) { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
      }
    }
    function rod(a, b, r, color, g) {
      var va = V(a), vb = V(b), len = va.distanceTo(vb);
      var mesh = new T.Mesh(new T.CylinderGeometry(r, r, len, 10), new T.MeshStandardMaterial({ color: color, roughness: 0.7 }));
      mesh.position.copy(va).add(vb).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      g.add(mesh);
    }
    function cellMesh(cell, color, opacity, edgeColor, g) {
      var v = cell.vertices, pos = [], idx = [];
      v.forEach(function (p) { var q = V(p); pos.push(q.x, q.y, q.z); });
      for (var i = 0; i < 5; i++) { var j = (i + 1) % 5; idx.push(i, j, 5 + j, i, 5 + j, 5 + i); }
      idx.push(0, 1, 2, 0, 2, 3, 0, 3, 4);
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      g.add(new T.Mesh(geo, new T.MeshStandardMaterial({ color: color, transparent: true, opacity: opacity, side: T.DoubleSide, depthWrite: false })));
      var lines = [];
      function seg(a, b) { var qa = V(v[a]), qb = V(v[b]); lines.push(qa.x, qa.y, qa.z, qb.x, qb.y, qb.z); }
      for (var k2 = 0; k2 < 5; k2++) { seg(k2, (k2 + 1) % 5); seg(5 + k2, 5 + (k2 + 1) % 5); seg(k2, 5 + k2); }
      var lg = new T.BufferGeometry();
      lg.setAttribute('position', new T.Float32BufferAttribute(lines, 3));
      g.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: edgeColor })));
    }
    function tube(path, radius, color, g) {
      if (!path || path.length < 2) return;
      var pts = [], stride = Math.max(1, Math.floor(path.length / 120));
      for (var i = 0; i < path.length; i += stride) pts.push(V(path[i]));
      pts.push(V(path[path.length - 1]));
      var curve = new T.CatmullRomCurve3(pts);
      g.add(new T.Mesh(new T.TubeGeometry(curve, Math.min(400, pts.length * 3), radius, 8, false), new T.MeshStandardMaterial({ color: color, roughness: 0.4 })));
    }

    function rebuild() {
      clear(staticGroup);
      scene.background = col('panel-2');
      var half = F.field.half;
      var floor = new T.Mesh(new T.PlaneGeometry(2 * half, 2 * half), new T.MeshStandardMaterial({ color: col('tile'), roughness: 1 }));
      floor.rotation.x = -Math.PI / 2;
      staticGroup.add(floor);
      var seams = [];
      (F.field.tileSeams || []).forEach(function (s) { seams.push(s, 0.05, -half, s, 0.05, half, -half, 0.05, s, half, 0.05, s); });
      var sg = new T.BufferGeometry();
      sg.setAttribute('position', new T.Float32BufferAttribute(seams, 3));
      staticGroup.add(new T.LineSegments(sg, new T.LineBasicMaterial({ color: col('tile-seam') })));
      var wallMat = new T.MeshStandardMaterial({ color: col('ink-3'), transparent: true, opacity: 0.55 });
      var wh = F.field.wallHeight, wt = F.field.wallThickness || 1;
      [[0, half + wt / 2, 2 * half + 2 * wt, wt], [0, -half - wt / 2, 2 * half + 2 * wt, wt], [half + wt / 2, 0, wt, 2 * half], [-half - wt / 2, 0, wt, 2 * half]].forEach(function (w) {
        var m = new T.Mesh(new T.BoxGeometry(w[2], wh, w[3]), wallMat);
        m.position.set(w[0], wh / 2, -w[1]);
        staticGroup.add(m);
      });
      ['red', 'blue'].forEach(function (al) {
        var z = F.loadingZones[al];
        var m = new T.Mesh(new T.PlaneGeometry(z.x1 - z.x0, z.y1 - z.y0), new T.MeshBasicMaterial({ color: col(al), transparent: true, opacity: 0.35 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set((z.x0 + z.x1) / 2, 0.1, -(z.y0 + z.y1) / 2);
        staticGroup.add(m);
      });
      var hm = hive(), fr = hm.frame, frameCol = col('ink-3');
      fr.legs.forEach(function (s) { rod(s[0], s[1], fr.tubeRadius, frameCol, staticGroup); });
      rod(fr.crossbar[0], fr.crossbar[1], fr.tubeRadius, frameCol, staticGroup);
      hm.hives.forEach(function (h) {
        for (var i = 0; i + 1 < h.armBar.length; i++) rod(h.armBar[i], h.armBar[i + 1], h.armRadius, frameCol, staticGroup);
        h.cells.forEach(function (cell) {
          var isT = h.alliance === state.target && cell.role === 'up';
          cellMesh(cell, col(h.alliance), cell.role === 'up' ? 0.32 : 0.18, isT ? col('ink') : col(h.alliance), staticGroup);
          if (isT) tube(cell.mouth.concat([cell.mouth[0]]), 0.45, col('pollen'), staticGroup);
        });
      });
      needs = true;
    }

    function update() {
      clear(dynGroup);
      var r = current, p = currentParams;
      if (!r || !p) return;
      var aimHd = r.best ? r.best.yawDeg : r.psi0Deg;
      if (!userOrbited) {
        orbit.az = Math.atan2(Math.sin(aimHd * DEG), -Math.cos(aimHd * DEG)) + 0.55;
        orbit.target.set((p.mouth.x + F.hive.hiveX[p.target]) / 2, 22, -p.mouth.y / 2);
      }
      // shooter mouth: a post from the tiles to the mouth height and a small disc at the mouth
      rod([p.mouth.x, p.mouth.y, 0], [p.mouth.x, p.mouth.y, p.h0], 0.8, col('ink-2'), dynGroup);
      var disc = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 0.6, 24), new T.MeshStandardMaterial({ color: col('pollen'), roughness: 0.8 }));
      disc.position.set(p.mouth.x, p.h0, -p.mouth.y);
      dynGroup.add(disc);
      var path = r.trajectory || (r.closestMiss && r.closestMiss.path);
      var ok = !!r.trajectory && r.best && r.best.reachable !== false;
      if (path) {
        tube(path, 0.7, ok ? col('pollen') : col('bad-mark'), dynGroup);
        var end = path[path.length - 1];
        var ball = new T.Mesh(new T.SphereGeometry(E.ballProps(p.ballId).rIn, 20, 14), new T.MeshStandardMaterial({ color: ok ? col('pollen') : col('bad-mark') }));
        ball.position.copy(V(end));
        dynGroup.add(ball);
      }
      needs = true;
    }

    function place() {
      var d = orbit.dist, ce = Math.cos(orbit.el);
      camera.position.set(orbit.target.x + d * ce * Math.cos(orbit.az), orbit.target.y + d * Math.sin(orbit.el), orbit.target.z + d * ce * Math.sin(orbit.az));
      camera.lookAt(orbit.target);
    }
    function resize() {
      var w = host.clientWidth || 400, h = host.clientHeight || 300;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needs = true;
    }
    (function loop() {
      if (needs) { place(); renderer.render(scene, camera); needs = false; }
      requestAnimationFrame(loop);
    })();

    var ptrs = {}, lastPinch = 0;
    host.addEventListener('pointerdown', function (e) { host.setPointerCapture(e.pointerId); ptrs[e.pointerId] = [e.clientX, e.clientY]; userOrbited = true; });
    host.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        ptrs[e.pointerId] = [e.clientX, e.clientY];
        var a = ptrs[ids[0]], b = ptrs[ids[1]], dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (lastPinch) orbit.dist = clamp(orbit.dist * lastPinch / dd, 60, 900);
        lastPinch = dd;
      } else {
        var prev = ptrs[e.pointerId];
        orbit.az += (e.clientX - prev[0]) * 0.008;
        orbit.el = clamp(orbit.el + (e.clientY - prev[1]) * 0.006, 0.05, 1.5);
        ptrs[e.pointerId] = [e.clientX, e.clientY];
      }
      needs = true;
    });
    function up(e) { delete ptrs[e.pointerId]; lastPinch = 0; }
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', function (e) { e.preventDefault(); userOrbited = true; orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 60, 900); needs = true; }, { passive: false });

    api.update = update;
    api.rebuild = function () { rebuild(); update(); };
    api.resize = resize;
    return api;
  })();

  // ------------------------------------------------------------------ controls
  var motorSel = $('motor');
  D.motors.motors.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label + ' — ' + m.sku;
    motorSel.appendChild(o);
  });
  SH.wheels.forEach(function (w) {
    var o = document.createElement('option');
    o.value = w.id;
    o.textContent = w.label;
    $('wheel').appendChild(o);
  });
  ADDONS.forEach(function (a) {
    var o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.label;
    $('addOn').appendChild(o);
  });

  function syncControls() {
    document.querySelectorAll('.seg[data-key]').forEach(function (seg) {
      var key = seg.getAttribute('data-key'), val;
      if (key === 'ballId') val = state.ballId;
      else if (key === 'target') val = state.target;
      else if (key === 'upSide') val = String(state.hive[state.target]);
      else if (key === 'motorsPerWheel') val = String(state.shooter.motorsPerWheel);
      else if (key === 'type') val = state.shooter.type;
      else if (key === 'precision') val = state.precision;
      else if (key === 'control') val = state.shooter.control;
      else if (key === 'units') val = state.units;
      seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(val))); });
    });
    $('h0').value = state.h0;
    $('h0Out').textContent = fmtLen(state.h0, 0);
    document.querySelectorAll('.u-len').forEach(function (el) { el.textContent = U.lenUnit(); });
    var step = U.lenStep();
    ['mx', 'my'].forEach(function (id) { $(id).step = step; });
    $('origin').value = state.origin;
    syncMouthInputs();
    $('pollenSize').textContent = fmtLen(E.ballProps('pollen').Din, 1);
    $('nectarSize').textContent = fmtLen(E.ballProps('nectar').Din, 1);
    $('nudgeText').textContent = fmtLen(1, U.getSystem() === 'metric' ? 1 : 0) + ' (Shift: ' + fmtLen(6, 0) + ')';
    motorSel.value = state.motorId;
    $('gear').value = String(state.shooter.gear);
    $('wheel').value = state.shooter.wheelId;
    $('wheelCount').value = String(state.shooter.wheelCount);
    $('addOn').value = state.shooter.addOn;
    var fi = flywheelInertia(state.shooter);
    $('inertiaHelp').textContent = 'Flywheel inertia per shaft: ' + sci(fi.total) + ' kg·m² (' + fi.text + '). Heavier = smaller speed dip per shot but slower spin-up.';
    $('battery').value = state.shooter.batteryV;
    $('battOut').textContent = nf(state.shooter.batteryV, 1) + ' V';
    $('interval').value = state.shooter.shotInterval;
    $('intervalOut').textContent = nf(state.shooter.shotInterval, 2) + ' s';
    var dual = state.shooter.type === 'dual';
    $('topRatioCtl').hidden = !dual;
    $('topRatio').value = state.shooter.topRatio;
    $('topOut').textContent = Math.round(state.shooter.topRatio * 100) + '% of bottom · spin ratio ' + nf((1 - state.shooter.topRatio) / (1 + state.shooter.topRatio), 2);
    var eta = $('eta'), range = dual ? (MODEL.etaDualRange || [0.8, 0.95]) : (MODEL.etaSingleRange || [0.3, 0.5]);
    eta.min = range[0];
    eta.max = range[1];
    eta.value = dual ? state.shooter.etaDual : state.shooter.etaSingle;
    $('etaOut').textContent = nf(Number(eta.value), 2);
    $('etaWhat').textContent = dual ? 'average wheel surface speed' : 'wheel surface speed';
    $('etaHelp').textContent = dual ? 'Two wheels ideally launch at their average surface speed; slip and compression lose a little.' :
      'A hooded shooter ideally launches at half the wheel\'s surface speed. Measured shooters land around 0.30–0.45, so lower this if your real shots come out slow.';
    var pr = SH.precision[state.precision];
    $('precHelp').textContent = 'Each shot is off by about ±' + pr.sigThetaDeg + '° in angle, ±' + pr.sigYawDeg + '° in aim and ±' + nf(pr.sigShooter * 100, 1) + '% in speed.';
    $('tipLabel').textContent = 'TIP ' + state.target + ' HIVE';
    UI.panels.setAlliance(state.target);
  }

  function syncMouthInputs() {
    var q = U.fieldToDisplay(state.mouth.x, state.mouth.y), L = mouthLimit(), H = F.field.half;
    $('mx').value = Math.round(q.x * 100) / 100;
    $('my').value = Math.round(q.y * 100) / 100;
    $('mx').min = $('my').min = lenVal(H - L);
    $('mx').max = $('my').max = lenVal(H + L);
    $('originHelp').textContent = '(0, 0) is the ' + U.CORNERS[state.origin].label.toLowerCase() + ' inside wall corner; x runs along the ' +
      (U.CORNERS[state.origin].fy < 0 ? 'audience' : 'far') + ' wall, y along the ' + (U.CORNERS[state.origin].fx < 0 ? 'red' : 'blue') +
      ' alliance wall. The far corner is (' + nf(U.toLen(2 * H), 1) + ', ' + nf(U.toLen(2 * H), 1) + ') ' + U.lenUnit() +
      '. Headings: degrees from +x toward +y.';
  }

  function changed(opts) {
    syncControls();
    if (opts && opts.hive) { hiveCache.key = ''; three.rebuild(); }
    drawField();
    callHooks('onChange', state);
    if (hoodGate()) return;
    request('coarse');
    requestFull();
  }
  // fixed hood without a valid angle: error state on every calculated field, no engine work (design #2 section 5.9)
  function hoodGate() {
    var err = UI.hood.validate(state.hood);
    if (!err) { UI.hoodError.hide(); return false; }
    clearTimeout(fullTimer);
    queued = null;
    motorsSeq++;   // a motors table answer still in flight must not overwrite the error cells
    if (heatStop) { heatStop(); heatStop = null; heatKey = ''; }
    UI.rpmPlot.cancel();
    UI.hoodError.show(err, function () { UI.panels.openRobotConfig('hoodAngle'); });
    return true;
  }
  UI.hood.mount($('hoodHost'), function () { return state.hood; }, function (cfg) { state.hood = cfg; UI.hood.save(cfg); changed(); });

  document.querySelectorAll('.seg[data-key]').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var key = seg.getAttribute('data-key'), v = b.getAttribute('data-v');
      if (key === 'ballId') {
        state.ballId = v;
        var Lb = mouthLimit();
        state.mouth.x = clamp(state.mouth.x, -Lb, Lb); state.mouth.y = clamp(state.mouth.y, -Lb, Lb);
      }
      else if (key === 'target') { state.target = v; return changed({ hive: true }); }
      else if (key === 'upSide') { state.hive[state.target] = Number(v); return changed({ hive: true }); }
      else if (key === 'motorsPerWheel') state.shooter.motorsPerWheel = Number(v);
      else if (key === 'type') state.shooter.type = v;
      else if (key === 'precision') state.precision = v;
      else if (key === 'control') state.shooter.control = v;
      else if (key === 'units') { setUnits(v); return; }
      changed();
    });
  });
  $('tipBtn').addEventListener('click', function () { state.hive[state.target] *= -1; changed({ hive: true }); });
  $('h0').addEventListener('input', function () { state.h0 = Number(this.value); changed(); });
  motorSel.addEventListener('change', function () { state.motorId = this.value; changed(); });
  $('gear').addEventListener('change', function () { state.shooter.gear = Number(this.value); changed(); });
  $('topRatio').addEventListener('input', function () { state.shooter.topRatio = Number(this.value); changed(); });
  $('wheel').addEventListener('change', function () { state.shooter.wheelId = this.value; changed(); });
  $('wheelCount').addEventListener('change', function () { state.shooter.wheelCount = Number(this.value); changed(); });
  $('addOn').addEventListener('change', function () { state.shooter.addOn = this.value; changed(); });
  $('battery').addEventListener('input', function () { state.shooter.batteryV = Number(this.value); changed(); });
  $('interval').addEventListener('input', function () { state.shooter.shotInterval = Number(this.value); changed(); });
  $('eta').addEventListener('input', function () {
    if (state.shooter.type === 'dual') state.shooter.etaDual = Number(this.value); else state.shooter.etaSingle = Number(this.value);
    changed();
  });
  // units toggle: display only, so no re-evaluation; just re-render everything from the last result
  function setUnits(u) {
    state.units = U.setSystem(u);
    saveUnits(state.units);
    syncControls();
    var showing = !UI.hoodError.active();   // in the error state the calculated fields keep their error
    if (current && showing) { renderResults(current, currentParams); renderMotor(current, currentParams); }
    UI.rpmPlot.redraw();
    drawField(); drawSide();
    if (lastMotorRows && showing) renderMotors(lastMotorRows);
    if (mathDialog.open) renderMath();
  }
  ['mx', 'my'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var x = U.parseLen($('mx').value), y = U.parseLen($('my').value);   // -> inches in the user frame
      if (!isFinite(x) || !isFinite(y)) return syncControls();
      x = U.toLen(x); y = U.toLen(y);
      var w = U.displayToField(x, y);
      moveMouthTo(w.x, w.y, 'key', true);
    });
  });
  $('origin').addEventListener('change', function () {
    state.origin = U.setCorner(this.value);
    saveOrigin(state.origin);
    syncControls();
    if (current) renderResults(current, currentParams);
    drawField();
    if (mathDialog.open) renderMath();
  });

  // ------------------------------------------------------------------ show the math
  function renderMath() {
    var r = current, p = currentParams, body = $('mathBody');
    if (!r || !p) return;
    body.replaceChildren();
    var C = E.constants(), A = C.aero, bp = E.ballProps(p.ballId);
    var mo = D.motors.motors.find(function (x) { return x.id === p.motorId; }) || { label: 'Custom motor', freeRpm: p.customMotor ? p.customMotor.freeRpm : 0 };   // custom motor (#5): not a goBILDA row
    var s = state.shooter, sh = p.shooter, m = r.motor, dt = m && m.details, b = r.best;
    var wheel = wheelById[s.wheelId], fi = flywheelInertia(s);
    var f = function (x, d) { return nf(x, d == null ? 2 : d); };
    var pid = sh.control === 'pid';
    var mq = U.fieldToDisplay(p.mouth.x, p.mouth.y), Lu = U.lenUnit();
    var aimH = r.aimHeadingDeg != null ? U.headingToUser(r.aimHeadingDeg) : null;
    $('mathSub').textContent = bp.label + ' from the shooter mouth at (' + f(mq.x, 1) + ', ' + f(mq.y, 1) + ') ' + Lu +
      ' (origin: ' + U.CORNERS[state.origin].label.toLowerCase() + ' corner)' +
      (aimH != null ? ', mouth pointed ' + f(aimH, 1) + '° from +x' : '') +
      ', ' + fmtLen(p.h0, 0) + ' above the tiles, into the ' +
      p.target + ' HIVE · ' + mo.label + ' · ' + wheel.label + ' · ' + (pid ? 'PID velocity' : 'fixed power') + ' at ' + f(sh.batteryV, 1) + ' V. Every number below is for this spot.';

    function sec(title, intro) {
      var el = document.createElement('section');
      el.className = 'math-sec';
      var h = document.createElement('h3');
      h.textContent = title;
      el.appendChild(h);
      if (intro) {
        var pp = document.createElement('p');
        intro.forEach(function (part) {
          if (typeof part === 'string') pp.appendChild(document.createTextNode(part));
          else { var bb = document.createElement('b'); bb.textContent = part.b; pp.appendChild(bb); }
        });
        el.appendChild(pp);
      }
      body.appendChild(el);
      return el;
    }
    function eq(parent, what, formula, work, result) {
      var row = document.createElement('div');
      row.className = 'eq';
      var a = document.createElement('div'); a.className = 'eq-what'; a.textContent = what;
      var bF = document.createElement('div'); bF.className = 'eq-f'; bF.textContent = formula;
      var c = document.createElement('div'); c.className = 'eq-n';
      if (work) c.appendChild(document.createTextNode(work + (result != null ? ' = ' : '')));
      if (result != null) { var strong = document.createElement('b'); strong.textContent = result; c.appendChild(strong); }
      row.appendChild(a); row.appendChild(bF); row.appendChild(c);
      parent.appendChild(row);
    }
    function note(parent, text) { var n = document.createElement('p'); n.className = 'math-note'; n.textContent = text; parent.appendChild(n); }
    function ms(x) { return !isFinite(x) ? 'never' : x >= 1000 ? f(x / 1000, 2) + ' s' : f(x, 0) + ' ms'; }

    if (!b || !m) {
      var s0 = sec('No scoring arc from here', [L10n(r.reason) + '. With no arc there is no exit speed to turn into wheel or motor rpm, so only the ball-flight rules below apply.']);
      note(s0, 'Turn on the verdict map to find spots where an arc exists.');
    } else {
      var v = b.v, dual = dt.type === 'dual';
      var ds = dual && dt.splitModel === 'impulse' && window.ShotDualSplit, dsFmt = { f: f, pct: pct, sci: sci, ms: ms };   // dual-wheel impulse split (issue M2)

      var s1 = sec('1 · Exit speed → wheel rpm → motor rpm', ['The shot needs the ball to leave at ', { b: fmtSpeed(v) + (U.speedUnit() === 'm/s' ? '' : ' (' + f(v, 2) + ' m/s)') }, '. The formulas below work in SI units (m/s, m, kg). The wheel has to spin faster than that, because the ball only picks up part of the wheel surface speed.']);
      if (dual) {
        eq(s1, 'Exit efficiency', 'v_exit = η × (v_bottom + v_top) ÷ 2,  v_top = k × v_bottom', 'η ' + f(dt.etaDual, 2) + ', k ' + f(dt.topRatio, 2) + ' → v_exit = ' + f(dt.exitFactor, 3) + ' × v_bottom');
        eq(s1, 'Bottom wheel surface speed', 'v_bottom = v_exit ÷ (η(1 + k) ÷ 2)', f(v, 2) + ' ÷ ' + f(dt.exitFactor, 3), f(dt.vWheel, 2) + ' m/s');
      } else {
        eq(s1, 'Exit efficiency', 'η = ball exit speed ÷ wheel surface speed', 'set in Robot config (a perfect hood = 0.50)', 'η = ' + f(dt.etaSingle, 2));
        eq(s1, 'Wheel surface speed', 'v_wheel = v_exit ÷ η', f(v, 2) + ' ÷ ' + f(dt.exitFactor, 2), f(dt.vWheel, 2) + ' m/s');
      }
      eq(s1, 'Wheel rpm', 'n_wheel = 60 × v_wheel ÷ (π × D)', '60 × ' + f(dt.vWheel, 2) + ' ÷ (π × ' + f(dt.wheelDiameterM, 3) + ' m)', f(m.wheelRpm, 0) + ' rpm');
      eq(s1, 'Motor rpm', 'n_motor = n_wheel ÷ G  (G = wheel rpm per motor rpm)', f(m.wheelRpm, 0) + ' ÷ ' + f(dt.gear, 2), f(m.motorRpm, 0) + ' rpm');

      var s2 = sec('2 · How fast the motor can go: battery and PID', pid ?
        [{ b: 'PID does not add power. ' }, 'A velocity PID can raise the motor voltage up to the battery voltage and no higher, so the top speed is set by the battery: a DC motor spins at a free speed proportional to voltage. What PID buys is holding the set speed as the battery drains, and driving the motor at full power to recover after each shot.'] :
        [{ b: 'Fixed power, no PID. ' }, 'The motor settles at whatever speed that power level gives on the current battery voltage. As the battery sags the speed drops with it, and after each shot the flywheel only creeps back instead of being driven back at full power.']);
      eq(s2, 'Usable free speed', 'n_free = listed rpm × 0.97 × (V ÷ 12 V)', f(mo.freeRpm, 0) + ' × ' + f(dt.freeSpeedFactor, 2) + ' × (' + f(sh.batteryV, 1) + ' ÷ 12)', f(m.usableFreeRpm, 0) + ' rpm');
      eq(s2, 'Speed used', 'h = n_motor ÷ n_free', f(m.motorRpm, 0) + ' ÷ ' + f(m.usableFreeRpm, 0), pct(m.headroom, 1));
      eq(s2, 'Fastest exit this setup allows', 'v_max = η_exit × n_free × G × π × D ÷ 60', f(dt.exitFactor, 3) + ' × ' + f(m.usableFreeRpm, 0) + ' × ' + f(dt.gear, 2) + ' × π × ' + f(dt.wheelDiameterM, 3) + ' ÷ 60', f(m.vCap, 2) + ' m/s');
      if (pid) {
        eq(s2, 'Speed scatter from the motor', 'σ_motor = 0.5% up to h 80% → 3% at 95% → 6% at 100%', 'h = ' + pct(m.headroom, 1), '±' + pct(m.sigmaMotor, 2));
        note(s2, 'Above 100% the motor cannot reach the speed at all (WON’T WORK). Above 92% a PID has nothing left to fight battery sag, so even a good shot is capped at NOT CONSISTENT.');
      } else {
        eq(s2, 'Speed scatter from the battery', 'σ_motor = voltage swing ÷ (V × √12)', f(dt.openLoopSwingV, 1) + ' V ÷ (' + f(sh.batteryV, 1) + ' × 3.46)', '±' + pct(m.sigmaMotor, 2));
        note(s2, 'Assumes the battery swings about ' + f(dt.openLoopSwingV, 1) + ' V over a match; with nothing correcting it, speed follows voltage one-for-one.');
      }

      var s3 = sec('3 · Flywheel: speed lost per shot and recovery', ['Each ball takes energy out of the spinning wheel. How much speed that costs depends on the flywheel inertia; how fast it comes back depends on motor torque and on ', { b: pid ? 'PID driving it at full power' : 'fixed power letting it creep back' }, '.']);
      eq(s3, 'Flywheel inertia', 'I = wheels × I_wheel + steel flywheel + hubs', fi.text, sci(dt.inertiaKgM2) + ' kg·m²');
      eq(s3, 'Ball energy', 'E_ball = ½ m v² + ½ I_ball ω²,  ω = S × v ÷ r', '½ × ' + f(bp.massKg, 4) + ' kg × ' + f(v, 2) + '² + spin at S ' + f(m.S0, 2) + ' (ω ' + f(dt.spinRadS, 0) + ' rad/s)', f(dt.keLinJ, 3) + ' + ' + f(dt.keRotJ, 3) + ' J');
      eq(s3, 'Energy drawn from the wheel', dual ? (ds ? 'E_B = s_B × 2 E_ball  (bottom wheel share s_B of the impulse split, below)' : 'E = 2 × E_ball ÷ (1 + k)  (bottom wheel share)') : 'E = 2 × E_ball  (slip wastes about as much as the ball gets)', '2 × ' + f(dt.keLinJ + dt.keRotJ, 3) + (dual ? ' × ' + f(dt.share, 2) : ''), f(m.shotEnergyJ, 3) + ' J');
      eq(s3, 'Wheel speed before the shot', 'ω₀ = n_wheel × 2π ÷ 60', f(m.wheelRpm, 0) + ' × 2π ÷ 60', f(dt.w0, 1) + ' rad/s');
      eq(s3, 'Right after the shot', 'ω₁ = √(ω₀² − 2E ÷ I)', '√(' + f(dt.w0, 1) + '² − 2 × ' + f(m.shotEnergyJ, 3) + ' ÷ ' + sci(dt.inertiaKgM2) + ')', f(dt.w1, 1) + ' rad/s');
      eq(s3, ds ? 'Speed dip, bottom wheel' : 'Speed dip', 'dip = 1 − ω₁ ÷ ω₀', '1 − ' + f(dt.w1, 1) + ' ÷ ' + f(dt.w0, 1), pct(m.dip, 2));
      if (ds) ds.rows(m, dt, dsFmt).forEach(function (r) { eq(s3, r.what, r.formula, r.numbers, r.result); });
      eq(s3, 'Stall torque at the wheel', 'T = motors × T_stall × (V ÷ 12) ÷ G', f(dt.motorsPerWheel, 0) + ' × ' + f(dt.stallTorqueListedNm, 4) + ' N·m × (' + f(sh.batteryV, 1) + ' ÷ 12) ÷ ' + f(dt.gear, 2), f(dt.wheelStallTorqueNm, 4) + ' N·m');
      eq(s3, 'Time constant', 'τ = I × ω_free ÷ T', sci(dt.inertiaKgM2) + ' × ' + f(dt.wFree, 1) + ' ÷ ' + f(dt.wheelStallTorqueNm, 4), f(m.tauS, 3) + ' s');
      if (ds) {
        ds.recoveryRows(m, dt, dsFmt).forEach(function (r) { eq(s3, r.what, r.formula, r.numbers, r.result); });
      } else if (pid) {
        eq(s3, 'Back to speed (full power)', 't = τ × ln((ω_free − ω₁) ÷ (ω_free − ω₀))', f(m.tauS, 3) + ' × ln((' + f(dt.wFree, 1) + ' − ' + f(dt.w1, 1) + ') ÷ (' + f(dt.wFree, 1) + ' − ' + f(dt.w0, 1) + '))', ms(m.recoveryMs));
      } else {
        eq(s3, 'Back within 1% (no boost)', 't = τ × ln(dip ÷ 1%)', f(m.tauS, 3) + ' × ln(' + pct(m.dip, 2) + ' ÷ 1%)', ms(m.recoveryMs));
      }
      if (!ds) eq(s3, 'Still missing at the next shot', pid ? 'ω(Δt) = ω_free − (ω_free − ω₁)·e^(−Δt/τ), capped at ω₀' : 'leftover = dip × e^(−Δt/τ)', 'Δt = ' + f(dt.shotInterval, 2) + ' s', pct(m.residual, 2));
      eq(s3, 'Speed scatter from recovery', 'σ_recovery = leftover ÷ 2', pct(m.residual, 2) + ' ÷ 2', '±' + pct(m.sigmaRecovery, 2));

      var s4 = sec('4 · What changing the wheel changes', ['A wheel changes two numbers here. ', { b: 'Diameter' }, ' sets how many rpm the same surface speed takes (bigger wheel = fewer rpm = more headroom). ', { b: 'Mass' }, ' sets the flywheel inertia (heavier = smaller dip per shot, but slower spin-up and slower recovery). Grip and softness are not modeled per wheel; the exit-efficiency slider covers them. Same motor, gearing, ' + fi.n + ' wheel' + (fi.n > 1 ? 's' : '') + ' per shaft and extra flywheel as now:']);
      var wrap = document.createElement('div');
      wrap.className = 'table-wrap math-table';
      var tbl = document.createElement('table');
      var thead = document.createElement('thead'), trh = document.createElement('tr');
      ['Wheel', 'Diameter', 'Mass', 'Shaft inertia', 'Wheel rpm', 'Motor use', 'Dip / shot', 'Back to speed'].forEach(function (t) {
        var thc = document.createElement('th'); thc.scope = 'col'; thc.textContent = t; trh.appendChild(thc);
      });
      thead.appendChild(trh); tbl.appendChild(thead);
      var tb = document.createElement('tbody');
      SH.wheels.forEach(function (w) {
        var I = flywheelInertia(s, w.id).total;
        var mm = E.motorModel(p.motorId, Object.assign({}, sh, { wheelDiameterMm: w.diameterMm, inertiaKgM2: I }), p.ballId, v);
        var tr = document.createElement('tr');
        if (w.id === s.wheelId) tr.className = 'sel';
        [w.label, fmtLen(w.diameterMm / 25.4, 1), fmtMass(w.massG / 1000, U.massUnit() === 'g' ? 0 : 2), sci(I), f(mm.wheelRpm, 0), pct(mm.headroom), pct(mm.dip, 1), ms(mm.recoveryMs)].forEach(function (t) {
          var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb); wrap.appendChild(tbl); s4.appendChild(wrap);
      note(s4, 'Wheel inertias are estimates from goBILDA listed masses (±25%). The 82 mm and 60 mm steel flywheels use goBILDA published inertia.');
    }

    var area = bp.areaM2, weight = bp.massKg * A.g;
    var s5 = sec('5 · Ball flight', ['The path is solved step by step (every 2.5 ms) with gravity, air drag and backspin lift. A shot only counts if the ball goes through the CELL mouth without touching the rim, the frame, another CELL, a wall or the floor.']);
    eq(s5, 'Ball', 'A = π r²', bp.label + ': ' + fmtLen(bp.Din, 2) + ', ' + fmtMass(bp.massKg, U.massUnit() === 'g' ? 1 : 2), f(area * 1e4, 1) + ' cm²');
    if (b) {
      var v0 = b.v, th = b.thetaDeg * DEG, S0 = m ? m.S0 : 1;
      var FD = 0.5 * A.rho * A.cd * area * v0 * v0, CL = A.clSlope * Math.min(S0, A.clSMax), FL = 0.5 * A.rho * CL * area * v0 * v0;
      eq(s5, 'Drag at launch', 'F_D = ½ ρ C_D A v²', '½ × ' + f(A.rho, 2) + ' × ' + f(A.cd, 2) + ' × ' + f(area, 5) + ' × ' + f(v0, 2) + '²', f(FD, 3) + ' N (' + f(FD / weight, 2) + ' × ball weight)');
      eq(s5, 'Backspin lift at launch', 'F_L = ½ ρ C_L A v²,  C_L = 0.20 × min(S, 1)', 'S = ' + f(S0, 2) + ' → C_L ' + f(CL, 2), f(FL, 3) + ' N (' + f(FL / weight, 2) + ' × ball weight)');
      eq(s5, 'Launch', 'v_x = v cos θ,  v_z = v sin θ', f(v0, 2) + ' m/s at ' + f(b.thetaDeg, 1) + '°', f(v0 * Math.cos(th), 2) + ' and ' + f(v0 * Math.sin(th), 2) + ' m/s');
      var rise = Math.pow(v0 * Math.sin(th), 2) / (2 * A.g) / 0.0254;
      eq(s5, 'Apex', 'no air: h₀ + v_z² ÷ 2g   ·   with air: simulated', f(U.toLen(p.h0), 0) + ' + ' + f(U.toLen(rise), 1) + ' = ' + fmtLen(p.h0 + rise, 1) + ' without air', fmtLen(b.apexIn, 1) + ' with air');
      if (b.tToCell != null) eq(s5, 'Into the CELL', 'simulated', 'after ' + f(b.tToCell, 2) + ' s', 'entering at ' + fmtSpeed(b.entrySpeed, 2));
    }

    var sg = r.sigma || {}, pr = SH.precision[state.precision];
    var s6 = sec('6 · Hit rate and verdict', ['No robot shoots the same way twice. Each shot is scattered by random errors, and the hit rate is the share of those shots that still go in.']);
    eq(s6, 'Aim scatter (' + pr.label + ')', 'σ_angle, σ_aim', '', '±' + f(sg.thetaDeg, 1) + '° angle, ±' + f(sg.yawDeg, 1) + '° aim');
    if (sg.v != null) eq(s6, 'Speed scatter', 'σ_v = √(σ_shots² + σ_motor² + σ_recovery²)', '√(' + pct(sg.shooter, 2) + '² + ' + pct(sg.motor, 2) + '² + ' + pct(sg.recovery, 2) + '²)', '±' + pct(sg.v, 2));
    if (b) {
      var wn = b.scoringWindow || b.windows;   // rectangular opening when the engine provides it (#3)
      eq(s6, 'Scoring window at the best aim' + (b.scoringWindow ? ' (rectangular opening)' : ''), 'range that still scores, others held at best', f(wn.thetaDeg[0], 1) + '–' + f(wn.thetaDeg[1], 1) + '° · ' + f(U.toSpeed(wn.v[0]), 2) + '–' + fmtSpeed(wn.v[1], 2));
    }
    eq(s6, 'Hit rate', 'share of scattered shots that score', '', pct(r.hitRate, 0));
    eq(s6, 'Verdict', '≥ 80% (and PID under 92% speed) → POSSIBLE · 40–80% → NOT CONSISTENT · under 40%, no arc, or too slow → WON’T WORK', '', r.verdict);
    callHooks('onMathRender', body, r, p);
  }

  $('mathBtn').addEventListener('click', function () {
    renderMath();
    if (typeof mathDialog.showModal === 'function') mathDialog.showModal(); else mathDialog.setAttribute('open', '');
  });
  $('mathClose').addEventListener('click', function () { if (mathDialog.close) mathDialog.close(); else mathDialog.removeAttribute('open'); });
  mathDialog.addEventListener('click', function (e) { if (e.target === mathDialog && mathDialog.close) mathDialog.close(); });

  // ------------------------------------------------------------------ theme + resize
  function themeChanged() { readPalette(); drawField(); drawSide(); three.rebuild(); UI.rpmPlot.redraw(); }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', themeChanged); else if (mq.addListener) mq.addListener(themeChanged);
  }
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { layoutField(); drawField(); drawSide(); three.resize(); }, 60);
  }
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('fieldWrap'));

  // ------------------------------------------------------------------ start
  readPalette();
  syncControls();
  layoutField();
  drawField();
  three.resize();
  three.rebuild();
  hoodGate();
  callHooks('onStart', {
    state: state, recalc: function () { changed(); }, current: function () { return current; },
    field: { wrap: $('fieldWrap'), sx: sx, sy: sy, k: k, toWorld: toWorld },
    fmt: { nf: nf, L10n: L10n }, units: U, data: D, engine: E
  });
  makeBackend().then(function (b) {
    backend = b;
    $('engineState').textContent = 'Engine: ' + b.kind;
    request('full');
    requestMotors();
  });
  window.__shotSim = { state: state, get current() { return current; }, get backend() { return backend && backend.kind; }, get heatCount() { return heatCount; }, get heatRunning() { return !!heatStop; } };
})();
