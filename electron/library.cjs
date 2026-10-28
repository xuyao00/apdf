const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_PDF_BYTES = 300 * 1024 * 1024;
class Library {
  constructor(root) {
    this.root = root;
    this.index = path.join(root, 'library.json');
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      const data = JSON.parse(await fs.readFile(this.index, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.some(e =>
        !e || !/^[a-f0-9]{64}$/.test(e.id) || typeof e.title !== 'string' || typeof e.filename !== 'string' ||
        !Number.isFinite(e.size) || e.size < 1 || !Number.isInteger(e.page) || e.page < 1 ||
        typeof e.addedAt !== 'string' || typeof e.lastOpenedAt !== 'string' ||
        ['author', 'bibtex', 'doi'].some(key => key in e && typeof e[key] !== 'string')
      )) {
        throw new Error('Invalid library index. Your files have been preserved.');
      }
      return data.entries;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  mutate(fn) {
    const result = this.queue.then(async () => {
      await fs.mkdir(this.root, { recursive: true });
      const entries = await this.read();
      const value = await fn(entries);
      const temporary = this.index + '.tmp';
      await fs.writeFile(temporary, JSON.stringify({ version: 1, entries }, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.index);
      return value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async add(bytes, filename, metadata = {}) {
    validatePdf(bytes);
    const id = createHash('sha256').update(bytes).digest('hex');
    return this.mutate(async entries => {
      const previous = entries.find(e => e.id === id);
      if (previous) return previous;
      await fs.writeFile(this.pdfPath(id), bytes, { mode: 0o600 });
      const entry = {
        id, filename: path.basename(filename), title: path.basename(filename, path.extname(filename)),
        addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
        size: bytes.length, page: 1, ...cleanPatch(metadata)
      };
      entries.unshift(entry);
      return entry;
    });
  }
  pdfPath(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid document ID.');
    return path.join(this.root, id + '.pdf');
  }
  async get(id) {
    const entry = (await this.read()).find(e => e.id === id);
    if (!entry) throw new Error('This document is no longer in your library.');
    return { entry, bytes: await fs.readFile(this.pdfPath(id)) };
  }
  update(id, patch) {
    return this.mutate(async entries => {
      const entry = entries.find(e => e.id === id);
      if (!entry) throw new Error('Document not found.');
      Object.assign(entry, cleanPatch(patch));
      return entry;
    });
  }
  async remove(id) {
    const file = this.pdfPath(id);
    // Commit the index first. A failed deletion leaves an orphan, never a dangling entry.
    await this.mutate(async entries => {
      const i = entries.findIndex(e => e.id === id);
      if (i < 0) throw new Error('Document not found.');
      entries.splice(i, 1);
    });
    await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function validatePdf(bytes) {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new Error('Choose a PDF smaller than 300 MB.');
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw new Error('This file does not appear to be a PDF.');
}
function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid document metadata.');
  const result = {};
  for (const key of ['title', 'author', 'bibtex', 'doi']) {
    if (key in patch) {
      if (typeof patch[key] !== 'string' || patch[key].length > (key === 'bibtex' ? 100000 : 2000)) throw new Error('Invalid ' + key + '.');
      result[key] = patch[key];
    }
  }
  for (const key of ['page', 'pageCount']) {
    if (key in patch) {
      if (!Number.isInteger(patch[key]) || patch[key] < 1 || patch[key] > 1000000) throw new Error('Invalid page number.');
      result[key] = patch[key];
    }
  }
  if (patch.lastOpenedAt) result.lastOpenedAt = new Date().toISOString();
  return result;
}
module.exports = { Library, validatePdf, MAX_PDF_BYTES };
