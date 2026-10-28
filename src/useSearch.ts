import { useEffect, useRef, useState } from 'react';
import type { IndexedPage, SearchMatch, SearchOptions } from './types';
export function useSearch(pages: IndexedPage[], query: string, options: SearchOptions) {
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const [state, setState] = useState<{ matches: SearchMatch[]; error: string; busy: boolean; truncated: boolean }>({ matches: [], error: '', busy: false, truncated: false });
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    worker.current?.terminate(); worker.current = null;
  }, [pages]);
  useEffect(() => {
    const id = ++sequence.current;
    let deadline: ReturnType<typeof setTimeout>;
    setState({ matches: [], error: '', busy: Boolean(query && pages.length), truncated: false });
    if (!query || !pages.length) return;
    // Kill the prior worker, including any regex still executing in it.
    worker.current?.terminate(); worker.current = null;
    const debounce = setTimeout(() => {
      const instance = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      const fail = (message: string) => {
        if (id !== sequence.current) return;
        instance.terminate(); worker.current = null;
        setState({ matches: [], error: message, busy: false, truncated: false });
      };
      instance.onmessage = event => {
        if (event.data.id !== id || sequence.current !== id) return;
        clearTimeout(deadline);
        setState({ matches: event.data.matches || [], error: event.data.error || '', busy: false, truncated: Boolean(event.data.truncated) });
      };
      instance.onerror = () => { clearTimeout(deadline); fail('Search could not start. Try again.'); };
      instance.postMessage({ type: 'index', pages: pages.map(({ page, text }) => ({ page, text })) });
      instance.postMessage({ type: 'query', query, options, id });
      deadline = setTimeout(() => fail('This search took too long. Try a simpler pattern.'), 1800);
    }, 180);
    return () => { clearTimeout(debounce); clearTimeout(deadline); worker.current?.terminate(); worker.current = null; };
  }, [pages, query, options.caseSensitive, options.regex]);
  return state;
}
