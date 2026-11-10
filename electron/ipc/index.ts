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
import { paths, ensureDirs, logError } from '../store/paths';
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
  countUserData,
  exportNotes,
  exportUserData,
  getAllNotesCount,
  getAllProgress,
  getProgress,
  getSettings,
  getBookStats,
  getAllNotes,
  getFinishedSummary,
  getStats,
  importUserData,
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

let mainWindow: BrowserWindow | null = null;
let scanning = false;

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win;
}

function defaultLibraryDirs(): string[] {
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
    const dirs = [...(settings.libraryDirs ?? [])];
    const files: string[] = [];

    for (const p of input) {
      try {
        const st = fs.statSync(p);
        // 目录纳入长期扫描；单个文件只参与这一次导入，
        // 以前把文件路径也塞进 libraryDirs，导致扫描时 readdirSync 直接失败、书永远进不来。
        if (st.isDirectory()) dirs.push(path.normalize(p));
        else if (st.isFile()) files.push(path.normalize(p));
      } catch {
        /* 失效路径忽略 */
      }
    }

    const before = new Set(readLibrary().map((b) => b.id));
    saveSettings({ libraryDirs: [...new Set(dirs)] });
    const books = await runScan(false, files);
    const added = books.filter((b) => !before.has(b.id)).length;
    return { ok: true, added, scanned: scanned.length, titles, books };
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
      const r = await dialog.showSaveDialog(mainWindow!, {
        title: '导出全部笔记',
        defaultPath: path.join(app.getPath('documents'), `墨栖笔记-${stamp}.md`),
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

    const r = await dialog.showOpenDialog(mainWindow!, {
      title: '选择笔记导出的文件夹',
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
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: paths.data(),
    libraryDir: resolveDirs(getSettings())[0] ?? '',
    documents: (() => {
      try {
        return app.getPath('documents');
      } catch {
        return '';
      }
    })(),
    exeDir: app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
  }));

  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(paths.data());
    return true;
  });

  // ── 个人数据备份与恢复（只动 data/user/，不碰书籍与书架）──
  ipcMain.handle('data:counts', () => countUserData());

  ipcMain.handle('data:export', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择保存位置',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const target = picked.filePaths[0];
    if (picked.canceled || !target) return { ok: false, canceled: true };
    return exportUserData(target, app.getVersion());
  });

  ipcMain.handle('data:import', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择包含个人数据的文件夹',
      buttonLabel: '开始导入',
      properties: ['openDirectory'],
    };
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return { ok: false, canceled: true };
    return importUserData(source);
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
