import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowRight, BookOpen, Check, Clock3, FilePlus2, FileText, FolderOpen, HardDrive, Library, LoaderCircle, LockKeyhole, Moon, MoreHorizontal, Plus, Search, ShieldCheck, Sparkles, Sun, Trash2, Upload, X } from 'lucide-react';
import { Reader } from './components/Reader';
import { BibtexDialog } from './components/BibtexDialog';
import { loadPdf } from './pdf';
import type { DocumentState, LibraryEntry, OpenedFile } from './types';
import appIcon from '../build/icon.png';

export default function App() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [citation, setCitation] = useState(false);
  const [filter, setFilter] = useState('');
  const [section, setSection] = useState<'all' | 'recent'>('all');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [dark, setDark] = useState(localStorage.getItem('apdf-theme') === 'dark');
  const [dragging, setDragging] = useState(false);
  const [remove, setRemove] = useState<LibraryEntry | null>(null);
  const [password, setPassword] = useState<{ incorrect: boolean; resolve: (value: string | null) => void } | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const loadingTask = useRef<ReturnType<typeof loadPdf> | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const generation = useRef(0);
  const position = useRef(1);
  const notify = useCallback((message: string, error = true) => {
    setNotice({ message, error }); clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 10000 : 4000);
  }, []);
  const refresh = useCallback(async () => setEntries(await window.apdf.list()), []);
  useEffect(() => {
    const theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('apdf-theme', theme);
    void window.apdf.setTheme(theme).catch(e => notify('Could not save appearance: ' + e.message));
  }, [dark, notify]);

  const openFile = useCallback(async (file: OpenedFile | null) => {
    if (!file) return;
    const request = ++generation.current;
    setLoading(true); setCitation(false);
    let task: ReturnType<typeof loadPdf> | null = null;
    try {
      task = loadPdf(new Uint8Array(file.bytes));
      const currentTask = task;
      loadingTask.current = task;
      task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        setPasswordInput('');
        setPassword({ incorrect: reason === 2, resolve: value => {
          setPassword(null);
          if (value === null) { void currentTask.destroy(); if (request === generation.current) setLoading(false); }
          else updatePassword(value);
        } });
      };
      const pdf = await task.promise;
      if (request !== generation.current) { await task.destroy(); await window.apdf.release(file.token); return; }
      const metadata = await pdf.getMetadata().catch(() => null);
      const info = (metadata?.info || {}) as { Title?: string; Author?: string };
      const title = file.entry?.title || info.Title?.trim() || file.filename.replace(/\.pdf$/i, '').replace(/[_]/g, ' ');
      const next = { pdf, file, title, author: file.entry?.author || info.Author || '', entry: file.entry };
      position.current = Math.min(file.entry?.page || 1, pdf.numPages);
      const previous = docRef.current;
      setDoc(next);
      if (previous) setTimeout(() => { void previous.pdf.loadingTask.destroy(); void window.apdf.release(previous.file.token); }, 0);
      if (file.entry) {
        await window.apdf.update(file.entry.id, { lastOpenedAt: new Date().toISOString() });
        await refresh();
      }
    } catch (error) {
      void task?.destroy();
      void window.apdf.release(file.token);
      if (request === generation.current && !(error as Error).message.includes('destroyed')) notify('Could not open PDF: ' + (error as Error).message);
    } finally { if (request === generation.current) { setLoading(false); loadingTask.current = null; } }
  }, [notify, refresh]);
  const open = useCallback(async () => {
    try { await openFile(await window.apdf.open()); } catch (e) { notify((e as Error).message); }
  }, [openFile, notify]);
  useEffect(() => {
    void refresh().catch(e => notify('Could not load library: ' + e.message));
    const pending = () => { void window.apdf.pending().then(openFile).catch(e => notify(e.message)); };
    pending();
    return window.apdf.onOpen(action => { if (action === 'dialog') void open(); else pending(); });
  }, [open, openFile, refresh, notify]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void open(); }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  const persistPosition = useCallback((page: number) => {
    if (docRef.current?.file.token === doc?.file.token) position.current = page;
    const entry = doc?.entry;
    if (entry) void window.apdf.update(entry.id, { page }).then(updated => setEntries(entries => entries.map(e => e.id === entry.id ? updated : e))).catch(e => notify(e.message));
  }, [notify, doc?.entry, doc?.file.token]);
  async function save(metadata?: { title: string; author: string; bibtex: string; doi: string }) {
    const current = docRef.current;
    if (!current) return;
    const patch = { title: current.title, author: current.author, pageCount: current.pdf.numPages, page: position.current, ...metadata };
    const entry = current.entry ? await window.apdf.update(current.entry.id, patch) : await window.apdf.save(current.file.token, patch);
    setDoc(value => value?.file.token === current.file.token ? { ...value, entry, title: entry.title, author: entry.author || '' } : value);
    await refresh();
    notify(metadata ? 'PDF and citation saved to your library.' : 'PDF saved to your library.', false);
  }
  const closeReader = () => {
    persistPosition(position.current);
    setDoc(null); setCitation(false);
    setTimeout(() => { if (doc) { void doc.pdf.loadingTask.destroy(); void window.apdf.release(doc.file.token); } }, 0);
  };
  const visible = entries.filter(entry => `${entry.title} ${entry.author || ''} ${entry.filename} ${entry.doi || ''}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : (section === 'recent' ? b.lastOpenedAt.localeCompare(a.lastOpenedAt) : b.addedAt.localeCompare(a.addedAt)));
  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  const run = (fn: () => Promise<unknown>) => { void fn().catch(e => notify(e.message)); };

  return <div className="app" onDragOver={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={event => { if (!event.relatedTarget) setDragging(false); }} onDrop={event => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) run(async () => openFile(await window.apdf.openDropped(file)));
  }}>
    {!window.apdf ? <div className="browser-notice">Run aPDF as a desktop app with <code>npm run dev</code>.</div> : doc ? <Reader key={doc.file.token} doc={doc} dark={dark} onToggleTheme={() => setDark(v => !v)} onBack={closeReader} onSave={() => save()} onCitation={() => setCitation(true)} onError={notify} onPosition={persistPosition} /> : <>
      <aside className="library-sidebar"><div className="brand"><img className="brand-icon" src={appIcon} alt="" /><span>aPDF</span></div>
        <button className="primary-button open-button" onClick={() => void open()}><Plus size={17} /> Open PDF <kbd>{window.apdf?.platform === 'darwin' ? '⌘' : 'Ctrl'} O</kbd></button>
        <div className="sidebar-label">WORKSPACE</div>
        <nav><button className={section === 'all' ? 'active' : ''} onClick={() => setSection('all')}><Library size={18} /> All documents <span>{entries.length}</span></button><button className={section === 'recent' ? 'active' : ''} onClick={() => setSection('recent')}><Clock3 size={18} /> Recently opened</button></nav>
        <div className="sidebar-bottom"><div className="future-note"><Sparkles size={17} /><div><strong>A little more insight.</strong><p>AI summaries and semantic search are on the roadmap.</p><span>COMING LATER</span></div></div>
          <div className="storage-note"><HardDrive size={16} /><div><span>Stored on this device</span><small>{entries.length} PDF{entries.length !== 1 ? 's' : ''} · {formatSize(totalSize)}</small></div><button className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} title="Switch theme" onClick={() => setDark(v => !v)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button></div></div>
      </aside>
      <div className="library-main"><header className="library-topbar"><div><span>Workspace</span><ChevronRightSmall /><strong>{section === 'all' ? 'All documents' : 'Recently opened'}</strong></div><span className="local-badge"><span className="status-dot" /> Local library</span></header>
        <main className="library-content"><div className="library-heading"><div><span className="eyebrow">A LITTLE SPACE TO THINK</span><h1>{section === 'all' ? 'Your library' : 'Pick up where you left off'}</h1><p>Your papers, references, and ideas. All in one quiet place.</p></div><button className="secondary-button" onClick={() => void open()}><FilePlus2 size={16} /> Open document</button></div>
          <div className="library-controls"><label className="library-search"><Search size={17} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search your library…" aria-label="Search library" />{filter && <button className="icon-button" aria-label="Clear library filter" onClick={() => setFilter('')}><X size={14} /></button>}</label><button className="sort-button" onClick={() => setSort(s => s === 'recent' ? 'title' : 'recent')}><ArrowDownAZ size={16} />{sort === 'title' ? 'Title' : 'Newest first'}</button></div>
          {entries.length === 0 ? <div className="empty-library"><div className="empty-illustration"><div className="paper-back" /><div className="paper-front"><FileText size={31} strokeWidth={1.2} /><span /><span /><span /><div className="paper-highlight" /></div><span className="illustration-plus"><Plus size={17} /></span></div>
            <span className="eyebrow">LESS FRICTION. MORE UNDERSTANDING.</span><h2>Make room for your next idea.</h2><p>Open a paper and settle into the details.<br />Save it here to build a library that stays with you.</p><button className="primary-button" onClick={() => void open()}><FolderOpen size={17} /> Open your first PDF <ArrowRight size={16} /></button><span className="drop-hint">or drop a PDF anywhere in this window</span>
            <div className="feature-strip"><div><BookOpen size={18} /><span>Distraction-free reading</span></div><div><Search size={18} /><span>Precise, flexible search</span></div><div><FileText size={18} /><span>References in context</span></div></div></div> : <>
              <div className="document-count">{visible.length} document{visible.length !== 1 ? 's' : ''}</div>
              <div className="document-grid">{visible.map(entry => <article className="document-card" key={entry.id}><button className="card-open" aria-label={`Open ${entry.title}`} onClick={() => run(async () => openFile(await window.apdf.load(entry.id)))}>
                <div className="card-preview"><span className="pdf-file-badge">PDF</span><div className="mini-paper"><FileText size={29} strokeWidth={1} /><strong>{entry.title}</strong><span /><span /><span /><span /></div>{entry.bibtex && <span className="citation-badge"><Check size={11} /> BibTeX</span>}</div>
                <div className="card-info"><h3>{entry.title}</h3><p>{entry.author || entry.filename}</p><div><span>{entry.pageCount ? `${entry.pageCount} pages` : 'PDF document'} · {formatSize(entry.size)}</span><span className="reading-position">p. {entry.page || 1}</span></div></div></button>
                <button className="card-remove icon-button" title="Remove from library" aria-label={`Remove ${entry.title}`} onClick={() => setRemove(entry)}><Trash2 size={15} /></button></article>)}</div>
              {!visible.length && <div className="no-documents"><Search size={25} /><h2>No matching documents</h2><p>Try a title, author, or filename.</p></div>}
            </>}
          <footer className="library-footer"><span><ShieldCheck size={14} /> Your library stays on your device.</span><span>Made for curious minds.</span></footer>
        </main>
      </div></>}
    {notice && <div className={`toast ${notice.error ? 'error-toast' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <span>!</span> : <Check size={17} />}<p>{notice.message}</p><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {loading && <div className="loading-overlay"><LoaderCircle className="spinner" size={25} /><span>Opening document…</span></div>}
    {dragging && <div className="drop-overlay"><Upload size={35} /><h2>Drop into a quieter reading space.</h2><p>Open a PDF from your device</p></div>}
    {citation && doc && <BibtexDialog doc={doc} onClose={() => setCitation(false)} onSave={metadata => save(metadata)} onError={notify} />}
    {remove && <div className="modal-backdrop"><div className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="remove-title" onKeyDown={e => { if (e.key === 'Escape') setRemove(null); }}><h2 id="remove-title">Remove from your library?</h2><p>“{remove.title}” and its saved citation will be removed from aPDF. Your original PDF stays where it is.</p><div className="modal-actions"><button autoFocus className="secondary-button" onClick={() => setRemove(null)}>Keep document</button><button className="danger-button" onClick={() => run(async () => { await window.apdf.remove(remove.id); setRemove(null); await refresh(); })}>Remove</button></div></div></div>}
    {password && <div className="modal-backdrop password-backdrop"><form className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={event => { event.preventDefault(); password.resolve(passwordInput); }}><LockKeyhole size={25} /><h2 id="password-title">This PDF is protected.</h2><p>{password.incorrect ? 'That password didn’t work. Please try again.' : 'Enter the document password to start reading.'}</p><input autoFocus type="password" aria-label="PDF password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} /><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => password.resolve(null)}>Cancel</button><button className="primary-button" type="submit">Unlock PDF</button></div></form></div>}
  </div>;
}
function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function ChevronRightSmall() { return <span className="breadcrumb-separator">/</span>; }
