// Browser smoke test for the built page (Playwright + Chromium; run in the cloud container, not on the device).
//   node tests/smoke/app.smoke.mjs <built.html> --capture out.json   record verdict/hitRate at 3 spots (pre-change build)
//   node tests/smoke/app.smoke.mjs <built.html> [--compare out.json] [--shot out.png]
//     checks: legacy values match the capture, hook bus (onStart/extendParams/onResult/onChange/onMathRender), throwing hook
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

async function open(browser, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:/, (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(), logs = [], errors = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_);
  await settle(page);
  return { page, logs, errors };
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
} finally { await browser.close(); }
if (failed) { console.log(failed + ' check(s) FAILED'); process.exit(1); }
console.log('smoke OK');
