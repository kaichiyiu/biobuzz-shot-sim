// Show the math hook (owner decision 2026-11-11): section 6 is retitled, the Verdict row removed, the "verdict map" hint reworded.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const NV = createRequire(import.meta.url)(path.join(ROOT, 'src', 'ui-noverdict.js'));

function node(tag, text, cls) {
  const n = { tag, cls, textContent: text || '', kids: [], parentNode: null, appendChild(c) { c.parentNode = n; n.kids.push(c); return c; },
    removeChild(c) { n.kids = n.kids.filter((k) => k !== c); c.parentNode = null; },
    querySelector(sel) { return all(n).find((x) => match(x, sel)) || null; }, querySelectorAll(sel) { return all(n).filter((x) => match(x, sel)); } };
  return n;
}
const all = (n) => n.kids.flatMap((k) => [k, ...all(k)]);
const match = (x, sel) => (sel[0] === '.' ? x.cls === sel.slice(1) : x.tag === sel);

function mathBody() {
  const body = node('div'), sec = body.appendChild(node('section'));
  sec.appendChild(node('h3', '6 · Hit rate and verdict'));
  for (const [what, val] of [['Hit rate', '87%'], ['Verdict', 'POSSIBLE']]) { const row = sec.appendChild(node('div', '', 'eq')); row.appendChild(node('div', what, 'eq-what')); row.appendChild(node('div', val, 'eq-n')); }
  sec.appendChild(node('p', 'Turn on the verdict map to find spots where an arc exists.', 'math-note'));
  sec.appendChild(node('p', 'Above 100% the motor cannot reach the speed at all (WON’T WORK). Above 92% a PID has nothing left to fight battery sag, so even a good shot is capped at NOT CONSISTENT.', 'math-note'));
  return { body, sec };
}

test('fix: section 6 retitled, Verdict row removed (Hit rate row kept), hint reworded; idempotent', () => {
  const { body, sec } = mathBody();
  NV.fix(body); NV.fix(body);
  assert.equal(sec.kids[0].textContent, '6 · Hit rate (old scatter model, for reference)');
  assert.deepEqual(body.querySelectorAll('.eq-what').map((x) => x.textContent), ['Hit rate']);
  assert.doesNotMatch(body.querySelector('.math-note').textContent, /verdict/i);
  assert.equal(body.querySelectorAll('.math-note')[1].textContent, 'Above 100% the motor cannot reach the speed at all. Above 92% a PID has nothing left to fight battery sag, so the motor may not hold its speed between shots.');
  assert.doesNotMatch(all(body).map((x) => x.textContent).join('\n'), /POSSIBLE|NOT CONSISTENT|WON'T WORK|Verdict/);
  assert.doesNotThrow(() => NV.fix(null));
});

test('browser: registers an onMathRender hook on ShotUI.hooks', () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'ui-noverdict.js'), 'utf8'), { window: win });
  const h = win.ShotUI.hooks.find((x) => x.name === 'noverdict'), { body, sec } = mathBody();
  h.onMathRender(body, {}, {});
  assert.match(sec.kids[0].textContent, /^6 · Hit rate \(old scatter model/); assert.equal(body.querySelectorAll('.eq').length, 1);
});
