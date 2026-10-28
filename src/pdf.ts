import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { indexText } from './core/search.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { IndexedPage, ReferenceTarget } from './types';
GlobalWorkerOptions.workerSrc = workerUrl;
export function loadPdf(bytes: Uint8Array) {
  const base = new URL('.', window.location.href).href;
  return getDocument({ data: bytes, cMapUrl: base + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
}
export async function buildIndex(pdf: PDFDocumentProxy, onProgress: (n: number) => void, isCancelled: () => boolean) {
  const pages: IndexedPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (isCancelled()) return [];
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(indexText(n, content.items) as IndexedPage);
    onProgress(n);
    // Yield regularly while indexing large documents.
    if (n % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return pages;
}
export async function resolveDestination(pdf: PDFDocumentProxy, destination: string | unknown[], label = 'Reference'): Promise<ReferenceTarget | null> {
  const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
  if (!dest) return null;
  const page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0] as { num: number; gen: number })) + 1;
  const kind = (dest[1] as { name?: string })?.name;
  return { page, label,
    x: kind === 'XYZ' && typeof dest[2] === 'number' ? dest[2] : undefined,
    y: kind === 'XYZ' && typeof dest[3] === 'number' ? dest[3] : kind === 'FitH' && typeof dest[2] === 'number' ? dest[2] : undefined };
}
