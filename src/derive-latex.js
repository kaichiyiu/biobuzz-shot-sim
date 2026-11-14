/* BIOBUZZ Shot Sim - Show the derivation (#6, O9): the derivation sections as LaTeX for the .tex export (owner decision D3). Browser: window.DeriveLatex. Node: module.exports.
   latex(sections, opts?) -> string   the sections of ui-derive.js build() except the flight ones (ids 'flight-*': the export template already has them) as \section*, one align* per row
     (what, symbolic form, numbers, then the result in a line below), notes as paragraphs; '' when nothing is left. opts.preview = true adds the preview remark. Pure ASCII output (like ExportTex.esc):
     text is escaped, $..$ segments are kept, known Greek / symbols become math, anything else non-ASCII becomes '?'. The result needs amsmath (the template loads it).
   texEsc(s) -> string (text mode)   texMath(s) -> string (math-only strings: tex / num). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveLatex = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var GR = { 'η': 'eta', 'θ': 'theta', 'ψ': 'psi', 'κ': 'kappa', 'π': 'pi', 'Δ': 'Delta', 'σ': 'sigma', 'τ': 'tau', 'ω': 'omega', 'ρ': 'rho', 'ε': 'epsilon', 'λ': 'lambda', 'μ': 'mu', 'φ': 'phi', 'α': 'alpha', 'β': 'beta', 'δ': 'delta', 'γ': 'gamma' };
  var SY = { '°': '^\\circ', '×': '\\times', '·': '\\cdot', '±': '\\pm', '≈': '\\approx', '≤': '\\le', '≥': '\\ge', '→': '\\to', '∝': '\\propto', '⌈': '\\lceil ', '⌉': '\\rceil ', '²': '^2', '−': '-' };
  var TXT = { '–': '--', '—': '---', '′': "'", '\u00a0': ' ', '\u2009': ' ', '\u2005': ' ', '\u2003': ' ' };
  var SP = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

  function sym(c) { return GR[c] ? '\\' + GR[c] + ' ' : SY[c] || null; }
  function charText(c) {
    if (TXT[c] != null) return TXT[c];
    var s = sym(c);
    if (s) return '$' + s + '$';
    if (c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n')) return '?';
    return /[&%$#_{}~^\\]/.test(c) ? SP[c] || '\\' + c : c;
  }
  function texMath(s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, function (c) { return TXT[c] != null ? ' ' : sym(c) || '?'; }).replace(/(?<!\\)%/g, '\\%').replace(/(?<!\\)#/g, '\\#');
  }
  function texEsc(s) {   // text with $..$ math segments kept; a stray $ is literal
    s = String(s == null ? '' : s);
    var out = '', last = 0, m, re = /\$([^$]*)\$/g;
    function plain(t) { return t.split('').map(charText).join(''); }
    while ((m = re.exec(s))) { out += plain(s.slice(last, m.index)) + '$' + texMath(m[1]) + '$'; last = re.lastIndex; }
    return out + plain(s.slice(last));
  }
  var txt = function (s) { return '\\text{' + texEsc(s) + '}'; };

  function rowTex(w) {
    var l = (w.what ? txt(w.what) + ' \\quad ' : '') + '& ' + (w.tex ? texMath(w.tex) : '\\ ');
    var env = '\\begin{align*}\n' + l + (w.num ? ' \\\\\n& = ' + texMath(w.num) : '') + '\n\\end{align*}';
    return env + (w.res ? '\n\\hspace*{2em}$\\Rightarrow$ ' + texEsc(w.res) : '') + '\n';
  }
  function sectionTex(s) {
    var out = ['\\subsection*{' + texEsc(s.title) + '}'];
    if (s.lead) out.push(texEsc(s.lead) + '\n');
    (s.rows || []).forEach(function (w) { if (w && (w.tex || w.num || w.res)) out.push(rowTex(w)); });
    (s.notes || []).forEach(function (t) { out.push(texEsc(t) + '\n'); });
    return out.join('\n');
  }

  function latex(sections, opts) {
    var list = (sections || []).filter(function (s) { return s && !/^flight-/.test(s.id || ''); });
    if (!list.length) return '';
    return '\\section*{Derivation for the current spot}\n' + 'The steps of the simulator\'s Show the math page for the spot that was on screen when this file was made, in the order the code works; lengths in inches, speeds in m/s, angles in degrees.' +
      (opts && opts.preview ? ' These numbers come from the coarse preview grid (1 degree and 2 percent steps); the full-accuracy result differs slightly.' : '') + '\n\n' + list.map(sectionTex).join('\n') + '\n';
  }

  return { latex: latex, texEsc: texEsc, texMath: texMath };
});
