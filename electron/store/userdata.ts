import fs from 'node:fs';
import path from 'node:path';
import type {
  DailyStat,
  Note,
  Progress,
  ReadingSession,
  Settings,
} from '../../shared/models';
import { DEFAULT_SETTINGS } from '../../shared/models';
import { paths } from './paths';
import { readJson, writeJsonAtomic, writeTextAtomic } from './json';

type ProgressMap = Record<string, Progress>;
type NotesMap = Record<string, Note[]>;

// ───────────────────────── 进度 ─────────────────────────

export function getProgress(bookId: string): Progress | null {
  const map = readJson<ProgressMap>(paths.progress(), {});
  return map[bookId] ?? null;
}

export function saveProgress(p: Progress): void {
  const map = readJson<ProgressMap>(paths.progress(), {});
  map[p.bookId] = { ...p, updatedAt: Date.now() };
  writeJsonAtomic(paths.progress(), map);
}

export function getAllProgress(): ProgressMap {
  return readJson<ProgressMap>(paths.progress(), {});
}

// ───────────────────────── 笔记 ─────────────────────────

export function listNotes(bookId: string): Note[] {
  const map = readJson<NotesMap>(paths.notes(), {});
  const list = map[bookId] ?? [];
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

export function saveNote(note: Note): Note {
  const map = readJson<NotesMap>(paths.notes(), {});
  const list = map[note.bookId] ?? [];
  const idx = list.findIndex((n) => n.id === note.id);
  const next: Note = { ...note, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  map[note.bookId] = list;
  writeJsonAtomic(paths.notes(), map);
  return next;
}

export function removeNote(bookId: string, noteId: string): boolean {
  const map = readJson<NotesMap>(paths.notes(), {});
  const list = map[bookId] ?? [];
  const next = list.filter((n) => n.id !== noteId);
  if (next.length === list.length) return false;
  map[bookId] = next;
  writeJsonAtomic(paths.notes(), map);
  return true;
}

/** 导出为 Markdown 文件，返回路径 */
export function exportNotes(bookId: string, bookTitle: string, targetDir?: string): string {
  const notes = listNotes(bookId);
  const dir = targetDir || paths.user();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lines: string[] = [`# ${bookTitle} · 笔记`, ''];
  let lastChapter = '';
  for (const n of notes) {
    if (n.chapterTitle !== lastChapter) {
      lastChapter = n.chapterTitle;
      lines.push(`## ${lastChapter}`, '');
    }
    lines.push(`> ${n.text.replace(/\n+/g, ' ').trim()}`, '');
    if (n.comment.trim()) lines.push(n.comment.trim(), '');
    const d = new Date(n.createdAt);
    const pad = (x: number) => String(x).padStart(2, '0');
    lines.push(`*${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}*`, '');
  }

  const safe = bookTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const file = path.join(dir, `${safe}-笔记.md`);
  writeTextAtomic(file, lines.join('\n'));
  return file;
}

// ───────────────────────── 会话与统计 ─────────────────────────

export function addSession(s: ReadingSession): void {
  const list = readJson<ReadingSession[]>(paths.sessions(), []);
  const last = list[list.length - 1];
  const now = s.endedAt || Date.now();

  if (
    last &&
    last.bookId === s.bookId &&
    last.date === s.date &&
    now - last.endedAt < 10 * 60 * 1000
  ) {
    last.seconds += s.seconds;
    last.endedAt = now;
  } else {
    list.push(s);
  }

  // 只保留最近 120 天
  const cutoff = Date.now() - 120 * 24 * 3600 * 1000;
  const trimmed = list.filter((x) => x.endedAt >= cutoff);
  writeJsonAtomic(paths.sessions(), trimmed);
}

function dateKey(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return dateKey(Date.now());
}

export function getStats(days = 7): DailyStat[] {
  const sessions = readJson<ReadingSession[]>(paths.sessions(), []);
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  const allNotes = Object.values(notesMap).flat();

  const buckets = new Map<string, DailyStat>();
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKey(Date.now() - i * 24 * 3600 * 1000);
    buckets.set(key, { date: key, seconds: 0, books: [], noteCount: 0, pagesRead: 0 });
  }

  for (const s of sessions) {
    const b = buckets.get(s.date);
    if (!b) continue;
    b.seconds += s.seconds;
    const existing = b.books.find((x) => x.bookId === s.bookId);
    if (existing) existing.seconds += s.seconds;
    else b.books.push({ bookId: s.bookId, title: s.bookTitle, seconds: s.seconds });
  }

  for (const n of allNotes) {
    const key = dateKey(n.createdAt);
    const b = buckets.get(key);
    if (b) b.noteCount += 1;
  }

  return [...buckets.values()];
}

export function getTodayStat(): DailyStat {
  return getStats(1)[0] ?? { date: todayKey(), seconds: 0, books: [], noteCount: 0, pagesRead: 0 };
}

export function getTotals(): { seconds: number; days: number; notes: number } {
  const sessions = readJson<ReadingSession[]>(paths.sessions(), []);
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  const daySet = new Set(sessions.map((s) => s.date));
  return {
    seconds: sessions.reduce((sum, s) => sum + s.seconds, 0),
    days: daySet.size,
    notes: Object.values(notesMap).reduce((sum, list) => sum + list.length, 0),
  };
}

/** 每本书的累计阅读秒数与笔记数 */
export interface FinishedSummary {
  notes: number;
  seconds: number;
  days: number;
  /** 这是今年读完的第几本（按 finishedAt 排序） */
  yearIndex: number;
  /** 今年一共读完几本 */
  yearTotal: number;
}

/** 读完一本书时用来生成庆祝数据 */
export function getFinishedSummary(bookId: string): FinishedSummary {
  const sessions = readJson<ReadingSession[]>(paths.sessions(), []);
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  const progressMap = readJson<ProgressMap>(paths.progress(), {});

  const mine = sessions.filter((s) => s.bookId === bookId);
  const seconds = mine.reduce((a, b) => a + b.seconds, 0);
  const days = new Set(mine.map((s) => s.date)).size;
  const notes = (notesMap[bookId] ?? []).length;

  const year = new Date().getFullYear();
  const finishedThisYear = Object.values(progressMap)
    .filter((p) => p.finished && p.finishedAt && new Date(p.finishedAt).getFullYear() === year)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));

  const idx = finishedThisYear.findIndex((p) => p.bookId === bookId);
  return {
    notes,
    seconds,
    days,
    yearIndex: idx >= 0 ? idx + 1 : finishedThisYear.length,
    yearTotal: finishedThisYear.length,
  };
}

/** 撤销「今天 · 这本书」的全部阅读时长，返回被扣掉的秒数 */
export function resetBookToday(bookId: string): number {
  const list = readJson<ReadingSession[]>(paths.sessions(), []);
  const today = todayKey();
  let removed = 0;
  const next = list.filter((s) => {
    if (s.bookId === bookId && s.date === today) {
      removed += s.seconds;
      return false;
    }
    return true;
  });
  if (removed > 0) writeJsonAtomic(paths.sessions(), next);
  return removed;
}

export function getBookStats(): Record<string, { seconds: number; notes: number }> {
  const sessions = readJson<ReadingSession[]>(paths.sessions(), []);
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  const out: Record<string, { seconds: number; notes: number }> = {};
  const bump = (id: string) => {
    if (!out[id]) out[id] = { seconds: 0, notes: 0 };
    return out[id];
  };
  for (const s of sessions) bump(s.bookId).seconds += s.seconds;
  for (const [bookId, list] of Object.entries(notesMap)) bump(bookId).notes = list.length;
  return out;
}

/** 全书库的所有笔记（导出用） */
export function getAllNotes(): Note[] {
  const map = readJson<NotesMap>(paths.notes(), {});
  return Object.values(map).flat();
}

export function getAllNotesCount(): number {
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  return Object.values(notesMap).reduce((sum, l) => sum + l.length, 0);
}

// ───────────────────────── 设置 ─────────────────────────

/** 分类改名：把所有笔记上的旧分类名换成新的 */
export function renameNoteCategory(from: string, to: string): number {
  const map = readJson<NotesMap>(paths.notes(), {});
  let n = 0;
  for (const list of Object.values(map)) {
    for (const note of list) {
      if (note.category === from) {
        note.category = to;
        note.updatedAt = Date.now();
        n += 1;
      }
    }
  }
  if (n) writeJsonAtomic(paths.notes(), map);
  return n;
}

/** 删除分类：相关笔记退回「未分类」，笔记本身不删 */
export function removeNoteCategory(name: string): number {
  const map = readJson<NotesMap>(paths.notes(), {});
  let n = 0;
  for (const list of Object.values(map)) {
    for (const note of list) {
      if (note.category === name) {
        delete note.category;
        note.updatedAt = Date.now();
        n += 1;
      }
    }
  }
  if (n) writeJsonAtomic(paths.notes(), map);
  return n;
}

export function getSettings(): Settings {
  const raw = readJson<Partial<Settings>>(paths.settings(), {});

  // v1 → v2：分页成为默认阅读方式。
  // v1 没有「翻页方式」入口，存档里的 pageMode: 'scroll' 只是当时的默认值，
  // 不是用户选择；升级时一次性改为 paged，此后用户手动选择的 scroll 会保留。
  if ((raw.dataVersion ?? 1) < 2) {
    raw.pageMode = 'paged';
    raw.dataVersion = 2;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    dataVersion: DEFAULT_SETTINGS.dataVersion,
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = { ...cur, ...patch, dataVersion: DEFAULT_SETTINGS.dataVersion };
  writeJsonAtomic(paths.settings(), next);
  return next;
}

// ───────────────────── 个人数据导入 / 导出 ─────────────────────
//
// 只搬 data/user/ 下的三个文件：progress / notes / sessions。
// 书籍本体、书架索引、解析缓存都不动 —— 那些可以重新扫描生成。
// 详细规则见 docs/03-数据模型与存储.md §7。

const USER_FILES = ['progress.json', 'notes.json', 'sessions.json'] as const;
type UserFile = (typeof USER_FILES)[number];

export interface DataCounts {
  books: number;
  notes: number;
  days: number;
  sessions: number;
}

export type ImportFailReason = 'not-moqi-data' | 'empty' | 'read-error';

export type ImportResult =
  | { ok: true; counts: DataCounts; merged: DataCounts; backupDir: string; source: string }
  | { ok: false; canceled?: boolean; reason?: ImportFailReason; detail?: string };

export type ExportResult =
  | { ok: true; dir: string; counts: DataCounts }
  | { ok: false; canceled?: boolean; detail?: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayStamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function minuteStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

export function countUserData(): DataCounts {
  const progressMap = readJson<ProgressMap>(paths.progress(), {});
  const notesMap = readJson<NotesMap>(paths.notes(), {});
  const sessions = readJson<ReadingSession[]>(paths.sessions(), []);
  return {
    books: Object.keys(progressMap).length,
    notes: Object.values(notesMap).reduce((sum, list) => sum + list.length, 0),
    days: new Set(sessions.map((s) => s.date)).size,
    sessions: sessions.length,
  };
}

/** 导出：在用户选的目录里新建「墨栖个人数据-日期」，复制三个文件并写一份白话说明 */
export function exportUserData(targetParent: string, appVersion: string): ExportResult {
  try {
    const date = dayStamp();
    let dir = path.join(targetParent, `墨栖个人数据-${date}`);
    let n = 2;
    while (fs.existsSync(dir)) dir = path.join(targetParent, `墨栖个人数据-${date}-${n++}`);

    fs.mkdirSync(dir, { recursive: true });

    for (const file of USER_FILES) {
      const src = path.join(paths.user(), file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file));
    }

    const guide = [
      '这是「墨栖」的个人阅读数据备份。',
      `导出于 ${date} · 软件版本 ${appVersion}`,
      '',
      '怎么恢复：',
      '1. 打开墨栖，点右上角「数据备份」按钮',
      '2. 点「导入我的数据」',
      '3. 选中这个文件夹（选它的上一层也可以），确定',
      '4. 看到「个人数据导入成功」就好了',
      '',
      '请不要修改里面的 .json 文件。',
      '',
    ].join('\n');
    writeTextAtomic(path.join(dir, '导入说明.txt'), guide);

    return { ok: true, dir, counts: countUserData() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 在任意一层目录里找三个数据文件，最多向下 3 层 */
function locateDataFiles(root: string): Partial<Record<UserFile, string>> {
  const found: Partial<Record<UserFile, string>> = {};
  const priorities = ['user', 'data', '墨栖个人数据'];

  const visit = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name as UserFile;
      if (USER_FILES.includes(name) && !found[name]) found[name] = path.join(dir, entry.name);
    }

    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        const rank = (name: string): number => {
          const i = priorities.findIndex((p) => name.startsWith(p));
          return i < 0 ? priorities.length : i;
        };
        return rank(a.name) - rank(b.name);
      });

    for (const d of dirs) visit(path.join(dir, d.name), depth + 1);
  };

  visit(root, 0);
  return found;
}

function isProgressMap(value: unknown): value is ProgressMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const o = item as Record<string, unknown>;
    return (
      typeof o.bookId === 'string' &&
      typeof o.chapterId === 'string' &&
      typeof o.blockId === 'string' &&
      typeof o.ratio === 'number' &&
      typeof o.updatedAt === 'number'
    );
  });
}

function isNotesMap(value: unknown): value is NotesMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((list) => {
    if (!Array.isArray(list)) return false;
    return list.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const o = item as Record<string, unknown>;
      return (
        typeof o.id === 'string' &&
        typeof o.bookId === 'string' &&
        typeof o.text === 'string' &&
        typeof o.createdAt === 'number' &&
        Array.isArray(o.ranges)
      );
    });
  });
}

function isSessionList(value: unknown): value is ReadingSession[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.bookId === 'string' &&
      typeof o.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
      typeof o.seconds === 'number'
    );
  });
}

function backupCurrentUserData(): string {
  const dir = path.join(paths.user(), `_backup-${minuteStamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of USER_FILES) {
    const src = path.join(paths.user(), file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file));
  }
  return dir;
}

/** 导入：认任意一层目录，结构不合格就整包拒绝 */
export function importUserData(sourceDir: string): ImportResult {
  const located = locateDataFiles(sourceDir);
  const hits = Object.values(located).filter(Boolean) as string[];

  if (hits.length === 0) {
    return {
      ok: false,
      reason: 'not-moqi-data',
      detail: '没有找到 progress.json / notes.json / sessions.json',
    };
  }

  const incomingProgress: ProgressMap = {};
  const incomingNotes: NotesMap = {};
  const incomingSessions: ReadingSession[] = [];
  let readError = '';

  if (located['progress.json']) {
    const raw = readJson<unknown>(located['progress.json'], null);
    if (isProgressMap(raw)) Object.assign(incomingProgress, raw);
    else if (raw === null) readError = 'progress.json';
  }
  if (located['notes.json']) {
    const raw = readJson<unknown>(located['notes.json'], null);
    if (isNotesMap(raw)) Object.assign(incomingNotes, raw);
    else if (raw === null) readError = readError || 'notes.json';
  }
  if (located['sessions.json']) {
    const raw = readJson<unknown>(located['sessions.json'], null);
    if (isSessionList(raw)) incomingSessions.push(...raw);
    else if (raw === null) readError = readError || 'sessions.json';
  }

  const incomingCounts: DataCounts = {
    books: Object.keys(incomingProgress).length,
    notes: Object.values(incomingNotes).reduce((sum, list) => sum + list.length, 0),
    days: new Set(incomingSessions.map((s) => s.date)).size,
    sessions: incomingSessions.length,
  };

  const hasAny = incomingCounts.books + incomingCounts.notes + incomingCounts.sessions > 0;
  if (!hasAny) {
    return {
      ok: false,
      reason: readError ? 'read-error' : 'empty',
      detail: readError ? `${readError} 解析失败` : '三个文件都没有有效条目',
    };
  }

  try {
    const backupDir = backupCurrentUserData();

    const currentProgress = readJson<ProgressMap>(paths.progress(), {});
    const currentNotes = readJson<NotesMap>(paths.notes(), {});
    const currentSessions = readJson<ReadingSession[]>(paths.sessions(), []);

    const mergedProgress: ProgressMap = { ...currentProgress };
    for (const [bookId, item] of Object.entries(incomingProgress)) {
      const old = mergedProgress[bookId];
      if (!old || item.updatedAt > old.updatedAt) mergedProgress[bookId] = item;
    }

    const mergedNotes: NotesMap = {};
    for (const [bookId, list] of Object.entries(currentNotes)) mergedNotes[bookId] = [...list];
    for (const [bookId, list] of Object.entries(incomingNotes)) {
      const target = mergedNotes[bookId] ?? (mergedNotes[bookId] = []);
      const index = new Map(target.map((n) => [n.id, n] as const));
      for (const note of list) {
        const old = index.get(note.id);
        if (!old) {
          target.push(note);
          index.set(note.id, note);
        } else if ((note.updatedAt ?? 0) > (old.updatedAt ?? 0)) {
          target[target.indexOf(old)] = note;
          index.set(note.id, note);
        }
      }
    }

    const mergedSessions = [...currentSessions];
    const seen = new Set(mergedSessions.map((s) => s.id));
    for (const session of incomingSessions) {
      if (!seen.has(session.id)) {
        mergedSessions.push(session);
        seen.add(session.id);
      }
    }
    mergedSessions.sort((a, b) => a.startedAt - b.startedAt);

    writeJsonAtomic(paths.progress(), mergedProgress);
    writeJsonAtomic(paths.notes(), mergedNotes);
    writeJsonAtomic(paths.sessions(), mergedSessions);

    return {
      ok: true,
      counts: incomingCounts,
      merged: countUserData(),
      backupDir: path.basename(backupDir),
      source: sourceDir,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'read-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
