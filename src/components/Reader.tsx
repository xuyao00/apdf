import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Expand, FileText, Highlighter, List, LoaderCircle, Maximize, Minus, Moon, MoreHorizontal, PanelLeft, Plus, Printer, RotateCw, Search, Sun, X } from 'lucide-react';
import { PdfPage } from './PdfPage';
import { ReferencePreview } from './ReferencePreview';
import { buildIndex, resolveDestination } from '../pdf';
import { resolveReference } from '../core/search.mjs';
import { useSearch } from '../useSearch';
import type { DocumentState, IndexedPage, OutlineItem, ReferenceTarget } from '../types';

type Pane = 'search' | 'outline' | 'pages' | null;
export function Reader({ doc, dark, onToggleTheme, onCheckUpdates, onBack, onSave, onCitation, onError, onPosition }: {
  dark: boolean; onToggleTheme: () => void; onCheckUpdates: () => void;
  doc: DocumentState; onBack: () => void; onSave: () => Promise<void>; onCitation: () => void;
  onError: (message: string) => void; onPosition: (page: number) => void;
}) {
  const [pane, setPane] = useState<Pane>(null);
  const [page, setPage] = useState(doc.entry?.page || 1);
  const [pageInput, setPageInput] = useState(String(page));
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState<'width' | 'page' | null>('width');
  const [rotation, setRotation] = useState(0);
  const [defaultSize, setDefaultSize] = useState({ width: 612, height: 792 });
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [pages, setPages] = useState<IndexedPage[]>([]);
  const [progress, setProgress] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<{ target: ReferenceTarget; pinned: boolean } | null>(null);
  const [selection, setSelection] = useState<{ label: string; page: number; x: number; y: number } | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const linkSequence = useRef(0);
  const pageRef = useRef(page); pageRef.current = page;
  const onPositionRef = useRef(onPosition); onPositionRef.current = onPosition;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const search = useSearch(pages, query, { caseSensitive, regex });
  const activeMatch = search.matches[selected];
  const matchesByPage = useMemo(() => {
    const result = new Map<number, typeof search.matches>();
    for (const match of search.matches) { const bucket = result.get(match.page) || []; bucket.push(match); result.set(match.page, bucket); }
    return result;
  }, [search.matches]);

  const navigate = useCallback((number: number, target?: ReferenceTarget) => {
    const n = Math.max(1, Math.min(doc.pdf.numPages, number));
    const container = scroll.current;
    const element = container?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!container || !element) return;
    container.scrollTop = element.offsetTop - 28;
    setPage(n); setPageInput(String(n));
    if (target?.y !== undefined) {
      void doc.pdf.getPage(n).then(pdfPage => {
        const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation) % 360 });
        const [, y] = viewport.convertToViewportPoint(target.x || 0, target.y!);
        container.scrollTop = element.offsetTop + Math.max(0, y - 120);
      }).catch(error => onErrorRef.current(error.message));
    }
  }, [doc.pdf, scale, rotation]);

  useEffect(() => {
    let cancelled = false;
    void doc.pdf.getPage(1).then(first => { if (!cancelled) { const size = first.getViewport({ scale: 1 }); setDefaultSize({ width: size.width, height: size.height }); } }).catch(e => onErrorRef.current(e.message));
    void doc.pdf.getOutline().then(value => { if (!cancelled) setOutline((value || []) as OutlineItem[]); }).catch(() => {});
    void buildIndex(doc.pdf, n => { if (!cancelled) setProgress(n); }, () => cancelled)
      .then(value => { if (!cancelled) setPages(value); }).catch(e => { if (!cancelled) onErrorRef.current('Text indexing failed: ' + e.message); });
    return () => { cancelled = true; };
  }, [doc.pdf]);

  useEffect(() => {
    const container = scroll.current;
    if (!container || !fit) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = rotation % 180 ? defaultSize.height : defaultSize.width;
      const height = rotation % 180 ? defaultSize.width : defaultSize.height;
      const value = fit === 'width' ? (entry.contentRect.width - 80) / width : Math.min((entry.contentRect.width - 80) / width, (entry.contentRect.height - 56) / height);
      setScale(Math.max(0.25, Math.min(3, value)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit, pane, rotation, defaultSize]);
  useEffect(() => { const frame = requestAnimationFrame(() => navigate(pageRef.current)); return () => cancelAnimationFrame(frame); }, [scale, rotation, navigate]);
  useEffect(() => { setPageInput(String(page)); const timer = setTimeout(() => onPositionRef.current(page), 600); return () => clearTimeout(timer); }, [page]);
  useEffect(() => { if (pane === 'search') queryInput.current?.focus(); }, [pane]);
  useEffect(() => { setSelected(0); }, [query, caseSensitive, regex]);
  useEffect(() => {
    if (activeMatch && pane === 'search') {
      const item = pages[activeMatch.page - 1]?.items.find(item => item.end > activeMatch.start);
      navigate(activeMatch.page, item ? { page: activeMatch.page, x: item.transform[4], y: item.transform[5], label: 'Search result' } : undefined);
    }
  }, [activeMatch, pane, pages, navigate]);
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(hoverTimer.current); linkSequence.current++; onPositionRef.current(pageRef.current); }, []);

  const changeZoom = useCallback((delta: number) => { setFit(null); setScale(value => Math.max(0.25, Math.min(4, Math.round((value + delta) * 100) / 100))); }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (document.querySelector('[aria-modal="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      const editing = /INPUT|TEXTAREA/.test((event.target as HTMLElement).tagName);
      if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); setPane('search'); setTimeout(() => queryInput.current?.focus(), 0); }
      else if (event.key === 'Escape') { setPreview(null); setSelection(null); setFocusMode(false); if (pane === 'search') setPane(null); }
      else if (modifier && ['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '-' ? -0.1 : 0.1); }
      else if (modifier && event.key === '0') { event.preventDefault(); setFit('width'); }
      else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void onSave().catch(e => onErrorRef.current(e.message)); }
      else if (modifier && event.key.toLowerCase() === 'p') { event.preventDefault(); void window.apdf.print(doc.file.token).catch(e => onErrorRef.current(e.message)); }
      else if (!editing && ['ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); navigate(pageRef.current + 1); }
      else if (!editing && ['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); navigate(pageRef.current - 1); }
      else if (!editing && event.key === 'Home') { event.preventDefault(); navigate(1); }
      else if (!editing && event.key === 'End') { event.preventDefault(); navigate(doc.pdf.numPages); }
      else if (!editing && event.key.toLowerCase() === 'f' && !modifier) setFocusMode(value => !value);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [doc, navigate, changeZoom, pane, onSave]);

  const cancelHide = () => clearTimeout(hideTimer.current);
  const closePreview = () => { linkSequence.current++; clearTimeout(hoverTimer.current); setPreview(null); };
  const hidePreview = () => {
    clearTimeout(hoverTimer.current);
    hideTimer.current = setTimeout(() => { linkSequence.current++; setPreview(value => value?.pinned ? value : null); }, 450);
  };
  function showLink(destination: string | unknown[], label: string, pin: boolean) {
    cancelHide(); clearTimeout(hoverTimer.current);
    const request = ++linkSequence.current;
    hoverTimer.current = setTimeout(() => {
      void resolveDestination(doc.pdf, destination, label).then(target => {
        if (request !== linkSequence.current) return;
        if (!target) { if (pin) onErrorRef.current('This reference has no destination in the PDF.'); return; }
        setPreview(value => value?.pinned && !pin ? value : { target, pinned: pin });
      }).catch(e => onErrorRef.current(e.message));
    }, pin ? 0 : 250);
  }
  function selectionChanged() {
    const selectedText = window.getSelection();
    if (!selectedText || selectedText.isCollapsed || !selectedText.rangeCount) { setSelection(null); return; }
    const label = selectedText.toString().trim();
    const node = selectedText.anchorNode?.parentElement;
    const pageElement = node?.closest<HTMLElement>('[data-page]');
    if (!pageElement || !node?.closest('.textLayer') || label.length > 80 || !/^(fig(?:ure)?\.?|tab(?:le)?\.?|\[\s*\d+\s*\])/i.test(label)) { setSelection(null); return; }
    const rect = selectedText.getRangeAt(0).getBoundingClientRect();
    setSelection({ label, page: Number(pageElement.dataset.page), x: Math.min(window.innerWidth - 180, Math.max(12, rect.left)), y: Math.max(60, rect.top - 42) });
  }
  function previewSelection() {
    if (!selection) return;
    const target = resolveReference(selection.label, pages, selection.page);
    if (target) setPreview({ target, pinned: true });
    else onErrorRef.current(pages.length ? 'No matching caption or citation was found. Try selecting just “Figure 1”, “Table 1”, or “[1]”.' : 'Text is still indexing. Try again in a moment.');
    setSelection(null);
  }
  const run = (fn: () => Promise<unknown>) => { void fn().catch(e => onErrorRef.current(e.message)); };
  const searchStatus = search.error || (progress < doc.pdf.numPages ? `Indexing ${progress} of ${doc.pdf.numPages} pages…` : search.busy ? 'Searching…' : query ? `${search.matches.length}${search.truncated ? '+' : ''} results` : 'Find a word, phrase, or pattern.');

  return <div className={`reader ${focusMode ? 'focus-mode' : ''}`}>
    <header className="reader-toolbar">
      <button className="icon-button" aria-label="Back to library" title="Back to library" onClick={onBack}><ArrowLeft size={18} /></button>
      <span className="toolbar-divider" />
      <button className={`icon-button ${pane ? 'selected' : ''}`} aria-label="Toggle navigation" title="Navigation" onClick={() => setPane(pane ? null : 'outline')}><PanelLeft size={18} /></button>
      <div className="document-name"><strong>{doc.title}</strong><span>{doc.entry ? 'In your library' : 'Local document'}</span></div>
      <div className="page-navigation"><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => navigate(page - 1)}><ChevronLeft size={17} /></button>
        <input aria-label="Page number" value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={() => { const n = Number(pageInput); if (Number.isInteger(n) && n >= 1) navigate(n); else setPageInput(String(page)); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><span>/ {doc.pdf.numPages}</span>
        <button className="icon-button" aria-label="Next page" disabled={page >= doc.pdf.numPages} onClick={() => navigate(page + 1)}><ChevronRight size={17} /></button></div>
      <span className="toolbar-divider" /><button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(-0.1)}><Minus size={16} /></button>
      <button className="zoom-label" title="Fit width / fit page" onClick={() => setFit(fit === 'width' ? 'page' : 'width')}>{Math.round(scale * 100)}% <ChevronDown size={12} /></button>
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(0.1)}><Plus size={16} /></button>
      <button className="icon-button optional-tool" aria-label="Fit page" title="Fit page" onClick={() => setFit('page')}><Expand size={17} /></button>
      <span className="toolbar-divider" /><button className={`icon-button ${pane === 'search' ? 'selected' : ''}`} aria-label="Search document" title="Search (⌘/Ctrl F)" onClick={() => setPane(pane === 'search' ? null : 'search')}><Search size={18} /></button>
      <button className="icon-button optional-tool" aria-label="Citation details" title="BibTeX citation" onClick={onCitation}><span className="cite-icon">{'{ }'}</span></button>
      <button className="icon-button optional-tool" aria-label="Rotate clockwise" title="Rotate clockwise" onClick={() => setRotation(r => (r + 90) % 360)}><RotateCw size={17} /></button>
      <button className="icon-button secondary-tool" aria-label="Export PDF" title="Export original PDF" onClick={() => run(() => window.apdf.exportPdf(doc.file.token))}><Download size={17} /></button>
      <button className="icon-button secondary-tool" aria-label="Print PDF" title="Open print viewer" onClick={() => run(() => window.apdf.print(doc.file.token))}><Printer size={17} /></button>
      <button className="icon-button optional-tool" aria-label="Focus mode" title="Focus mode (F; Esc to exit)" onClick={() => setFocusMode(true)}><Maximize size={17} /></button>
      <button className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} title="Switch theme" onClick={onToggleTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      <details className="toolbar-more update-menu" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.stopPropagation(); } }}>
        <summary className="icon-button" role="button" aria-label="More reader actions" title="More reader actions"><MoreHorizontal size={18} /></summary>
        <div className="toolbar-menu" onClick={e => { e.currentTarget.closest('details')!.open = false; }}>
          <button onClick={onCheckUpdates}><RefreshCw size={16} /> Check for updates</button>
          <button className="compact-menu-item" onClick={() => setFit('page')}><Expand size={16} /> Fit page</button>
          <button className="compact-menu-item" onClick={onCitation}><span className="cite-icon">{'{ }'}</span> Citation details</button>
          <button className="compact-menu-item" onClick={() => setRotation(r => (r + 90) % 360)}><RotateCw size={16} /> Rotate clockwise</button>
          <button className="compact-menu-item" onClick={() => setFocusMode(true)}><Maximize size={16} /> Focus mode</button>
          <button onClick={() => run(() => window.apdf.exportPdf(doc.file.token))}><Download size={16} /> Export PDF</button>
          <button onClick={() => run(() => window.apdf.print(doc.file.token))}><Printer size={16} /> Print PDF</button>
        </div>
      </details>
      <button className={`save-button ${doc.entry ? 'is-saved' : ''}`} disabled={Boolean(doc.entry) || saving} onClick={async () => { setSaving(true); try { await onSave(); } catch (e) { onErrorRef.current((e as Error).message); } finally { setSaving(false); } }}>{doc.entry ? <Check size={15} /> : <Bookmark size={15} />}{doc.entry ? 'Saved' : saving ? 'Saving…' : 'Save'}</button>
      {focusMode && <button className="exit-focus secondary-button" onClick={() => setFocusMode(false)}>Exit focus <span>Esc</span></button>}
    </header>
    <div className="reader-layout">
      {pane && <aside className="reader-sidebar"><div className="pane-tabs">
        <button className={pane === 'outline' ? 'active' : ''} aria-label="Document outline" onClick={() => setPane('outline')}><List size={17} /></button>
        <button className={pane === 'pages' ? 'active' : ''} aria-label="Page thumbnails" onClick={() => setPane('pages')}><FileText size={17} /></button>
        <button className={pane === 'search' ? 'active' : ''} aria-label="Find in document" onClick={() => setPane('search')}><Search size={17} /></button><button className="pane-close" aria-label="Close navigation" onClick={() => setPane(null)}><X size={16} /></button></div>
        {pane === 'search' && <><div className="search-controls"><label className="search-field"><Search size={16} /><input ref={queryInput} placeholder="Find in document…" aria-label="Search query" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && search.matches.length) setSelected(n => (n + (e.shiftKey ? -1 : 1) + search.matches.length) % search.matches.length); }} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button>}</label>
          <div className="search-options"><button className={caseSensitive ? 'active' : ''} aria-label="Case sensitive" aria-pressed={caseSensitive} title="Match case" onClick={() => setCaseSensitive(v => !v)}>Aa <span>Match case</span></button><button className={regex ? 'active' : ''} aria-label="Regular expression" aria-pressed={regex} title="Use regular expression" onClick={() => setRegex(v => !v)}>.* <span>Regex</span></button></div>
          <div className={`search-status ${search.error ? 'inline-error' : ''}`} role="status">{searchStatus}</div>
          {!!search.matches.length && <div className="result-navigation"><span>{selected + 1} of {search.matches.length}</span><button className="icon-button" aria-label="Previous match" onClick={() => setSelected(n => (n - 1 + search.matches.length) % search.matches.length)}><ChevronLeft size={15} /></button><button className="icon-button" aria-label="Next match" onClick={() => setSelected(n => (n + 1) % search.matches.length)}><ChevronRight size={15} /></button></div>}</div>
          <div className="search-results">{search.matches.map((match, i) => <button key={`${match.page}-${match.start}`} className={`search-result ${i === selected ? 'active' : ''}`} onClick={() => setSelected(i)}><span>PAGE {match.page}</span><p>…{match.snippet.slice(0, match.snippetStart)}<mark>{match.snippet.slice(match.snippetStart, match.snippetStart + match.end - match.start)}</mark>{match.snippet.slice(match.snippetStart + match.end - match.start)}…</p></button>)}
            {!query && <div className="pane-empty"><Search size={26} /><p>A closer look.</p><span>Search the full document. Use regular expressions for more precise results.</span></div>}
            {query && !search.busy && !search.error && pages.length > 0 && !search.matches.length && <div className="pane-empty"><p>No matches found.</p><span>Try a different phrase or turn off match case.</span></div>}</div></>}
        {pane === 'outline' && <div className="outline-pane"><h3>Contents</h3>{outline.length ? <Outline items={outline} onClick={destination => { if (destination) run(async () => { const target = await resolveDestination(doc.pdf, destination); if (target) { setHistory(h => [...h, page]); navigate(target.page, target); } }); }} /> : <div className="pane-empty"><List size={26} /><p>No outline in this PDF.</p><span>Use page thumbnails or search to find your way.</span></div>}</div>}
        {pane === 'pages' && <div className="thumbnails">{Array.from({ length: doc.pdf.numPages }, (_, i) => <button className={`thumbnail ${page === i + 1 ? 'active' : ''}`} key={i} aria-label={`Go to page ${i + 1}`} onClick={() => navigate(i + 1)}><PdfPage pdf={doc.pdf} number={i + 1} scale={148 / defaultSize.width} text={false} defaultSize={defaultSize} /><span>{i + 1}</span></button>)}</div>}
      </aside>}
      <main ref={scroll} className="document-scroll" aria-label="PDF document" onMouseUp={selectionChanged} onScroll={() => {
        const container = scroll.current!;
        // Use element geometry; mixed-size PDFs update their heights as rendered.
        const anchor = container.getBoundingClientRect().top + 90;
        let closest = pageRef.current, distance = Infinity;
        for (const element of Array.from(container.querySelectorAll<HTMLElement>(':scope > .page-stack > .pdf-page'))) {
          const rect = element.getBoundingClientRect();
          const d = rect.top <= anchor && rect.bottom > anchor ? 0 : Math.abs(rect.top - anchor);
          if (d < distance) { distance = d; closest = Number(element.dataset.page); }
        }
        if (closest !== pageRef.current) setPage(closest);
        setSelection(null);
      }}><div className="page-stack">{Array.from({ length: doc.pdf.numPages }, (_, i) => <PdfPage key={i} pdf={doc.pdf} number={i + 1} scale={scale} rotation={rotation} defaultSize={defaultSize} indexed={pages[i]} matches={matchesByPage.get(i + 1)} activeMatch={activeMatch} onLink={showLink} onLinkLeave={hidePreview} onExternal={url => run(() => window.apdf.external(url))} />)}</div></main>
    </div>
    <footer className="reader-status"><span><span className="status-dot" />{progress < doc.pdf.numPages ? `Indexing text · ${progress}/${doc.pdf.numPages}` : 'All pages ready'}</span><span>Hover over a linked reference to preview it <span className="status-separator">·</span> Select an unlinked reference for a preview</span><span>{Math.round(scale * 100)}% <span className="status-separator">·</span> {page} / {doc.pdf.numPages}</span></footer>
    {!!history.length && <button className="return-button secondary-button" onClick={() => { navigate(history[history.length - 1]); setHistory(h => h.slice(0, -1)); }}><ArrowLeft size={14} /> Back to page {history[history.length - 1]}</button>}
    {selection && <button className="selection-preview primary-button" style={{ left: selection.x, top: selection.y }} onMouseDown={e => e.preventDefault()} onClick={previewSelection}><Highlighter size={14} /> Preview reference</button>}
    {preview && <ReferencePreview pdf={doc.pdf} target={preview.target} pinned={preview.pinned} onClose={closePreview} onPin={() => setPreview(value => value && { ...value, pinned: !value.pinned })} onEnter={cancelHide} onLeave={hidePreview} onJump={() => { setHistory(h => [...h, page]); navigate(preview.target.page, preview.target); closePreview(); }} />}
  </div>;
}
function Outline({ items, onClick }: { items: OutlineItem[]; onClick: (dest: OutlineItem['dest']) => void }) {
  return <ul>{items.map((item, i) => <li key={i}><button onClick={() => onClick(item.dest)} disabled={!item.dest}>{item.title}</button>{item.items.length > 0 && <Outline items={item.items} onClick={onClick} />}</li>)}</ul>;
}
