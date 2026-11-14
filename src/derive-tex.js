/* BIOBUZZ Shot Sim - Show the derivation (#6, O1): own TeX subset -> HTML (no CDN, works offline). Browser: window.DeriveTex. Node: module.exports.
   html(src, opt?) -> safe HTML string   src = text with $...$ math, \section, \textbf \emph \texttt, -- ; opt.math = true: src is math only. Every emitted character is escaped (& < > " ').
   plain(src, opt?) -> readable text (same parser)   blocks(templateBody) -> [{ kind: 'h' | 'p' | 'eq', tex }]  (\section, equation / align environments, paragraphs; % comment lines dropped)
   Math: groups, ^ _, \frac \tfrac \dfrac \sqrt, Greek, \cdot \times \le \ge \approx \lceil \rceil \lfloor \rfloor \pm \circ, \ln \min \max \sin \cos \tan \operatorname \text \mathrm \mathbf \dot
   \left \right \big, spacing (\, \; \quad \qquad "\ " \!), & and \\ (align). An unknown command is printed as plain text, never throws. Fixed-text helpers: n rng spd lng. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeriveTex = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var G = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  var S = { cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', approx: '≈', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', pm: '±', infty: '∞', to: '→', Rightarrow: '⇒', circ: '°', degree: '°',
    partial: '∂', neq: '≠', ne: '≠', sum: '∑', 'in': '∈', mid: '|', ldots: '…', dots: '…', cdots: '⋯', sim: '∼', '%': '%', '&': '&', _: '_', '#': '#', $: '$', '{': '{', '}': '}', '|': '‖' };
  var REL = ['le', 'leq', 'ge', 'geq', 'approx', 'neq', 'ne', 'to', 'Rightarrow', 'times', 'cdot', 'pm', 'in', 'sim'];
  var FN = ['ln', 'log', 'min', 'max', 'sin', 'cos', 'tan', 'arctan', 'exp', 'clamp', 'sgn'];
  var SP = { ',': ' ', ';': ' ', ':': ' ', ' ': ' ', '!': '', quad: ' ', qquad: '  ' };
  var DELIM = { left: 1, right: 1, big: 1, Big: 1, bigg: 1, Bigg: 1, bigl: 1, bigr: 1 };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var wrap = function (cls, a) { return '<span class="' + cls + '">' + a + '</span>'; };
  var single = function (a) { return /^[^\s()+\-−=<>*\/^_,;]{1,3}$/.test(a); };
  var HTML = {   // emitters: ch(text, italic), and wrappers
    ch: function (s, it, rel) { return it ? '<i>' + esc(s) + '</i>' : rel ? '\u2005' + esc(s) + '\u2005' : esc(s); }, frac: function (a, b) { return wrap('dv-frac', wrap('dv-n', a) + wrap('dv-d', b)); },
    sqrt: function (a) { return wrap('dv-sqrt', '√' + wrap('dv-rad', a)); }, sup: function (a) { return '<sup>' + a + '</sup>'; }, sub: function (a) { return '<sub>' + a + '</sub>'; },
    up: function (a) { return wrap('dv-up', a); }, bf: function (a) { return '<b>' + a + '</b>'; }, tt: function (a) { return '<code>' + a + '</code>'; }, em: function (a) { return '<em>' + a + '</em>'; },
    dot: function (a) { return wrap('dv-dot', a); }, nl: function () { return '<br>'; }, h: function (a) { return '<b class="dv-h">' + a + '</b>'; }, math: function (a) { return wrap('dv-m', a); }
  };
  var PLAIN = {
    ch: function (s) { return s; }, frac: function (a, b) { return (single(a) ? a : '(' + a + ')') + '/' + (single(b) ? b : '(' + b + ')'); }, sqrt: function (a) { return '√(' + a + ')'; },
    sup: function (a) { return '^' + (single(a) ? a : '(' + a + ')'); }, sub: function (a) { return '_' + (single(a) ? a : '(' + a + ')'); },
    up: id, bf: id, tt: id, em: id, dot: function (a) { return a + '̇'; }, nl: function () { return '; '; }, h: id, math: id
  };
  function id(a) { return a; }

  // ---- parser: st = { s, i }; em = emitter; math mode ignores spaces, text mode keeps them
  function word(st) { var m = /^[a-zA-Z]+/.exec(st.s.slice(st.i)); if (m) { st.i += m[0].length; return m[0]; } var c = st.s.charAt(st.i); st.i += c ? 1 : 0; return c; }
  function skip(st) { while (/\s/.test(st.s.charAt(st.i))) st.i++; }
  function group(st, em, text) {   // one argument: {...} or a single token
    skip(st);
    if (st.s.charAt(st.i) === '{') { st.i++; var r = (text ? tseq : mseq)(st, em, true); return r; }
    return text ? tatom(st, em) : matom(st, em);
  }
  function mseq(st, em, inG) {
    var out = '';
    while (st.i < st.s.length) { if (st.s.charAt(st.i) === '}' && inG) { st.i++; return out; } out += mitem(st, em); }
    return out;
  }
  function mitem(st, em) {
    var c = st.s.charAt(st.i), out = c === '^' || c === '_' ? '' : matom(st, em);
    for (skip(st); st.s.charAt(st.i) === '^' || st.s.charAt(st.i) === '_'; skip(st)) { var k = st.s.charAt(st.i++); out += em[k === '^' ? 'sup' : 'sub'](group(st, em, false)); }
    return out;
  }
  function matom(st, em) {
    skip(st);
    var c = st.s.charAt(st.i++);
    if (c === '') return '';
    if (c === '{') return mseq(st, em, true);
    if (c === '}') return '';
    if (c === '\\') return mcmd(word(st), st, em);
    if (/[a-zA-Z]/.test(c)) return em.ch(c, true);
    if (c === '=' || c === '<' || c === '>' || c === '+') return em.ch(c, false, true);
    if (c === '-') return em.ch('−');
    if (c === '&') return em.ch(' ');
    if (c === '~') return em.ch(' ');
    if (c === "'") return em.ch('′');
    return em.ch(c);
  }
  function mcmd(name, st, em) {
    var a, b;
    if (name === 'frac' || name === 'tfrac' || name === 'dfrac') { a = group(st, em, false); b = group(st, em, false); return em.frac(a, b); }
    if (name === 'sqrt') { if (st.s.charAt(st.i) === '[') st.i = st.s.indexOf(']', st.i) + 1 || st.s.length; return em.sqrt(group(st, em, false)); }
    if (name === 'text' || name === 'mbox' || name === 'textrm') return em.up(group(st, em, true));
    if (name === 'mathrm' || name === 'operatorname') return em.up(group(st, em, false));
    if (name === 'mathbf' || name === 'boldsymbol') return em.bf(group(st, em, false));
    if (name === 'textbf') return em.bf(group(st, em, true));
    if (name === 'texttt') return em.tt(group(st, em, true));
    if (name === 'emph' || name === 'textit') return em.em(group(st, em, true));
    if (name === 'dot') return em.dot(group(st, em, false));
    if (name === 'begin' || name === 'end') { group(st, em, true); return ''; }
    if (DELIM[name]) { skip(st); if (st.s.charAt(st.i) === '.') { st.i++; return ''; } return matom(st, em); }
    if (G[name]) return em.ch(G[name], name.charAt(0) === name.charAt(0).toLowerCase());
    if (S[name] != null) return em.ch(S[name], false, REL.indexOf(name) >= 0);
    if (FN.indexOf(name) >= 0) return em.up(name) + em.ch(' ');
    if (SP[name] != null) return em.ch(SP[name]);
    if (name === '\\') return em.nl();
    return em.ch('\\' + name);   // unknown command: plain text
  }
  function tseq(st, em, inG) {
    var out = '';
    while (st.i < st.s.length) {
      if (inG && st.s.charAt(st.i) === '}') { st.i++; return out; }
      out += tatom(st, em);
    }
    return out;
  }
  function tatom(st, em) {
    var c = st.s.charAt(st.i++), m, d;
    if (c === '') return '';
    if (c === '{') return tseq(st, em, true);
    if (c === '$') { d = st.s.indexOf('$', st.i); d = d < 0 ? st.s.length : d; m = { s: st.s.slice(st.i, d), i: 0 }; st.i = d + 1; return em.math(mseq(m, em, false)); }
    if (c === '~') return em.ch(' ');
    if (c === '-' && st.s.substr(st.i - 1, 2) === '--') { var tri = st.s.substr(st.i - 1, 3) === '---'; st.i += tri ? 2 : 1; return em.ch(tri ? '—' : '–'); }
    if (c !== '\\') return em.ch(c);
    var name = word(st);
    if (name === 'section' || name === 'subsection') { if (st.s.charAt(st.i) === '*') st.i++; return em.h(group(st, em, true)); }
    if (name === 'textbf') return em.bf(group(st, em, true));
    if (name === 'texttt') return em.tt(group(st, em, true));
    if (name === 'emph' || name === 'textit') return em.em(group(st, em, true));
    if (name === 'text' || name === 'textrm') return group(st, em, true);
    if (name === 'begin' || name === 'end') { group(st, em, true); return ''; }
    if (name === '\\') return em.nl();
    if (name === ' ' || name === ',' || name === ';') return em.ch(SP[name]);
    if (/^[%&_#${}]$/.test(name)) return em.ch(name);
    return em.ch('\\' + name);
  }

  function run(src, opt, em) {
    var st = { s: String(src == null ? '' : src), i: 0 };
    return opt && opt.math ? em.math(mseq(st, em, false)) : tseq(st, em, false);
  }
  function html(src, opt) { return run(src, opt, HTML); }
  function plain(src, opt) { return run(src, opt, PLAIN); }

  function blocks(body) {
    var out = [], last = 0, m, re = /\\begin\{(equation|align)\*?\}([\s\S]*?)\\end\{\1\*?\}|\\section\*?\{([^}]*)\}/g;
    body = String(body == null ? '' : body).replace(/^[ \t]*%.*$/gm, '');
    function paras(t) { t.split(/\n\s*\n/).forEach(function (q) { q = q.replace(/\s+/g, ' ').trim(); if (q) out.push({ kind: 'p', tex: q }); }); }
    while ((m = re.exec(body))) {
      paras(body.slice(last, m.index));
      out.push(m[3] != null ? { kind: 'h', tex: m[3] } : { kind: 'eq', tex: m[2].trim() });
      last = re.lastIndex;
    }
    paras(body.slice(last));
    return out;
  }

  // ---- number / unit helpers (never print NaN / undefined)
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function n(x, d) { if (!fin(x)) return 'n/a'; var s = x.toFixed(d == null ? 2 : d); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; }
  function rng(a, b, d) { return n(a, d) + '–' + n(b, d); }
  function conv(U, kind) { return U && U[kind === 's' ? 'speedUnit' : 'lenUnit'] && U[kind === 's' ? 'toSpeed' : 'toLen'] ? U : null; }
  function spd(a, b, d, U) {   // speed in m/s, plus the user's unit when it differs
    var u = conv(U, 's'), s = (b == null ? n(a, d) : rng(a, b, d)) + ' m/s';
    return u && u.speedUnit() !== 'm/s' && fin(a) ? s + ' (' + (b == null ? n(u.toSpeed(a), 1) : rng(u.toSpeed(a), u.toSpeed(b), 1)) + ' ' + u.speedUnit() + ')' : s;
  }
  function lng(a, b, d, U) {   // length in inches, plus the user's unit when it differs
    var u = conv(U, 'l'), s = (b == null ? n(a, d) : rng(a, b, d)) + ' in';
    return u && u.lenUnit() !== 'in' && fin(a) ? s + ' (' + (b == null ? n(u.toLen(a), 1) : rng(u.toLen(a), u.toLen(b), 1)) + ' ' + u.lenUnit() + ')' : s;
  }

  return { html: html, plain: plain, blocks: blocks, esc: esc, n: n, rng: rng, spd: spd, lng: lng, fin: fin };
});
