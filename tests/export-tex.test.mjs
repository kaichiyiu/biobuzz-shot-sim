// H1: LaTeX derivation (template + renderTex): placeholders, numbers from the constants, escaping, balanced braces / environments, optional pdflatex compile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadEngine, BASE, ROOT } from './load-data.mjs';

const req = createRequire(import.meta.url);
const E = loadEngine();
req(path.join(ROOT, 'src', 'engine-export.js')); req(path.join(ROOT, 'src', 'engine-export-bearing.js'));
const S = req(path.join(ROOT, 'src', 'export-solver.js')), T = req(path.join(ROOT, 'src', 'export-tex.js')), CC = req(path.join(ROOT, 'src', 'calib-core.js'));
const tpl = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'derivation.tex.txt'), 'utf8');
const XS = { stepIn: 4, mouthForwardIn: 5.5 };
const HOODS = { adjustable: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, fixed: { mode: 'fixed', angleDeg: 62.5 }, legacy: undefined };
const mk = (hood) => { const P = { ...BASE, hood }, rows = E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS)); return { P, rows, c: S.constantsFrom(P, rows, E) }; };
const CASES = Object.entries(HOODS).map(([n, h]) => [n, mk(h)]);
const CFG = { v: 1, savedAt: '2026-11-11T10:00:00.000Z', field: { ballId: 'pollen' }, robot: { motorId: 'yj6000', shooter: { type: 'single', gear: 1, etaSingle: 0.62, wheelId: 'x' } }, calibration: null };
const strip = (s) => s.replace(/\\\\/g, '').replace(/(^|[^\\])%.*$/gm, '$1').replace(/\\[{}]/g, '');
const balanced = (s) => { let d = 0; for (const ch of strip(s)) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; } return d === 0; };
const envsOk = (s) => { const st = []; for (const m of strip(s).matchAll(/\\(begin|end)\{([a-z*]+)\}/g)) { if (m[1] === 'begin') st.push(m[2]); else if (st.pop() !== m[2]) return false; } return st.length === 0; };

test('template: <= 200 lines, article + amsmath only, its placeholders are exactly the renderer\'s', () => {
  assert.ok(tpl.split('\n').length <= 200); assert.match(tpl, /\\documentclass\[11pt\]\{article\}/);
  assert.deepEqual([...tpl.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)].map((m) => m[1]), ['amsmath']);
  const names = [...new Set([...tpl.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(names, T.PLACEHOLDERS);
  assert.ok(balanced(tpl.replace(/\{\{[A-Z0-9_]+\}\}/g, 'x')) && envsOk(tpl));
});

for (const [name, { c }] of CASES) {
  test(`renderTex ${name}: everything filled, braces and environments balanced, the team numbers are in the text`, () => {
    const out = T.renderTex(c, CFG, tpl, { wheelDiameterMm: 96 });
    assert.ok(!out.includes('{{') && !/\{\{[A-Z]/.test(out)); assert.ok(balanced(out), 'braces'); assert.ok(envsOk(out), 'environments');
    assert.ok(out.includes('\\begin{document}') && out.trim().endsWith('\\end{document}'));
    const kd = 0.5 * c.rho * c.cd * c.areaM2 / c.massKg, kl0 = 0.5 * c.rho * c.areaM2 / c.massKg * c.clSlope;
    for (const x of [c.massKg, c.areaM2, c.rho, c.cd, c.clSlope, c.clSMax, c.g, c.S0, c.dt, kd, kl0, c.rpmPerMps, c.ticksPerMotorRev, c.h0M, c.mouthForwardIn, c.rpmPerMps * c.ticksPerMotorRev / 60]) assert.ok(out.includes(T.tn(x)), 'number ' + T.tn(x));
    for (const [d, z] of c.aim) { assert.ok(out.includes(T.tn(d, 4) + ' & '), 'aim distance ' + d); assert.ok(out.includes(T.tn(z, 5)), 'aim height ' + z); }
    if (c.hood.mode === 'fixed') assert.ok(out.includes('$\\theta = ' + T.tn(c.hood.angleDeg) + '^\\circ$')); else for (const [d, th] of c.hood.table) assert.ok(out.includes(T.tn(th, 4)), 'angle ' + th);
    const mid = c.aim[Math.floor(c.aim.length / 2)][0], s = S.solveSpeed(c, mid);
    assert.ok(out.includes('$v = ' + T.tn(s.vMps, 6) + '$ m/s') && out.includes('$n = ' + T.tn(s.motorRpm, 6) + '$ rpm'), 'worked example');
    for (const x of Object.values(S.LIMITS)) assert.ok(out.includes(T.tn(x)) || out.includes(String(x)), 'limit ' + x);
    assert.ok(!/NaN|undefined|n\/a/.test(out.replace(/\\text\{n\/a\}/g, '')), 'no NaN / undefined');
  });
}

test('renderTex: no hard-coded team numbers - changing the constants changes the text; eta / diameter / gear derive from each other and rpmPerMps', () => {
  const { c } = CASES[0][1], c2 = { ...c, massKg: c.massKg * 1.37, rpmPerMps: c.rpmPerMps * 1.11, aim: c.aim.map(([d, z]) => [d, z + 0.0123]) };
  const a = T.renderTex(c, CFG, tpl, { wheelDiameterMm: 96 }), b = T.renderTex(c2, CFG, tpl, { wheelDiameterMm: 96 });
  assert.ok(a.includes(T.tn(c.massKg)) && !b.includes(T.tn(c.massKg)) && b.includes(T.tn(c2.massKg)));
  assert.ok(!b.includes(T.tn(c.rpmPerMps)) && b.includes(T.tn(c2.rpmPerMps))); assert.ok(!b.includes(T.tn(c.aim[2][1], 5)));
  // eta missing: derived from D, gear and kappa = the exit factor the engine uses (calib-core), for the default eta of the BASE shooter
  const sh = CC.shooterOf(E, { shooter: BASE.shooter }).sh, eta = CC.exitFactorOf(sh);
  const noEta = T.renderTex(c, { ...CFG, robot: { ...CFG.robot, shooter: { type: 'single', gear: sh.gear } } }, tpl, { wheelDiameterMm: sh.wheelDiameterMm });
  assert.ok(noEta.includes('$\\eta = ' + T.tn(eta, 5) + '$'), 'derived eta ' + eta + ' vs table kappa ' + c.rpmPerMps);
  const noD = T.renderTex(c, { ...CFG, robot: { ...CFG.robot, shooter: { type: 'single', gear: sh.gear, etaSingle: eta } } }, tpl);
  assert.ok(noD.includes('$D = ' + T.tn(sh.wheelDiameterMm, 5) + '$ mm'), 'derived D');
  assert.match(T.renderTex(c, null, tpl), /\\text\{n\/a\}/);   // no cfg: unknown values are n/a, still a valid document
  assert.ok(balanced(T.renderTex(c, null, tpl)) && envsOk(T.renderTex(c, null, tpl)));
});

test('esc: LaTeX special characters and non-ASCII; hostile cfg text keeps the document balanced', () => {
  assert.equal(T.esc('a_b&c%d$e#f{g}h~i^j\\k'), 'a\\_b\\&c\\%d\\$e\\#f\\{g\\}h\\textasciitilde{}i\\textasciicircum{}j\\textbackslash{}k');
  assert.equal(T.esc('caf\u00e9 \u03b8'), 'caf? ?'); assert.equal(T.esc(null), ''); assert.equal(T.esc(12), '12');
  const cfg = { ...CFG, savedAt: '{{X}}%', field: { ballId: '}}{{' }, robot: { motorId: 'a_b&c%d$e#f{g}h~i^j\\k\u00e9', shooter: { type: '\\end{document}' } } };
  const out = T.renderTex(CASES[1][1].c, cfg, tpl);
  assert.ok(balanced(out) && envsOk(out)); assert.ok(!out.includes('{{')); assert.ok(out.includes('a\\_b\\&c\\%d\\$e\\#f\\{g\\}h') && !/[^\x00-\x7f]/.test(out));
  assert.equal(out.split('\\end{document}').length, 2);   // the hostile "\end{document}" text was neutralised (its backslash is escaped)
});

test('calibration sentence: default eta warns, single and per-rpm calibrations are described, a calibrated single eta overrides cfg eta', () => {
  const { c } = CASES[0][1];
  assert.match(T.renderTex(c, CFG, tpl, { wheelDiameterMm: 96 }), /this build is not calibrated/);
  const cal = { calibrated: true, date: '2026-11-09', mode: 'single', applied: { key: 'etaSingle', value: 0.5123 }, fit: { factor: 0.5123 } };
  const one = T.renderTex(c, { ...CFG, calibration: cal }, tpl, { wheelDiameterMm: 96 });
  assert.match(one, /was calibrated on 2026-11-09, as a single factor \(fitted factor \$0.5123\$\)/); assert.ok(one.includes('$\\eta = 0.5123$')); assert.ok(!/not calibrated/.test(one));
  assert.match(T.renderTex(c, { ...CFG, calibration: { ...cal, mode: 'perRpm' } }, tpl, { wheelDiameterMm: 96 }), /per-rpm curve/);
});

test('renderTex errors: missing template, unknown placeholder, missing constant', () => {
  const { c } = CASES[0][1];
  assert.throws(() => T.renderTex(c, CFG, undefined), /not loaded/); assert.throws(() => T.renderTex(c, CFG, ''), /not loaded/);
  assert.throws(() => T.renderTex(c, CFG, tpl + '\n{{NOPE}}'), /unknown placeholder NOPE/);
  assert.throws(() => T.renderTex({ ...c, massKg: NaN }, CFG, tpl), /massKg is missing/);
  assert.equal(T.tn(0), '0'); assert.equal(T.tn(1e-6), '1\\times 10^{-6}'); assert.equal(T.tn(2.5e7), '2.5\\times 10^{7}'); assert.equal(T.tn(0.1 + 0.2), '0.3'); assert.equal(T.tn(NaN), '\\text{n/a}');
});

// F1 (Phase 1 review): kappa = 60 / (eta pi D g) must use the engine's EXIT FACTOR, which for dual wheels is etaDual (1 + k) / 2, also with an applied calibration.
const DUAL = (etaDual) => ({ ...BASE, shooter: { ...BASE.shooter, type: 'dual', etaDual, topRatio: 0.6 }, hood: HOODS.fixed });
const cfgOf = (P, calibration) => { const sh = CC.shooterOf(E, P).sh; return { sh, cfg: { v: 1, field: { ballId: 'pollen' }, robot: { motorId: 'yj6000', shooter: { type: sh.type, gear: sh.gear, etaSingle: sh.etaSingle, etaDual: sh.etaDual, topRatio: sh.topRatio, wheelId: 'x' } }, calibration: calibration || null } }; };
const F1_CASES = () => {
  const out = [], rowsOf = (P) => E.exportPoints(P, XS).map((q) => E.exportPoint(P, q, XS));
  const single = { ...BASE, hood: HOODS.fixed }, dual = DUAL(0.475), dualCal = DUAL(0.52);
  for (const [name, P, cal] of [['single', single, null], ['dual', dual, null], ['dual + applied calibration', dualCal, { calibrated: true, date: '2026-11-11', mode: 'single', applied: { key: 'etaDual', value: 0.52 }, fit: { factor: 0.52 } }]]) {
    const rows = rowsOf(P), { sh, cfg } = cfgOf(P, cal); out.push({ name, P, rows, sh, cfg, c: S.constantsFrom(P, rows, E) });
  }
  return out;
};
for (const { name, sh, cfg, c } of F1_CASES()) {
  test(`F1 ${name}: kappa = 60 / (eta pi D g) with the exit factor equals RPM_PER_MPS (1e-9) and the text prints that eta`, () => {
    const I = T.inputs(c, cfg, { wheelDiameterMm: sh.wheelDiameterMm }), exit = CC.exitFactorOf(sh);
    assert.ok(Math.abs(I.eta - exit) <= 1e-12 * exit, `eta ${I.eta} vs exit factor ${exit}`);
    if (sh.type === 'dual') { assert.ok(Math.abs(I.eta - sh.etaDual * 0.8) < 1e-12 && I.eta < sh.etaDual); assert.equal(I.etaDual, sh.etaDual); }
    const kappa = 60 / (I.eta * Math.PI * (I.wheelDiameterMm / 1000) * I.gear);
    assert.ok(Math.abs(kappa / c.rpmPerMps - 1) <= 1e-9, `60/(ETA pi D g) = ${kappa} vs RPM_PER_MPS ${c.rpmPerMps}`);
    const out = T.renderTex(c, cfg, tpl, { wheelDiameterMm: sh.wheelDiameterMm });
    assert.ok(out.includes('(' + T.tn(I.eta, 5) + ')\\,\\pi'), 'kappa uses eta');
    if (sh.type === 'dual') { assert.ok(out.includes('\\eta_{\\mathrm{eff}} = \\eta_{\\mathrm{dual}}\\,(1+k)/2 = ' + T.tn(sh.etaDual, 5)) && out.includes('= ' + T.tn(I.eta, 5) + '$'), 'inputs row'); assert.ok(!out.includes('(' + T.tn(sh.etaDual, 5) + ')\\,\\pi')); }
    assert.ok(out.includes(T.tn(c.rpmPerMps)));
  });
}
test('F1: an applied value for the other wheel layout is ignored; missing parts of a dual shooter are derived from kappa', () => {
  const [, d] = F1_CASES(), I = T.inputs(d.c, { ...d.cfg, calibration: { calibrated: true, mode: 'single', applied: { key: 'etaSingle', value: 0.9 } } }, { wheelDiameterMm: d.sh.wheelDiameterMm });
  assert.ok(Math.abs(I.eta - d.sh.etaDual * 0.8) < 1e-12);
  const noK = T.inputs(d.c, { ...d.cfg, robot: { ...d.cfg.robot, shooter: { type: 'dual', gear: d.sh.gear, etaDual: d.sh.etaDual } } }, { wheelDiameterMm: d.sh.wheelDiameterMm });
  assert.ok(noK.derived && Math.abs(noK.eta / (d.sh.etaDual * 0.8) - 1) <= 1e-9, 'eta_eff derived from kappa');
  assert.match(T.renderTex(d.c, { ...d.cfg, robot: { ...d.cfg.robot, shooter: { type: 'dual', gear: d.sh.gear, etaDual: d.sh.etaDual } } }, tpl, { wheelDiameterMm: d.sh.wheelDiameterMm }), /derived from \$\\kappa\$/);
});

test('pdflatex (when installed): every rendering compiles without errors', (t) => {
  if (spawnSync('pdflatex', ['--version']).error) return t.skip('pdflatex is not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tex-'));
  for (const [name, { c }] of CASES) {
    const f = path.join(dir, name + '.tex');
    fs.writeFileSync(f, T.renderTex(c, CFG, tpl, { wheelDiameterMm: 96 }));
    const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', dir, f], { encoding: 'utf8' });
    assert.equal(r.status, 0, name + ': ' + (r.stdout || '').split('\n').filter((l) => l.startsWith('!')).join(' | '));
  }
});

test('pdflatex (when installed): the dual-wheel and the dual + applied-calibration renderings compile (F1)', (t) => {
  if (spawnSync('pdflatex', ['--version']).error) return t.skip('pdflatex is not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tex-'));
  for (const { name, sh, cfg, c } of F1_CASES()) {
    const f = path.join(dir, name.replace(/\W+/g, '_') + '.tex');
    fs.writeFileSync(f, T.renderTex(c, cfg, tpl, { wheelDiameterMm: sh.wheelDiameterMm }));
    const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', dir, f], { encoding: 'utf8' });
    assert.equal(r.status, 0, name + ': ' + (r.stdout || '').split('\n').filter((l) => l.startsWith('!')).join(' | '));
  }
});
