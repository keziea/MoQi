import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BookFormat, BookMeta, BookVariant } from '../../shared/models';
import { paths, logError } from './paths';
import { readJson, writeJsonAtomic } from './json';
import { cleanTitle, loadBookContent, titleFromFileName } from '../parsers';

export const FORMAT_QUALITY: Record<BookFormat, number> = {
  epub: 100,
  mobi: 90,
  pdf: 70,
  txt: 60,
};

const EXT_FORMAT: Record<string, BookFormat> = {
  '.epub': 'epub',
  '.mobi': 'mobi',
  '.azw': 'mobi',
  '.azw3': 'mobi',
  '.pdf': 'pdf',
  '.txt': 'txt',
};

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-electron', 'release', '.git', '.tmp', 'build',
  'docs', 'src', 'electron', '.vite', 'resources', 'logs', 'assets',
]);

const MAX_DEPTH = 4;

/** 明显不是书的文本文件（安装包自带的许可证、说明等） */
const SKIP_FILENAME = /^(license|licence|copying|notice|readme|changelog|third[-_]?party|version|package)/i;

export function scanForBooks(dirs: string[]): string[] {
  const found = new Set<string>();

  /** 单个文件也直接收下：用户完全可能只导入一本书，而不是整个文件夹 */
  const considerFile = (full: string) => {
    const fmt = EXT_FORMAT[path.extname(full).toLowerCase()];
    if (!fmt) return;
    if (SKIP_FILENAME.test(path.basename(full))) return;
    // 明显过小的文件不当作书（< 2KB）
    try {
      if (fs.statSync(full).size < 2048) return;
    } catch {
      return;
    }
    found.add(full);
  };

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        walk(full, depth + 1);
      } else {
        considerFile(full);
      }
    }
  };

  for (const p of dirs) {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isFile()) considerFile(p);
    else if (st.isDirectory()) walk(p, 0);
  }
  return [...found];
}

interface Group {
  key: string;
  folder: string;
  baseName: string;
  files: string[];
}

/** 同名多格式归并为一本 */
export function groupBooks(files: string[]): Group[] {
  const map = new Map<string, Group>();
  for (const f of files) {
    const folder = path.dirname(f);
    const baseName = titleFromFileName(f);
    const key = `${folder}||${baseName}`;
    if (!map.has(key)) map.set(key, { key, folder, baseName, files: [] });
    map.get(key)!.files.push(f);
  }
  return [...map.values()];
}

export function makeBookId(folder: string, baseName: string): string {
  const slug = baseName.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 12) || 'book';
  const hash = crypto.createHash('md5').update(`${folder}|${baseName}`).digest('hex').slice(0, 6);
  return `${slug}-${hash}`;
}

/** 选出质量最高的格式 */
export function pickBest(variants: BookVariant[]): BookVariant | undefined {
  return [...variants].sort((a, b) => b.quality - a.quality)[0];
}

export function readLibrary(): BookMeta[] {
  return readJson<BookMeta[]>(paths.library(), []);
}

export function writeLibrary(list: BookMeta[]): void {
  writeJsonAtomic(paths.library(), list);
}

export interface RefreshResult {
  books: BookMeta[];
  errors: { file: string; message: string }[];
}

/**
 * 扫描并刷新书库。已有的书保留原有进度相关信息，只更新文件层面的元数据。
 */
export async function refreshLibrary(
  dirs: string[],
  existing: BookMeta[],
  onProgress?: (done: number, total: number, title: string) => void
): Promise<RefreshResult> {
  const files = scanForBooks(dirs);
  const groups = groupBooks(files);
  const byId = new Map(existing.map((b) => [b.id, b]));
  const errors: { file: string; message: string }[] = [];
  const out: BookMeta[] = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const id = makeBookId(g.folder, g.baseName);
    const variants: BookVariant[] = g.files
      .map((f) => {
        const fmt = EXT_FORMAT[path.extname(f).toLowerCase()]!;
        let size = 0;
        try {
          size = fs.statSync(f).size;
        } catch {
          return null;
        }
        return { format: fmt, path: f, sizeBytes: size, quality: FORMAT_QUALITY[fmt] } as BookVariant;
      })
      .filter((x): x is BookVariant => !!x);

    if (variants.length === 0) continue;

    const best = pickBest(variants)!;
    const prev = byId.get(id);

    // 文件未变 → 复用已有 meta，不重复解析
    const sameVariant =
      prev &&
      prev.variants.some((v) => v.path === best.path && v.sizeBytes === best.sizeBytes);

    if (prev && sameVariant) {
      out.push({
        ...prev,
        variants,
        categories: prev.categories,
        format: prev.variants.find((v) => v.format === prev.format) ? prev.format : best.format,
      });
      onProgress?.(i + 1, groups.length, prev.title);
      continue;
    }

    // 需要解析（首次或文件更新）
    const base: BookMeta = {
      id,
      title: cleanTitle(g.baseName),
      author: '未知作者',
      format: best.format,
      variants,
      totalChars: 0,
      chapterCount: 0,
      addedAt: prev?.addedAt ?? Date.now(),
      lastOpenedAt: prev?.lastOpenedAt,
      categories: prev?.categories,
    };

    try {
      const { book, coverFileName } = await loadBookContent(id, best.path, true);
      out.push({
        ...base,
        title: book.meta.title || base.title,
        author: book.meta.author,
        publisher: book.meta.publisher,
        cover: coverFileName,
        totalChars: book.meta.totalChars,
        chapterCount: book.meta.chapterCount,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logError(`parse:${path.basename(best.path)}`, e);
      errors.push({ file: best.path, message });
      // 解析失败也保留条目，让用户能看到并切换版本
      out.push({ ...base, title: cleanTitle(g.baseName) || titleFromFileName(best.path) });
    }

    onProgress?.(i + 1, groups.length, base.title);
  }

  // 保留旧条目中「文件仍在、但本次未扫描到」的书（例如用户换了书库目录）
  const scannedIds = new Set(out.map((b) => b.id));
  for (const old of existing) {
    if (scannedIds.has(old.id)) continue;
    const alive = old.variants.some((v) => {
      try {
        return fs.existsSync(v.path);
      } catch {
        return false;
      }
    });
    if (!alive) continue;
    // 历史误收的非书籍文件（许可证、说明等）一并清掉
    const allJunk = old.variants.every((v) => SKIP_FILENAME.test(path.basename(v.path)));
    if (allJunk) continue;
    out.push(old);
  }

  writeLibrary(out);
  return { books: out, errors };
}

/** 书籍分类改名：所有挂了这个分类的书一起改 */
export function renameCategoryInBooks(from: string, to: string): BookMeta[] {
  const list = readLibrary();
  let changed = false;
  const next = list.map((b) => {
    const cats = b.categories ?? [];
    if (!cats.includes(from)) return b;
    changed = true;
    return { ...b, categories: [...new Set(cats.map((c) => (c === from ? to : c)))] };
  });
  if (changed) writeLibrary(next);
  return next;
}

/** 删除书籍分类：从所有书上摘掉，书本身保留 */
export function removeCategoryFromBooks(name: string): BookMeta[] {
  const list = readLibrary();
  let changed = false;
  const next = list.map((b) => {
    const cats = b.categories ?? [];
    if (!cats.includes(name)) return b;
    changed = true;
    return { ...b, categories: cats.filter((c) => c !== name) };
  });
  if (changed) writeLibrary(next);
  return next;
}

export function updateBookMeta(bookId: string, patch: Partial<BookMeta>): BookMeta | null {
  const list = readLibrary();
  const idx = list.findIndex((b) => b.id === bookId);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  writeLibrary(list);
  return list[idx];
}

export function removeBook(bookId: string, deleteCache: boolean): boolean {
  const list = readLibrary();
  const next = list.filter((b) => b.id !== bookId);
  if (next.length === list.length) return false;
  writeLibrary(next);
  if (deleteCache) {
    try {
      fs.rmSync(paths.bookDir(bookId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return true;
}
