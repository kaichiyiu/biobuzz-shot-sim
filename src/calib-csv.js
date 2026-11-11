/* BIOBUZZ Shot Sim - #11 calibration CSV: one line per shot, same columns as the form; shots of one setting are grouped into a CalibRow.
   Columns: settingId,ballId,h0In,hoodDeg,measuredMotorRpm,landingIn (any order on import, extra columns ignored, settingId may be blank).
   Browser: window.CalibCsv. Node: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalibCsv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var COLUMNS = ['settingId', 'ballId', 'h0In', 'hoodDeg', 'measuredMotorRpm', 'landingIn'];
  var REQUIRED = COLUMNS.slice(1);
  var NUMERIC = ['h0In', 'hoodDeg', 'measuredMotorRpm', 'landingIn'];

  function esc(s) { s = String(s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  // rows: CalibRow[] -> CSV text (header + one line per shot, LF)
  function toCsv(rows) {
    var out = [COLUMNS.join(',')];
    (rows || []).forEach(function (r) {
      (r.landingIn || []).forEach(function (d) {
        out.push([r.settingId == null ? '' : r.settingId, r.ballId, r.h0In, r.hoodDeg, r.measuredMotorRpm, d].map(esc).join(','));
      });
    });
    return out.join('\n') + '\n';
  }

  // RFC-4180 style split of the whole text into records of fields (quotes, doubled quotes, CRLF/LF); blank lines dropped
  function records(text) {
    var recs = [], rec = [], f = '', q = false, i = 0, c, any = false, line = 1;
    function endField() { rec.push(f); f = ''; }
    function endRec() { endField(); if (rec.length > 1 || rec[0].trim() !== '') recs.push({ f: rec, line: line }); rec = []; }
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (c === '\n') line++; f += c; }
      } else if (c === '"' && f === '') { q = true; any = true; }
      else if (c === ',') endField();
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRec(); line++; }
      else f += c;
    }
    if (f !== '' || rec.length || any) endRec();
    return recs;
  }

  // -> { rows: CalibRow[], errors: string[] }. Never throws; bad lines are skipped and reported with their line number.
  function fromCsv(text) {
    var errors = [], rows = [];
    if (typeof text !== 'string') return { rows: [], errors: ['Input is not text.'] };
    text = text.replace(/^﻿/, '');
    var recs = records(text);
    if (!recs.length) return { rows: [], errors: ['The file is empty.'] };
    var head = recs[0].f.map(function (h) { return h.trim().toLowerCase(); }), idx = {};
    COLUMNS.forEach(function (c) { idx[c] = head.indexOf(c.toLowerCase()); });
    var missing = REQUIRED.filter(function (c) { return idx[c] < 0; });
    if (missing.length) return { rows: [], errors: ['Missing column(s): ' + missing.join(', ') + '. Expected header: ' + COLUMNS.join(',') + '.'] };
    var groups = Object.create(null), lastBase = null, lastAuto = null;
    recs.slice(1).forEach(function (rc) {
      var f = rc.f, bad = false, v = {};
      function get(c) { return idx[c] < 0 || idx[c] >= f.length ? '' : f[idx[c]].trim(); }
      NUMERIC.forEach(function (c) {
        var s = get(c), n = s === '' ? NaN : Number(s);
        if (!isFinite(n)) { errors.push('Line ' + rc.line + ': ' + c + ' "' + s + '" is not a number.'); bad = true; } else v[c] = n;
      });
      var ball = get('ballId').toLowerCase();
      if (ball !== 'pollen' && ball !== 'nectar') { errors.push('Line ' + rc.line + ': ballId "' + get('ballId') + '" must be pollen or nectar.'); bad = true; }
      if (bad) return;
      var sid = get('settingId');
      // blank settingId: consecutive lines with identical setup belong together
      var base = [ball, v.h0In, v.hoodDeg, v.measuredMotorRpm].join('|');
      var g = sid !== '' ? groups[sid] : (base === lastBase ? lastAuto : null);
      if (!g) {
        g = { ballId: ball, h0In: v.h0In, hoodDeg: v.hoodDeg, measuredMotorRpm: v.measuredMotorRpm, landingIn: [] };
        if (sid !== '') { g.settingId = sid; groups[sid] = g; }
        rows.push(g);
      } else if (g.measuredMotorRpm !== v.measuredMotorRpm || g.hoodDeg !== v.hoodDeg || g.h0In !== v.h0In || g.ballId !== ball) {
        errors.push('Line ' + rc.line + ': setting "' + sid + '" has different ball / height / angle / rpm than its first line (kept the first).');
      }
      if (sid === '') { lastBase = base; lastAuto = g; }
      g.landingIn.push(v.landingIn);
    });
    return { rows: rows, errors: errors };
  }

  return { COLUMNS: COLUMNS, toCsv: toCsv, fromCsv: fromCsv };
});
