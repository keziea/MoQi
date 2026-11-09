import { create } from 'zustand';
import type { Book, HighlightColor, Note, Progress, ReadMark, TextRange } from '@shared/models';
import { ipc } from '@/lib/ipc';
import { useLibrary } from './useLibrary';

/** 进度一变就同步到书架缓存：退出阅读页时书卡上的状态才是最新的 */
function syncToLibrary(bookId: string, p: Progress) {
  useLibrary.setState((s) => ({ progressMap: { ...s.progressMap, [bookId]: p } }));
}

export type PanelKind = 'toc' | 'notes' | 'stats' | 'settings' | 'search' | null;

export interface LocateTarget {
  chapterId: string;
  blockId?: string;
  /** 用于触发重复跳转 */
  nonce: number;
  /** 跳转后是否做呼吸提示 */
  breathe?: boolean;
}

interface ReaderState {
  book: Book | null;
  bookId: string | null;
  loading: boolean;
  error: string | null;

  progress: Progress | null;
  notes: Note[];
  panel: PanelKind;
  locate: LocateTarget | null;

  open: (bookId: string) => Promise<void>;
  close: () => void;
  setPanel: (p: PanelKind) => void;
  reloadNotes: () => Promise<void>;

  patchProgress: (patch: Partial<Progress>) => void;
  setMark: (mark: ReadMark) => void;
  clearMark: () => void;

  createNote: (input: {
    chapterId: string;
    chapterTitle: string;
    ranges: TextRange[];
    text: string;
    comment: string;
    color: HighlightColor;
    kind: 'selection' | 'paragraph';
    category?: string;
    title?: string;
  }) => Promise<Note | null>;
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'comment' | 'color' | 'category' | 'title'>>
  ) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  jumpTo: (chapterId: string, blockId?: string, breathe?: boolean) => void;
}

let progressTimer: number | null = null;
let pendingProgress: Progress | null = null;

function flushProgress() {
  if (!pendingProgress) return;
  const p = pendingProgress;
  pendingProgress = null;
  ipc.progress.save(p).catch(() => {});
}

export const useReader = create<ReaderState>((set, get) => ({
  book: null,
  bookId: null,
  loading: false,
  error: null,
  progress: null,
  notes: [],
  panel: null,
  locate: null,

  open: async (bookId) => {
    set({ loading: true, error: null, book: null, bookId, notes: [], progress: null, panel: null });
    try {
      const [res, prog, notes] = await Promise.all([
        ipc.book.open(bookId),
        ipc.progress.get(bookId),
        ipc.note.list(bookId),
      ]);
      if (!res.ok || !res.book) {
        set({ loading: false, error: res.error ?? '这本书打不开' });
        return;
      }

      // 打开过就算「在读」：写一个 openedAt 标记。
      // 之前用 ratio > 0 判定，导致刚打开、还没往下翻时仍显示「未读」。
      const now = Date.now();
      let next: Progress;
      if (prog) {
        next = prog.openedAt ? prog : { ...prog, openedAt: now };
      } else {
        const firstCh = res.book.chapters[0];
        next = {
          bookId,
          chapterId: firstCh?.id ?? '',
          blockId: firstCh?.blocks[0]?.id ?? '',
          delta: 0,
          ratio: 0,
          updatedAt: now,
          openedAt: now,
        };
      }
      if (!prog || !prog.openedAt) ipc.progress.save(next).catch(() => {});

      set({ book: res.book, progress: next, notes, loading: false });
      syncToLibrary(bookId, next);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '打开失败' });
    }
  },

  close: () => {
    flushProgress();
    set({ book: null, bookId: null, progress: null, notes: [], panel: null, error: null });
  },

  setPanel: (panel) => set({ panel }),

  reloadNotes: async () => {
    const id = get().bookId;
    if (!id) return;
    const notes = await ipc.note.list(id);
    set({ notes });
  },

  patchProgress: (patch) => {
    const cur = get().progress;
    const bookId = get().bookId;
    if (!bookId) return;
    const next: Progress = {
      // 必须继承原进度：否则每次滚动都会把 finished / finishedAt / openedAt 抹掉，
      // 表现就是「标记读完的书，一翻又变回在读了」。
      ...(cur ?? {}),
      // 把 patch 里的 finished / finishedAt / openedAt 也带上：
      // 阅读页的「标记读完」走的就是这个入口。
      ...patch,
      bookId,
      chapterId: patch.chapterId ?? cur?.chapterId ?? '',
      blockId: patch.blockId ?? cur?.blockId ?? '',
      delta: patch.delta ?? cur?.delta ?? 0,
      ratio: patch.ratio ?? cur?.ratio ?? 0,
      updatedAt: Date.now(),
      mark: patch.mark !== undefined ? patch.mark : cur?.mark,
      pageIndex: patch.pageIndex !== undefined ? patch.pageIndex : cur?.pageIndex,
    };
    set({ progress: next });
    syncToLibrary(bookId, next);
    pendingProgress = next;
    if (progressTimer) window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(flushProgress, 420);
  },

  setMark: (mark) => {
    const cur = get().progress;
    const bookId = get().bookId;
    if (!bookId) return;
    const next: Progress = {
      ...(cur ?? {}),
      bookId,
      chapterId: mark.chapterId,
      blockId: mark.blockId,
      delta: 0,
      ratio: mark.ratio,
      updatedAt: Date.now(),
      mark,
      ...(cur?.pageIndex !== undefined ? { pageIndex: cur.pageIndex } : {}),
    };
    set({ progress: next });
    syncToLibrary(next.bookId, next);
    pendingProgress = next;
    if (progressTimer) window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(flushProgress, 120);
  },

  clearMark: () => {
    const cur = get().progress;
    if (!cur) return;
    const next: Progress = { ...cur, mark: undefined, updatedAt: Date.now() };
    set({ progress: next });
    syncToLibrary(next.bookId, next);
    pendingProgress = next;
    if (progressTimer) window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(flushProgress, 120);
  },

  createNote: async (input) => {
    const bookId = get().bookId;
    if (!bookId) return null;
    const now = Date.now();
    const note: Note = {
      id: `n_${now}_${Math.random().toString(36).slice(2, 7)}`,
      bookId,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      ranges: input.ranges,
      text: input.text,
      comment: input.comment,
      color: input.color,
      kind: input.kind,
      category: input.category || undefined,
      title: input.title || undefined,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const saved = await ipc.note.save(note);
      set((s) => ({ notes: [...s.notes, saved] }));
      return saved;
    } catch {
      return null;
    }
  },

  updateNote: async (id, patch) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const next: Note = { ...note, ...patch, updatedAt: Date.now() };
    const saved = await ipc.note.save(next);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? saved : n)) }));
  },

  deleteNote: async (id) => {
    const bookId = get().bookId;
    if (!bookId) return;
    await ipc.note.remove(bookId, id);
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },

  jumpTo: (chapterId, blockId, breathe = true) => {
    set({ locate: { chapterId, blockId, nonce: Date.now(), breathe } });
  },
}));

export function flushReaderProgress() {
  if (progressTimer) window.clearTimeout(progressTimer);
  flushProgress();
}
