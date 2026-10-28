import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import type { IndexedPage, SearchMatch } from '../types';

interface Props {
  pdf: PDFDocumentProxy; number: number; scale: number; rotation?: number;
  defaultSize?: { width: number; height: number }; eager?: boolean; text?: boolean;
  indexed?: IndexedPage; matches?: SearchMatch[]; activeMatch?: SearchMatch;
  onLink?: (destination: string | unknown[], label: string, pin: boolean) => void;
  onLinkLeave?: () => void; onExternal?: (url: string) => void;
  onReady?: (width: number, height: number) => void;
}
interface Link { id: string; rect: number[]; dest?: string | unknown[]; url?: string; label: string }
interface Highlight { x: number; y: number; width: number; height: number; active: boolean }
const EMPTY_MATCHES: SearchMatch[] = [];
export function PdfPage(props: Props) {
  const { pdf, number, scale, rotation = 0, defaultSize = { width: 612, height: 792 }, eager = false } = props;
  const wrapper = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [measuredSize, setSize] = useState<{ width: number; height: number } | null>(null);
  const size = measuredSize || defaultSize;
  useEffect(() => {
    if (eager) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '900px' });
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, [eager]);
  const swapped = rotation % 180 !== 0;
  return <div ref={wrapper} className="pdf-page" data-page={number}
    style={{ width: (swapped ? size.height : size.width) * scale, height: (swapped ? size.width : size.height) * scale }}>
    {visible ? <PageContent {...props} onSize={setSize} /> : <div className="page-placeholder">{number}</div>}
  </div>;
}
function PageContent({ pdf, number, scale, rotation = 0, text = true, indexed, matches = EMPTY_MATCHES, activeMatch, onLink, onLinkLeave, onExternal, onReady, onSize }: Props & { onSize: (size: { width: number; height: number }) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [rects, setRects] = useState<Highlight[]>([]);
  const [renderVersion, setRenderVersion] = useState(0);
  const [error, setError] = useState('');
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const target = canvas.current!;
    const textTarget = textContainer.current!;
    setError(''); setLinks([]);
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const intrinsicRotation = page.rotate;
      const natural = page.getViewport({ scale: 1 });
      onSize({ width: natural.width, height: natural.height });
      const viewport = page.getViewport({ scale, rotation: (intrinsicRotation + rotation) % 360 });
      // Cap pixel count for huge pages / high zoom; CSS size stays unchanged.
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(16000000 / (viewport.width * viewport.height)));
      target.width = Math.max(1, Math.floor(viewport.width * ratio));
      target.height = Math.max(1, Math.floor(viewport.height * ratio));
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      render = page.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (cancelled) return;
      if (text) {
        textTarget.replaceChildren();
        textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textTarget, viewport });
        layer.current = textLayer;
        await textLayer.render();
      }
      if (cancelled) return;
      const annotations = await page.getAnnotations();
      if (cancelled) return;
      setLinks(annotations.filter(a => a.subtype === 'Link' && (a.dest || a.url)).map(a => {
        const rect = [...viewport.convertToViewportPoint(a.rect[0], a.rect[1]), ...viewport.convertToViewportPoint(a.rect[2], a.rect[3])];
        const destLabel = typeof a.dest === 'string' ? a.dest.replace(/[._:]/g, ' ') : 'Reference';
        return { id: a.id, rect: [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.abs(rect[2] - rect[0]), Math.abs(rect[3] - rect[1])], dest: a.dest, url: a.url, label: destLabel };
      }));
      setRenderVersion(v => v + 1);
      onReadyRef.current?.(viewport.width, viewport.height);
    })().catch(error => { if (!cancelled && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') setError(error.message || 'Unable to render this page.'); });
    return () => { cancelled = true; render?.cancel(); textLayer?.cancel(); layer.current = null; };
  }, [pdf, number, scale, rotation, text, onSize]);

  useEffect(() => {
    if (!layer.current || !indexed || !textContainer.current) { setRects([]); return; }
    const parentRect = textContainer.current.getBoundingClientRect();
    const highlights: Highlight[] = [];
    for (const match of matches) {
      indexed.items.forEach((item, i) => {
        if (item.end <= match.start || item.start >= match.end) return;
        const span = layer.current!.textDivs[i];
        const node = span?.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        const range = document.createRange();
        range.setStart(node, Math.max(0, match.start - item.start));
        range.setEnd(node, Math.min(item.str.length, match.end - item.start));
        for (const rect of Array.from(range.getClientRects())) highlights.push({ x: rect.left - parentRect.left, y: rect.top - parentRect.top, width: rect.width, height: rect.height,
          active: activeMatch?.start === match.start && activeMatch?.page === match.page });
      });
    }
    setRects(highlights);
  }, [indexed, matches, activeMatch, renderVersion]);
  return <div className="page-content" style={{ '--total-scale-factor': scale } as CSSProperties}>
    <canvas ref={canvas} aria-label={`Page ${number}`} />
    <div ref={textContainer} className="textLayer" />
    <div className="search-highlights" aria-hidden="true">{rects.map((rect, i) => <div key={i} className={rect.active ? 'match active-match' : 'match'} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />)}</div>
    <div className="link-layer">{(onLink || onExternal) && links.map(link => <button key={link.id} className="pdf-link" aria-label={link.dest ? `Preview ${link.label}` : `Open ${link.url}`} title={link.dest ? 'Hover to preview · click to keep open' : link.url}
      style={{ left: link.rect[0], top: link.rect[1], width: Math.max(link.rect[2], 8), height: Math.max(link.rect[3], 8) }}
      onPointerEnter={() => { if (link.dest) onLink?.(link.dest, link.label, false); }}
      onPointerLeave={onLinkLeave}
      onFocus={() => { if (link.dest) onLink?.(link.dest, link.label, false); }}
      onClick={() => link.dest ? onLink?.(link.dest, link.label, true) : link.url && onExternal?.(link.url)} />)}</div>
    {error && <div className="page-error">{error}</div>}
  </div>;
}
