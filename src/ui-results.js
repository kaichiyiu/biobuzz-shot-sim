/* BIOBUZZ Shot Sim - #18 results panel: margin badge + reason + chips (Required-arc title bar), Required-arc rows,
   Scoring window block, Reference-data rows. Browser: window.ShotUI.results. */
(function (root) {
  'use strict';
  var D = null, W = null;   // UiDeps, ShotUI.window

  function init(deps) { D = deps; W = root.ShotUI.window; }
  function nf(x, d) { return D.nf(x, d); }

  var CAUSE_WORDS = {
    short: 'falls short',
    long: 'flies past',
    lip: 'clips the bottom lip',
    roof: 'hits the CELL rim or roof',
    cell: 'hits another CELL',
    frame: 'hits the HIVE frame or arm',
    wall: 'hits the wall',
    floor: 'hits the floor'
  };
  function causeWord(c) { return CAUSE_WORDS[c] || c; }
  function offsetWords(off) {
    if (Math.abs(off) < 0.05) return 'straight at the mouth center';
    return nf(Math.abs(off), 1) + '° ' + (off > 0 ? 'left' : 'right') + ' of the mouth center';
  }

  function chip(text) {
    var c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = D.ICON.alert;
    c.appendChild(document.createTextNode(text));
    return c;
  }

  // tolerance model: neutral badge "1.6× margin" ("≥ " when it is only a bound); margin null (cannot be shot) -> "out of reach". No verdict word (owner decision 2026-11-11).
  function marginBadge(t) {
    if (t.margin == null) return 'out of reach';
    var m = t.margin, n = t.capped ? String(t.sMax) : (m < 1 - 1e-6 && m.toFixed(1) === '1.0' ? m.toFixed(2) : m.toFixed(1));
    return (t.capped || t.lowerBound ? '≥ ' : '') + n + '× margin';
  }

  // engine reasons with a hit rate in them (codes OK / LOW_HEADROOM / MISSES_OFTEN / RARELY_SCORES) -> neutral facts:
  // "Scoring window: 62°–71°, 2,100–2,300 rpm, yaw 10°–14° · 62 % of free speed used". NO_ARC / TOO_SLOW / hood-error reasons are physical facts and stay.
  var HIT_CODES = { OK: 1, LOW_HEADROOM: 1, MISSES_OFTEN: 1, RARELY_SCORES: 1 };
  function span(a, d) { return nf(a[0], d) + '°–' + nf(a[1], d) + '°'; }
  function factReason(r) {
    var b = r && r.best, w = b && (b.scoringWindow || b.windows);
    if (!b || !w || !HIT_CODES[r.code] || !w.thetaDeg || !w.yawDeg) return null;
    var bits = ['launch angle ' + span(w.thetaDeg, 1)], m = b.scoringWindow && b.scoringWindow.motorRpm, q = null;
    if (m) bits.push(nf(m[0], 0) + '–' + nf(m[1], 0) + ' rpm');
    try { q = D.U.headingRangeToUser(w.yawDeg[0], w.yawDeg[1]); } catch (e) { q = null; }
    bits.push('yaw ' + (q ? (q.wraps ? nf(q.from, 1) + '° → ' + nf(q.to, 1) + '°' : nf(q.from, 1) + '°–' + nf(q.to, 1) + '°') : span(w.yawDeg, 1)));
    var h = r.motor && r.motor.headroom, txt = 'Scoring window: ' + bits.join(', ');
    if (typeof h === 'number' && isFinite(h)) txt += ' · ' + Math.round(h * 100) + ' % of free speed used';
    return txt;
  }

  // badge: neutral margin text (never a verdict, never colour alone); hidden without a tolerance and for error results (verdict null)
  function renderBadge(r) {
    var badge = D.$('verdictBadge'), box = D.$('warnings');
    var tol = r.tolerance && r.tolerance.margin !== undefined ? r.tolerance : null;
    if (r.verdict == null || !tol) badge.hidden = true;
    else {
      badge.hidden = false;
      badge.className = 'verdict-badge v-neutral';
      badge.innerHTML = '';
      badge.appendChild(document.createTextNode(marginBadge(tol)));
    }
    D.$('reason').textContent = factReason(r) || D.L10n(r.reason);
    box.replaceChildren();
    (r.warnings || []).forEach(function (w) { box.appendChild(chip(D.L10n(w.text))); });
    var h = r.hood;
    if (h && h.atLimit) {
      box.appendChild(chip('The best angle sits at the hood\'s ' + h.atLimit + ' limit, so a wider hood range might do better'));
    }
    if (h && h.rangeEdgesCoarse) {
      box.appendChild(chip('Range edges come from the coarse grid and may move a little'));
    }
  }

  function angleItem(b, h) {
    if (!h || h.mode !== 'adjustable') {
      return { label: 'Launch angle', value: nf(b.thetaDeg, 1) + '°', small: 'from horizon' };
    }
    var rg = h.rangeDeg;
    var tied = rg && rg[1] - rg[0] > 0.01;
    return {
      label: 'Best angle',
      value: tied ? nf(rg[0], 0) + '°–' + nf(rg[1], 0) + '°' : nf(h.angleDeg, 1) + '°',
      small: tied ? 'all equally wide; ' + nf(h.angleDeg, 0) + '° is the middle' : 'from horizon'
    };
  }

  function renderArc(r, p) {
    var b = r.best;
    var h = r.hood;
    var dl = D.$('arcReadout');
    var blk = D.$('windowBlock');
    if (!b) {
      var cm = r.closestMiss;
      blk.hidden = true;
      D.fillKV(dl, [
        { label: 'Mouth yaw', value: '—' },
        { label: 'Launch angle', value: '—' },
        { label: 'Launch speed', value: '—' },
        {
          label: 'Closest try', wide: true,
          value: cm ? nf(cm.thetaDeg, 0) + '° · ' + D.fmtSpeed(cm.v) : '—',
          small: cm && cm.cause ? 'misses: ' + causeWord(cm.cause) : ''
        }
      ]);
      return;
    }
    var m = r.motor;
    var speedLabel = 'Launch speed' + (b.reachable === false ? ' (needed; motor can\'t reach it)' : '');
    D.fillKV(dl, [
      { label: 'Mouth yaw', value: nf(D.U.headingToUser(b.yawDeg), 1) + '°', small: 'from +x' },
      angleItem(b, h),
      { label: speedLabel, value: D.fmtSpeed(b.v), small: m ? nf(m.motorRpm, 0) + ' rpm' : '' }
    ]);
    var rows = W.items(r, p);
    var sens = W.sensitivityItem(h);
    if (sens) rows.splice(rows.length - 1, 0, sens);   // before the efficiency line
    blk.hidden = false;
    D.$('windowNote').textContent = b.scoringWindow ? W.note(b.scoringWindow) : '';
    D.fillKV(D.$('windowReadout'), rows);
    var eta = D.$('windowReadout').lastElementChild;
    if (eta && rows[rows.length - 1].eta) {
      var link = document.createElement('button');
      link.type = 'button';
      link.className = 'btn link-btn';
      link.textContent = 'Change η';
      link.addEventListener('click', function () { root.ShotUI.panels.openRobotConfig('eta'); });
      eta.querySelector('dd').appendChild(link);
    }
  }

  function renderReference(r) {
    var b = r.best;
    var items = [
      { label: 'Angle to CELL center', value: nf(D.U.headingToUser(r.psi0Deg), 1) + '°', small: 'heading from +x' },
      { label: 'Offset angle', value: b ? nf(b.yawOffsetDeg, 1) + '°' : '—', small: b ? offsetWords(b.yawOffsetDeg) : '' },
      { label: 'Distance', value: D.fmtLen(r.distIn, 0), small: 'shooter mouth to CELL mouth center, flat' }
    ];
    if (b) {
      var metric = D.U.getSystem() === 'metric';
      var apexAlt = metric ? nf(b.apexIn * 0.0254, 2) + ' m' : nf(b.apexIn / 12, 1) + ' ft';
      items.push({ label: 'Apex', value: D.fmtLen(b.apexIn, 0), small: apexAlt + ' above the tiles' });
      items.push({
        label: 'Time to CELL',
        value: b.tToCell != null ? nf(b.tToCell, 2) + ' s' : '—',
        small: b.entrySpeed != null ? 'enters at ' + D.fmtSpeed(b.entrySpeed, 1) : ''
      });
    }
    D.fillKV(D.$('refReadout'), items);
  }

  var api = { init: init, renderBadge: renderBadge, renderArc: renderArc, renderReference: renderReference, causeWord: causeWord };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ShotUI = root.ShotUI || {}; root.ShotUI.results = api; }
})(typeof window !== 'undefined' ? window : {});
