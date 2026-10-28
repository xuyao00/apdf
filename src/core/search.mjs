export function compileQuery(query, options) {
  if (!query) return null;
  if (query.length > 1000) throw new Error('Keep search patterns under 1,000 characters.');
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  try { return new RegExp(source, options.caseSensitive ? 'gu' : 'giu'); }
  catch { throw new Error('Invalid regular expression. Check brackets and escape characters.'); }
}

export function searchPages(pages, query, options, limit = 5000) {
  const expression = compileQuery(query, options);
  if (!expression) return { matches: [], truncated: false };
  const matches = [];
  for (const page of pages) {
    expression.lastIndex = 0;
    // matchAll advances Unicode zero-length matches safely. Ignore zero-width results.
    for (const found of page.text.matchAll(expression)) {
      if (!found[0].length) continue;
      if (matches.length >= limit) return { matches, truncated: true };
      const start = found.index;
      const left = Math.max(0, start - 38);
      matches.push({ page: page.page, start, end: start + found[0].length,
        snippet: page.text.slice(left, start + found[0].length + 65), snippetStart: start - left });
    }
  }
  return { matches, truncated: false };
}

// Preserve a mapping to PDF text items so search highlights also work across runs.
export function indexText(page, items) {
  let text = '';
  const indexed = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!('str' in item)) continue;
    const start = text.length;
    text += item.str;
    indexed.push({ ...item, start, end: text.length });
    // PDF.js sometimes splits a word into adjacent text runs; only add a space
    // when the geometry indicates one. EOL remains searchable as whitespace.
    const next = items[i + 1];
    if (item.hasEOL) text += '\n';
    else if (next && 'str' in next) {
      const gap = next.transform[4] - (item.transform[4] + item.width);
      if (gap > Math.max(1, Math.abs(item.height) * 0.12) || Math.abs(next.transform[5] - item.transform[5]) > Math.abs(item.height) * 0.6) text += ' ';
    }
  }
  return { page, text, items: indexed };
}

export function resolveReference(label, pages, sourcePage) {
  const normalized = label.trim().replace(/\s+/g, ' ');
  const figure = normalized.match(/^(fig(?:ure)?\.?|tab(?:le)?\.?)\s*([A-Z]?\d+(?:[.\-]\d+)*[a-z]?)/i);
  const citation = normalized.match(/^\[\s*(\d+)\s*\]$/);
  if (!figure && !citation) return null;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = figure ? (/^fig/i.test(figure[1]) ? 'fig(?:ure)?\\.?' : 'tab(?:le)?\\.?') : '\\[';
  const number = figure ? figure[2] : citation[1];
  const pattern = figure ? `${prefix}\\s*${escape(number)}(?![\\w.\\-]\\d)(?=[\\s.:)\\n]|$)` : `\\[\\s*${number}\\s*\\]`;
  const re = new RegExp(pattern, 'gim');
  let best = null;
  for (const page of pages) {
    for (const found of page.text.matchAll(re)) {
      const before = page.text.slice(0, found.index);
      const linePrefix = before.slice(before.lastIndexOf('\n') + 1);
      let score = /^\s*$/.test(linePrefix) ? 8 : 0;
      if (page.page !== sourcePage) score += 2;
      if (citation) score += page.page / Math.max(1, pages.length);
      const item = page.items.find(item => item.end > found.index);
      if (item && (!best || score > best.score)) best = { page: page.page, x: item.transform[4], y: item.transform[5], label: normalized, score };
    }
  }
  return best;
}
