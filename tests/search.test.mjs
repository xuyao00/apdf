import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPages, indexText, resolveReference } from '../src/core/search.mjs';
const pages = [{ page: 1, text: 'Attention attention ATTENTION. Figure 1 and [1].' }, { page: 2, text: 'Figure 1. Results\nTable 2. Measurements\n[1] First citation.' }];
const options = { caseSensitive: false, regex: false };
test('literal search is insensitive by default and preserves exact offsets', () => {
  const result = searchPages(pages, 'attention', options);
  assert.equal(result.matches.length, 3);
  for (const m of result.matches) assert.equal(pages[m.page - 1].text.slice(m.start, m.end).toLowerCase(), 'attention');
});
test('case-sensitive and regular expression modes compose', () => {
  assert.equal(searchPages(pages, 'Attention', { ...options, caseSensitive: true }).matches.length, 1);
  assert.equal(searchPages(pages, 'Figure\\s+\\d', { ...options, regex: true }).matches.length, 2);
  assert.equal(searchPages(pages, 'attention|measurements', { caseSensitive: true, regex: true }).matches.length, 1);
});
test('literal patterns escape regex punctuation', () => {
  assert.equal(searchPages(pages, '[1]', options).matches.length, 2);
  assert.equal(searchPages(pages, '.', options).matches.length, 5);
});
test('literal phrase searches span line breaks and PDF spacing', () => {
  assert.equal(searchPages([{ page: 1, text: 'one\ntwo   three' }], 'one two three', options).matches.length, 1);
});
test('invalid expressions report errors; zero-width and Unicode matches terminate', () => {
  assert.throws(() => searchPages(pages, '[', { ...options, regex: true }), /Invalid regular/);
  assert.equal(searchPages([{ page: 1, text: '😃abc' }], '(?:)', { ...options, regex: true }).matches.length, 0);
  assert.equal(searchPages(pages, '', options).matches.length, 0);
});
test('caps search results and reports truncation without losing valid offsets', () => {
  const result = searchPages([{ page: 4, text: 'x'.repeat(6000) }], 'x', options);
  assert.equal(result.matches.length, 5000); assert.equal(result.truncated, true);
});
const item = (str, x = 0, y = 100, width = str.length * 5, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], height: 10, width, hasEOL });
test('text indexing joins adjacent runs, spaces separated words, and preserves item offsets', () => {
  const result = indexText(1, [item('atten', 0), item('tion', 25), item('works', 51, 100, 25, true), item('well', 0, 85)]);
  assert.equal(result.text, 'attention works\nwell');
  assert.equal(result.text.slice(result.items[2].start, result.items[2].end), 'works');
  assert.equal(searchPages([result], 'attention works', options).matches.length, 1);
});
test('unlinked reference resolution prefers captions and bibliography entries', () => {
  const indexed = [indexText(1, [item('See Figure 1 and [1].', 0, 100, 100, true)]), indexText(2, [item('Figure 1. Results', 0, 100, 100, true), item('[1] A citation.', 0, 80, 100, true)])];
  assert.equal(resolveReference('Figure 1', indexed, 1)?.page, 2);
  assert.equal(resolveReference('[1]', indexed, 1)?.page, 2);
  assert.equal(resolveReference('Figure 99', indexed, 1), null);
  assert.equal(resolveReference('random selection', indexed, 1), null);
});
