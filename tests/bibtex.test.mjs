import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBibtex } from '../src/core/bibtex.mjs';
test('round trips Scholar-style BibTeX with nested braces and escaped characters', () => {
  const bib = '@article{key,\n title={{A} study of {PDFs} \\& reading},\n author={Doe, Jane and Smith, John},\n year=2026, doi={10.1000/test}\n}';
  const result = parseBibtex(bib);
  assert.equal(result.bibtex, bib); assert.equal(result.title, 'A study of PDFs & reading');
  assert.equal(result.author, 'Doe, Jane and Smith, John'); assert.equal(result.doi, '10.1000/test');
});
test('quoted fields, braces within quotes, and parentheses are supported', () => {
  assert.equal(parseBibtex('@book(key, title="A {Nested} Title", year=2020)').title, 'A Nested Title');
});
test('incomplete, multi-entry, and non-citation data are rejected', () => {
  for (const source of ['', '@comment{hi}', '@article{k, title={Oops}', '@article{k, author={X}}', '@article{k, title={X}}\n@article{j,title={Y}}']) assert.throws(() => parseBibtex(source));
});
