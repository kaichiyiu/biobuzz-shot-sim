// Builds dist/biobuzz-shot-sim.html (publishable fragment) and dist/preview.html (standalone page).
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (f) => JSON.parse(rd('data', f));

const data = { motors: json('motors.json'), field: json('field.json'), shooter: json('shooter.json') };
const dataJs = `window.SHOT_DATA = ${JSON.stringify(data)};\n`;
fs.writeFileSync(path.join(ROOT, 'src', 'data.js'), dataJs, 'utf8');

// engine + extensions (#3 rect window, #2 hood, sweep), in registration order; also used by the worker
const ENGINE_FILES = ['engine.js', 'engine-rect.js', 'engine-hood-core.js', 'engine-hood.js', 'engine-sweep.js'];
const engine = ENGINE_FILES.map((f) => rd('src', f)).join('\n');
const worker = rd('src', 'worker.js');
const units = rd('src', 'units.js');
const app = rd('src', 'app.js');
const css = rd('src', 'styles.css') + '\n' + rd('src', 'panel.css') + '\n' + rd('src', 'ext.css');
// UI modules (window.ShotUI.*): after units.js, before app.js
const UI_FILES = ['ui-panels.js', 'ui-window.js', 'ui-results.js', 'ui-hood.js', 'ui-hood-error.js', 'ui-plot-axes.js', 'ui-rpm-plot.js'];
const markup = rd('src', 'markup.html');

// Inline scripts must never contain a closing script tag.
const safe = (s) => s.replace(/<\/(script)/gi, '<\/$1');
const workerSrc = `window.SHOT_WORKER_SRC = ${JSON.stringify(engine + '\n' + worker)};\n`;

const fragment = [
  '<title>BIOBUZZ Shot Sim</title>',
  '<meta name="description" content="Drag a robot anywhere on the FTC BIOBUZZ field, pick a goBILDA motor and flywheel, and see whether the shot into the HIVE is possible.">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap">',
  `<style>\n${css}\n</style>`,
  markup,
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
  `<script>\n${safe(dataJs)}</script>`,
  `<script>\n${safe(engine)}\n</script>`,
  `<script>\n${safe(workerSrc)}</script>`,
  `<script>\n${safe(units)}\n</script>`,
  ...UI_FILES.map((f) => `<script>\n${safe(rd('src', f))}\n</script>`),
  `<script>\n${safe(app)}\n</script>`,
].join('\n');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'biobuzz-shot-sim.html'), fragment, 'utf8');
const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"><path d="M17 2.5 29.6 9.75v14.5L17 31.5 4.4 24.25V9.75Z" fill="#D69A00" stroke="#151A17" stroke-width="2"/><path d="M9 23c3-9 12-13 17-10" fill="none" stroke="#151A17" stroke-width="2.4" stroke-linecap="round"/></svg>');
const preview = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="icon" href="${favicon}">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(ROOT, 'dist', 'preview.html'), preview, 'utf8');
// GitHub Pages serves docs/ from the main branch.
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), preview, 'utf8');
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '', 'utf8');
console.log(`built dist/biobuzz-shot-sim.html (${(fragment.length / 1024).toFixed(0)} KB), dist/preview.html and docs/index.html`);
