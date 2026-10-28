import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { detectReferenceRegion, referenceKind } from './core/reference-regions.mjs';
import type { ReferenceTarget } from './types';
export interface ReferenceCrop { left: number; top: number; width: number; height: number }
interface Box { text: string; left: number; top: number; width: number; height: number }
const cache = new WeakMap<PDFDocumentProxy, Map<number, ReturnType<typeof analyzePage>>>();
async function analyzePage(pdf: PDFDocumentProxy, number: number) {
  const page = await pdf.getPage(number);
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(1.3, 1000 / natural.width, Math.sqrt(1800000 / (natural.width * natural.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const content = await page.getTextContent();
    const boxes: Box[] = content.items.filter((item): item is TextItem => 'str' in item).map(item => {
      const [a, b, c, d, x, y] = item.transform, h = Math.hypot(c, d) || item.height || 1, w = Math.hypot(a, b) || 1;
      const points = [[x - c * .22, y - d * .22], [x + item.width * a / w - c * .22, y + item.width * b / w - d * .22], [x + c, y + d], [x + item.width * a / w + c, y + item.width * b / w + d]].map(([px, py]) => viewport.convertToViewportPoint(px, py));
      const left = Math.min(...points.map(p => p[0])), top = Math.min(...points.map(p => p[1]));
      return { text: item.str, left, top, width: Math.max(...points.map(p => p[0])) - left, height: Math.max(h * scale, Math.max(...points.map(p => p[1])) - top) };
    });
    const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
    const ink = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < ink.length; i++) ink[i] = pixels[i * 4 + 3] > 0 && Math.min(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]) < 242 ? 1 : 0;
    return { width: canvas.width, height: canvas.height, ink, boxes, scale, viewport };
  } finally { canvas.width = canvas.height = 0; }
}
export async function getReferenceCrop(pdf: PDFDocumentProxy, target: ReferenceTarget): Promise<ReferenceCrop | null> {
  if (!referenceKind(target.label)) return null;
  let pages = cache.get(pdf);
  if (!pages) { pages = new Map(); cache.set(pdf, pages); }
  let analysis = pages.get(target.page);
  if (!analysis) {
    analysis = analyzePage(pdf, target.page); pages.set(target.page, analysis);
    // Bound cached raster memory on long papers.
    if (pages.size > 6) pages.delete(pages.keys().next().value!);
    void analysis.catch(() => { if (pages!.get(target.page) === analysis) pages!.delete(target.page); });
  }
  const data = await analysis;
  const point = target.y === undefined ? undefined : data.viewport.convertToViewportPoint(target.x ?? 0, target.y);
  const crop = detectReferenceRegion(data, target.label, point ? { x: point[0], y: point[1] } : undefined);
  return crop ? { left: crop.left / data.scale, top: crop.top / data.scale, width: crop.width / data.scale, height: crop.height / data.scale } : null;
}
