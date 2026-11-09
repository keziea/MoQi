import type {
  Book,
  BookMeta,
  DailyStat,
  Note,
  OpenBookResult,
  Progress,
  ReadingSession,
  Settings,
} from '@shared/models';

export interface ScanProgress {
  done: number;
  total: number;
  title: string;
}

export interface AppInfoLite {
  version: string;
  dataDir: string;
  libraryDir: string;
  documents: string;
  exeDir: string;
}

export interface MoqiApi {
  library: {
    list(): Promise<BookMeta[]>;
    scan(opts?: { silent?: boolean }): Promise<BookMeta[]>;
    import(
      paths: string[]
    ): Promise<{ ok: boolean; added: number; scanned: number; titles: string[]; books: BookMeta[] }>;
    remove(bookId: string, deleteCache: boolean): Promise<{ ok: boolean; books: BookMeta[] }>;
    pickFolder(): Promise<string[] | null>;
    pickFiles(): Promise<string[] | null>;
    setCategories(bookId: string, categories: string[]): Promise<{ ok: boolean; meta?: BookMeta }>;
    switchVariant(bookId: string, format: string): Promise<{ ok: boolean; meta?: BookMeta; error?: string }>;
  };
  book: {
    open(bookId: string): Promise<OpenBookResult>;
  };
  progress: {
    get(bookId: string): Promise<Progress | null>;
    all(): Promise<Record<string, Progress>>;
    save(progress: Progress): Promise<boolean>;
  };
  note: {
    list(bookId: string): Promise<Note[]>;
    save(note: Note): Promise<Note>;
    remove(bookId: string, noteId: string): Promise<boolean>;
    export(bookId: string): Promise<string>;
    exportAll(
      mode: 'single' | 'folder'
    ): Promise<{ ok: boolean; count?: number; path?: string; error?: string; canceled?: boolean }>;
  };
  category: {
    rename(
      kind: 'book' | 'note',
      from: string,
      to: string
    ): Promise<{ ok: boolean; error?: string; books?: BookMeta[]; count?: number }>;
    remove(
      kind: 'book' | 'note',
      name: string
    ): Promise<{ ok: boolean; error?: string; books?: BookMeta[]; count?: number }>;
    setNoteColor(name: string, color: string): Promise<{ ok: boolean; error?: string }>;
  };
  session: {
    add(session: ReadingSession): Promise<boolean>;
  };
  stats: {
    get(days: number): Promise<DailyStat[]>;
    books(): Promise<Record<string, { seconds: number; notes: number }>>;
    resetBookToday(bookId: string): Promise<{ removed: number; today: number }>;
    finishedSummary(bookId: string): Promise<{
      notes: number;
      seconds: number;
      days: number;
      yearIndex: number;
      yearTotal: number;
    }>;
    totals(): Promise<{ seconds: number; days: number; notes: number; allNotes: number }>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: Partial<Settings>): Promise<Settings>;
  };
  app: {
    info(): Promise<AppInfoLite>;
    openDataDir(): Promise<boolean>;
    openPath(p: string): Promise<boolean>;
  };
  win: {
    setFullScreen(on: boolean): Promise<boolean>;
    isFullScreen(): Promise<boolean>;
  };
  on: {
    scanProgress(cb: (p: ScanProgress) => void): () => void;
  };
}

declare global {
  interface Window {
    moqi: MoqiApi;
  }
}

export const ipc: MoqiApi = window.moqi;

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.moqi;
}

export type { Book, BookMeta, DailyStat, Note, Progress, ReadingSession, Settings };
