/* BIOBUZZ Shot Sim - Show the derivation (#6, O7): a collapsed "Show the derivation" block appended to the Show the math dialog by an onMathRender hook (pattern: ui-noverdict.js).
   Browser: window.ShotUI.derive + a hook (no configSlice, no storage). Node: module.exports = { build, mount }.
   build(r, p, ctx) -> Section[]   in the order the code works: flight (3, from the export template) -> scoring window -> hood -> exit speed / rpm -> margin -> burst. Every section is built inside its own
     try / catch: a throwing section is skipped and never breaks the dialog. r null -> []. ctx = { E, units, template?, cfg? }.
   mount(body, sections, r?) -> <details class="derive"> | null   replaces an earlier block; DOM via createElement, text only through DeriveTex.html (every character escaped).
   Section = { id, title, lead, rows: [{ what, tex, num, res }], notes: [], blocks?: [{ kind: 'p' | 'eq', tex }] } (see derive-window.js). */
(function (root) {
  'use strict';
  var node = typeof module === 'object' && module.exports;
  var D = node ? require('./derive-tex.js') : root.DeriveTex;
  var L = node ? { F: require('./derive-flight.js'), W: require('./derive-window.js'), H: require('./derive-hood.js'), M: require('./derive-margin.js'), B: require('./derive-burst.js') }
    : { F: root.DeriveFlight, W: root.DeriveWindow, H: root.DeriveHood, M: root.DeriveMargin, B: root.DeriveBurst };
  var ctx0 = null;

  function build(r, p, ctx) {
    if (!r || !p || !D) return [];
    var out = [];
    function add(lib, fn) {
      try { var s = L[lib] && L[lib][fn](lib === 'F' ? p : r, lib === 'F' ? ctx : p, ctx); (Array.isArray(s) ? s : [s]).forEach(function (x) { if (x) out.push(x); }); }
      catch (e) { if (typeof console !== 'undefined') console.warn('derive section ' + lib + '.' + fn + ' skipped:', e); }
    }
    add('F', 'sections'); add('W', 'window'); add('H', 'hood'); add('W', 'eta'); add('M', 'margin'); add('B', 'burst');
    return out;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;   // DeriveTex output only: every character is escaped there
    return e;
  }
  var inl = function (s) { return D.html(s); }, math = function (s) { return D.html(s, { math: true }); };

  function sectionEl(s) {
    var sec = el('section', 'dv-sec'), h = el('h4'), i;
    sec.id = 'dv-' + s.id; h.textContent = s.title; sec.appendChild(h);
    if (s.lead) sec.appendChild(el('p', 'dv-lead', inl(s.lead)));
    (s.blocks || []).forEach(function (b) { sec.appendChild(b.kind === 'eq' ? el('div', 'dv-eq', math(b.tex)) : el('p', 'dv-p', inl(b.tex))); });
    for (i = 0; i < (s.rows || []).length; i++) {
      var w = s.rows[i], row = el('div', 'dv-row'), calc = el('div', 'dv-calc');
      row.appendChild(el('div', 'dv-what', inl(w.what))); row.appendChild(el('div', 'dv-tex', math(w.tex)));
      calc.appendChild(el('div', 'dv-num', w.num ? math(w.num) : '')); calc.appendChild(el('div', 'dv-res', w.res ? '= ' + inl(w.res) : ''));
      row.appendChild(calc); sec.appendChild(row);
    }
    (s.notes || []).forEach(function (t) { sec.appendChild(el('p', 'math-note dv-note', inl(t))); });
    return sec;
  }

  function mount(body, sections, r) {
    if (!body || !body.querySelectorAll || typeof document === 'undefined') return null;
    Array.prototype.forEach.call(body.querySelectorAll('.derive'), function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
    if (!sections || !sections.length) return null;
    var det = el('details', 'derive'), sum = el('summary'), box = el('div', 'dv-body');
    sum.textContent = 'Show the derivation'; det.appendChild(sum);
    box.appendChild(el('p', 'dv-intro', inl('The same steps in the order the code works, with the numbers of this spot. Lengths in inches, speeds in m/s, angles in degrees.' +
      (r && r.mode === 'coarse' ? ' This is a preview: the numbers come from the coarse grid (1° and 2 % steps) and the full-accuracy result differs slightly.' : ''))));
    sections.forEach(function (s) { try { box.appendChild(sectionEl(s)); } catch (e) { /* a malformed section is skipped */ } });
    det.appendChild(box); body.appendChild(det);
    return det;
  }

  var api = { build: build, mount: mount };
  if (node) { module.exports = api; return; }
  var UI = root.ShotUI = root.ShotUI || {};
  UI.derive = api;
  UI.hooks = (UI.hooks || []).concat([{ name: 'derive', onStart: function (c) { ctx0 = c; },
    onMathRender: function (body, r, p) { mount(body, build(r, p, { E: root.ShotEngine, units: ctx0 && ctx0.units, cfg: null }), r); } }]);
})(typeof window !== 'undefined' ? window : {});
