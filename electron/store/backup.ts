/**
 * 完整备份与恢复
 *
 * 一个压缩包里同时装下：书架索引、阅读进度、笔记、阅读时长、分类与偏好、书文件、封面。
 * 目标只有一个：换电脑时，用户不用懂 JSON、不用找路径、不用重新整理书架。
 *
 * 备份结构（全部收在 data/ 下，跟软件自己的数据目录一一对应）：
 *
 *   墨栖备份-2026-11-20-2140/
 *   ├── manifest.json          机器可读：版本、数量、是否含书
 *   ├── 导入说明.txt            人可读：怎么恢复
 *   └── data/
 *       ├── library.json        书架
 *       ├── settings.json       分类、笔记分类颜色、阅读目标
 *       ├── user/               progress / notes / sessions
 *       └── books/{id}/
 *           ├── cover.jpg
 *           └── source/书名.epub   原书文件（解析缓存不带，恢复后第一次打开自动重建）
 *
 * 兼容：旧版「墨栖个人数据-日期」文件夹（三个 json 直接放根目录）照样能导入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { readAppVersion } from '../version';
import iconv from 'iconv-lite';
import type { BookFormat, BookMeta, BookVariant, NoteCategoryDef, Settings } from '../../shared/models';
import { HIGHLIGHT_COLORS } from '../../shared/models';
import { FORMAT_QUALITY, readLibrary, writeLibrary } from './library';
import { paths } from './paths';
import { readJson, writeTextAtomic } from './json';
import {
  USER_FILES,
  countPayload,
  countUserData,
  getSettings,
  isNotesMap,
  isProgressMap,
  isSessionList,
  mergeUserData,
  minuteStamp,
  readUserDataPayload,
  saveSettings,
  type DataCounts,
  type NotesMap,
  type ProgressMap,
  type UserDataPayload,
} from './userdata';
import {
  ZipError,
  ZipTooLargeError,
  extractZipEntry,
  normalizeEntryName,
  readZipEntryBuffer,
  readZipIndex,
  writeZipArchive,
  type ZipIndexEntry,
  type ZipWriteEntry,
} from './zip';

export const BACKUP_FORMAT_VERSION = 2;
const APP_TAG = 'moqi-reader';

const EXT_FORMAT: Record<string, BookFormat> = {
  '.epub': 'epub',
  '.mobi': 'mobi',
  '.azw': 'mobi',
  '.azw3': 'mobi',
  '.pdf': 'pdf',
  '.txt': 'txt',
};

const COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

// ───────────────────────────── 公共类型 ─────────────────────────────

export interface BackupCounts extends DataCounts {
  /** 书架上有多少本 */
  shelf: number;
}

export interface BackupStats extends BackupCounts {
  /** 书文件总大小 */
  bookBytes: number;
  /** 记录类 json 的总大小 */
  recordBytes: number;
  bookFiles: number;
  lastBackupAt?: number;
}

export type BackupPhase = 'collect' | 'pack' | 'unpack' | 'books' | 'merge';

export interface BackupProgress {
  phase: BackupPhase;
  done: number;
  total: number;
  name?: string;
  bytes?: number;
}

export type BackupExportResult =
  | {
      ok: true;
      file: string;
      bytes: number;
      counts: BackupCounts;
      bookFiles: number;
      skipped: string[];
    }
  | { ok: false; canceled?: boolean; detail?: string; reason?: 'too-large' | 'write-error' };

export type RestoreFailReason =
  | 'unsupported'
  | 'not-moqi-data'
  | 'empty'
  | 'read-error'
  | 'zip-error';

export type BackupRestoreResult =
  | {
      ok: true;
      sourceKind: 'zip' | 'folder';
      source: string;
      /** 备份里带进来的量 */
      counts: BackupCounts;
      /** 合并之后这台电脑上的总量 */
      merged: BackupCounts;
      booksAdded: number;
      booksUpdated: number;
      booksSkipped: number;
      bookFiles: number;
      backupDir: string;
      warnings: string[];
      /** 旧版只有三个 json 的备份 */
      legacy: boolean;
      /** 这份备份里有没有书（旧版没有清单，按没有书处理） */
      includeBooks: boolean;
    }
  | { ok: false; canceled?: boolean; reason?: RestoreFailReason; detail?: string };

export interface BackupManifest {
  app: typeof APP_TAG;
  kind: 'moqi-backup';
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  includeBooks: boolean;
  counts: BackupCounts;
  bookFiles: number;
}

// ───────────────────────────── 小工具 ─────────────────────────────

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function baseOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** 存档里的文件名要能在 Windows 上解压出来，非法字符一律换成下划线 */
function safeFileName(raw: string, fallback = 'file'): string {
  let name = raw
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!name) name = fallback;
  if (name.length > 80) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, Math.max(1, 80 - ext.length)) + ext;
  }
  return name;
}

function isBookId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 96 &&
    /^[\w\u4e00-\u9fa5.-]+$/.test(id) &&
    !id.includes('..')
  );
}

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function sizeOfFile(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function readyForFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function defaultBackupName(): string {
  return `墨栖备份-${readyForFileName()}.zip`;
}

// ───────────────────────────── 概览 ─────────────────────────────

export function getBackupStats(): BackupStats {
  const library = readLibrary();
  const data = countUserData();

  let bookFiles = 0;
  let bookBytes = 0;
  const seen = new Set<string>();
  for (const meta of library) {
    for (const variant of meta.variants ?? []) {
      if (!variant?.path || seen.has(variant.path)) continue;
      seen.add(variant.path);
      const size = sizeOfFile(variant.path);
      if (size > 0) {
        bookFiles += 1;
        bookBytes += size;
      }
    }
  }

  const recordBytes =
    sizeOfFile(paths.library()) +
    sizeOfFile(paths.settings()) +
    sizeOfFile(paths.progress()) +
    sizeOfFile(paths.notes()) +
    sizeOfFile(paths.sessions());

  return {
    ...data,
    shelf: library.length,
    bookFiles,
    bookBytes,
    recordBytes,
    lastBackupAt: getSettings().lastBackupAt,
  };
}

// ───────────────────────────── 导出 ─────────────────────────────

interface PackPlan {
  entries: ZipWriteEntry[];
  library: BookMeta[];
  counts: BackupCounts;
  bookFiles: number;
  bookBytes: number;
  skipped: string[];
}

function collectPlan(includeBooks: boolean): PackPlan {
  const library = readLibrary();
  const payload = readUserDataPayload();
  const counts: BackupCounts = { ...countPayload(payload), shelf: library.length };
  const entries: ZipWriteEntry[] = [];
  const skipped: string[] = [];
  let bookFiles = 0;
  let bookBytes = 0;

  if (includeBooks) {
    for (const meta of library) {
      if (!isBookId(meta.id)) continue;
      const bookDir = paths.bookDir(meta.id);
      const prefix = `data/books/${meta.id}`;

      // 封面：先看索引里记的那个，文件不在了再按常见后缀找一遍
      const coverName = [meta.cover, ...COVER_EXTS.map((ext) => `cover.${ext}`)]
        .filter((name): name is string => !!name)
        .find(
          (name) =>
            COVER_EXTS.includes(path.extname(name).slice(1).toLowerCase()) &&
            existsFile(path.join(bookDir, name))
        );
      if (coverName && existsFile(path.join(bookDir, coverName))) {
        entries.push({
          name: `${prefix}/${coverName}`,
          file: path.join(bookDir, coverName),
          size: sizeOfFile(path.join(bookDir, coverName)),
        });
      }

      // 原书文件：同一本书可能有好几个格式，全部带走
      const used = new Set<string>();
      const files = [...new Set((meta.variants ?? []).map((v) => v.path).filter(Boolean))];
      for (const file of files) {
        const size = sizeOfFile(file);
        if (!size) {
          skipped.push(`${meta.title}：${path.basename(file)}（文件已不在原位置）`);
          continue;
        }
        try {
          fs.accessSync(file, fs.constants.R_OK);
        } catch {
          skipped.push(`${meta.title}：${path.basename(file)}（文件读不了，可能被占用）`);
          continue;
        }
        let name = safeFileName(path.basename(file), `${meta.id}.epub`);
        if (used.has(name.toLowerCase())) {
          const ext = path.extname(name);
          name = `${path.basename(name, ext)}-${used.size + 1}${ext}`;
        }
        used.add(name.toLowerCase());
        entries.push({ name: `${prefix}/source/${name}`, file, size });
        bookFiles += 1;
        bookBytes += size;
      }
    }
  }

  return { entries, library, counts, bookFiles, bookBytes, skipped };
}

function guideText(manifest: BackupManifest, skipped: string[]): string {
  const lines = [
    '这是「墨栖」的完整备份。',
    `备份于 ${new Date(manifest.createdAt).toLocaleString('zh-CN')} · 软件版本 ${manifest.appVersion}`,
    '',
    `包含：书架 ${manifest.counts.shelf} 本 · 书文件 ${manifest.bookFiles} 个 · 笔记 ${manifest.counts.notes} 条 · 阅读记录 ${manifest.counts.days} 天`,
    '',
    '怎么恢复：',
    '1. 打开墨栖 → 工作台右上角「数据备份与恢复」',
    '2. 点「恢复备份」里的「压缩包」，选中这个 zip（不用先解压）',
    '   已经解压了也可以点旁边的「文件夹」，选中解压出来的文件夹',
    '3. 等进度走完，看到「恢复完成」就好了',
    '',
    '说明：',
    '· 导入是「只补不覆盖」：这台电脑上已有的书和笔记不会被删掉，重复导入也不会产生重复。',
    '· 书文件会被复制进墨栖自己的数据目录，原文件不受影响。',
    '· 恢复后第一次打开某本书会重新排版（几秒钟），之后照常秒开。',
    '· 导入前会自动把当前数据备份到数据目录的 backups 文件夹。',
    '',
  ];
  if (!manifest.includeBooks) {
    lines.push(
      '注意：这份备份没有包含书文件和书架，只恢复笔记、阅读进度、统计与分类。',
      '换电脑后需要重新添加书。',
      ''
    );
  }
  if (skipped.length) {
    lines.push('导出时这些文件已经不在原位置，没能打包：', ...skipped.map((s) => `· ${s}`), '');
  }
  return lines.join('\n');
}

const MANIFEST_ENTRY = 'manifest.json';
const GUIDE_ENTRY = '导入说明.txt';

export async function exportBackup(
  targetFile: string,
  options: { includeBooks: boolean },
  onProgress?: (p: BackupProgress) => void
): Promise<BackupExportResult> {
  try {
    onProgress?.({ phase: 'collect', done: 0, total: 1 });
    const plan = collectPlan(!!options.includeBooks);

    const manifest: BackupManifest = {
      app: APP_TAG,
      kind: 'moqi-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: readAppVersion(),
      createdAt: Date.now(),
      includeBooks: !!options.includeBooks,
      counts: plan.counts,
      bookFiles: plan.bookFiles,
    };

    const entries: ZipWriteEntry[] = [
      { name: MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: GUIDE_ENTRY, data: Buffer.from(guideText(manifest, plan.skipped), 'utf8') },
      { name: 'data/library.json', data: Buffer.from(JSON.stringify(plan.library, null, 2), 'utf8') },
      {
        name: 'data/settings.json',
        data: Buffer.from(JSON.stringify(pickPortableSettings(getSettings()), null, 2), 'utf8'),
      },
      ...plan.entries,
    ];

    for (const file of USER_FILES) {
      const src = path.join(paths.user(), file);
      if (existsFile(src)) {
        entries.push({ name: `data/user/${file}`, file: src, size: sizeOfFile(src) });
      }
    }

    let last = 0;
    const { bytes } = await writeZipArchive(targetFile, entries, (p) => {
      const now = Date.now();
      if (now - last < 120 && p.done < p.total) return;
      last = now;
      onProgress?.({ phase: 'pack', done: p.done, total: p.total, name: p.name, bytes: p.bytes });
    });

    // 记一笔「上次备份时间」。这里失败不该把已经成功的导出判成失败。
    try {
      saveSettings({ lastBackupAt: Date.now() });
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      file: targetFile,
      bytes,
      counts: plan.counts,
      bookFiles: plan.bookFiles,
      skipped: plan.skipped,
    };
  } catch (err) {
    if (err instanceof ZipTooLargeError) return { ok: false, reason: 'too-large', detail: err.message };
    return {
      ok: false,
      reason: 'write-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 只带走「跟着用户走」的设置：分类、笔记分类颜色、每日目标。主题字号这些跟机器走更合理。 */
function pickPortableSettings(settings: Settings): Partial<Settings> {
  return {
    categories: settings.categories,
    noteCategories: settings.noteCategories,
    dailyGoalMinutes: settings.dailyGoalMinutes,
  };
}

// ───────────────────────────── 读取源：文件夹 / zip ─────────────────────────────

interface BackupSource {
  kind: 'zip' | 'folder';
  names: string[];
  readText(rel: string): Promise<string | null>;
  copyTo(rel: string, dest: string): Promise<void>;
  dispose(): Promise<void>;
}

function walkFolder(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, rel: string, depth: number): void => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '__MACOSX' || entry.name === '.DS_Store') continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), next, depth + 1);
      else if (entry.isFile()) out.push(next);
    }
  };
  visit(root, '', 0);
  return out;
}

/** 老版本导出的 json 可能是记事本另存的 GBK，尽量认出来 */
function decodeText(buf: Buffer): string {
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  if (Buffer.from(text, 'utf8').equals(buf)) return text;
  try {
    return iconv.decode(buf, 'gbk').replace(/^\uFEFF/, '');
  } catch {
    return text;
  }
}

function openFolderSource(root: string): BackupSource {
  return {
    kind: 'folder',
    names: walkFolder(root),
    async readText(rel) {
      const target = path.join(root, ...rel.split('/'));
      try {
        return decodeText(await fs.promises.readFile(target));
      } catch {
        return null;
      }
    },
    async copyTo(rel, dest) {
      const target = path.join(root, ...rel.split('/'));
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(target, dest);
    },
    async dispose() {
      /* 文件夹是用户自己的，什么都不用清理 */
    },
  };
}

async function openZipSource(file: string): Promise<BackupSource> {
  const index = await readZipIndex(file);
  const map = new Map<string, ZipIndexEntry>();
  for (const entry of index) {
    if (entry.isDir) continue;
    const name = normalizeEntryName(entry.name);
    if (name) map.set(name, entry);
  }
  return {
    kind: 'zip',
    names: [...map.keys()],
    async readText(rel) {
      const entry = map.get(rel);
      if (!entry) return null;
      if (entry.uncompressedSize > 64 * 1024 * 1024) throw new ZipError('备份里的数据文件异常偏大');
      return decodeText(await readZipEntryBuffer(file, entry));
    },
    async copyTo(rel, dest) {
      const entry = map.get(rel);
      if (!entry) throw new ZipError(`压缩包里找不到 ${rel}`);
      await extractZipEntry(file, entry, dest);
    },
    async dispose() {
      /* 没有句柄要关 */
    },
  };
}

async function openSource(sourcePath: string): Promise<BackupSource> {
  const stat = await fs.promises.stat(sourcePath);
  if (stat.isDirectory()) return openFolderSource(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext !== '.zip') {
    throw new ZipError(
      ext === '.7z' || ext === '.rar'
        ? '这种压缩格式墨栖暂时读不了，请先解压成文件夹，或用 ZIP 重新打包'
        : '请选择 .zip 压缩包，或者已经解压的文件夹'
    );
  }
  return openZipSource(sourcePath);
}

// ───────────────────────────── 定位备份里的数据 ─────────────────────────────

interface Layout {
  dataDir: string;
  libraryPath: string | null;
  settingsPath: string | null;
  userPaths: Partial<Record<(typeof USER_FILES)[number], string>>;
}

function byDepth(a: string, b: string): number {
  return a.split('/').length - b.split('/').length || a.length - b.length;
}

function pickPath(names: string[], pattern: RegExp): string | null {
  return names.filter((n) => pattern.test(n)).sort(byDepth)[0] ?? null;
}

function detectLayout(source: BackupSource): Layout | null {
  const names = source.names;

  const progress =
    pickPath(names, /(^|\/)data\/user\/progress\.json$/) ??
    pickPath(names, /(^|\/)user\/progress\.json$/) ??
    pickPath(names, /(^|\/)progress\.json$/);

  let dataDir: string | null = null;
  if (progress) {
    const userDir = dirnameOf(progress);
    dataDir = /(^|\/)user$/.test(userDir) ? dirnameOf(userDir) : userDir;
  }

  const libraryPath =
    pickPath(names, /(^|\/)data\/library\.json$/) ?? pickPath(names, /(^|\/)library\.json$/);
  if (dataDir === null && libraryPath) dataDir = dirnameOf(libraryPath);

  // 只带了一部分（比如只有 notes.json）也要认
  if (dataDir === null) {
    const anyUser = pickPath(names, /(^|\/)(notes|sessions)\.json$/);
    if (anyUser) {
      const dir = dirnameOf(anyUser);
      dataDir = /(^|\/)user$/.test(dir) ? dirnameOf(dir) : dir;
    }
  }

  if (dataDir === null) return null;

  const userPaths: Layout['userPaths'] = {};
  for (const file of USER_FILES) {
    const preferred = joinRel(joinRel(dataDir, 'user'), file);
    const flat = joinRel(dataDir, file);
    const found = names.includes(preferred)
      ? preferred
      : names.includes(flat)
        ? flat
        : pickPath(names, new RegExp(`(^|/)${file.replace('.', '\\.')}$`));
    if (found) userPaths[file] = found;
  }

  return {
    dataDir,
    libraryPath,
    settingsPath:
      names.includes(joinRel(dataDir, 'settings.json'))
        ? joinRel(dataDir, 'settings.json')
        : pickPath(names, /(^|\/)settings\.json$/),
    userPaths,
  };
}

// ───────────────────────────── 校验 ─────────────────────────────

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitizeLibrary(value: unknown): BookMeta[] {
  if (!Array.isArray(value)) return [];
  const formats: BookFormat[] = ['epub', 'mobi', 'pdf', 'txt'];
  const out: BookMeta[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !isBookId(o.id)) continue;
    if (typeof o.title !== 'string' || !o.title.trim()) continue;
    const format = formats.includes(o.format as BookFormat) ? (o.format as BookFormat) : 'txt';
    out.push({
      id: o.id,
      title: o.title,
      author: typeof o.author === 'string' && o.author ? o.author : '未知作者',
      publisher: typeof o.publisher === 'string' ? o.publisher : undefined,
      cover: typeof o.cover === 'string' ? o.cover : undefined,
      format,
      variants: [],
      totalChars: Number(o.totalChars) || 0,
      chapterCount: Number(o.chapterCount) || 0,
      addedAt: Number(o.addedAt) || Date.now(),
      lastOpenedAt: Number(o.lastOpenedAt) || undefined,
      currentChapterTitle:
        typeof o.currentChapterTitle === 'string' ? o.currentChapterTitle : undefined,
      categories: Array.isArray(o.categories)
        ? [...new Set(o.categories.filter((c): c is string => typeof c === 'string' && !!c))]
        : undefined,
    });
  }
  return out;
}

function sanitizeSettings(value: unknown): Partial<Settings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (Array.isArray(o.categories)) {
    out.categories = [...new Set(o.categories.filter((c): c is string => typeof c === 'string' && !!c))];
  }
  if (Array.isArray(o.noteCategories)) {
    const seen = new Set<string>();
    const cats: NoteCategoryDef[] = [];
    for (const item of o.noteCategories) {
      if (!item || typeof item !== 'object') continue;
      const c = item as Record<string, unknown>;
      if (typeof c.name !== 'string' || !c.name.trim() || seen.has(c.name)) continue;
      const color = (HIGHLIGHT_COLORS as string[]).includes(String(c.color))
        ? (c.color as NoteCategoryDef['color'])
        : 'clay';
      seen.add(c.name);
      cats.push({ name: c.name, color });
    }
    if (cats.length) out.noteCategories = cats;
  }
  if (typeof o.dailyGoalMinutes === 'number' && o.dailyGoalMinutes > 0) {
    out.dailyGoalMinutes = o.dailyGoalMinutes;
  }
  return out;
}

// ───────────────────────────── 安全备份 ─────────────────────────────

function createSafetyBackup(): string {
  const root = paths.backups();
  let dir = path.join(root, minuteStamp());
  let n = 2;
  while (fs.existsSync(dir)) dir = path.join(root, `${minuteStamp()}-${n++}`);
  fs.mkdirSync(dir, { recursive: true });

  for (const file of ['library.json', 'settings.json']) {
    const src = path.join(paths.data(), file);
    if (existsFile(src)) fs.copyFileSync(src, path.join(dir, file));
  }
  const userDir = path.join(dir, 'user');
  fs.mkdirSync(userDir, { recursive: true });
  for (const file of USER_FILES) {
    const src = path.join(paths.user(), file);
    if (existsFile(src)) fs.copyFileSync(src, path.join(userDir, file));
  }

  writeTextAtomic(
    path.join(dir, '说明.txt'),
    [
      '这是墨栖在导入备份之前，自动给「这台电脑原来的数据」留的一份底。',
      `时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '如果导入后发现不对劲，把这里的 library.json、settings.json、user/ 三个文件复制回数据目录即可。',
      '平时可以不管它，也可以随时删掉。',
      '',
    ].join('\n')
  );

  return path.relative(paths.data(), dir).split(path.sep).join('/');
}

// ───────────────────────────── 恢复书 ─────────────────────────────

interface RestoredBook {
  variants: BookVariant[];
  cover?: string;
}

async function restoreBooks(
  source: BackupSource,
  dataDir: string,
  library: BookMeta[],
  onProgress?: (p: BackupProgress) => void
): Promise<{ restored: Map<string, RestoredBook>; files: number; skipped: number; warnings: string[] }> {
  const restored = new Map<string, RestoredBook>();
  const warnings: string[] = [];
  const booksRoot = `${joinRel(dataDir, 'books')}/`;
  let files = 0;
  let skipped = 0;
  let lastTick = 0;

  // 先把「书 id → 源文件列表」分好组，避免每本书都扫一遍全部条目
  const byId = new Map<string, string[]>();
  for (const name of source.names) {
    if (!name.startsWith(booksRoot)) continue;
    const rest = name.slice(booksRoot.length);
    const id = rest.split('/')[0];
    if (!id || !isBookId(id)) continue;
    const list = byId.get(id) ?? [];
    list.push(name);
    byId.set(id, list);
  }

  for (let i = 0; i < library.length; i += 1) {
    const meta = library[i];
    const now = Date.now();
    if (now - lastTick > 120 || i === library.length - 1) {
      lastTick = now;
      onProgress?.({ phase: 'books', done: i, total: library.length, name: meta.title });
    }

    const entries = byId.get(meta.id) ?? [];
    const sourceNames = entries.filter((n) => n.startsWith(`${booksRoot}${meta.id}/source/`));
    if (!sourceNames.length) {
      skipped += 1;
      continue;
    }

    const destDir = paths.bookDir(meta.id);
    const destSource = path.join(destDir, 'source');
    try {
      fs.mkdirSync(destSource, { recursive: true });
    } catch (err) {
      warnings.push(`${meta.title}：无法创建目录 ${err instanceof Error ? err.message : ''}`);
      skipped += 1;
      continue;
    }

    const variants: BookVariant[] = [];
    const used = new Set<string>();
    for (const rel of sourceNames) {
      let name = safeFileName(baseOf(rel));
      const format = EXT_FORMAT[path.extname(name).toLowerCase()];
      if (!format) continue;

      // 同一个包里出现同名文件时换个名字；跨次导入则直接覆盖，不会越导越多
      if (used.has(name.toLowerCase())) {
        const ext = path.extname(name);
        name = `${path.basename(name, ext)}-${used.size + 1}${ext}`;
      }
      used.add(name.toLowerCase());

      const dest = path.join(destSource, name);
      try {
        await source.copyTo(rel, dest);
      } catch (err) {
        warnings.push(`${meta.title}：${name} 复制失败（${err instanceof Error ? err.message : '未知错误'}）`);
        continue;
      }
      files += 1;

      const existing = variants.find((v) => v.format === format);
      const variant: BookVariant = {
        format,
        path: dest,
        sizeBytes: sizeOfFile(dest),
        quality: FORMAT_QUALITY[format],
      };
      if (!existing) variants.push(variant);
      else if (variant.sizeBytes > existing.sizeBytes) variants.splice(variants.indexOf(existing), 1, variant);
    }

    if (!variants.length) {
      skipped += 1;
      continue;
    }

    // 封面
    let cover: string | undefined;
    for (const ext of COVER_EXTS) {
      const rel = `${booksRoot}${meta.id}/cover.${ext}`;
      if (!entries.includes(rel)) continue;
      const dest = path.join(destDir, `cover.${ext}`);
      try {
        await source.copyTo(rel, dest);
        cover = `cover.${ext}`;
        break;
      } catch {
        /* 封面失败不影响正文 */
      }
    }

    restored.set(meta.id, { variants, cover });
  }

  onProgress?.({ phase: 'books', done: library.length, total: library.length });
  return { restored, files, skipped, warnings };
}

function mergeLibrary(
  incoming: BookMeta[],
  restored: Map<string, RestoredBook>
): { library: BookMeta[]; added: number; updated: number; skipped: number } {
  const current = readLibrary();
  const list = [...current];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const meta of incoming) {
    const book = restored.get(meta.id);
    if (!book) {
      skipped += 1;
      continue;
    }

    const index = list.findIndex((b) => b.id === meta.id);
    if (index < 0) {
      const best = [...book.variants].sort((a, b) => b.quality - a.quality)[0];
      list.push({
        ...meta,
        format: best.format,
        variants: book.variants,
        cover: book.cover ?? meta.cover,
      });
      added += 1;
      continue;
    }

    const existing = list[index];
    const variants = [...(existing.variants ?? [])];
    for (const variant of book.variants) {
      const same = variants.findIndex((v) => v.format === variant.format);
      if (same < 0) variants.push(variant);
      else if (!existsFile(variants[same].path)) variants[same] = variant;
    }

    const format = variants.some((v) => v.format === existing.format)
      ? existing.format
      : [...variants].sort((a, b) => b.quality - a.quality)[0]?.format ?? existing.format;

    list[index] = {
      ...existing,
      variants,
      format,
      cover: existing.cover && existsFile(path.join(paths.bookDir(existing.id), existing.cover))
        ? existing.cover
        : book.cover ?? existing.cover,
      categories: [
        ...new Set([...(existing.categories ?? []), ...(meta.categories ?? [])]),
      ],
      lastOpenedAt: Math.max(existing.lastOpenedAt ?? 0, meta.lastOpenedAt ?? 0) || undefined,
      totalChars: existing.totalChars || meta.totalChars,
      chapterCount: existing.chapterCount || meta.chapterCount,
      publisher: existing.publisher ?? meta.publisher,
    };
    updated += 1;
  }

  if (added || updated) writeLibrary(list);
  return { library: list, added, updated, skipped };
}

// ───────────────────────────── 恢复设置 ─────────────────────────────

function mergePortableSettings(incoming: Partial<Settings>): void {
  if (!Object.keys(incoming).length) return;
  const current = getSettings();
  const patch: Partial<Settings> = {};

  if (incoming.categories?.length) {
    const merged = [...new Set([...(current.categories ?? []), ...incoming.categories])];
    if (merged.length !== (current.categories ?? []).length) patch.categories = merged;
  }

  if (incoming.noteCategories?.length) {
    const currentCats = current.noteCategories ?? [];
    const used = new Set(currentCats.map((c) => c.color));
    const merged = [...currentCats];
    for (const cat of incoming.noteCategories) {
      if (merged.some((c) => c.name === cat.name)) continue;
      const color = used.has(cat.color)
        ? HIGHLIGHT_COLORS.find((c) => !used.has(c)) ?? cat.color
        : cat.color;
      used.add(color);
      merged.push({ name: cat.name, color });
    }
    if (merged.length !== currentCats.length) patch.noteCategories = merged;
  }

  if (incoming.dailyGoalMinutes) {
    // 只有本机从来没设过（settings.json 里没有这个字段）才用备份里的值，
    // 本机设过就以本机为准 —— 阅读目标更像是「当前的习惯」。
    const raw = readJson<Partial<Settings>>(paths.settings(), {});
    if (raw.dailyGoalMinutes === undefined) patch.dailyGoalMinutes = incoming.dailyGoalMinutes;
  }

  if (Object.keys(patch).length) saveSettings(patch);
}

// ───────────────────────────── 恢复主流程 ─────────────────────────────

export async function restoreBackup(
  sourcePath: string,
  onProgress?: (p: BackupProgress) => void
): Promise<BackupRestoreResult> {
  let source: BackupSource | null = null;
  try {
    onProgress?.({ phase: 'unpack', done: 0, total: 1 });
    source = await openSource(sourcePath);

    const layout = detectLayout(source);
    if (!layout) {
      return {
        ok: false,
        reason: 'not-moqi-data',
        detail: '没有找到 library.json / progress.json / notes.json / sessions.json',
      };
    }

    // 清单可能就在包的根目录，也可能被用户重新打包到一个上层文件夹里
    const manifestPath =
      (source.names.includes('manifest.json') ? 'manifest.json' : null) ??
      (layout.dataDir ? `${dirnameOf(layout.dataDir)}/manifest.json`.replace(/^\//, '') : null) ??
      pickPath(source.names, /(^|\/)manifest\.json$/);
    const manifestRaw = manifestPath ? parseJson(await source.readText(manifestPath)) : null;
    const manifest =
      manifestRaw && typeof manifestRaw === 'object' && !Array.isArray(manifestRaw)
        ? (manifestRaw as Partial<BackupManifest>)
        : null;
    const formatVersion = typeof manifest?.formatVersion === 'number' ? manifest.formatVersion : 0;

    // ── 先把所有内容读进内存并校验，任何一项不合格都不落盘 ──
    const libraryRaw = layout.libraryPath ? parseJson(await source.readText(layout.libraryPath)) : null;
    const incomingLibrary = sanitizeLibrary(libraryRaw);

    const userPayload: UserDataPayload = { progress: {}, notes: {}, sessions: [] };
    const readErrors: string[] = [];

    const progressPath = layout.userPaths['progress.json'];
    if (progressPath) {
      const raw = parseJson(await source.readText(progressPath));
      if (isProgressMap(raw)) Object.assign(userPayload.progress, raw as ProgressMap);
      else if (raw !== null) readErrors.push('progress.json');
    }

    const notesPath = layout.userPaths['notes.json'];
    if (notesPath) {
      const raw = parseJson(await source.readText(notesPath));
      if (isNotesMap(raw)) Object.assign(userPayload.notes, raw as NotesMap);
      else if (raw !== null) readErrors.push('notes.json');
    }

    const sessionsPath = layout.userPaths['sessions.json'];
    if (sessionsPath) {
      const raw = parseJson(await source.readText(sessionsPath));
      if (isSessionList(raw)) userPayload.sessions.push(...raw);
      else if (raw !== null) readErrors.push('sessions.json');
    }

    const incomingSettings = layout.settingsPath
      ? sanitizeSettings(parseJson(await source.readText(layout.settingsPath)))
      : {};

    const counts: BackupCounts = { ...countPayload(userPayload), shelf: incomingLibrary.length };
    const hasAny = counts.books + counts.notes + counts.sessions + counts.shelf > 0;
    if (!hasAny) {
      return {
        ok: false,
        reason: readErrors.length ? 'read-error' : 'empty',
        detail: readErrors.length ? `${readErrors.join(' / ')} 解析失败` : '备份里没有可恢复的内容',
      };
    }

    onProgress?.({ phase: 'merge', done: 0, total: 1 });

    // ── 校验通过：先给当前数据留底，再写 ──
    const backupDir = createSafetyBackup();

    const { restored, files, warnings } = await restoreBooks(
      source,
      layout.dataDir,
      incomingLibrary,
      onProgress
    );

    if (layout.libraryPath && libraryRaw === null) {
      warnings.push('书架索引读不出来，这次只恢复了笔记与阅读记录。');
    }

    const { added, updated, skipped } = mergeLibrary(incomingLibrary, restored);
    const mergedUser = mergeUserData(userPayload);
    mergePortableSettings(incomingSettings);

    const merged: BackupCounts = { ...mergedUser, shelf: readLibrary().length };

    if (formatVersion > BACKUP_FORMAT_VERSION) {
      warnings.unshift('这份备份来自更新版本的墨栖，可能有内容读不出来，建议先升级软件。');
    }

    return {
      ok: true,
      sourceKind: source.kind,
      source: sourcePath,
      counts,
      merged,
      booksAdded: added,
      booksUpdated: updated,
      booksSkipped: skipped,
      bookFiles: files,
      backupDir,
      warnings: warnings.slice(0, 6),
      legacy: !layout.libraryPath,
      includeBooks: manifest ? manifest.includeBooks !== false : files > 0,
    };
  } catch (err) {
    if (err instanceof ZipError) {
      return { ok: false, reason: 'zip-error', detail: err.message };
    }
    return {
      ok: false,
      reason: 'read-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await source?.dispose();
  }
}

