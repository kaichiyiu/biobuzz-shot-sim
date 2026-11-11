/* BIOBUZZ Shot Sim - #7 tolerance panel: inputs (+- yaw, launch angle, rpm, position), preset / calibration buttons and the margin result text.
   Browser: window.ShotUI.tolPanel. Node: module.exports (describe is pure; mount needs a DOM). The model lives in ui-tolerance.js. */
(function (root) {
  'use strict';
  var FIELDS = [
    { key: 'yawDeg', id: 'tolYaw', label: '± yaw (aim)', unit: '°', step: '0.1' },
    { key: 'angleDeg', id: 'tolAngle', label: '± launch angle', unit: '°', step: '0.1' },
    { key: 'rpm', id: 'tolRpm', label: '± motor rpm', unit: 'rpm', step: '5' },
    { key: 'posIn', id: 'tolPos', label: '± position', unit: null, step: '0.25' }
  ];
  var PRESETS = [['dialed', 'Dialed'], ['typical', 'Typical'], ['rough', 'Rough']];
  var AXIS = { angle: 'launch angle', rpm: 'motor speed', yaw: 'aim (yaw)', along: 'position along the shot line' };
  var HELP = 'How far off can your robot be? Margin 1.0× means your ± errors just fit inside the scoring window; 2× means you could be twice as sloppy. Leave all empty to keep the hit-rate model.';
  var GUESS = 'Dialed / Typical / Rough fill starting values (2σ of the old precision presets): a guess — measure your robot.';
  var CAL_HINT = 'Calibration spread is a 90 % half-width (about 1.6σ) of the rpm scatter you measured.';

  // margin as the user reads it: one decimal, two when rounding would show 1.0× on a margin that is still below 1
  function fmtMargin(m) {
    var t = m.toFixed(1);
    return m < 1 - 1e-6 && Number(t) >= 1 ? m.toFixed(2) : t;
  }
  function side(axis, s) {
    if (axis === 'along') return s < 0 ? 'towards the target' : 'away from the target';
    return s < 0 ? 'low side' : 'high side';
  }
  function bound(t, x) { return x >= (t.sMax || 4) - 1e-9 || !isFinite(x); }

  // tolerance result (res.tolerance) -> { head, preview, limit, axes, position, notes[], best }; u = ShotUnits, opts = { downgrade }
  function describe(t, u, opts) {
    var out = { head: '', preview: false, limit: '', axes: '', position: '', notes: [], best: '' }, nf = u.nf;
    if (!t) return out;
    out.preview = t.mode === 'coarse';
    if (t.margin == null) {
      out.head = t.verdict;
      if (t.cappedBy === 'unreachable') out.notes.push('The selected motor cannot produce this shot, so there is no margin. Pick a faster motor or more gearing.');
      return out;
    }
    out.head = (t.capped ? '≥ ' + t.sMax : (t.lowerBound ? '≥ ' : '') + fmtMargin(t.margin)) + '×';
    if (t.capped) out.limit = 'Nothing limits it within ' + t.sMax + '× your tolerances.';
    else if (t.limitingAxis) {
      out.limit = 'Limited by ' + AXIS[t.limitingAxis] + ', ' + side(t.limitingAxis, t.limitingSide) + '. Improve that first.';
      if (t.lowerBound) out.limit += ' (At least this much: the analysed range ends before a miss.)';
    }
    var want = t.tolerance || {}, parts = [];
    [['angle', 'angleDeg'], ['rpm', 'rpm'], ['yaw', 'yawDeg']].forEach(function (a) {
      var m = t.perAxis && t.perAxis[a[0]];
      if (want[a[1]] > 0 && typeof m === 'number') parts.push(AXIS[a[0]] + ' ' + (bound(t, m) ? '≥ ' + t.sMax : fmtMargin(m)) + '×');
    });
    if (parts.length) out.axes = 'Each error alone: ' + parts.join(' · ');
    var pos = t.position, bits = [];
    if (pos && pos.lateralIn != null) bits.push('±' + u.fmtLen(pos.lateralIn, 1) + ' sideways');
    if (pos && pos.alongIn) bits.push('−' + u.fmtLen(-pos.alongIn[0], 1) + ' / +' + u.fmtLen(pos.alongIn[1], 1) + ' along the line');
    if (bits.length) out.position = 'Position you can tolerate: ' + bits.join(', ');
    if (t.cappedBy === 'headroom') out.notes.push('Verdict held at NOT CONSISTENT: the motor needs more than ' + Math.round(((opts && opts.downgrade) || 0.92) * 100) + ' % of its usable free speed, so it cannot hold speed between shots.');
    var b = t.bestSetpoint;
    if (b && b.margin != null) {
      if (t.margin != null && b.margin <= t.margin + 1e-9) out.best = 'The current aim is already the most forgiving shot for your accuracy.';
      else {
        out.best = 'For your accuracy the most forgiving shot is ' + nf(b.thetaDeg, 1) + '°, ' + nf(b.motorRpm, 0) + ' rpm, yaw offset ' + (b.yawOffsetDeg > 0 ? '+' : '') + nf(b.yawOffsetDeg, 1) + '° — margin ' + (b.viewLimited ? '≥ ' : '') + fmtMargin(b.margin) + '×';
        if (b.viewLimited) out.best += ' (within the analysed range)';
      }
    }
    return out;
  }

  // the line under the badge when a margin is shown (the legacy reason talks about the hit rate): "Margin 0.7× · limited by launch angle, low side · 62 % motor headroom"
  function reason(t, r) {
    if (!t || t.margin == null) return null;
    var h = r && r.motor && r.motor.headroom, bits = ['Margin ' + (t.capped ? '≥ ' + t.sMax : (t.lowerBound ? '≥ ' : '') + fmtMargin(t.margin)) + '×'];
    if (!t.capped && t.limitingAxis) bits.push('limited by ' + AXIS[t.limitingAxis] + ', ' + side(t.limitingAxis, t.limitingSide));
    if (typeof h === 'number' && isFinite(h)) bits.push(t.cappedBy === 'headroom' ? 'the motor runs at ' + Math.round(h * 100) + ' % of free speed — no headroom as the battery drains' : Math.round((1 - h) * 100) + ' % motor headroom');
    return bits.join(' · ');
  }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  // deps = { get(): model, units, onField(key, text), onPreset(name), onCalib(), onClear(), downgrade }
  function mount(host, deps) {
    var inputs = {}, units = {}, say = el('p', { class: 'help tol-msg', role: 'status' }), res = el('div', { class: 'tol-res' });
    var row = el('div', { class: 'tol-fields' }, FIELDS.map(function (f) {
      var inp = el('input', { type: 'number', id: f.id, step: f.step, min: '0', placeholder: '0', 'aria-label': f.label }), un = el('span', { class: 'unit', text: f.unit || '' });
      inputs[f.key] = inp; units[f.key] = un;
      inp.addEventListener('change', function () { deps.onField(f.key, inp.value); });
      return el('label', { class: 'tol-f' }, [el('span', { class: 'label', text: f.label }), el('span', { class: 'row' }, [inp, un])]);
    }));
    var btns = el('div', { class: 'tol-btns' }, PRESETS.map(function (p) {
      var b = el('button', { type: 'button', class: 'btn', 'data-preset': p[0], text: p[1] });
      b.addEventListener('click', function () { deps.onPreset(p[0]); });
      return b;
    }));
    var cal = el('button', { type: 'button', class: 'btn', id: 'tolCalib', title: CAL_HINT, text: 'Use calibration spread' }), clr = el('button', { type: 'button', class: 'btn', id: 'tolClear', text: 'Clear' });
    cal.addEventListener('click', function () { deps.onCalib(); });
    clr.addEventListener('click', function () { deps.onClear(); });
    btns.appendChild(cal); btns.appendChild(clr);
    var wrap = el('div', { class: 'ctl tol', id: 'tolerance', 'aria-live': 'off' }, [
      el('span', { class: 'label', text: 'Tolerance: how far off can the robot be?' }), row, btns,
      el('p', { class: 'hood-hint', text: GUESS }), el('p', { class: 'hood-hint', text: HELP }), say, res]);
    host.replaceChildren(wrap);

    function line(txt, cls) { if (txt) res.appendChild(el('p', { class: cls || 'tol-line', text: txt })); }
    return {
      sync: function () {
        var m = deps.get(), u = deps.units;
        FIELDS.forEach(function (f) {
          var v = f.key === 'posIn' ? u.toLen(m.posIn) : m[f.key];
          inputs[f.key].value = v > 0 ? String(Math.round(v * 100) / 100) : '';
        });
        units.posIn.textContent = u.lenUnit();
        wrap.setAttribute('data-source', m.source);
      },
      say: function (t) { say.textContent = t || ''; },
      result: function (r) {   // r = res (or null); nothing is shown without a tolerance result
        res.replaceChildren();
        var t = r && r.tolerance;
        if (!t) return;
        var d = describe(t, deps.units, { downgrade: deps.downgrade });
        line(t.margin == null ? d.head : 'Margin ' + d.head + (d.preview ? ' (preview)' : ''), 'tol-margin');
        line(d.limit); line(d.axes); line(d.position);
        d.notes.forEach(function (n) { line(n); });
        line(d.best, 'tol-best');
      }
    };
  }

  var api = { describe: describe, reason: reason, fmtMargin: fmtMargin, mount: mount, FIELDS: FIELDS, PRESETS: PRESETS, CAL_HINT: CAL_HINT };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShotUI = root.ShotUI || {};
  root.ShotUI.tolPanel = api;
})(typeof window !== 'undefined' ? window : {});
