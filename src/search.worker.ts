import { searchPages } from './core/search.mjs';
let pages: Array<{ page: number; text: string }> = [];
self.onmessage = event => {
  if (event.data.type === 'index') { pages = event.data.pages; return; }
  const { query, options, id } = event.data;
  try { self.postMessage({ id, ...searchPages(pages, query, options) }); }
  catch (error) { self.postMessage({ id, error: (error as Error).message }); }
};
