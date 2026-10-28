import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Pin, X } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { ReferenceTarget } from '../types';
import { PdfPage } from './PdfPage';
import { getReferenceCrop, type ReferenceCrop } from '../reference-crop';
import { referenceKind } from '../core/reference-regions.mjs';
export function ReferencePreview({ pdf, target, pinned, onClose, onJump, onPin, onEnter, onLeave }: {
  pdf: PDFDocumentProxy; target: ReferenceTarget; pinned: boolean; onClose: () => void;
  onJump: () => void; onPin: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const [crop, setCrop] = useState<ReferenceCrop | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullPage, setFullPage] = useState(false);
  const kind = referenceKind(target.label);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setCrop(null); setFullPage(false);
    void getReferenceCrop(pdf, target).then(value => { if (!cancelled) setCrop(value); })
      .catch(() => { /* Unstructured or scanned PDFs retain the page preview. */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pdf, target]);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void pdf.getPage(target.page).then(page => {
      if (cancelled || !body.current) return;
      const width = page.getViewport({ scale: 1 }).width;
      observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
      observer.observe(body.current);
    }).catch(() => {});
    return () => { cancelled = true; observer?.disconnect(); };
  }, [pdf, target.page]);
  async function scrollToTarget() {
    const page = await pdf.getPage(target.page);
    const viewport = page.getViewport({ scale });
    const [, y] = viewport.convertToViewportPoint(target.x ?? 0, target.y ?? page.view[3]);
    if (body.current) body.current.scrollTop = Math.max(0, y - (kind ? 240 : 40));
  }
  return <aside className="reference-preview" role="dialog" aria-label="Reference preview" onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <header><div><span className="eyebrow">{crop && !fullPage ? `${kind?.kind.toUpperCase()} PREVIEW` : 'REFERENCE PREVIEW'}</span><strong>{target.label} <span>· page {target.page}</span></strong></div>
      <button className={`icon-button ${pinned ? 'selected' : ''}`} title="Keep preview open" aria-label="Pin preview" aria-pressed={pinned} onClick={onPin}><Pin size={16} /></button>
      <button className="icon-button" title="Close preview" aria-label="Close preview" onClick={onClose}><X size={17} /></button></header>
    <div ref={body} className="preview-body" data-preview-mode={loading ? 'loading' : crop && !fullPage ? 'crop' : 'page'}>
      {loading ? <div className="preview-loading" role="status"><LoaderCircle size={20} className="spinner" /> Preparing preview…</div> : crop && !fullPage ? <CroppedReference pdf={pdf} page={target.page} crop={crop} label={target.label} /> : <PdfPage key={`${target.page}-${target.x}-${target.y}`} pdf={pdf} number={target.page} scale={scale} eager text={false} onReady={() => { void scrollToTarget().catch(() => {}); }} />}
    </div>
    <footer><span>{loading ? 'Finding the reference…' : crop ? <button onClick={() => setFullPage(value => !value)}>{fullPage ? 'Show cropped reference' : 'Show full page'}</button> : kind ? 'Could not isolate this reference · page preview' : 'Page preview'}</span><button onClick={onJump}>Go to page <ArrowUpRight size={14} /></button></footer>
  </aside>;
}
function CroppedReference({ pdf, page: number, crop, label }: { pdf: PDFDocumentProxy; page: number; crop: ReferenceCrop; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  const [error, setError] = useState('');
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false, task: RenderTask | undefined;
    const output = canvas.current!;
    setError('');
    void (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const scale = width / crop.width;
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(8000000 / (crop.width * crop.height * scale * scale)));
      output.width = Math.max(1, Math.ceil(width * ratio)); output.height = Math.max(1, Math.ceil(crop.height * scale * ratio));
      output.style.width = `${width}px`; output.style.height = `${crop.height * scale}px`;
      task = page.render({ canvas: output, viewport: page.getViewport({ scale }), transform: [ratio, 0, 0, ratio, -crop.left * scale * ratio, -crop.top * scale * ratio], background: '#ffffff' });
      await task.promise;
    })().catch(e => { if (!cancelled && e.name !== 'RenderingCancelledException') setError('Unable to render the crop. Use Show full page.'); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, number, crop, width]);
  return <div ref={container} className="cropped-reference" data-crop={JSON.stringify(crop)}><canvas ref={canvas} aria-label={`${label} cropped preview`} />{error && <p role="alert">{error}</p>}</div>;
}
