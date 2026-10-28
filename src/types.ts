import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
export interface LibraryEntry {
  id: string; filename: string; title: string; author?: string; bibtex?: string; doi?: string;
  addedAt: string; lastOpenedAt: string; size: number; page: number; pageCount?: number;
}
export interface OpenedFile { token: string; filename: string; bytes: Uint8Array; entry?: LibraryEntry }
export interface DesktopAPI {
  platform: string;
  checkForUpdates(): Promise<void>;
  setTheme(theme: 'light' | 'dark'): Promise<void>;
  open(): Promise<OpenedFile | null>;
  openDropped(file: File): Promise<OpenedFile>;
  pending(): Promise<OpenedFile | null>;
  release(token: string): Promise<void>;
  list(): Promise<LibraryEntry[]>;
  load(id: string): Promise<OpenedFile>;
  save(token: string, metadata: Partial<LibraryEntry>): Promise<LibraryEntry>;
  update(id: string, patch: Partial<LibraryEntry>): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
  exportPdf(token: string): Promise<void>;
  exportBibtex(title: string, bibtex: string): Promise<void>;
  importBibtex(): Promise<string | null>;
  external(url: string): Promise<void>;
  print(token: string): Promise<void>;
  onOpen(callback: (action?: string) => void): () => void;
}
declare global { interface Window { apdf: DesktopAPI } }
export interface IndexedPage {
  page: number; text: string; items: Array<TextItem & { start: number; end: number }>;
}
export interface SearchMatch { page: number; start: number; end: number; snippet: string; snippetStart: number }
export interface SearchOptions { caseSensitive: boolean; regex: boolean }
export interface ReferenceTarget { page: number; x?: number; y?: number; label: string }
export interface OutlineItem { title: string; dest: string | unknown[] | null; items: OutlineItem[] }
export interface DocumentState {
  file: OpenedFile; pdf: PDFDocumentProxy; title: string; author: string; entry?: LibraryEntry;
}
