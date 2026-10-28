import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReferenceRegion, referenceKind, referenceLabel } from '../src/core/reference-regions.mjs';
import { pushReference, traverseReferences } from '../src/core/reference-history.mjs';
function layout() {
  const width = 600, height = 800, ink = new Uint8Array(width * height), boxes = [];
  const rect = (left, top, w, h) => { for (let y = top; y < top + h; y++) ink.fill(1, y * width + left, y * width + left + w); };
  const text = (text, left, top, w, h = 14) => { boxes.push({ text, left, top, width: w, height: h }); rect(left, top + 3, w, h - 6); };
  return { data: { width, height, ink, boxes }, rect, text };
}
test('reference identity handles named anchors and visible text for explicit destinations', () => {
  assert.deepEqual(referenceKind('Fig. S2a'), { kind: 'figure', number: 's2a' });
  assert.deepEqual(referenceKind('table.3.2'), { kind: 'table', number: '3.2' });
  assert.deepEqual(referenceKind('Table IV'), { kind: 'table', number: 'iv' });
  assert.equal(referenceKind('Section 3'), null);
  assert.equal(referenceKind('Tableau'), null);
  assert.equal(referenceLabel('table 1', 'See Figure 1 and Table 1.'), 'table 1');
  assert.equal(referenceLabel('figure caption 7', '2'), 'figure 2');
  assert.equal(referenceLabel('', 'Figure 2'), 'Figure 2');
  assert.equal(referenceLabel('figure.1.2', '1.2'), 'figure 1.2');
});
test('figure crop contains the graphic and caption, excluding heading and table', () => {
  const f = layout(); f.text('Results', 55, 55, 120, 20); f.rect(70, 140, 460, 240);
  f.text('Figure 1. Measurements', 55, 405, 270);
  f.text('Table 1. More results', 55, 470, 220);
  const crop = detectReferenceRegion(f.data, 'figure 1');
  assert.ok(crop); assert.ok(crop.top <= 140 && crop.top > 100);
  assert.ok(crop.top + crop.height >= 419 && crop.top + crop.height < 470);
  assert.ok(crop.left <= 55 && crop.left + crop.width >= 530);
});
test('figure caption above the graphic and wrapped captions are retained', () => {
  const f = layout(); f.text('Figure 2. A long caption', 55, 120, 280, 12); f.text('continued on this line.', 55, 134, 240, 12);
  f.rect(60, 170, 450, 220); f.text('Body text after the figure.', 55, 450, 400);
  const crop = detectReferenceRegion(f.data, 'Figure 2');
  assert.ok(crop); assert.ok(crop.top < 120); assert.ok(crop.top + crop.height >= 390 && crop.top + crop.height < 450);
});
test('table crop includes aligned cells and caption, without neighboring body text', () => {
  const f = layout(); f.text('Table 1. Results', 55, 120, 180);
  for (const y of [155, 183, 211]) { f.text('Condition', 55, y, 75); f.text('Accuracy', 210, y, 60); f.text('Time', 340, y, 40); }
  f.text('Body text must not be included.', 55, 280, 400);
  const crop = detectReferenceRegion(f.data, 'table 1');
  assert.ok(crop); assert.ok(crop.top <= 120); assert.ok(crop.top + crop.height >= 225 && crop.top + crop.height < 280);
  assert.ok(crop.left + crop.width >= 380);
});
test('two-column figure crop excludes the neighboring text column', () => {
  const f = layout(); f.rect(55, 130, 210, 180); f.text('Figure 3. Column figure', 55, 330, 210);
  for (let i = 0; i < 12; i++) f.text('Unrelated right column prose', 325, 110 + i * 22, 220);
  const crop = detectReferenceRegion(f.data, 'Figure 3');
  assert.ok(crop); assert.ok(crop.left + crop.width < 310);
});
test('uncertain captions, text-only figure references, sections and scans use the page fallback', () => {
  const f = layout(); f.text('Figure 1. A caption without an identifiable graphic', 55, 300, 450);
  for (let i = 0; i < 5; i++) f.text('Ordinary prose above a caption.', 55, 160 + i * 22, 400);
  assert.equal(detectReferenceRegion(f.data, 'Figure 1'), null);
  assert.equal(detectReferenceRegion(f.data, 'Figure 9'), null);
  assert.equal(detectReferenceRegion(f.data, 'Section 2'), null);
  assert.equal(detectReferenceRegion(layout().data, 'Table 1'), null);
});
test('nested history restores exact positions on the same page and supports forward and branching', () => {
  const a = { page: 1, x: 10, y: 620 }, b = { page: 2, x: 20, y: 430 }, c = { page: 2, x: 30, y: 180 };
  let history = pushReference({ back: [], forward: [] }, a); history = pushReference(history, b);
  let moved = traverseReferences(history, c, 'back'); assert.deepEqual(moved.target, b);
  moved = traverseReferences(moved.history, b, 'back'); assert.deepEqual(moved.target, a);
  assert.equal(traverseReferences(moved.history, a, 'back'), null);
  moved = traverseReferences(moved.history, a, 'forward'); assert.deepEqual(moved.target, b);
  moved = traverseReferences(moved.history, b, 'forward'); assert.deepEqual(moved.target, c);
  assert.equal(traverseReferences(moved.history, c, 'forward'), null);
  moved = traverseReferences(moved.history, c, 'back');
  history = pushReference(moved.history, b); assert.deepEqual(history.forward, []);
});
