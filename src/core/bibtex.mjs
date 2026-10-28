// Small validation/parser for a single BibTeX entry. Preserve the original entry
// verbatim; nested braces and escaped punctuation must survive a round trip.
export function parseBibtex(source) {
  const text = source.trim();
  const header = text.match(/^@(\w+)\s*([{(])\s*([^,\s]+)\s*,/);
  if (!header || /^(comment|preamble|string)$/i.test(header[1])) throw new Error('Paste one complete BibTeX citation, starting with @article, @book, or another entry type.');
  const closing = header[2] === '{' ? '}' : ')';
  let pos = header[0].length;
  const fields = {};
  while (pos < text.length) {
    while (/[\s,]/.test(text[pos] || '') && pos < text.length) pos++;
    if (text[pos] === closing) {
      if (text.slice(pos + 1).trim()) throw new Error('Import one BibTeX entry at a time.');
      if (!fields.title) throw new Error('This citation needs a title field.');
      return { bibtex: text, key: header[3], title: plain(fields.title), author: plain(fields.author || ''), doi: plain(fields.doi || '') };
    }
    const field = text.slice(pos).match(/^(\w+)\s*=\s*/);
    if (!field) throw new Error('Invalid BibTeX field near: ' + text.slice(pos, pos + 24));
    pos += field[0].length;
    let value = '';
    if (text[pos] === '{' || text[pos] === '"') {
      const quote = text[pos++] === '"';
      let depth = quote ? 0 : 1, complete = false;
      while (pos < text.length) {
        const char = text[pos++];
        if (char === '\\') { value += char + (text[pos++] || ''); continue; }
        if (char === '{') depth++;
        if (char === '}') { depth--; if (!quote && depth === 0) { complete = true; break; } }
        if (quote && char === '"' && depth === 0) { complete = true; break; }
        value += char;
      }
      if (!complete) throw new Error('Unclosed braces or quotes in BibTeX.');
    } else {
      while (pos < text.length && text[pos] !== ',' && text[pos] !== closing) value += text[pos++];
    }
    fields[field[1].toLowerCase()] = value.trim();
  }
  throw new Error('The BibTeX entry is missing its closing bracket.');
}
function plain(text) { return text.replace(/[{}]/g, '').replace(/\\([&%_#])/g, '$1').replace(/\s+/g, ' ').trim(); }
