/* BIOBUZZ Shot Sim - Show the derivation (#6, O6): the ball-flight sections, reused from the export derivation template (Block H), so the dialog and the .tex export say the same.
   Browser: window.DeriveFlight. Node: module.exports.
   render(template, p, E, cfg?, libs?) -> Section[]   fills the template with ExportSolver.constantsFrom(p, [], E) + ExportTex.renderTex (no export rows: only the aim table, rpm map and ticks print n/a, they are not used here),
     takes the Geometry, Flight model and RK4 sections and turns them into blocks with DeriveTex.blocks. Section = { id, title, lead: '', rows: [], notes: [], blocks: [{ kind: 'p' | 'eq', tex }] }.
   sections(p, ctx) -> Section[]   ctx = { E, cfg? }; template = window.SHOT_TEMPLATES['derivation.tex']. [] when the template, ExportTex or ExportSolver is absent or the fill fails (never throws). */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(root, node ? require('./derive-tex.js') : root.DeriveTex, node ? { S: require('./export-solver.js'), X: require('./export-tex.js') } : { S: root.ExportSolver, X: root.ExportTex });
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveFlight = api;
})(typeof self !== 'undefined' ? self : this, function (root, D, L) {
  'use strict';
  var PARTS = [['flight-geometry', 'Geometry and frame'], ['flight-model', 'Flight model'], ['flight-rk4', 'Numerical integration']];

  function cut(tex, from) {   // the text from "\section{from..." up to the next \section
    var i = tex.indexOf('\\section{' + from);
    if (i < 0) return '';
    var j = tex.indexOf('\\section{', i + 9);
    return tex.slice(i, j < 0 ? tex.length : j);
  }

  function render(template, p, E, cfg, libs) {
    var S = libs && libs.S || L.S, X = libs && libs.X || L.X;
    if (!template || !S || !X || !E || !p) return [];
    var out;
    try {
      var c = S.constantsFrom(p, [], E);
      out = X.renderTex(c, cfg || null, template, { wheelDiameterMm: p.shooter && p.shooter.wheelDiameterMm });
    } catch (e) { return []; }
    return PARTS.map(function (q) {
      var bl = D.blocks(cut(out, q[1])), h = bl.filter(function (b) { return b.kind === 'h'; })[0];
      if (!h) return null;
      var sec = { id: q[0], title: h.tex, lead: '', rows: [], notes: [], blocks: bl.filter(function (b) { return b.kind !== 'h'; }) };
      if (q[0] === 'flight-geometry') sec.notes.push('In the export table d is measured from the robot centre and f is the mouth offset set in the export panel; here f is the value in the first equation (0 unless set there).');
      return sec;
    }).filter(Boolean);
  }

  function sections(p, ctx) {
    var T = root.SHOT_TEMPLATES && root.SHOT_TEMPLATES['derivation.tex'];
    return render(T, p, ctx && ctx.E || root.ShotEngine, ctx && ctx.cfg, null);
  }

  return { render: render, sections: sections };
});
