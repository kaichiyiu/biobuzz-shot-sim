// F7: the "Preview - refining" chip lives in #warnings only between a coarse and the following full result, never twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './load-data.mjs';

const A = createRequire(import.meta.url)(path.join(ROOT, 'src', 'ui-accuracy.js'));
function fakeBox() {
  const kids = [];
  const doc = { createElement: () => { const e = { className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { kids.splice(kids.indexOf(this), 1); } }; return e; } };
  return { kids, doc, appendChild: (c) => kids.push(c), querySelector: (s) => kids.find((k) => '#' + k.id === s) || null };
}

test('chip added on coarse, not duplicated, removed on full; other chips untouched', () => {
  const b = fakeBox(); b.appendChild({ id: 'other', remove() {} });
  A.sync(b, 'full', b.doc); assert.equal(b.kids.length, 1);
  A.sync(b, 'coarse', b.doc); A.sync(b, 'coarse', b.doc); A.sync(b, 'coarse', b.doc);
  assert.equal(b.kids.filter((k) => k.id === A.ID).length, 1); assert.match(b.kids[1].textContent, /Preview/); assert.equal(b.kids[1].className, 'chip');
  A.sync(b, 'full', b.doc);
  assert.equal(b.kids.length, 1); assert.equal(b.kids[0].id, 'other');
  A.sync(b, 'full', b.doc); assert.equal(b.kids.length, 1);   // removing twice is harmless
  A.sync(null, 'coarse', b.doc);                               // no box: no throw
});
