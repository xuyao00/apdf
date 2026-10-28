import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Pin, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReferenceTarget } from '../types';
import { PdfPage } from './PdfPage';
export function ReferencePreview({ pdf, target, pinned, onClose, onJump, onPin, onEnter, onLeave }: {
  pdf: PDFDocumentProxy; target: ReferenceTarget; pinned: boolean; onClose: () => void;
  onJump: () => void; onPin: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    pdf.getPage(target.page).then(page => {
      if (cancelled || !body.current) return;
      const width = page.getViewport({ scale: 1 }).width;
      observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
      observer.observe(body.current);
    });
    return () => { cancelled = true; observer?.disconnect(); };
  }, [pdf, target.page]);
  async function scrollToTarget() {
    const page = await pdf.getPage(target.page);
    const viewport = page.getViewport({ scale });
    const [, y] = viewport.convertToViewportPoint(target.x || 0, target.y ?? page.view[3]);
    if (body.current) body.current.scrollTop = Math.max(0, y - (/fig|tab/i.test(target.label) ? 240 : 40));
  }
  return <aside className="reference-preview" role="dialog" aria-label="Reference preview" onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <header><div><span className="eyebrow">REFERENCE PREVIEW</span><strong>{target.label} <span>· page {target.page}</span></strong></div>
      <button className={`icon-button ${pinned ? 'selected' : ''}`} title="Keep preview open" aria-label="Pin preview" aria-pressed={pinned} onClick={onPin}><Pin size={16} /></button>
      <button className="icon-button" title="Close preview" aria-label="Close preview" onClick={onClose}><X size={17} /></button></header>
    <div ref={body} className="preview-body"><PdfPage key={`${target.page}-${target.x}-${target.y}`} pdf={pdf} number={target.page} scale={scale} eager text={false} onReady={() => { void scrollToTarget(); }} /></div>
    <footer><span>Keep your place. Follow the thought.</span><button onClick={onJump}>Go to page <ArrowUpRight size={14} /></button></footer>
  </aside>;
}
