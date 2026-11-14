/* BIOBUZZ Shot Sim - #9 burst fire: per-shot motor rpm against the rpm window for 1-5 shots, the shortest interval that keeps every shot in the window,
   and a switch that puts the burst's speed loss into the tolerance margin (params.tolerance.burstShots). Numbers only, no verdict words.
   Model { shots: 1..5, include: boolean }. Browser: window.ShotUI.burst and a hook (configSlice 'burst' -> cfg.ext.burst). Node: module.exports (the pure model;
   mount needs a DOM). The plan comes from ShotEngine.burstPlan (engine-burst.js); the margin bias from engine-tolerance.js. Maths: process_docs/issue-9b/design.md. */
(function (root) {
  'use strict';
  var MAX = 5, DEFAULT = { shots: 3, include: false };
  var NOTE = 'Only matters when a tolerance is set (the ± fields above): the margin then also covers the speed the flywheel has lost by the later shots.';
  var HELP = 'Each bar is the motor speed when that shot leaves, against the scoring window (shaded). Shot 1 is at your setpoint, the middle of the window. The interval is the shot interval set in Robot config. The window and setpoint use the single-η model: after a per-rpm calibration the export table\'s rpm may differ slightly.';

  function norm(raw) {
    var s = Math.round(Number(raw && raw.shots));
    return { shots: s >= 1 ? Math.min(s, MAX) : DEFAULT.shots, include: !!(raw && raw.include) };
  }
  // only with a tolerance on the params and more than one shot
  function toParams(m, p) {
    var n = norm(m);
    if (p && p.tolerance && typeof p.tolerance === 'object' && n.include && n.shots > 1) p.tolerance.burstShots = n.shots;
    return p;
  }
  function stateOf(plan, s) { return s.inWindow ? 'in' : s.motorRpm < plan.windowRpm[0] ? 'below' : 'above'; }

  // the raised setpoint of the margin (res.tolerance.burstSetpoint) -> { pct, rpm } | null; only when the burst is included and the setpoint moved
  function shiftOf(t, include) {
    var b = t && include ? t.burstSetpoint : null;
    return b && b.shiftPct > 0 && t.setpoint ? { pct: b.shiftPct, rpm: b.motorRpm - t.setpoint.motorRpm, setpointRpm: b.motorRpm } : null;
  }
  // plan (E.burstPlan) -> { rows: [{ k, state, rpm, text, pos: 0..1 }], band: [lo, hi] in 0..1, windowText, minText, steadyText, shiftText, note }; nf(x, digits) formats numbers
  function describe(plan, nf, bias, shift) {
    var out = { rows: [], band: [0, 1], windowText: '', minText: '', steadyText: '', shiftText: '', note: '' };
    if (!plan) { out.note = 'No burst to show: there is no reachable aim at this spot.'; return out; }
    var lo = plan.windowRpm[0], hi = plan.windowRpm[1], w = hi - lo, a = lo - w, b = hi + w, i;
    for (i = 0; i < plan.perShot.length; i++) { a = Math.min(a, plan.perShot[i].motorRpm - w / 10); b = Math.max(b, plan.perShot[i].motorRpm + w / 10); }
    function pos(r) { return Math.max(0, Math.min(1, (r - a) / (b - a))); }
    out.band = [pos(lo), pos(hi)];
    out.windowText = 'Window ' + nf(lo, 0) + ' – ' + nf(hi, 0) + ' rpm · setpoint ' + nf(plan.setpointRpm, 0) + ' rpm · ' + (plan.control === 'pid' ? 'PID' : 'fixed power') + ' · ' + nf(plan.intervalS, 2) + ' s between shots';
    plan.perShot.forEach(function (s) {
      var st = stateOf(plan, s), word = st === 'in' ? 'in window' : st + ' window';
      out.rows.push({ k: s.k, state: st, rpm: s.motorRpm, pos: pos(s.motorRpm), text: 'Shot ' + s.k + ': ' + nf(s.motorRpm, 0) + ' rpm · ' + nf(Math.max(0, s.deficitPct), 1) + ' % below setpoint · ' + word });
    });
    out.minText = plan.shots < 2 ? '' : plan.minIntervalS == null ? 'Min interval for all in window: none up to 60 s' : 'Min interval for all in window: ' + nf(plan.minIntervalS, plan.minIntervalS < 1 ? 3 : 2) + ' s';
    out.steadyText = plan.shots < 2 ? '' : 'After many shots at this interval the speed settles ' + nf(plan.steadyDeficitPct, 1) + ' % below the setpoint.';
    if (shift) out.shiftText = 'Setpoint raised by +' + nf(shift.pct, 1) + ' % (+' + nf(shift.rpm, 0) + ' rpm) so the burst stays in the window.';
    if (bias && bias.speedPct > 0) out.note = 'The margin includes a speed bias of ' + nf(bias.speedPct, 1) + ' % (the largest loss over ' + bias.shots + ' shots).';
    return out;
  }

  var api = { norm: norm, toParams: toParams, describe: describe, shiftOf: shiftOf, stateOf: stateOf, MAX: MAX, NOTE: NOTE, HELP: HELP };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  // ------------------------------------------------------------------ browser
  var cur = norm(null), ctx = null, last = null, lastP = null, els = null, UI = root.ShotUI = root.ShotUI || {};
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function nf(x, d) { return ctx && ctx.fmt && ctx.fmt.nf ? ctx.fmt.nf(x, d) : Number(x).toFixed(d); }

  function bar(r, band) {
    var track = el('div', { style: 'position:relative;height:12px;border:1px solid var(--rule);border-radius:4px;background:var(--panel-2)' });
    track.appendChild(el('i', { style: 'position:absolute;top:0;bottom:0;left:' + band[0] * 100 + '%;width:' + (band[1] - band[0]) * 100 + '%;background:var(--pollen-wash)' }));
    var inside = r.state === 'in';
    track.appendChild(el('i', { style: 'position:absolute;top:1px;width:8px;height:8px;margin-left:-5px;border-radius:50%;border:1px solid var(--ink-2);left:' + r.pos * 100 + '%;background:' + (inside ? 'var(--ink-2)' : 'var(--panel)') }));
    return el('div', { class: 'burst-row', 'data-state': r.state, style: 'display:grid;gap:2px;margin:4px 0' }, [el('div', { class: 'burst-t', text: r.text, style: 'font-size:13px' }), track]);
  }

  function render() {
    if (!els) return;
    els.seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-n')) === cur.shots)); });
    els.chk.checked = cur.include;
    var plan = null, E = ctx && ctx.engine, sh = shiftOf(last && last.tolerance, cur.include);   // included and a raised setpoint: the plan uses it, so per-shot "in window" agrees with the margin
    try { plan = last && E && E.burstPlan ? E.burstPlan(last, lastP, sh ? { shots: cur.shots, setpointRpm: sh.setpointRpm } : { shots: cur.shots }) : null; } catch (e) { plan = null; }
    var d = describe(plan, nf, cur.include && last && last.tolerance ? last.tolerance.bias : null, sh), kids = d.rows.map(function (r) { return bar(r, d.band); });
    els.out.replaceChildren.apply(els.out, kids);
    els.win.textContent = d.windowText; els.shift.textContent = d.shiftText; els.min.textContent = d.minText; els.steady.textContent = d.steadyText;
    els.note.textContent = d.note || (cur.include && last && last.tolerance ? '' : NOTE);
  }

  function mount(host) {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Shots in the burst' }, [1, 2, 3, 4, 5].map(function (n) { return el('button', { type: 'button', 'data-n': String(n), text: String(n) }); }));
    var chk = el('input', { type: 'checkbox', id: 'burstInclude' });
    var win = el('p', { class: 'hood-hint', 'aria-live': 'polite' }), out = el('div', { class: 'burst-bars' }), min = el('p', { class: 'burst-min', style: 'font-weight:600;margin:2px 0' });
    var steady = el('p', { class: 'hood-hint' }), shift = el('p', { class: 'burst-shift', style: 'font-weight:600;margin:2px 0' }), note = el('p', { class: 'hood-hint', role: 'status' });
    var wrap = el('div', { class: 'ctl burst', id: 'burst' }, [el('span', { class: 'label', text: 'Burst: motor speed shot by shot' }), seg, el('p', { class: 'hood-hint', text: HELP }), win, shift, out, min, steady,
      el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px' }, [chk, el('span', { text: 'Include burst in margin' })]), note]);
    host.replaceChildren(wrap);
    els = { seg: seg, chk: chk, out: out, win: win, min: min, shift: shift, steady: steady, note: note };
    seg.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      cur = norm({ shots: b.getAttribute('data-n'), include: cur.include });
      render();
      if (cur.include && ctx) ctx.recalc();
    });
    chk.addEventListener('change', function () { cur = norm({ shots: cur.shots, include: chk.checked }); render(); if (ctx) ctx.recalc(); });
    render();
  }

  UI.burst = api;
  UI.hooks = (UI.hooks || []).concat([{
    name: 'burst',
    onStart: function (c) { ctx = c; var host = document.getElementById('burstHost'); if (host) mount(host); },
    extendParams: function (p) { return toParams(cur, p); },
    onResult: function (r, p) { last = r; lastP = p; render(); },
    configSlice: { key: 'burst', get: function () { return norm(cur); }, set: function (v) { cur = norm(v); render(); if (ctx) ctx.recalc(); } }
  }]);
})(typeof window !== 'undefined' ? window : {});
