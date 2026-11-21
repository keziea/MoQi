/**
 * v0.8 布局迁移：把旧版散落的数据搬进 <容器>\Data，并把书文件收进 Data\books。
 *
 * 原则：
 *  · 旧数据只读不删；复制 + 校验通过后才用新目录。
 *  · 任何一步失败，旧数据不动；新 Data 里本次复制的顶层条目清掉。
 *  · 书库里的绝对路径搬到新 Data 后改写；外部书由 adoptExternalBooks 复制进来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { BookMeta } from '../../shared/models';
import { APP_NAME_EN } from '../../shared/names.generated';
import { paths, LEGACY_DATA_DIR_NAME, DATA_MARKER } from './paths';
import { readLibrary, writeLibrary } from './library';
import { writeJsonAtomic } from './json';

export interface MigrationProgress {
  phase: 'scan' | 'copy' | 'verify' | 'books';
  done: number;
  total: number;
  bytes?: number;
  name?: string;
}

export interface LegacyLocation {
  dir: string;
  kind: 'pointer' | 'default' | 'v05-nested';
}

export interface MigrationResult {
  migrated: boolean;
  source?: string;
  files: number;
  bytes: number;
  error?: string;
}

export interface AdoptResult {
  copied: number;
  updated: number;
  missing: string[];
}

const LEGACY_IMPORT_FILE = 'legacy-import.json';
const SKIP_TOP = new Set(['runtime', 'cache', 'pending-cleanup.json', 'migration.json']);

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(`${p}${path.sep}`);
}

function listFiles(root: string, rel = '', out: string[] = []): string[] {
  const dir = rel ? path.join(root, rel) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!rel && SKIP_TOP.has(entry.name)) continue;
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) listFiles(root, next, out);
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function readJsonStrict<T>(file: string): { exists: boolean; value: T | null } {
  if (!fs.existsSync(file)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) as T };
  } catch {
    return { exists: true, value: null };
  }
}

/** 目录里有没有真实的用户数据（空目录/只有 runtime 不算） */
export function hasUserData(dir: string): boolean {
  if (!isDir(dir)) return false;
  for (const rel of ['library.json', 'data/library.json', 'user/notes.json']) {
    if (fs.existsSync(path.join(dir, rel))) return true;
  }
  const books = path.join(dir, 'books');
  try {
    return isDir(books) && fs.readdirSync(books).length > 0;
  } catch {
    return false;
  }
}

function oldConfigDir(): string {
  return path.join(app.getPath('appData'), APP_NAME_EN);
}

/** 找旧版数据：指针 → %APPDATA%\MoQiData → %APPDATA%\moqi-reader\data */
export function findLegacyData(): LegacyLocation | null {
  const candidates: LegacyLocation[] = [];

  const pointer = path.join(oldConfigDir(), 'data-root.txt');
  if (fs.existsSync(pointer)) {
    try {
      const raw = fs.readFileSync(pointer, 'utf8').replace(/^\uFEFF/, '').trim();
      if (raw) candidates.push({ dir: path.resolve(raw), kind: 'pointer' });
    } catch {
      /* ignore */
    }
  }

  candidates.push({
    dir: path.join(app.getPath('appData'), LEGACY_DATA_DIR_NAME),
    kind: 'default',
  });
  candidates.push({ dir: path.join(oldConfigDir(), 'data'), kind: 'v05-nested' });

  for (const candidate of candidates) {
    if (!hasUserData(candidate.dir)) continue;
    // 旧指针可能指向「容器」，数据在 data\ 里层
    if (hasUserData(path.join(candidate.dir, 'data'))) {
      return { ...candidate, dir: path.join(candidate.dir, 'data') };
    }
    return candidate;
  }
  return null;
}

function rewriteLibraryPaths(dataDir: string, oldDataDir: string): void {
  const file = path.join(dataDir, 'library.json');
  const parsed = readJsonStrict<BookMeta[]>(file);
  if (!parsed.exists) return;
  if (!Array.isArray(parsed.value)) throw new Error('library.json 读不出来');

  let changed = false;
  for (const meta of parsed.value) {
    for (const variant of meta.variants ?? []) {
      if (!variant.path) continue;
      if (!isInside(variant.path, oldDataDir)) continue;
      variant.path = path.join(dataDir, path.relative(oldDataDir, variant.path));
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(file, parsed.value);
}

function verifyCopy(source: string, target: string): void {
  const srcFiles = listFiles(source);
  for (const rel of srcFiles) {
    const a = path.join(source, rel);
    const b = path.join(target, rel);
    if (!fs.existsSync(b)) throw new Error(`新位置缺少文件：${rel}`);
    if (fs.statSync(a).size !== fs.statSync(b).size) {
      throw new Error(`文件大小不一致：${rel}`);
    }
  }

  const lib = readJsonStrict<BookMeta[]>(path.join(target, 'library.json'));
  if (lib.exists && !Array.isArray(lib.value)) throw new Error('library.json 读不出来');
  const srcLib = readJsonStrict<BookMeta[]>(path.join(source, 'library.json'));
  if (srcLib.exists && !Array.isArray(srcLib.value)) {
    throw new Error('旧 library.json 读不出来，为了不冒险已停止迁移');
  }
  if (
    Array.isArray(srcLib.value) &&
    Array.isArray(lib.value) &&
    srcLib.value.length !== lib.value.length
  ) {
    throw new Error('书架数量对不上，已停止迁移');
  }
}

/**
 * 把旧数据复制进 v0.8 的 Data。
 * 目标 Data 里只允许有 runtime；复制失败会清掉本次新增的顶层条目。
 */
export async function migrateLegacyData(
  sourceDir: string,
  targetDataDir: string,
  onProgress?: (p: MigrationProgress) => void
): Promise<MigrationResult> {
  if (path.resolve(sourceDir).toLowerCase() === path.resolve(targetDataDir).toLowerCase()) {
    return {
      migrated: false,
      source: sourceDir,
      files: 0,
      bytes: 0,
      error: '旧数据位置和新 Data 是同一个目录，跳过迁移',
    };
  }
  if (hasUserData(targetDataDir)) {
    return {
      migrated: false,
      source: sourceDir,
      files: 0,
      bytes: 0,
      error: '新 Data 已经有数据，跳过迁移',
    };
  }

  const files = listFiles(sourceDir);
  const before = new Set<string>();
  try {
    for (const name of fs.readdirSync(targetDataDir)) before.add(name);
  } catch {
    /* target 可能还不存在 */
  }

  const createdTop: string[] = [];
  let bytes = 0;
  try {
    await fs.promises.mkdir(targetDataDir, { recursive: true });
    onProgress?.({ phase: 'copy', done: 0, total: files.length, bytes: 0 });

    for (let i = 0; i < files.length; i += 1) {
      const rel = files[i];
      const src = path.join(sourceDir, rel);
      const dst = path.join(targetDataDir, rel);
      const top = rel.split(path.sep)[0];
      if (!before.has(top) && !createdTop.includes(top)) createdTop.push(top);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await fs.promises.copyFile(src, dst);
      try {
        bytes += fs.statSync(dst).size;
      } catch {
        /* ignore */
      }
      if (i % 10 === 0 || i === files.length - 1) {
        onProgress?.({ phase: 'copy', done: i + 1, total: files.length, bytes, name: rel });
      }
    }

    onProgress?.({ phase: 'verify', done: 0, total: 1, bytes });
    verifyCopy(sourceDir, targetDataDir);
    rewriteLibraryPaths(targetDataDir, sourceDir);

    const marker = path.join(targetDataDir, DATA_MARKER);
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(
        marker,
        JSON.stringify(
          { app: APP_NAME_EN, kind: 'data-dir', layout: 'flat', version: 3 },
          null,
          2
        ),
        'utf8'
      );
    }

    writeJsonAtomic(path.join(targetDataDir, LEGACY_IMPORT_FILE), {
      app: APP_NAME_EN,
      migratedAt: Date.now(),
      from: sourceDir,
      files: files.length,
      bytes,
    });

    onProgress?.({ phase: 'verify', done: 1, total: 1, bytes });
    return { migrated: true, source: sourceDir, files: files.length, bytes };
  } catch (err) {
    // 清掉本次新增的顶层条目，目标里原有的 runtime 不动
    for (const top of createdTop) {
      try {
        fs.rmSync(path.join(targetDataDir, top), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return {
      migrated: false,
      source: sourceDir,
      files: 0,
      bytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeName(raw: string): string {
  const name = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  return name || 'book.file';
}

/**
 * 把书库里的外部书复制进 Data\books\{id}\source，并改写路径。
 * 同时修复“整个文件夹被移动后绝对路径失效”的问题：原路径不存在时，
 * 只要 Data\books 里有同 id 的源文件就自动改回内部路径。
 */
export async function adoptExternalBooks(
  onProgress?: (done: number, total: number, title: string) => void
): Promise<AdoptResult> {
  const dataDir = paths.data();
  const library = readLibrary();
  let changed = false;
  let copied = 0;
  let updated = 0;
  const missing: string[] = [];

  for (let index = 0; index < library.length; index += 1) {
    const meta = library[index];
    for (const variant of meta.variants ?? []) {
      if (!variant.path) continue;
      const source = path.resolve(variant.path);
      const targetDir = path.join(paths.bookDir(meta.id), 'source');
      let target = path.join(targetDir, safeName(path.basename(source)));

      const sourceInside = isInside(source, dataDir);
      if (sourceInside && fs.existsSync(source)) continue;

      // 原路径失效 / 在外部：优先找 Data 里已经有的同 id 源文件
      if (!fs.existsSync(target) || fs.statSync(target).size !== variant.sizeBytes) {
        if (fs.existsSync(source) && !sourceInside) {
          try {
            await fs.promises.mkdir(targetDir, { recursive: true });
            let n = 2;
            while (fs.existsSync(target)) {
              const ext = path.extname(target);
              target = path.join(targetDir, `${path.basename(target, ext)}-${n++}${ext}`);
            }
            await fs.promises.copyFile(source, target);
            copied += 1;
          } catch {
            missing.push(`${meta.title}：${path.basename(source)}`);
            continue;
          }
        } else {
          missing.push(`${meta.title}：${path.basename(source)}`);
          continue;
        }
      }

      if (target !== variant.path) {
        variant.path = target;
        try {
          variant.sizeBytes = fs.statSync(target).size;
        } catch {
          /* ignore */
        }
        changed = true;
        updated += 1;
      }
    }
    onProgress?.(index + 1, library.length, meta.title);
    // 让浏览器/进度窗口有机会重绘
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (changed) writeLibrary(library);
  return { copied, updated, missing };
}

/** 书库里有「实际存在、但不在 Data 里」的书吗（用于决定要不要显示收书进度） */
export function hasExternalBooks(): boolean {
  const dataDir = paths.data();
  return readLibrary().some((meta) =>
    (meta.variants ?? []).some(
      (v) => !!v.path && !isInside(v.path, dataDir) && fs.existsSync(v.path)
    )
  );
}

/**
 * v0.8 书都收进 Data 了，旧 settings.libraryDirs 里的外部扫描目录要清掉，
 * 否则启动扫描会把同一本书按外部路径再加一遍，形成重复条目。
 */
export function clearExternalLibraryDirs(): void {
  const file = paths.settings();
  const parsed = readJsonStrict<Record<string, unknown>>(file);
  if (!parsed.exists || !parsed.value) return;
  const dirs = parsed.value.libraryDirs;
  if (!Array.isArray(dirs) || dirs.length === 0) return;
  writeJsonAtomic(file, { ...parsed.value, libraryDirs: [] });
}

/** 迁移成功后清掉旧版指针，避免旧路径继续被当回事 */
export function clearLegacyPointers(): void {
  for (const name of ['data-root.txt', 'data-root.previous.txt', 'migration.json']) {
    try {
      fs.rmSync(path.join(oldConfigDir(), name), { force: true });
    } catch {
      /* ignore */
    }
  }
}
