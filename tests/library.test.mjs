import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { Library, validatePdf } = createRequire(import.meta.url)('../electron/library.cjs');
const bytes = Buffer.from('%PDF-1.7\nTest fixture');
async function fixture(t) { const root = await mkdtemp(join(tmpdir(), 'apdf-unit-')); t.after(() => rm(root, { recursive: true, force: true })); return new Library(root); }
test('saves independent PDF copies, deduplicates by content, and survives restart', async t => {
  const lib = await fixture(t);
  const entry = await lib.add(bytes, 'paper.pdf', { title: 'Paper', bibtex: '@article{k,title={Paper}}' });
  const duplicate = await lib.add(bytes, 'copy.pdf', { title: 'Duplicate' });
  assert.equal(entry.id, duplicate.id); assert.equal((await lib.read()).length, 1);
  const fresh = new Library(lib.root);
  assert.deepEqual((await fresh.get(entry.id)).bytes, bytes);
  assert.equal((await fresh.read())[0].bibtex, entry.bibtex);
});
test('concurrent metadata writes do not lose updates', async t => {
  const lib = await fixture(t); const entry = await lib.add(bytes, 'paper.pdf');
  await Promise.all([lib.update(entry.id, { title: 'New title' }), lib.update(entry.id, { page: 3 }), lib.update(entry.id, { bibtex: '@article{k,title={Paper}}' })]);
  const saved = (await lib.read())[0];
  assert.equal(saved.title, 'New title'); assert.equal(saved.page, 3); assert.ok(saved.bibtex);
});
test('failed patches cannot poison subsequent writes or change immutable IDs', async t => {
  const lib = await fixture(t); const entry = await lib.add(bytes, 'paper.pdf');
  await assert.rejects(lib.update(entry.id, { page: -1 }));
  await lib.update(entry.id, { title: 'Valid', id: '../escape' });
  assert.equal((await lib.read())[0].id, entry.id);
  assert.throws(() => lib.pdfPath('../escape'), /Invalid document ID/);
  assert.equal((await lib.read())[0].title, 'Valid');
});
test('removal deletes only the owned copy and library entry', async t => {
  const lib = await fixture(t); const entry = await lib.add(bytes, 'paper.pdf');
  await lib.remove(entry.id); assert.equal((await lib.read()).length, 0);
  await assert.rejects(readFile(lib.pdfPath(entry.id)), { code: 'ENOENT' });
});
test('a corrupt index is preserved and cannot be silently overwritten', async t => {
  const lib = await fixture(t); await writeFile(lib.index, 'broken');
  await assert.rejects(lib.add(bytes, 'paper.pdf')); assert.equal(await readFile(lib.index, 'utf8'), 'broken');
});
test('structurally invalid metadata is reported before reaching the renderer', async t => {
  const lib = await fixture(t);
  await writeFile(lib.index, JSON.stringify({ version: 1, entries: [{ id: 'a'.repeat(64) }] }));
  await assert.rejects(lib.read(), /Invalid library index/);
});
test('rejects empty and non-PDF files before storage', () => {
  assert.throws(() => validatePdf(Buffer.from('not a pdf'))); assert.throws(() => validatePdf(Buffer.alloc(0)));
});
