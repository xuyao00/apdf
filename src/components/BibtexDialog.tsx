import { useRef, useState } from 'react';
import { ExternalLink, FileUp, X, Check, Copy, Download } from 'lucide-react';
import { parseBibtex } from '../core/bibtex.mjs';
import type { DocumentState } from '../types';
export function BibtexDialog({ doc, onClose, onSave, onError }: { doc: DocumentState; onClose: () => void; onSave: (metadata: { title: string; author: string; bibtex: string; doi: string }) => Promise<void>; onError: (message: string) => void }) {
  const [value, setValue] = useState(doc.entry?.bibtex || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const act = (fn: () => Promise<unknown>) => { void fn().catch(e => onError(e.message)); };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="modal bibtex-modal" role="dialog" aria-modal="true" aria-labelledby="bibtex-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, a[href]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="modal-heading"><div><span className="eyebrow">YOUR RESEARCH, WELL REFERENCED</span><h2 id="bibtex-title">Citation details</h2></div><button className="icon-button" aria-label="Close citation details" onClick={onClose}><X size={20} /></button></div>
      <p className="citation-title">{doc.title}</p>
      <div className="scholar-instructions"><div className="scholar-symbol">G<span>scholar</span></div><p>Find this paper on Google Scholar. Choose <strong>Cite → BibTeX</strong>, then paste the entry below or import its .bib file.</p>
        <button className="secondary-button" onClick={() => act(() => window.apdf.external(`https://scholar.google.com/scholar?q=${encodeURIComponent(doc.title)}`))}>Find on Scholar <ExternalLink size={14} /></button></div>
      <label htmlFor="bibtex">BibTeX entry</label>
      <textarea id="bibtex" autoFocus value={value} spellCheck={false} placeholder={'@article{citation_key,\n  title = {Paper title},\n  author = {Author name},\n  year = {2026}\n}'} onChange={e => { setValue(e.target.value); setError(''); }} />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="bibtex-tools"><button className="text-button" onClick={() => act(async () => { const imported = await window.apdf.importBibtex(); if (imported !== null) { setValue(imported); setError(''); } })}><FileUp size={15} /> Import .bib</button>
        <button className="text-button" disabled={!value} onClick={() => act(async () => { await navigator.clipboard.writeText(value); setCopied(true); })}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}</button>
        <button className="text-button" disabled={!value} onClick={() => act(() => window.apdf.exportBibtex(doc.title, value))}><Download size={15} /> Export</button></div>
      <footer className="modal-footer"><span>Saved alongside your PDF, on this device.</span><button className="primary-button" disabled={saving} onClick={async () => {
        try { const metadata = parseBibtex(value); setSaving(true); await onSave(metadata); onClose(); }
        catch (e) { setError((e as Error).message); } finally { setSaving(false); }
      }}>{saving ? 'Saving…' : doc.entry ? 'Save citation' : 'Save PDF & citation'} <Check size={15} /></button></footer>
    </div>
  </div>;
}
