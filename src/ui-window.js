/* BIOBUZZ Shot Sim - #18/#3/#2: formats the Scoring window block (rows, rectangular-opening note, +-1 degree row).
   Reads res.best.scoringWindow when the engine provides it, else the pentagon res.best.windows with no note.
   Browser: window.ShotUI.window. Node: module.exports (pure functions; init(deps) supplies the helpers). */
(function (root) {
  'use strict';
  var D = null;   // UiDeps

  function init(deps) { D = deps; }
  function nf(x, d) { return D.nf(x, d); }
  function range(lo, hi, d) { return nf(lo, d) + '° – ' + nf(hi, d) + '°'; }

  // the window the UI shows: sw = rectangular scoringWindow, w = ranges to print (null = nothing fits the opening).
  // scoringWindow undefined = engine extension not loaded: fall back to the pentagon windows and print no note.
  function pick(b) {
    var sw = b.scoringWindow;
    if (sw) return { sw: sw, w: sw };
    return { sw: null, w: sw === null ? null : b.windows };
  }

  function note(sw) {
    if (!sw || !sw.opening) return '';
    var w = nf(D.U.toLen(sw.opening.widthIn), 1);
    var h = nf(D.U.toLen(sw.opening.heightIn), 1);
    return 'Rectangular opening assumed (' + w + ' × ' + h + ' ' + D.U.lenUnit() + '), so results stay consistent across the yaw range';
  }

  function yawText(w) {
    var q = D.U.headingRangeToUser(w.yawDeg[0], w.yawDeg[1]);
    if (q.wraps) return nf(q.from, 1) + '° → ' + nf(q.to, 1) + '°';
    return range(q.from, q.to, 1);
  }

  function rpmRange(sw, w, p) {
    var m = sw && sw.motorRpm;
    if (!m) {
      var lo = D.E.motorModel(p.motorId, p.shooter, p.ballId, w.v[0]);
      var hi = D.E.motorModel(p.motorId, p.shooter, p.ballId, w.v[1]);
      m = [lo.motorRpm, hi.motorRpm];
    }
    var text = nf(m[0], 0) + '–' + nf(m[1], 0) + ' rpm';
    return sw && sw.clippedByMotor ? text + ' · limited by motor' : text;
  }

  function etaItem(p) {
    var eta = p.shooter.type === 'dual' ? p.shooter.etaDual : p.shooter.etaSingle;
    return { label: 'Exit efficiency', value: 'η ' + nf(eta, 2), small: 'rpm assume this', eta: true };
  }

  // KVItem[] for the window rows (labels: Yaw / Launch angle / Speed), plus small print rows
  function items(r, p) {
    var b = r.best;
    if (!b) return [];
    var pk = pick(b);
    if (!pk.w) return [{ label: 'Window', value: 'No shot fits the rectangular opening from here', wide: true }];
    var w = pk.w;
    var out = [
      { label: 'Yaw', value: yawText(w), small: 'from +x' },
      { label: 'Launch angle', value: range(w.thetaDeg[0], w.thetaDeg[1], 1), small: 'from horizon' },
      { label: 'Speed', value: nf(D.U.toSpeed(w.v[0]), 1) + ' – ' + D.fmtSpeed(w.v[1], 1), small: rpmRange(pk.sw, w, p) }
    ];
    if (pk.sw && pk.sw.moved) {
      out.push({
        label: 'Note', value: 'Window moved off the best aim', wide: true,
        small: 'the best-hit aim clips the opening corner, so these ranges are for the nearest shot that fits'
      });
    }
    out.push(etaItem(p));
    return out;
  }

  // one SensitivityRow -> text. The engine gives widthRatio 0 (not null) and rpmWindow null when no window is left.
  function sensitivityText(s) {
    var sign = s.deltaDeg > 0 ? '+' : '−';
    var noWindow = s.rpmWindow == null || s.widthRatio == null || !(s.widthRatio > 0);
    return sign + '1°: ' + (noWindow ? 'no window' : nf(s.widthRatio * 100, 0) + '% as wide');
  }

  // adjustable hood only: how much of the rpm window survives a +-1 degree angle error
  function sensitivityItem(h) {
    if (!h || !h.sensitivity) return null;
    var rows = h.sensitivity.filter(function (s) { return Math.abs(Math.abs(s.deltaDeg) - 1) < 1e-6; });
    if (!rows.length) return null;
    rows.sort(function (a, c) { return a.deltaDeg - c.deltaDeg; });
    var still = rows.every(function (s) { return s.nominalStillScores; });
    return {
      label: 'Angle error ±1°', wide: true,
      value: rows.map(sensitivityText).join(' · '),
      small: still ? 'the best rpm still scores at both' : 'the best rpm stops scoring at one of them'
    };
  }

  var api = { init: init, items: items, note: note, sensitivityItem: sensitivityItem, sensitivityText: sensitivityText, pick: pick };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.window = api; }
})(typeof window !== 'undefined' ? window : {});
