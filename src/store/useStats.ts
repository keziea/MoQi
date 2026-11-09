import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { todayStr } from '@/lib/format';

interface StatsState {
  /** 本次会话累计秒数（含小数） */
  activeSeconds: number;
  /** 今日累计秒数（含本次） */
  todaySeconds: number;
  /** 本书今日累计秒数（含本次） */
  bookTodaySeconds: number;
  running: boolean;
  /** 用户手动暂停；窗口失焦的自动暂停不算 */
  manualPaused: boolean;
  bookId: string | null;
  bookTitle: string;
  ready: boolean;

  init: () => Promise<void>;
  start: (bookId: string, bookTitle: string) => void;
  /** manual=true 表示用户按了暂停，失焦/回到窗口不应自动恢复 */
  pause: (manual?: boolean) => void;
  /** manual=true 表示用户按了继续，会清掉手动暂停 */
  resume: (manual?: boolean) => void;
  toggle: () => void;
  /** 只清零「本次」计时，今日累计保留 */
  reset: () => Promise<void>;
  stop: () => void;
  markActivity: () => void;
  refreshToday: () => Promise<void>;
}

let ticker: number | null = null;
let flusher: number | null = null;
let sentSeconds = 0;
let lastTick = 0;
let lastActivity = Date.now();
let sessionStart = Date.now();
/** 防止 start/stop/init 的异步统计结果互相覆盖 */
let generation = 0;

const IDLE_LIMIT = 3 * 3600 * 1000;

async function fetchToday(
  bookId: string | null,
  bookTitle?: string,
): Promise<{ today: number; book: number }> {
  const stats = await ipc.stats.get(1);
  const today = stats[0];
  const title = bookTitle?.trim();
  const book = bookId
    ? (today?.books ?? [])
        .filter((b) => b.bookId === bookId || (!!title && b.title.trim() === title))
        .reduce((sum, b) => sum + b.seconds, 0)
    : 0;
  return { today: today?.seconds ?? 0, book };
}

function flush(get: () => StatsState) {
  const { activeSeconds, bookId, bookTitle } = get();
  const delta = Math.floor(activeSeconds - sentSeconds);
  if (delta <= 0 || !bookId) return;
  sentSeconds += delta;
  const now = Date.now();
  ipc.session
    .add({
      id: `s_${now}_${Math.random().toString(36).slice(2, 7)}`,
      bookId,
      bookTitle,
      date: todayStr(),
      startedAt: sessionStart,
      endedAt: now,
      seconds: delta,
    })
    .catch(() => {});
}

function clearTimers() {
  if (ticker) {
    window.clearInterval(ticker);
    ticker = null;
  }
  if (flusher) {
    window.clearInterval(flusher);
    flusher = null;
  }
}

export const useStats = create<StatsState>((set, get) => ({
  activeSeconds: 0,
  todaySeconds: 0,
  bookTodaySeconds: 0,
  running: false,
  manualPaused: false,
  bookId: null,
  bookTitle: '',
  ready: false,

  init: async () => {
    const gen = ++generation;
    try {
      const { today } = await fetchToday(null);
      if (gen === generation && !get().bookId) set({ todaySeconds: today, ready: true });
    } catch {
      if (gen === generation) set({ ready: true });
    }
  },

  start: (bookId, bookTitle) => {
    const gen = ++generation;
    sentSeconds = 0;
    lastTick = Date.now();
    lastActivity = Date.now();
    sessionStart = Date.now();
    clearTimers();
    set({
      activeSeconds: 0,
      todaySeconds: 0,
      bookTodaySeconds: 0,
      running: true,
      manualPaused: false,
      bookId,
      bookTitle,
      ready: false,
    });

    fetchToday(bookId, bookTitle)
      .then(({ today, book }) => {
        if (gen !== generation) return;
        const active = get().activeSeconds;
        set({
          todaySeconds: today + active,
          bookTodaySeconds: book + active,
          ready: true,
        });
      })
      .catch(() => {
        if (gen === generation) set({ ready: true });
      });

    ticker = window.setInterval(() => {
      const s = get();
      if (!s.running) {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      const delta = Math.min(2, (now - lastTick) / 1000);
      lastTick = now;
      if (now - lastActivity > IDLE_LIMIT) return;
      set((st) => ({
        activeSeconds: st.activeSeconds + delta,
        todaySeconds: st.todaySeconds + delta,
        bookTodaySeconds: st.bookTodaySeconds + delta,
      }));
    }, 1000);

    flusher = window.setInterval(() => flush(get), 30000);
  },

  pause: (manual = false) => {
    if (manual) set({ manualPaused: true });
    if (!get().running) return;
    flush(get);
    set({ running: false });
  },

  resume: (manual = false) => {
    if (manual) set({ manualPaused: false });
    else if (get().manualPaused) return;
    if (get().running) return;
    lastTick = Date.now();
    lastActivity = Date.now();
    set({ running: true });
  },

  toggle: () => {
    if (get().running) get().pause(true);
    else get().resume(true);
  },

  reset: async () => {
    const { bookId } = get();
    flush(get);
    sentSeconds = 0;
    sessionStart = Date.now();
    lastTick = Date.now();
    lastActivity = Date.now();
    set({ activeSeconds: 0 });

    // 真正把「今天 · 这本书」的时间退回，并允许今日目标庆祝重新触发
    try {
      localStorage.removeItem(`moqi:goal-fired:${todayStr()}`);
    } catch {
      /* ignore */
    }
    if (bookId) {
      try {
        const r = await ipc.stats.resetBookToday(bookId);
        set({ todaySeconds: r.today });
      } catch {
        /* ignore */
      }
    }
  },

  stop: () => {
    const gen = ++generation;
    flush(get);
    clearTimers();
    set({
      running: false,
      manualPaused: false,
      bookId: null,
      bookTitle: '',
      activeSeconds: 0,
      bookTodaySeconds: 0,
    });
    fetchToday(null)
      .then(({ today }) => {
        if (gen === generation) set({ todaySeconds: today, ready: true });
      })
      .catch(() => {
        if (gen === generation) set({ ready: true });
      });
  },

  markActivity: () => {
    lastActivity = Date.now();
  },

  refreshToday: async () => {
    if (get().running) return;
    const gen = generation;
    const { bookId, bookTitle } = get();
    try {
      const { today, book } = await fetchToday(bookId, bookTitle);
      if (gen === generation) {
        set({ todaySeconds: today, bookTodaySeconds: book, ready: true });
      }
    } catch {
      /* ignore */
    }
  },
}));
