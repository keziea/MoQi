import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_NOTE_CATEGORIES } from '../../shared/models';
import type {
  BookMeta,
  DailyStat,
  HighlightColor,
  Note,
  OpenBookResult,
  Progress,
  ReadingSession,
  Settings,
} from '../../shared/models';
import {
  paths,
  ensureDirs,
  logError,
  DATA_DIR_NAME,
  configDir,
  effectiveDefaultDataDir,
  getDataRootInfo,
  getPreviousDataDir,
  programDir,
} from '../store/paths';
import {
  makeBookId,
  pickBest,
  readLibrary,
  refreshLibrary,
  removeBook,
  removeCategoryFromBooks,
  renameCategoryInBooks,
  scanForBooks,
  updateBookMeta,
  writeLibrary,
} from '../store/library';
import { loadBookContent, titleFromFileName } from '../parsers';
import {
  addSession,
  exportNotes,
  getAllNotesCount,
  getAllProgress,
  getProgress,
  getSettings,
  getBookStats,
  getAllNotes,
  getFinishedSummary,
  getStats,
  resetBookToday,
  getTotals,
  listNotes,
  removeNote,
  removeNoteCategory,
  renameNoteCategory,
  saveNote,
  saveProgress,
  saveSettings,
} from '../store/userdata';
import { defaultBackupName, exportBackup, getBackupStats, restoreBackup } from '../store/backup';
import { adoptExternalBooks } from '../store/migrate';
import {
  cancelPendingCleanup,
  cleanupNow,
  getPendingCleanup,
  planDataLocation,
  relocateData,
} from '../store/location';
import type {
  ExistingAction,
  LocationPlan,
  RelocateMode,
  RelocateResult,
} from '../store/location';

let mainWindow: BrowserWindow | null = null;
let scanning = false;

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win;
}

/** 备份进度：窗口可能在长任务中途被关掉，send 之前先确认还活着 */
function sendBackupProgress(payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('backup:progress', payload);
  } catch {
    /* 窗口正在销毁，忽略 */
  }
}

function sendLocationProgress(payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('location:progress', payload);
  } catch {
    /* ignore */
  }
}

let relaunchTimer: NodeJS.Timeout | null = null;

/** 迁移完数据要重启，让所有模块按新路径重新初始化 */
function scheduleRelaunch(): void {
  if (relaunchTimer) return;
  relaunchTimer = setTimeout(() => {
    relaunchTimer = null;
    app.relaunch();
    app.exit(0);
  }, 1400);
}

function stamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function showMessage(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  if (mainWindow && !mainWindow.isDestroyed()) return dialog.showMessageBox(mainWindow, options);
  return dialog.showMessageBox(options);
}

async function showOpenDialog(
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  if (mainWindow && !mainWindow.isDestroyed()) return dialog.showOpenDialog(mainWindow, options);
  return dialog.showOpenDialog(options);
}

async function showSaveDialog(
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  if (mainWindow && !mainWindow.isDestroyed()) return dialog.showSaveDialog(mainWindow, options);
  return dialog.showSaveDialog(options);
}

function renameTargetName(name: string): string | null {
  const base = path
    .basename(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!base) return null;
  if (base.toLowerCase() === DATA_DIR_NAME.toLowerCase()) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base)) return null;
  return base;
}

/** 给「重命名」选项一个同层的名字输入框（保存对话框只用来取名，不写文件） */
async function askRename(
  plan: LocationPlan
): Promise<{ action: 'rename'; renameTo: string } | null> {
  const parent = path.dirname(plan.root);
  const suggested = path.join(parent, `${DATA_DIR_NAME}-old-${stamp()}`);
  const picked = await showSaveDialog({
    title: '给已有数据起个新名字',
    buttonLabel: '用这个名字',
    defaultPath: suggested,
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (picked.canceled || !picked.filePath) return null;

  const resolved = path.resolve(picked.filePath);
  if (path.dirname(resolved).toLowerCase() !== parent.toLowerCase()) {
    await showMessage({
      type: 'warning',
      title: '只能在同一层改名',
      message: '旧数据必须留在原来的文件夹里，只能改它自己的名字。',
      detail: `请选择 ${parent} 这一层里的名字。`,
      buttons: ['知道了'],
    });
    return null;
  }

  const name = renameTargetName(path.basename(resolved));
  if (!name) {
    await showMessage({
      type: 'warning',
      title: '这个名字不能用',
      message: '名字不能为空，不能叫 MoQiData，也不能用 Windows 保留名或非法字符。',
      buttons: ['知道了'],
    });
    return null;
  }

  if (fs.existsSync(path.join(parent, name))) {
    await showMessage({
      type: 'warning',
      title: '这个名字已经被占用了',
      message: `${path.join(parent, name)} 已经存在。`,
      detail: '请换一个名字，或者先处理掉那个文件夹。',
      buttons: ['知道了'],
    });
    return null;
  }

  return { action: 'rename', renameTo: name };
}

async function askExistingAction(
  plan: LocationPlan
): Promise<{ action: ExistingAction; renameTo?: string } | null> {
  const isMoqi = plan.existing === 'moqi';
  const buttons = isMoqi
    ? ['复用这份数据', '覆盖（先备份）', '重命名旧数据', '取消']
    : ['重命名旧数据', '取消'];
  const cancelId = buttons.length - 1;

  const result = await showMessage({
    type: 'warning',
    title: '目标位置已有内容',
    message: `${plan.root} 已经存在`,
    detail: isMoqi
      ? [
          '复用：直接使用这份数据，不复制、不合并。当前数据会留在原处。',
          '覆盖：先把旧目录改名备份，再把当前数据迁进去。',
          '重命名：给旧目录起个新名字保留下来，再把当前数据迁进去。',
          '',
          '三个选项都不会直接删除你的文件。',
        ].join('\n')
      : [
          '这个文件夹不是墨栖的数据。',
          '为避免误覆盖，只能给它改名保留，或者取消。',
        ].join('\n'),
    buttons,
    defaultId: 0,
    cancelId,
    noLink: true,
  });

  if (result.response < 0 || result.response === cancelId) return null;
  if (isMoqi && result.response === 0) return { action: 'reuse' };
  if (isMoqi && result.response === 1) return { action: 'replace' };
  return askRename(plan);
}

async function askRelocateMode(
  plan: LocationPlan,
  existingNote?: string,
  title = '更改数据位置'
): Promise<RelocateMode | null> {
  const stats = getBackupStats();
  const free =
    plan.freeBytes !== undefined ? `目标磁盘剩余：${formatBytes(plan.freeBytes)}` : '';
  const result = await showMessage({
    type: 'question',
    title,
    message: `将在所选位置使用 ${DATA_DIR_NAME} 文件夹`,
    detail: [
      `当前：${getDataRootInfo().dataDir}`,
      `目标：${plan.dataDir}`,
      `数据量：${stats.shelf} 本书 · ${stats.notes} 条笔记 · ${formatBytes(stats.bookBytes)}`,
      free,
      existingNote ?? '',
      '',
      '复制：旧位置永久保留，确认没问题后你可以自己删。',
      '移动：复制并核对成功后，旧目录保留 7 天；设置页可以立即清理或保留。',
      '完成后墨栖会自动重启。',
    ]
      .filter((line) => line !== '')
      .join('\n'),
    buttons: ['复制过去（推荐，保留旧数据）', '移动过去（7 天后清理旧目录）', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response < 0 || result.response === 2) return null;
  return result.response === 1 ? 'move' : 'copy';
}

/** 打开「选择数据上级目录」对话框；pick / change 共用，避免两套默认路径 */
async function pickDataParent(): Promise<{ canceled: boolean; parent?: string }> {
  const current = getDataRootInfo();
  const picked = await showOpenDialog({
    title: '选择数据存放的上级目录',
    buttonLabel: '选这里',
    defaultPath: path.dirname(current.root),
    properties: ['openDirectory', 'createDirectory'],
  });
  const parent = picked.filePaths[0];
  if (picked.canceled || !parent) return { canceled: true };
  return { canceled: false, parent };
}

function defaultLibraryDirs(): string[] {
  // v0.8 单根布局：书都已经在 Data 里，不再默认扫文档/项目目录，避免重复收书
  if (getDataRootInfo().mode === 'single-root') return [];
  const dirs: string[] = [];
  try {
    dirs.push(path.join(app.getPath('documents'), '墨栖书库'));
  } catch {
    /* ignore */
  }
  // 仅在开发运行时自动纳管项目目录（打包后绝不能扫安装目录，否则会捡到 LICENSE 等文本）
  if (!app.isPackaged) {
    dirs.push(app.getAppPath());
  }
  return dirs;
}

function resolveDirs(settings: Settings): string[] {
  const list = (settings.libraryDirs ?? []).filter(Boolean);
  const merged = [...list, ...defaultLibraryDirs()];
  return [...new Set(merged.map((d) => path.normalize(d)))].filter((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });
}

async function runScan(silent = false, extraPaths: string[] = []): Promise<BookMeta[]> {
  if (scanning) return readLibrary();
  scanning = true;
  try {
    const settings = getSettings();
    const dirs = [...new Set([...resolveDirs(settings), ...extraPaths])];
    const existing = readLibrary();
    const { books, errors } = await refreshLibrary(dirs, existing, (done, total, title) => {
      if (!silent) mainWindow?.webContents.send('library:scanProgress', { done, total, title });
    });
    if (errors.length) logError('scan', JSON.stringify(errors));
    return books;
  } finally {
    scanning = false;
  }
}

export function registerIpc(): void {
  ensureDirs();

  // ─── 书库 ───
  ipcMain.handle('library:list', () => readLibrary());

  ipcMain.handle('library:scan', async (_e, opts: { silent?: boolean }) => {
    return runScan(!!opts?.silent);
  });

  ipcMain.handle('library:import', async (_e, { paths: input }: { paths: string[] }) => {
    if (!input?.length) return { ok: false, added: 0, scanned: 0, titles: [], books: readLibrary() };

    // 先看看这次到底扫到了什么：空文件夹、只有一个书名、还是混了好几本
    const scanned = scanForBooks(input);
    const titles = [...new Set(scanned.map((f) => titleFromFileName(f)))];

    const settings = getSettings();
    const singleRoot = getDataRootInfo().mode === 'single-root';
    const dirs = [...(settings.libraryDirs ?? [])];
    const files: string[] = [];

    for (const p of input) {
      try {
        const st = fs.statSync(p);
        // 旧布局：目录纳入长期扫描；单个文件只参与这一次导入。
        // v0.8：目录也不长期记住，扫完就把书复制进 Data，避免下次从外部路径再收一遍。
        if (st.isDirectory() && !singleRoot) dirs.push(path.normalize(p));
        else if (st.isFile()) files.push(path.normalize(p));
      } catch {
        /* 失效路径忽略 */
      }
    }

    const before = new Set(readLibrary().map((b) => b.id));
    saveSettings({
      libraryDirs: singleRoot ? [] : [...new Set(dirs)],
    });
    // v0.8 要把选中的目录本身作为这次扫描的 extraPaths，因为它不再存进 libraryDirs
    const books = await runScan(false, singleRoot ? input : files);
    if (singleRoot) await adoptExternalBooks();
    const finalBooks = singleRoot ? readLibrary() : books;
    const added = finalBooks.filter((b) => !before.has(b.id)).length;
    return { ok: true, added, scanned: scanned.length, titles, books: finalBooks };
  });

  ipcMain.handle('library:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'multiSelections'],
      title: '选择书库文件夹',
    });
    return r.canceled ? null : r.filePaths;
  });

  ipcMain.handle('library:pickFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      title: '选择书籍文件',
      filters: [
        { name: '电子书', extensions: ['epub', 'mobi', 'azw3', 'azw', 'pdf', 'txt'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths;
  });

  ipcMain.handle('library:remove', async (_e, { bookId, deleteCache }) => {
    const ok = removeBook(bookId, !!deleteCache);
    return { ok, books: readLibrary() };
  });

  ipcMain.handle('library:setCategories', async (_e, { bookId, categories }) => {
    const meta = updateBookMeta(bookId, { categories });
    return { ok: !!meta, meta };
  });

  // ─── 分类管理（书籍分类 / 笔记分类共用） ───
  ipcMain.handle(
    'category:rename',
    async (_e, { kind, from, to }: { kind: 'book' | 'note'; from: string; to: string }) => {
      const name = (to ?? '').trim();
      if (!name) return { ok: false, error: '名字不能为空' };
      if (name === from) return { ok: true };

      if (kind === 'book') {
        const books = renameCategoryInBooks(from, name);
        const list = getSettings().categories ?? [];
        if (list.some((c) => c === name)) return { ok: false, error: '已经有同名分类了' };
        saveSettings({ categories: [...new Set(list.map((c) => (c === from ? name : c)))] });
        return { ok: true, books };
      }

      const cats = getSettings().noteCategories ?? DEFAULT_NOTE_CATEGORIES;
      if (cats.some((c) => c.name === name)) return { ok: false, error: '已经有同名分类了' };
      const count = renameNoteCategory(from, name);
      saveSettings({ noteCategories: cats.map((c) => (c.name === from ? { ...c, name } : c)) });
      return { ok: true, count };
    }
  );

  ipcMain.handle('category:remove', async (_e, { kind, name }: { kind: 'book' | 'note'; name: string }) => {
    if (kind === 'book') {
      const books = removeCategoryFromBooks(name);
      saveSettings({ categories: (getSettings().categories ?? []).filter((c) => c !== name) });
      return { ok: true, books };
    }
    const count = removeNoteCategory(name);
    const cats = getSettings().noteCategories ?? DEFAULT_NOTE_CATEGORIES;
    saveSettings({ noteCategories: cats.filter((c) => c.name !== name) });
    return { ok: true, count };
  });

  /** 改笔记分类的颜色：全局不允许两个分类用同一种颜色 */
  ipcMain.handle('category:setNoteColor', (_e, { name, color }: { name: string; color: HighlightColor }) => {
    const cats = getSettings().noteCategories ?? DEFAULT_NOTE_CATEGORIES;
    if (cats.some((c) => c.name !== name && c.color === color)) {
      return { ok: false, error: '这个颜色已经被别的分类占用了，先把它换掉' };
    }
    saveSettings({ noteCategories: cats.map((c) => (c.name === name ? { ...c, color } : c)) });
    return { ok: true };
  });

  ipcMain.handle('library:switchVariant', async (_e, { bookId, format }) => {
    const meta = readLibrary().find((b) => b.id === bookId);
    if (!meta) return { ok: false, error: '书不存在' };
    const v = meta.variants.find((x) => x.format === format);
    if (!v) return { ok: false, error: '该格式不存在' };
    // 同一本书可能有多个重复条目；记一次活动时间，让书架合并时选中这份。
    const updated = updateBookMeta(bookId, { format, lastOpenedAt: Date.now() });
    return { ok: true, meta: updated };
  });

  // ─── 打开书 ───
  ipcMain.handle('book:open', async (_e, { bookId }: { bookId: string }): Promise<OpenBookResult> => {
    try {
      const meta = readLibrary().find((b) => b.id === bookId);
      if (!meta) return { ok: false, error: '这本书不在书库里' };

      let variant = meta.variants.find((v) => v.format === meta.format) ?? pickBest(meta.variants);
      if (!variant) return { ok: false, error: '找不到书籍文件' };
      if (!fs.existsSync(variant.path)) {
        const alt = meta.variants.find((v) => fs.existsSync(v.path));
        if (!alt) return { ok: false, error: '书文件已被移动或删除' };
        variant = alt;
      }

      let result;
      try {
        result = await loadBookContent(bookId, variant.path);
      } catch (err) {
        // 主格式失败 → 换一个格式再试
        const alt = meta.variants.find((v) => v.format !== variant!.format && fs.existsSync(v.path));
        if (!alt) throw err;
        result = await loadBookContent(bookId, alt.path, true);
        variant = alt;
      }

      const book = result.book;
      book.meta = {
        ...meta,
        ...book.meta,
        format: (variant.format as BookMeta['format']) ?? meta.format,
        variants: meta.variants,
        cover: result.coverFileName ?? meta.cover,
        totalChars: book.meta.totalChars || meta.totalChars,
        chapterCount: book.chapters.length,
        addedAt: meta.addedAt,
        lastOpenedAt: Date.now(),
      };

      updateBookMeta(bookId, {
        totalChars: book.meta.totalChars,
        chapterCount: book.chapters.length,
        title: book.meta.title,
        author: book.meta.author,
        publisher: book.meta.publisher,
        cover: book.meta.cover,
        lastOpenedAt: book.meta.lastOpenedAt,
        format: book.meta.format,
      });
      saveSettings({ lastBookId: bookId });

      return { ok: true, book };
    } catch (err) {
      logError('book:open', err);
      const message = err instanceof Error ? err.message : '打开失败';
      return { ok: false, error: message };
    }
  });

  // ─── 进度 ───
  ipcMain.handle('progress:get', (_e, { bookId }) => getProgress(bookId));
  ipcMain.handle('progress:all', () => getAllProgress());
  ipcMain.handle('progress:save', (_e, progress: Progress) => {
    try {
      saveProgress(progress);
      return true;
    } catch (err) {
      logError('progress:save', err);
      return false;
    }
  });

  // ─── 笔记 ───
  ipcMain.handle('note:list', (_e, { bookId }) => listNotes(bookId));
  ipcMain.handle('note:save', (_e, note: Note) => saveNote(note));
  ipcMain.handle('note:remove', (_e, { bookId, noteId }) => removeNote(bookId, noteId));
  ipcMain.handle('note:export', (_e, { bookId }) => {
    const meta = readLibrary().find((b) => b.id === bookId);
    return exportNotes(bookId, meta?.title ?? bookId);
  });

  /** 导出全部笔记：一个 Markdown，或每条一个文件 */
  ipcMain.handle('note:exportAll', async (_e, { mode }: { mode: 'single' | 'folder' }) => {
    const notes = getAllNotes();
    if (!notes.length) return { ok: false, error: '还没有笔记可以导出' };

    const books = readLibrary();
    const titleOf = (id: string) => books.find((b) => b.id === id)?.title ?? '未知书籍';
    const day = new Date();
    const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const dateText = (t: number) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const body = (n: Note) => {
      const lines: string[] = [];
      if (n.title) lines.push(`### ${n.title}`, '');
      lines.push(`> ${n.text.replace(/\n+/g, ' ').trim()}`, '');
      if (n.comment.trim()) lines.push(n.comment.trim(), '');
      const meta = [n.category, dateText(n.createdAt)].filter(Boolean).join(' · ');
      if (meta) lines.push(`*${meta}*`, '');
      return lines.join('\n');
    };

    if (mode === 'single') {
      const exportDir = paths.exports();
      try {
        fs.mkdirSync(exportDir, { recursive: true });
      } catch {
        /* 建不了就让对话框自己回退到系统默认目录 */
      }
      const r = await showSaveDialog({
        title: '导出全部笔记',
        defaultPath: path.join(exportDir, `墨栖笔记-${stamp}.md`),
        filters: [{ name: 'Markdown 文件', extensions: ['md'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };

      const byBook = new Map<string, Note[]>();
      for (const n of notes) {
        const list = byBook.get(n.bookId) ?? [];
        list.push(n);
        byBook.set(n.bookId, list);
      }

      const out: string[] = ['# 墨栖 · 全部笔记', '', `> 导出于 ${stamp} · 共 ${notes.length} 条`, ''];
      for (const [bookId, list] of byBook) {
        out.push(`## ${titleOf(bookId)}`, '');
        const byChapter = new Map<string, Note[]>();
        for (const n of [...list].sort((a, b) => a.createdAt - b.createdAt)) {
          const key = n.chapterTitle || '未命名章节';
          const arr = byChapter.get(key) ?? [];
          arr.push(n);
          byChapter.set(key, arr);
        }
        for (const [chapter, arr] of byChapter) {
          out.push(`### ${chapter}`, '');
          for (const n of arr) out.push(body(n));
        }
      }
      fs.writeFileSync(r.filePath, out.join('\n'), 'utf8');
      return { ok: true, count: notes.length, path: r.filePath };
    }

    const r = await showOpenDialog({
      title: '选择笔记导出的文件夹',
      defaultPath: paths.exports(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };

    const dir = r.filePaths[0];
    const used = new Set<string>();
    for (const n of notes) {
      const base = `${titleOf(n.bookId)}-${n.chapterTitle || '未命名'}-${n.title || n.text.slice(0, 10)}`
        .replace(/[\\/:*?"<>|\s]+/g, '_')
        .slice(0, 60);
      let name = `${base}.md`;
      let i = 2;
      while (used.has(name)) name = `${base}-${i++}.md`;
      used.add(name);
      fs.writeFileSync(
        path.join(dir, name),
        `# ${titleOf(n.bookId)}\n\n## ${n.chapterTitle || '未命名章节'}\n\n${body(n)}`,
        'utf8'
      );
    }
    return { ok: true, count: notes.length, path: dir };
  });

  // ─── 会话与统计 ───
  ipcMain.handle('session:add', (_e, s: ReadingSession) => {
    try {
      addSession(s);
      return true;
    } catch (err) {
      logError('session:add', err);
      return false;
    }
  });

  ipcMain.handle('stats:get', (_e, { days }) => getStats(days ?? 7));
  ipcMain.handle('stats:books', () => getBookStats());
  ipcMain.handle('stats:finishedSummary', (_e, { bookId }) => getFinishedSummary(bookId));
  ipcMain.handle('stats:resetBookToday', (_e, { bookId }) => ({
    removed: resetBookToday(bookId),
    today: getStats(1)[0]?.seconds ?? 0,
  }));
  ipcMain.handle('stats:totals', () => ({ ...getTotals(), allNotes: getAllNotesCount() }));

  // ─── 设置 ───
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch ?? {}));

  // ─── 应用 ───
  ipcMain.handle('app:info', () => {
    const root = getDataRootInfo();
    return {
      version: app.getVersion(),
      dataDir: paths.data(),
      dataRoot: root.root,
      isCustomDataRoot: root.isCustom,
      unavailableDataRoot: root.unavailable ?? '',
      defaultDataDir: effectiveDefaultDataDir(),
      dataFolderName: DATA_DIR_NAME,
      portable: root.portable,
      legacyPortable: !!root.legacyPortable,
      layout: root.layout,
      mode: root.mode,
      containerDir: root.containerDir ?? '',
      pendingCleanup: getPendingCleanup(),
      libraryDir: resolveDirs(getSettings())[0] ?? '',
      documents: (() => {
        try {
          return app.getPath('documents');
        } catch {
          return '';
        }
      })(),
      exeDir: app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    };
  });

  // ── 数据存放位置 ──
  ipcMain.handle('location:info', () => {
    const root = getDataRootInfo();
    return {
      root: root.root,
      dataDir: root.dataDir,
      isCustom: root.isCustom,
      unavailable: root.unavailable ?? '',
      folderName: DATA_DIR_NAME,
      defaultDataDir: effectiveDefaultDataDir(),
      portable: root.portable,
      legacyPortable: !!root.legacyPortable,
      portableReadonly: !!root.portableReadonly,
      layout: root.layout,
      mode: root.mode,
      containerDir: root.containerDir ?? '',
      pendingCleanup: getPendingCleanup(),
      previous: getPreviousDataDir() ?? '',
      programDir: programDir(),
      configDir: configDir(),
      rolledBackFrom: root.rolledBackFrom ?? '',
    };
  });

  ipcMain.handle('location:pick', async () => {
    if (getDataRootInfo().mode === 'single-root') return { canceled: true };
    const picked = await pickDataParent();
    if (picked.canceled || !picked.parent) return { canceled: true };

    const plan = planDataLocation(picked.parent);
    return {
      canceled: false,
      parent: picked.parent,
      plan: {
        root: plan.root,
        dataDir: plan.dataDir,
        existing: plan.existing,
        same: plan.same,
        inside: plan.inside,
        empty: plan.empty,
        invalid: plan.invalid,
        detail: plan.detail,
      },
    };
  });

  ipcMain.handle('location:change', async (_e, opts?: { parent?: string }) => {
    const current = getDataRootInfo();
    if (current.mode === 'single-root') {
      return {
        ok: false,
        reason: 'invalid',
        detail: 'v0.8 的数据固定在软件目录的 Data 文件夹里，不能单独改；要搬就搬整个 MoQiReader 文件夹。',
        root: current.dataDir,
        dataDir: current.dataDir,
      };
    }
    let parent = opts?.parent;
    if (!parent) {
      const picked = await pickDataParent();
      if (picked.canceled || !picked.parent) return { ok: false, canceled: true };
      parent = picked.parent;
    }

    const plan = planDataLocation(parent);
    if (plan.invalid) {
      await showMessage({
        type: 'warning',
        title: '这个位置不能用',
        message: plan.detail ?? '请换一个文件夹。',
        detail: plan.root ? `目标：${plan.root}` : undefined,
        buttons: ['知道了'],
      });
      return {
        ok: false,
        reason: 'invalid',
        detail: plan.detail,
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    if (plan.same) {
      await showMessage({
        type: 'info',
        title: '数据已经在这里',
        message: `数据现在就存放在：\n${plan.dataDir}`,
        buttons: ['知道了'],
      });
      return { ok: false, reason: 'same', root: plan.root, dataDir: plan.dataDir };
    }
    if (plan.inside) {
      await showMessage({
        type: 'warning',
        title: '这个位置不行',
        message: '不能把数据放进当前的数据目录里',
        detail: '请选择上一层，或者换一个磁盘。',
        buttons: ['知道了'],
      });
      return {
        ok: false,
        reason: 'inside',
        detail: '不能放进当前数据目录',
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }

    let existingAction: ExistingAction | undefined;
    let renameTo: string | undefined;

    if (plan.existing !== 'none') {
      const choice = await askExistingAction(plan);
      if (!choice) return { ok: false, canceled: true, reason: 'canceled' };
      existingAction = choice.action;
      renameTo = choice.renameTo;

      if (existingAction === 'reuse') {
        const confirm = await showMessage({
          type: 'question',
          title: '复用这份数据',
          message: `以后就使用：\n${plan.dataDir}`,
          detail: [
            '不会复制，也不会合并。',
            '当前数据仍然留在原处，只是墨栖以后读这里。',
            '如果反悔，可以在设置里再改回来。',
          ].join('\n'),
          buttons: ['就用这里', '取消'],
          defaultId: 0,
          cancelId: 1,
        });
        if (confirm.response !== 0) return { ok: false, canceled: true, reason: 'canceled' };

        const result = await relocateData(
          { kind: 'custom', parent },
          'copy',
          { existingAction: 'reuse' }
        );
        if (result.ok) scheduleRelaunch();
        return result;
      }
    }

    const mode = await askRelocateMode(
      plan,
      existingAction === 'replace' || existingAction === 'rename'
        ? '旧目标会先改名保留，不会删除。'
        : undefined
    );
    if (!mode) return { ok: false, canceled: true, reason: 'canceled' };

    const result = await relocateData(
      { kind: 'custom', parent },
      mode,
      { existingAction, renameTo, onProgress: sendLocationProgress }
    );
    if (result.ok) scheduleRelaunch();
    return result;
  });

  ipcMain.handle('location:reset', async () => {
    const current = getDataRootInfo();
    if (current.mode === 'single-root') {
      return {
        ok: false,
        reason: 'invalid',
        detail: 'v0.8 的数据位置固定，不需要也不能改回默认。',
        root: current.dataDir,
        dataDir: current.dataDir,
      };
    }
    const targetRoot = effectiveDefaultDataDir();
    const plan = planDataLocation(path.dirname(targetRoot));

    if (plan.invalid) {
      await showMessage({
        type: 'warning',
        title: '默认位置不可用',
        message: plan.detail ?? '默认位置现在不能用。',
        detail: `目标：${plan.root}`,
        buttons: ['知道了'],
      });
      return {
        ok: false,
        reason: 'invalid',
        detail: plan.detail,
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    if (plan.same) {
      await showMessage({
        type: 'info',
        title: '已经在这里',
        message: `数据已经在默认位置：\n${plan.dataDir}`,
        buttons: ['知道了'],
      });
      return { ok: false, reason: 'same', root: plan.root, dataDir: plan.dataDir };
    }

    let existingAction: ExistingAction | undefined;
    let renameTo: string | undefined;

    if (plan.existing !== 'none') {
      const choice = await askExistingAction(plan);
      if (!choice) return { ok: false, canceled: true, reason: 'canceled' };
      existingAction = choice.action;
      renameTo = choice.renameTo;

      if (existingAction === 'reuse') {
        const confirm = await showMessage({
          type: 'question',
          title: '复用默认位置的数据',
          message: `以后就使用：\n${plan.dataDir}`,
          detail: '不会复制，也不会合并。当前自定义位置的数据仍然留在原处。',
          buttons: ['就用这里', '取消'],
          defaultId: 0,
          cancelId: 1,
        });
        if (confirm.response !== 0) return { ok: false, canceled: true, reason: 'canceled' };

        const result = await relocateData({ kind: 'default' }, 'copy', {
          existingAction: 'reuse',
        });
        if (result.ok) scheduleRelaunch();
        return result;
      }
    }

    const mode = await askRelocateMode(
      plan,
      [
        existingAction === 'replace' || existingAction === 'rename'
          ? '旧目标会先改名保留，不会删除。'
          : '',
        `当前：${current.dataDir}`,
      ]
        .filter(Boolean)
        .join('\n'),
      '恢复默认位置'
    );
    if (!mode) return { ok: false, canceled: true, reason: 'canceled' };

    const result = await relocateData({ kind: 'default' }, mode, {
      existingAction,
      renameTo,
      onProgress: sendLocationProgress,
    });
    if (result.ok) scheduleRelaunch();
    return result;
  });

  ipcMain.handle('location:cleanupNow', async () => {
    const pending = getPendingCleanup();
    if (!pending) return { cleaned: false, reason: 'none' };
    const confirm = await showMessage({
      type: 'warning',
      title: '清理旧数据',
      message: `确定删除旧位置吗？\n${pending.old}`,
      detail:
        '删掉后不能恢复。新位置的数据已经逐文件核对过，不受影响。\n如果还想留一份，选「取消」，稍后手动处理。',
      buttons: ['确认清理', '取消'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirm.response !== 0) return { cleaned: false, reason: 'canceled' };
    return cleanupNow();
  });
  ipcMain.handle('location:cancelCleanup', () => cancelPendingCleanup());

  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(paths.data());
    return true;
  });

  // ── 完整备份与恢复：书架 + 阅读数据 + 书文件，收进一个 zip ──
  ipcMain.handle('backup:info', () => getBackupStats());

  ipcMain.handle('backup:export', async (_e, opts?: { includeBooks?: boolean }) => {
    let documents = '';
    try {
      documents = app.getPath('documents');
    } catch {
      documents = app.getPath('home');
    }

    const picked = await dialog.showSaveDialog(mainWindow!, {
      title: '导出备份',
      buttonLabel: '导出',
      defaultPath: path.join(documents, defaultBackupName()),
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };

    const file = /\.zip$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.zip`;
    return exportBackup(file, { includeBooks: opts?.includeBooks !== false }, sendBackupProgress);
  });

  ipcMain.handle('backup:import', async (_e, { mode }: { mode: 'zip' | 'folder' }) => {
    const options: Electron.OpenDialogOptions =
      mode === 'zip'
        ? {
            title: '选择备份压缩包',
            buttonLabel: '开始恢复',
            properties: ['openFile'],
            filters: [
              { name: 'ZIP 压缩包', extensions: ['zip'] },
              { name: '全部文件', extensions: ['*'] },
            ],
          }
        : {
            title: '选择备份文件夹',
            buttonLabel: '开始恢复',
            properties: ['openDirectory'],
          };

    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return { ok: false, canceled: true };

    return restoreBackup(source, sendBackupProgress);
  });

  ipcMain.handle('app:openPath', async (_e, p: string) => {
    if (!p) return false;
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) await shell.openPath(p);
      else shell.showItemInFolder(p);
      return true;
    } catch {
      return false;
    }
  });

  // ─── 窗口 ───
  ipcMain.handle('win:setFullScreen', (_e, { on }) => {
    mainWindow?.setFullScreen(!!on);
    return !!on;
  });
  ipcMain.handle('win:isFullScreen', () => mainWindow?.isFullScreen() ?? false);
}

export { defaultLibraryDirs, resolveDirs, runScan, makeBookId };
