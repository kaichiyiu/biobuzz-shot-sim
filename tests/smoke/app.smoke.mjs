// Browser smoke test for the built page (Playwright + Chromium; run in the cloud container, not on the device).
//   node tests/smoke/app.smoke.mjs <built.html> --capture out.json   record verdict/hitRate at 3 spots (pre-change build)
//   node tests/smoke/app.smoke.mjs <built.html> [--compare out.json] [--shot out.png]
//     checks: legacy values match the capture, hook bus (onStart/extendParams/onResult/onChange/onMathRender), throwing hook
//     derivation (Show the derivation, issue #6): default / fixed hood / tolerance / burst / custom motor, with and without the worker
// Needs `playwright` resolvable (set NODE_PATH to its node_modules if required). Never touches the CDN (requests are aborted).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const html = path.resolve(args[0] || 'dist/preview.html');
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const URL_ = 'file://' + html + '?noworker';
const SPOTS = [['72', '24'], ['40', '60'], ['100', '36']];   // display-frame inches typed into #mx / #my
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };

async function open(browser, init, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:/, (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(), logs = [], errors = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const reqs = []; page.on('request', (q) => { if (/^https?:/.test(q.url())) reqs.push(q.url()); });
  await page.goto(url || URL_);
  await settle(page);
  return { page, logs, errors, reqs };
}
// wait until a full result is applied and the engine is idle
async function settle(page) {
  await page.waitForFunction(() => window.__shotSim && window.__shotSim.current && window.__shotSim.current.mode === 'full' &&
    !document.getElementById('arcPanel').classList.contains('busy'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.getElementById('arcPanel').classList.contains('busy'), null, { timeout: 30000 });
}
async function readState(page) {
  return page.evaluate(() => { const c = window.__shotSim.current, m = window.__shotSim.state.mouth;
    return { verdict: c.verdict, hitRate: c.hitRate, mode: c.mode, mouth: { x: m.x, y: m.y } }; });
}
async function capture(page) {
  const out = [];
  for (const [x, y] of SPOTS) {
    await page.fill('#mx', x); await page.fill('#my', y); await page.dispatchEvent('#my', 'change');
    await page.waitForTimeout(500); await settle(page);
    out.push({ at: [x, y], ...(await readState(page)) });
  }
  return out;
}

const HOOK_INIT = `(() => {
  const log = window.__hookLog = { start: 0, ctxKeys: null, ext: 0, results: [], changes: 0, math: 0, extParamsSeen: [], fieldOk: null, rc: null };
  const good = { name: 'smoke-good',
    onStart(ctx) { log.start++; log.ctxKeys = Object.keys(ctx).sort(); window.__ctx = ctx;
      try { const f = ctx.field; log.fieldOk = typeof f.sx === 'function' && typeof f.sy === 'function' && typeof f.k() === 'number' && !!f.toWorld(f.sx(10), f.sy(20)) && !!f.wrap; } catch (e) { log.fieldOk = 'ERR ' + e; } },
    extendParams(p) { log.ext++; return Object.assign(p, { x_test: 1 }); },
    onChange() { log.changes++; },
    onResult(r, p, mode) { log.results.push(mode); log.extParamsSeen.push(p.x_test); },
    onMathRender(body, r, p) { log.math++; } };
  const bad = { name: 'smoke-bad', onStart() { throw new Error('boom-start'); }, extendParams() { throw new Error('boom-ext'); },
    onChange() { throw new Error('boom-change'); }, onResult() { throw new Error('boom-result'); }, onMathRender() { throw new Error('boom-math'); } };
  (window.ShotUI = window.ShotUI || {}).hooks = (window.ShotUI.hooks || []).concat([bad, good]);
})();`;

const browser = await chromium.launch();
try {
  if (opt('--capture')) {
    const { page } = await open(browser);
    const data = await capture(page);
    fs.writeFileSync(opt('--capture'), JSON.stringify(data, null, 2));
    console.log('captured', JSON.stringify(data));
  } else {
    // (1) legacy path: no hooks, page renders, no errors
    const plain = await open(browser);
    check(plain.errors.length === 0, 'no page errors without hooks');
    const base = await readState(plain.page);
    check(['POSSIBLE', 'NOT CONSISTENT', "WON'T WORK"].includes(base.verdict) || typeof base.verdict === 'string', 'initial verdict present: ' + base.verdict);
    const spots = await capture(plain.page);
    if (opt('--compare')) {
      const ref = JSON.parse(fs.readFileSync(opt('--compare'), 'utf8'));
      ref.forEach((r, i) => check(r.verdict === spots[i].verdict && r.hitRate === spots[i].hitRate && r.mouth.x === spots[i].mouth.x && r.mouth.y === spots[i].mouth.y,
        `spot ${r.at} matches pre-change capture (${r.verdict} ${r.hitRate})`));
    }
    if (opt('--shot')) { await plain.page.goto(URL_); await settle(plain.page); await plain.page.screenshot({ path: opt('--shot') }); }

    // (2)+(3) hooks: a throwing hook first, then a good one; both receive calls, the good one is unaffected
    const h = await open(browser, HOOK_INIT);
    const L = await h.page.evaluate(() => window.__hookLog);
    check(L.start === 1, 'onStart called once');
    check(JSON.stringify(L.ctxKeys) === JSON.stringify(['current', 'data', 'engine', 'field', 'fmt', 'recalc', 'state', 'units']), 'AppCtx keys: ' + L.ctxKeys);
    check(L.fieldOk === true, 'ctx.field {wrap,sx,sy,k,toWorld} usable: ' + L.fieldOk);
    check(L.ext > 0 && L.extParamsSeen.every((v) => v === 1), 'extendParams applied (x_test reaches onResult params)');
    const hs = await readState(h.page);
    check(hs.verdict === base.verdict && hs.hitRate === base.hitRate, 'engine ignores x_test: same verdict/hitRate as without hooks');
    const ch0 = L.changes;
    await h.page.evaluate(() => window.__ctx.recalc()); await h.page.waitForTimeout(300); await settle(h.page);
    const L2 = await h.page.evaluate(() => window.__hookLog);
    check(L2.changes > ch0, 'ctx.recalc() runs changed() -> onChange');
    check(L2.results.includes('coarse') && L2.results.includes('full'), 'onResult saw coarse and full: ' + [...new Set(L2.results)]);
    check(await h.page.evaluate(() => window.__ctx.current() === window.__shotSim.current), 'ctx.current() returns the latest result');
    await h.page.click('#mathBtn'); await h.page.waitForTimeout(300);
    const L3 = await h.page.evaluate(() => window.__hookLog);
    check(L3.math >= 1, 'onMathRender called');
    check(await h.page.evaluate(() => document.getElementById('mathBody').children.length > 0), 'math body still rendered despite throwing hook');
    check(h.logs.some((l) => l.startsWith('warning') && l.includes('smoke-bad')), 'throwing hook logged via console.warn');
    check(h.errors.length === 0, 'no uncaught page errors with throwing hook: ' + h.errors.join('|'));
  }
  // (4) Show the derivation (#6): the block renders in the math dialog, numbers equal the result, no raw TeX / NaN / verdict words, no network use of its own
  if (!opt('--capture')) for (const url of [URL_, URL_.replace('?noworker', '')]) {
      const tag = url === URL_ ? '[noworker] ' : '[worker] ', d = await open(browser, null, url);
      const n0 = d.reqs.length, nn = (x, k) => x.toFixed(k), BAD = /POSSIBLE|NOT CONSISTENT|WON.T WORK|verdict|hit rate|NaN|undefined|[\\$]/i;
      const look = async (setup) => {
        if (setup) { await d.page.evaluate(() => document.querySelectorAll('details:not(.derive)').forEach((x) => { x.open = true; })); await d.page.evaluate(() => { window.__prev = window.__shotSim.current; }); await setup(d.page);
          await d.page.waitForFunction(() => window.__shotSim.current !== window.__prev && window.__shotSim.current.mode === 'full', null, { timeout: 8000 }).catch(() => null); await d.page.waitForTimeout(1500); }
        await settle(d.page);
        await d.page.click('#mathBtn');
        if (!(await d.page.waitForSelector('#mathBody details.derive', { timeout: 4000 }).catch(() => null))) { await d.page.keyboard.press('Escape'); return null; }
        await settle(d.page); await d.page.waitForTimeout(500);   // an open dialog re-renders on every full result: read after the last one
        const o = await d.page.evaluate(() => {
          const det = document.querySelector('#mathBody details.derive'), open0 = det.open, c = window.__shotSim.current, sw = c.best && c.best.scoringWindow, t = c.tolerance, h = c.hood;
          det.querySelector('summary').click();
          return { open0, open1: det.open, ids: [...det.querySelectorAll('section.dv-sec')].map((x) => x.id.slice(3)), text: det.innerText, html: det.innerHTML, panel: document.body.innerText.replace(det.innerText, ''),
            sw, h: h && { angleDeg: h.angleDeg, rpmWindow: h.rpmWindow }, motor: c.motor ? { motorRpm: c.motor.motorRpm, motorId: c.motor.motorId, vExit: c.motor.vExit } : null, dist: c.distIn, mode: c.mode,
            t: t && { boxMargin: t.boxMargin, margin: t.margin, grid: t.grid, bias: t.bias, setpoint: t.setpoint } };
        });
        await d.page.keyboard.press('Escape'); await d.page.waitForTimeout(150);
        return o;
      };
      const base = (o, label) => { if (!o) { check(false, tag + label + ': no derivation block'); return; } check(o.open0 === false && o.open1 === true, tag + label + ': block closed by default, opens on click'); check(!BAD.test(o.text), tag + label + ': no verdict words / NaN / undefined / raw TeX'); check(!/<script/i.test(o.html) && /dv-frac/.test(o.html), tag + label + ': markup safe, fractions rendered'); };
      let o = await look();
      base(o, 'default'); check(['flight-geometry', 'flight-model', 'flight-rk4', 'window', 'eta'].every((x) => o.ids.includes(x)), tag + 'default: sections ' + o.ids);
      check(o.text.includes(nn(o.sw.thetaDeg[0], 2)) && o.text.includes(nn(o.sw.v[1], 3)) && o.text.includes(nn(o.motor.motorRpm, 1)), tag + 'default: window / rpm numbers equal the result');
      check(o.panel.includes(Math.round(o.h ? o.h.rpmWindow.centerMotorRpm : o.motor.motorRpm).toLocaleString('en-US')), tag + 'default: setpoint rpm also shown in the panel');
      const mx0 = o.sw.thetaDeg[0];
      o = await look(async (pg) => { await pg.click('#hoodHost button[data-v="fixed"]'); await pg.fill('#hoodAngle', '68'); });
      base(o, 'fixed hood'); check(o.ids.includes('hood') && /Launch angle/.test(o.text) && !/Chosen angle/.test(o.text) && o.text.includes(nn(o.h.angleDeg, 2) + '°'), tag + 'fixed hood: angle row, no search rows');
      o = await look(async (pg) => { await pg.fill('#tolYaw', '0.3'); await pg.fill('#tolAngle', '0.3'); await pg.fill('#tolRpm', '15'); await pg.fill('#tolPos', '1'); });
      base(o, 'tolerance'); check(o.ids.includes('margin') && !o.ids.includes('burst'), tag + 'tolerance: margin section ' + o.ids);
      check(o.t && [nn(o.t.boxMargin, 3), nn(o.t.grid.kA, 3), nn(o.t.grid.kY, 3), nn(o.t.setpoint.motorRpm, 1), nn(o.dist, 2)].every((x) => o.text.includes(x)), tag + 'tolerance: margin, rates, setpoint rpm and distance equal the result');
      o = await look(async (pg) => { await pg.click('.seg[data-key="control"] button[data-v="power"]'); await pg.evaluate(() => { const e = document.getElementById('interval'); e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await pg.click('#burst button[data-n="3"]'); await pg.check('#burstInclude'); });
      base(o, 'burst'); check(o.ids.includes('burst') && o.t && o.t.bias && o.text.includes(o.t.bias.cells + ' cells on the low-speed side'), tag + 'burst: section with B = ' + (o.t && o.t.bias && o.t.bias.cells) + ' (power, 1 s)'); check(o.t.bias.cells > 0 && /Burst-aware setpoint|No speed cell/.test(o.text), tag + 'burst: erosion cells and the burst-aware setpoint (or the no-fit note)');
      o = await look(async (pg) => { await pg.check('#fcMotorOn'); await pg.fill('#fcFree', '5000'); await pg.fill('#fcStall', '0.2'); await pg.dispatchEvent('#fcStall', 'change'); });
      base(o, 'custom motor'); check(o.motor.motorId === 'custom' && o.ids.includes('eta') && o.text.includes(nn(o.motor.motorRpm, 1)), tag + 'custom motor: rpm section equals the result (' + o.motor.motorId + ', ' + nn(o.motor.motorRpm, 1) + ', ' + o.mode + ')');
      let moved = null;
      for (const [x, y] of [['72', '24'], ['100', '36'], ['40', '60'], ['60', '40']]) {
        const q = await look(async (pg) => { await pg.fill('#mx', x); await pg.fill('#my', y); await pg.dispatchEvent('#my', 'change'); });
        if (q && q.sw && q.sw.thetaDeg[0] !== mx0) { moved = q; break; }
      }
      check(!!moved && !BAD.test(moved.text) && moved.text.includes(nn(moved.sw.thetaDeg[0], 2)) && moved.text.includes(nn(moved.sw.v[1], 3)), tag + 'moved robot: numbers follow the new result' + (moved ? '' : ' (no spot with an arc found)'));
      check(d.reqs.length === n0 && d.reqs.every((u) => /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u)), tag + 'no requests beyond the page load (' + d.reqs.length + ')');
      if (url === URL_) {   // the .tex export carries the derivation sections of the spot on screen (O9), in the page, through the real download handler
        const tex = await d.page.evaluate(async () => {
          const E = window.ShotEngine, P = { ballId: 'pollen', target: 'red', hiveState: { red: -1, blue: 1 }, mouth: { x: -12.75, y: -48, height: 16 }, precision: { sigThetaDeg: 1, sigYawDeg: 1, sigShooter: 0.015 }, motorId: 'yj6000',
            hood: { mode: 'adjustable', minDeg: 45, maxDeg: 80 }, shooter: { type: 'single', wheelDiameterMm: 96, motorsPerWheel: 1, gear: 1, topRatio: 0.6, inertiaKgM2: 4e-4, shotInterval: 0.5 } };
          const rows = E.exportPoints(P, { stepIn: 12 }).slice(0, 6).map((q) => { const at = Object.assign({}, P, { mouth: Object.assign({}, P.mouth, { x: q.x, y: q.y }) }); return E.exportRow(E.evaluate(at, 'full'), q, at, {}, null); });
          let blob = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return orig.call(URL, b); };
          window.ShotUI.exportAlgo.setTable({ rows, params: P, cfg: null, etaCurve: null, ready: true }); document.getElementById('expAlgoTex').click();
          await new Promise((r) => setTimeout(r, 300)); return blob ? await blob.text() : '';
        });
        check(/\\subsection\*\{Scoring window\}/.test(tex) && /\\subsection\*\{Margin\}/.test(tex) && tex.includes('\\section{Geometry and frame}'), tag + '.tex export: Block H sections plus the derivation sections');
        check(!/[^\x00-\x7f]/.test(tex) && tex.split('\\end{document}').length === 2 && !/NaN|undefined/.test(tex), tag + '.tex export: ASCII, one \\end{document}, no NaN');
        if (opt('--tex-out')) fs.writeFileSync(opt('--tex-out'), tex);
      }
      check(d.errors.length === 0, tag + 'no page errors: ' + d.errors.join('|'));
  }
} finally { await browser.close(); }
if (failed) { console.log(failed + ' check(s) FAILED'); process.exit(1); }
console.log('smoke OK');
