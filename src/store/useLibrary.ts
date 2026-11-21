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
      // 只读现有书库，不要因为「现在没书」就自动扫描。
      // 空书架应该立刻回到「导入第一本书」的初始样式，而不是卡在“正在整理书库”。
      set({
        books,
        progressMap,
        loading: false,
        scanning: false,
        scanProgress: null,
        error: null,
      });
    } catch (e) {
      set({
        loading: false,
        scanning: false,
        scanProgress: null,
        error: e instanceof Error ? e.message : '书库加载失败',
      });
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
      set({ books: r.books, scanning: false, scanProgress: null, error: null });
      if (!r.ok) toast('没有找到可导入的书');
      else if (r.added > 0) toast(`已导入 ${r.added} 本书`);
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
    try {
      const r = await ipc.library.remove(bookId, deleteCache);
      if (r.ok) {
        // 删掉最后一本书也要马上回到空书架；不能残留任何“整理中”状态
        set({ books: r.books, scanning: false, scanProgress: null, error: null });
        toast('已从书架移除');
      } else {
        toast('没有找到这本书');
      }
    } catch {
      set({ scanning: false, scanProgress: null });
      toast('移除失败，请稍后再试');
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
