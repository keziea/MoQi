import { create } from 'zustand';
import type { BookMeta, Progress } from '@shared/models';
import { ipc } from '@/lib/ipc';
import { toast } from '@/lib/toast';

interface ScanProgress {
  done: number;
  total: number;
  title: string;
}

interface LibraryState {
  books: BookMeta[];
  progressMap: Record<string, Progress>;
  loading: boolean;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  error: string | null;

  load: () => Promise<void>;
  scan: (silent?: boolean) => Promise<void>;
  refreshProgress: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  pickAndImport: (mode?: 'file' | 'folder') => Promise<void>;
  remove: (bookId: string, deleteCache: boolean) => Promise<void>;
  touch: (bookId: string, patch: Partial<BookMeta>) => void;
  applyCategories: (bookId: string, categories: string[]) => void;
}

export const useLibrary = create<LibraryState>((set) => ({
  books: [],
  progressMap: {},
  loading: true,
  scanning: false,
  scanProgress: null,
  error: null,

  load: async () => {
    try {
      const [books, progressMap] = await Promise.all([ipc.library.list(), ipc.progress.all()]);
      set({ books, progressMap, loading: false });
      if (books.length === 0) {
        set({ scanning: true });
        const scanned = await ipc.library.scan({ silent: false });
        const pm = await ipc.progress.all();
        set({ books: scanned, progressMap: pm, scanning: false, scanProgress: null });
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '书库加载失败' });
    }
  },

  scan: async (silent = false) => {
    set({ scanning: true });
    try {
      const books = await ipc.library.scan({ silent });
      const progressMap = await ipc.progress.all();
      set({ books, progressMap, scanning: false, scanProgress: null });
    } catch {
      set({ scanning: false, scanProgress: null });
    }
  },

  refreshProgress: async () => {
    try {
      const progressMap = await ipc.progress.all();
      set({ progressMap });
    } catch {
      /* ignore */
    }
  },

  importPaths: async (paths) => {
    if (!paths.length) return;
    set({ scanning: true });
    try {
      const r = await ipc.library.import(paths);
      set({ books: r.books, scanning: false });
      if (r.added > 0) toast(`已导入 ${r.added} 本书`);
      else toast('这些书已经在书架上了');
    } catch {
      set({ scanning: false });
      toast('导入失败，请检查文件或文件夹是否可读');
    }
  },

  pickAndImport: async (mode = 'file') => {
    // 「导入文件」和「导入文件夹」分开走，取消时不再弹第二个对话框
    if (mode === 'file') {
      const files = await ipc.library.pickFiles();
      if (files?.length) await useLibrary.getState().importPaths(files);
      return;
    }
    const dirs = await ipc.library.pickFolder();
    if (dirs?.length) await useLibrary.getState().importPaths(dirs);
  },

  remove: async (bookId, deleteCache) => {
    const r = await ipc.library.remove(bookId, deleteCache);
    if (r.ok) {
      set({ books: r.books });
      toast('已从书架移除');
    }
  },

  touch: (bookId, patch) => {
    set((s) => ({
      books: s.books.map((b) => (b.id === bookId ? { ...b, ...patch } : b)),
    }));
  },

  applyCategories: (bookId, categories) => {
    set((s) => ({
      books: s.books.map((b) => (b.id === bookId ? { ...b, categories } : b)),
    }));
  },
}));
