// Cross-check of the fork features: engine vs tests/crosscheck/oracle_ext.py (mouth frame, rect window, hood).
//   node tests/crosscheck/compare-ext.mjs [--hood 60] [--seed 7] [--no-shots] [--tag x]      (npm run crosscheck:ext)
// --no-shots skips the mouth and rect families (to run the slow hood family in slices); --tag x suffixes the output files.
// Writes tests/crosscheck/out/ext[-tag]-{cases,out,probe-cases,probe-out,report}.json. Exit 1 on any non-boundary disagreement.
// Families (rule = entry-rule outcomes of the agreeing rect hits; entry numbers come from classifyShot entryAngleDeg / entrySpeed): mouth (200 shots, clamped mouths included), rect (300 shots), spin (200 topspin shots), hood (fixed 2/3, adjustable 1/3; default 60 cases).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadEngine, BASE } from '../load-data.mjs';

const E = loadEngine(), I = E._internal, G = I.geometry();
const OUT = path.join(ROOT, 'tests', 'crosscheck', 'out');
fs.mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : Number(process.argv[i + 1]); };
const nHood = arg('--hood', 60), noShots = process.argv.includes('--no-shots'), tag = process.argv.includes('--tag') ? '-' + process.argv[process.argv.indexOf('--tag') + 1] : '';
let seed = arg('--seed', 7) * 7919 + 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const R_BALL = { pollen: 1.4, nectar: 91.948 / 25.4 / 2 };   // ball radius in inches (data/shooter.json balls)
const S = (o) => ({ ...BASE, ...o, shooter: { ...BASE.shooter, ...(o.shooter || {}) } });

const EN = I.ext('entry'), SEG_MM_PER_MPS = 5;   // path samples are 5 ms apart: segment length = entry speed * 5 ms
function engineShot(p, th, v, yaw, rules) {   // the engine's own classifyShot: hit, rectHit, entryAngleDeg (< 0 descending), entrySpeed (m/s)
  const e = E.classifyShot(p, th, v, yaw), ent = { entry: [e.entryAngleDeg, e.entrySpeed] };
  return { hit: e.hit, cause: e.cause, speed: e.entrySpeed, rect: e.rectHit, angle: e.entryAngleDeg, segMm: e.entrySpeed * SEG_MM_PER_MPS, pass: rules.map((r) => e.rectHit && EN.cellOk(ent, 0, r)) };
}

function config(range, needArc, spin) {   // random mouth set-up with its coarse result; arcs wanted unless needArc is false
  for (;;) {
    const m = { x: (rnd() - 0.5) * 2 * range, y: (rnd() - 0.5) * 2 * range, height: 2 + rnd() * 29 };
    const p = S({ ...(spin ? { shooter: { spin } } : {}), ballId: rnd() < 0.25 ? 'nectar' : 'pollen', target: pick(['red', 'blue']), mouth: m, hiveState: { red: pick([-1, 1]), blue: pick([-1, 1]) } });
    const r = E.evaluate(p, 'coarse');
    if (r.best || (!needArc && rnd() < 0.25)) { const sp = (r.best && r.best.entrySpeed) || 4; return { p, m, r, rules: [{ rule: 'descending' }, { rule: 'maxSpeed', maxSpeedMps: 0.9 * sp }, { rule: 'maxSpeed', maxSpeedMps: 1.1 * sp }] }; }
  }
}
const oracleCase = (c, shots, extra) => ({ kind: 'shot', mouth: c.m, ball: c.p.ballId, target: c.p.target, hive_state: c.p.hiveState, S0: E.shooterSpin(c.p.shooter), spin: c.p.shooter.spin || 'back', entry_rules: c.rules, shots, ...extra });
function shotsFor(c, n, sp) {   // dTh deg, dV (log), dYaw deg: perturbation spans around the engine's aim; a third are wide random
  const a = c.r.best, out = [];
  for (let i = 0; i < n; i++) {
    out.push(a && i % 4 ? { theta: a.thetaDeg + (rnd() - 0.5) * 2 * sp[0], v: a.v * Math.exp((rnd() - 0.5) * 2 * sp[1]), yaw: a.yawDeg + (rnd() - 0.5) * 2 * sp[2] }
      : { theta: 20 + rnd() * 69, v: 2 + rnd() * 10, yaw: c.r.psi0Deg + (rnd() - 0.5) * 50 });
  }
  return out;
}

// ---- cases
const units = [];   // { fam, c, cfg } shot families, oracle case i
const cases = [];
for (let k = 0; k < (noShots ? 0 : 40); k++) { const c = config(75, k % 4 === 3); units.push({ fam: 'mouth', c }); cases.push(oracleCase(c, shotsFor(c, 5, [2.5, 0.04, 3]))); }
for (let k = 0; k < (noShots ? 0 : 10); k++) { const c = config(45, true); units.push({ fam: 'rect', c }); cases.push(oracleCase(c, shotsFor(c, 30, [3, 0.04, 6]))); }
for (let k = 0; k < (noShots ? 0 : 20); k++) { const c = config(55, true, 'top'); units.push({ fam: 'spin', c }); cases.push(oracleCase(c, shotsFor(c, 10, [2.5, 0.04, 3]))); }
const hoods = [], rows = [];
for (let k = 0, tries = 0; k < nHood && tries < 4000; tries++) {
  const c = config(55, true), fixed = k % 3 !== 2;
  const hood = fixed ? { mode: 'fixed', angleDeg: pick([45, 50, 55, 60, 65, 70, 75, 80]) } : (([lo, hi]) => ({ mode: 'adjustable', minDeg: lo, maxDeg: hi }))(pick([[45, 80], [50, 75], [55, 85]]));
  const p = { ...c.p, hood, mouth: { ...c.m, height: Math.min(29, Math.max(4, c.m.height)) } };   // hood cases stay inside the legal mouth range
  const co = E.evaluate(p, 'coarse'), fu = E.evaluate(p, 'full'), w = fu.hood && fu.hood.rpmWindow;
  if (!co.best || !w || w.clippedByMotor || fu.motor.vCap < w.vExit[1] * 1.05) continue;
  // the engine's fine view spans +-Wv (ln speed) around the coarse aim v0 (engine fineStage / hood.fineOpts); the oracle sees the same nodes,
  // cut to 12 nodes beyond the window to save time. Wv = max(0.06, 3 sigma_v, hood span) with the hood span from the coarse window.
  const cw = co.hood.rpmWindow.vExit, hs = Math.max(0.06, 0.5 * Math.log(cw[1] / cw[0]) + 0.02), Wv = Math.max(0.06, 3 * co.sigma.v, fixed ? hs : Math.max(0.12, hs));
  const nV = Math.ceil(Wv / 0.005 - 1e-9), v0 = co.best.v, il = Math.round(Math.log(w.vExit[0] / v0) / 0.005), ih = Math.round(Math.log(w.vExit[1] / v0) / 0.005);
  const axes = { v0, i_lo: Math.max(-nV, il - 12), i_hi: Math.min(nV, ih + 12), yaw0: co.best.yawDeg, theta0: co.hood.angleDeg, th_step: fixed ? 0.25 : 0.5, yaw_step: fixed ? 0.25 : 0.5 };
  const hc = { kind: 'hood', mouth: p.mouth, ball: p.ballId, target: p.target, hive_state: p.hiveState, S0: E.shooterSpin(p.shooter), hood, axes, v_cap: fu.motor.vCap, rpm_per_mps: w.motorRpm[1] / w.vExit[1], at: { angle_deg: fu.hood.angleDeg, yaw_deg: atYaws(axes.yaw0, fu.best.yawDeg) } };
  if (Math.abs(w.motorRpm[0] / w.vExit[0] / hc.rpm_per_mps - 1) > 1e-6) throw new Error('motor rpm is not proportional to exit speed');
  hoods.push({ p, fu, w, hood, hc }); cases.push(hc); k++;
}

// the engine's window is read at a fine-view yaw NODE (yaw0 + k 0.25), best.yawDeg is the plateau middle (maybe half a node away): ask the oracle at both
function atYaws(y0, y) { const k = (y - y0) / 0.25, a = Math.floor(k + 1e-6), b = Math.ceil(k - 1e-6); return (a === b ? [a] : [a, b]).map((i) => y0 + i * 0.25); }
function runOracle(list, name) {
  const cf = path.join(OUT, name + '-cases.json'), of = path.join(OUT, name + '-out.json');
  fs.writeFileSync(cf, JSON.stringify(list));
  execFileSync('python', [path.join(ROOT, 'tests', 'crosscheck', 'oracle_ext.py'), '--batch', cf, of], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(of, 'utf8'));
}
const t0 = Date.now(), out = runOracle(cases, 'ext' + tag);

// ---- compare shots. Entry numbers: the engine path stores positions in whole mm (Int16), so a 5 ms segment at the mouth (~10 mm long at
// 2 m/s) carries up to ~2.4 mm of rounding error: tolerance = 2.4 mm / segment length, plus 1 deg / 1.5 % for sampling (instant vs segment).
const fam = Object.fromEntries(['mouth', 'rect', 'spin', 'hood', 'rule'].map((k) => [k, { n: 0, agree: 0, boundary: 0, nonBoundary: 0 }]));
const num = { seg: [], angleErrDeg: [], speedErrPct: [], over: 0, maxAngleBoundRatio: 0, maxSpeedBoundRatio: 0 }, cov = { mouth: [0, 0], rect: [0, 0], spin: [0, 0] }, bad = [], pend = [];
units.forEach((u, ci) => {
  const cm = out[ci][0].mouth, em = E.evaluate(u.c.p, 'coarse').mouth;
  if (Math.abs(cm.x - em.x) + Math.abs(cm.y - em.y) + Math.abs(cm.height - em.height) > 1e-9) bad.push({ fam: u.fam, kind: 'mouth clamp', engine: em, oracle: cm });
  cases[ci].shots.forEach((s, si) => {
    const e = engineShot(u.c.p, s.theta, s.v, s.yaw, u.c.rules), o = out[ci][si];
    fam[u.fam].n++;
    const flags = [e.hit !== o.hit && 'hit', e.rect !== o.rect_hit && 'rect'].filter(Boolean);
    if (!flags.length) {
      fam[u.fam].agree++;
      if (o.hit) cov[u.fam][0]++;
      if (o.rect_hit) cov[u.fam][1]++;
      if (e.hit && e.angle != null && o.entry_angle_deg != null) {
        const dA = Math.abs(e.angle - o.entry_angle_deg), dS = 100 * Math.abs(e.speed / o.entry_speed - 1), q = 2.4 / e.segMm;
        const bA = q * 180 / Math.PI + 1, bS = 100 * q + 1.5;
        num.angleErrDeg.push(dA); num.speedErrPct.push(dS); num.seg.push(e.segMm);
        num.maxAngleBoundRatio = Math.max(num.maxAngleBoundRatio, dA / bA); num.maxSpeedBoundRatio = Math.max(num.maxSpeedBoundRatio, dS / bS);
        if (dA > bA || dS > bS) { num.over++; bad.push({ fam: u.fam, kind: 'entry numbers', shot: s, engine: { angle: e.angle, speed: e.speed, segMm: e.segMm }, oracle: { angle: o.entry_angle_deg, speed: o.entry_speed } }); }
        // rule outcome (rect hits only): a difference is a boundary case when the oracle's value lies within the numeric tolerance of the threshold
        u.c.rules.forEach((r, k) => {
          const rf = fam.rule; rf.n++;
          if (e.pass[k] === o.entry_pass[k]) { rf.agree++; return; }
          const near = r.rule === 'descending' ? Math.abs(o.entry_angle_deg) <= bA : 100 * Math.abs(o.entry_speed / r.maxSpeedMps - 1) <= bS;
          rf[near ? 'boundary' : 'nonBoundary']++;
          if (!near) bad.push({ fam: 'rule', kind: JSON.stringify(r), shot: s, situation: u.c.p.target + ' mouth ' + JSON.stringify(u.c.m), engine: { pass: e.pass[k], angle: e.angle, speed: e.speed }, oracle: { pass: o.entry_pass[k], angle: o.entry_angle_deg, speed: o.entry_speed } });
        });
      }
    } else pend.push({ u, ci, s, e, o, flags });
  });
});
if (pend.length) {   // boundary test: does the oracle flip the same flag within +-0.25 deg / +-0.5 % / +-0.25 deg yaw?
  const probe = pend.map((d) => oracleCase(d.u.c, [[0.25, 1, 0], [-0.25, 1, 0], [0, 1.005, 0], [0, 0.995, 0], [0, 1, 0.25], [0, 1, -0.25]]
    .map(([dt, fv, dy]) => ({ theta: d.s.theta + dt, v: d.s.v * fv, yaw: d.s.yaw + dy }))));
  const pr = runOracle(probe, 'ext' + tag + '-probe');
  pend.forEach((d, k) => {
    const flips = d.flags.every((f) => pr[k].some((r) => (f === 'hit' ? r.hit !== d.o.hit : r.rect_hit !== d.o.rect_hit)));
    fam[d.u.fam][flips ? 'boundary' : 'nonBoundary']++;
    if (!flips) bad.push({ fam: d.u.fam, kind: d.flags.join('+'), situation: d.u.c.p.target + ' mouth ' + JSON.stringify(d.u.c.m), shot: d.s, engine: { hit: d.e.hit, rect: d.e.rect, cause: d.e.cause }, oracle: { hit: d.o.hit, rect: d.o.rect_hit, cause: d.o.cause } });
  });
}
// ---- compare hood. agree = the oracle's own selection (angle + window) matches within one speed node. Otherwise the engine's window is checked
// against the oracle's physics at the engine's own angle and the two yaw nodes around best.yawDeg: the nodes in which engine window and oracle
// run differ must all be boundary nodes (the oracle's rect flag flips for a +-0.25 deg angle / yaw or +-0.5 % speed probe), and for an adjustable
// hood the engine's angle must be within 2 speed steps of the oracle's widest window.
const idxOf = (h, v) => Math.round(Math.log(v / h.hc.axes.v0) / 0.005) - h.hc.axes.i_lo;
const nodes = (a, b) => Math.round(Math.log(a / b) / 0.005);
const edges = (w, v) => (w ? Math.max(Math.abs(nodes(w[0], v[0])), Math.abs(nodes(w[1], v[1]))) : Infinity);
const runsOf = (R) => { const r = []; let s0 = -1; for (let i = 0; i <= R.length; i++) { if (i < R.length && R[i]) { if (s0 < 0) s0 = i; } else if (s0 >= 0) { r.push([s0, i - 1]); s0 = -1; } } return r; };
function diffNodes(h, o) {   // best yaw node: [yaw index, differing speed nodes]
  const lo = idxOf(h, h.w.vExit[0]), hi = idxOf(h, h.w.vExit[1]), mid = (lo + hi) >> 1, best = [];
  o.at_rect.forEach((R, yi) => {
    const run = runsOf(R).reduce((m, r) => { const d = mid < r[0] ? r[0] - mid : mid > r[1] ? mid - r[1] : 0; return !m || d < m.d ? { r, d } : m; }, null), d = [];
    for (let i = Math.min(lo, run ? run.r[0] : lo); i <= Math.max(hi, run ? run.r[1] : hi); i++) if ((i >= lo && i <= hi) !== !!(run && i >= run.r[0] && i <= run.r[1])) d.push(i);
    if (!best.length || d.length < best[1].length) best[0] = yi, best[1] = d;
  });
  return best;
}
const hrows = hoods.map((h, k) => {
  const o = out[units.length + k], adj = h.hood.mode === 'adjustable', eA = h.fu.hood.angleDeg, dA = Math.abs(o.angle_deg - eA);
  const worst = o.v_window ? edges(o.v_window, h.w.vExit) : Infinity;
  const r = { h, o, adj, eA, dA, worst, agree: o.v_window && worst <= 1 && (!adj || dA <= 0.5), diff: null };
  if (o.v_window && !r.agree) r.diff = diffNodes(h, o);
  return r;
});
const hp = [], hpOf = [];
hrows.forEach((r, k) => { if (!r.diff) return; const h = r.h, yaw = h.hc.at.yaw_deg[r.diff[0]], ax = h.hc.axes;
  r.diff[1].slice(0, 30).forEach((i) => { const v = ax.v0 * Math.exp(0.005 * (i + ax.i_lo));
    hp.push({ kind: 'shot', mouth: h.hc.mouth, ball: h.hc.ball, target: h.hc.target, hive_state: h.hc.hive_state, S0: h.hc.S0,
      shots: [[0.25, 1, 0], [-0.25, 1, 0], [0, 1.005, 0], [0, 0.995, 0], [0, 1, 0.25], [0, 1, -0.25]].map(([dt, fv, dy]) => ({ theta: r.eA + dt, v: v * fv, yaw: yaw + dy })) });
    hpOf.push([k, i]); }); });
const hpr = hp.length ? runOracle(hp, 'ext' + tag + '-hprobe') : [];
hrows.forEach((r, k) => {
  const { h, o, adj } = r, f = fam.hood;
  f.n++;
  if (!o.v_window) { f.nonBoundary++; bad.push({ fam: 'hood', kind: 'oracle has no window', hood: h.hood, engine: h.w.vExit }); return; }
  let cls = 'agree', flipped = 0, dn = r.diff ? r.diff[1].length : 0;
  if (r.diff) {
    hpOf.forEach(([kk, i], n) => { if (kk === k && hpr[n].some((x) => x.rect_hit !== o.at_rect[r.diff[0]][i])) flipped++; });
    const wA = adj ? o.angle_widths.reduce((m, x) => (Math.abs(x[0] - r.eA) < Math.abs(m[0] - r.eA) ? x : m)) : null;
    const tieOk = !adj || Math.max(...o.angle_widths.map((x) => x[1])) - wA[1] <= 2 * o.tie_step;
    cls = dn <= 30 && flipped === Math.min(dn, 30) && tieOk ? 'boundary' : 'nonBoundary';
  }
  rows.push({ hood: h.hood, target: h.p.target, ball: h.p.ballId, mouth: h.p.mouth, hive: h.p.hiveState, engine: [r.eA, ...h.w.vExit.map((v) => +v.toFixed(3))],
    yaw: [h.fu.best.yawDeg, o.yaw_deg], oracle: [o.angle_deg, ...o.v_window.map((v) => +v.toFixed(3))], range: o.range_deg, nodes: r.worst, diffNodes: dn, flipped,
    cuts: [o.speed_cut, o.yaw_cut], cls });
  f[cls]++;
  if (cls === 'nonBoundary') bad.push({ fam: 'hood', kind: `window ${r.worst} nodes, ${dn} differing nodes at the engine aim (${flipped} boundary), angle ${r.dA}`, hood: h.hood, mouth: h.p.mouth, target: h.p.target, engine: { angle: r.eA, v: h.w.vExit }, oracle: { angle: o.angle_deg, v: o.v_window, range: o.range_deg, speedCut: o.speed_cut, yawCut: o.yaw_cut } });
});
const mx = (a) => (a.length ? +Math.max(...a).toFixed(3) : null);
const tot = (k) => Object.entries(fam).reduce((s, [n, f]) => s + (n === 'rule' ? 0 : f[k]), 0);   // 'rule' counts rule outcomes, not shots
const pct = (a, q) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(3) : null);
const bins = [[0, 15], [15, 30], [30, 60], [60, 1e9]].map(([lo, hi]) => { const ix = num.seg.map((g, i) => (g >= lo && g < hi ? i : -1)).filter((i) => i >= 0), a = ix.map((i) => num.angleErrDeg[i]);
  return { segMm: [lo, hi === 1e9 ? null : hi], n: a.length, within1deg: a.filter((x) => x <= 1).length, p95Deg: pct(a, 0.95), maxDeg: mx(a) }; });
const report = { n: tot('n'), agree: tot('agree'), boundary: tot('boundary'), nonBoundary: bad, families: fam,
  agreementPct: Object.fromEntries(Object.entries(fam).map(([k, f]) => [k, f.n ? +(100 * f.agree / f.n).toFixed(2) : null])),
  agreedHits: Object.fromEntries(Object.entries(cov).map(([k, c]) => [k, { hit: c[0], rect: c[1] }])),
  entry: { n: num.angleErrDeg.length, within1deg: num.angleErrDeg.filter((x) => x <= 1).length, p50AngleErrDeg: pct(num.angleErrDeg, 0.5), p95AngleErrDeg: pct(num.angleErrDeg, 0.95), bySegment: bins, maxAngleErrDeg: mx(num.angleErrDeg), maxSpeedErrPct: mx(num.speedErrPct), outsideBound: num.over,
    maxAngleErrOverBound: +num.maxAngleBoundRatio.toFixed(3), maxSpeedErrOverBound: +num.maxSpeedBoundRatio.toFixed(3) }, hoodCases: hoods.length, hoodRows: rows, seconds: (Date.now() - t0) / 1000 };
fs.writeFileSync(path.join(OUT, 'ext' + tag + '-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(bad.length ? 1 : 0);
