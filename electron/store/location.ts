/**
 * 数据位置：规划 / 迁移 / 旧位置清理（v0.6 扁平结构，v0.7 加固）
 *
 * 数据目录本身就是 MoQiData 这一层，library.json / books / user 直接放在里面，
 * 不再套一层 data。迁移是一套「校验 → 快照 → 复制 → 校验 → 落位 → 记指针 → 延迟清理」的流程，
 * 不做原地 rename（跨盘会失败），也不在迁移过程中删除任何东西。
 *
 * v0.7 增加：
 *   · 目标已存在时：复用 / 覆盖（先改名备份） / 重命名 / 取消
 *   · 迁移前关键 JSON 快照（backups/migration-<时间戳>/）
 *   · 每文件大小 + JSON 解析 + 书数校验，不再只看文件数量
 *   · 移动模式保留 7 天，设置页可「立即清理」或「保留」
 *   · previous pointer + migration.json，崩溃/新位置打不开时可回滚
 *
 * 兼容 v0.5.x：旧的「容器 + data」目录仍能被认出来（isMoqiDataDir 看 data\ 里层），
 * 但新落位一律用扁平结构。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BookMeta } from '../../shared/models';
import { APP_NAME_EN } from '../../shared/names.generated';
import {
  DATA_MARKER,
  LEGACY_DATA_DIR_NAME,
  POINTER_PREV_FILE,
  clearDataRootPointer,
  configDir,
  defaultDataDir,
  effectiveDefaultDataDir,
  getDataRootInfo,
  getPreviousDataDir,
  isPortable,
  programDir,
  setDataRootPointer,
} from './paths';
import { readJson, writeJsonAtomic } from './json';

export type ExistingKind = 'none' | 'moqi' | 'other';
export type ExistingAction = 'reuse' | 'replace' | 'rename' | 'cancel';
export type LocationInvalid =
  | 'empty'
  | 'relative'
  | 'missing-parent'
  | 'not-directory'
  | 'too-long'
  | 'reserved-name'
  | 'illegal-char'
  | 'protected'
  | 'program-dir';

export interface LocationPlan {
  /** 用户选中的上级目录 */
  parent: string;
  /** 数据根目录（v0.6 扁平结构下就等于数据目录） */
  root: string;
  /** 真正的数据目录：flat = root */
  dataDir: string;
  /** 选的就是现在的位置 */
  same: boolean;
  /** 选到了当前数据目录里面 */
  inside: boolean;
  /** 目标位置已经有什么 */
  existing: ExistingKind;
  /** 目标存在但是空目录 */
  empty: boolean;
  /** 目标卷剩余空间（拿不到时 undefined） */
  freeBytes?: number;
  /** 规划阶段就能判定的非法情况 */
  invalid?: LocationInvalid;
  /** 给用户看的一句话 */
  detail?: string;
}

export interface RelocateProgress {
  done: number;
  total: number;
  bytes: number;
}

export interface PendingCleanup {
  old: string;
  at: number;
  deleteAfter: number;
}

export type RelocateResult =
  | {
      ok: true;
      root: string;
      dataDir: string;
      files: number;
      bytes: number;
      /** 顺手复制进新数据目录的外部书数量 */
      adopted: number;
      /** 外部书复制失败的清单 */
      missing: string[];
      /** 本次是复制还是移动 */
      mode: RelocateMode;
      /** 复用了目标已有数据，没有复制 */
      reused?: boolean;
      /** 迁移前关键 JSON 快照目录 */
      backupDir?: string;
      /** 被改名保留下来的旧目标目录 */
      asideDir?: string;
      /** 移动模式下旧位置的计划清理时间 */
      deleteAfter?: number;
    }
  | {
      ok: false;
      canceled?: boolean;
      reason: 'inside' | 'same' | 'conflict' | 'io' | 'invalid' | 'space' | 'canceled';
      detail?: string;
      root?: string;
      dataDir?: string;
    };

export type RelocateTarget = { kind: 'custom'; parent: string } | { kind: 'default' };

/** copy = 复制后保留旧数据；move = 复制校验后，旧目录保留 deleteAfter 再清理 */
export type RelocateMode = 'copy' | 'move';

export interface RelocateOptions {
  /** 目标已存在时的处理方式；不传 = 保守拒绝 */
  existingAction?: ExistingAction;
  /** action = rename 时，旧目标的新名字（只取末级名，必须同层） */
  renameTo?: string;
  /** move 模式旧目录保留天数，默认 7 */
  keepOldDays?: number;
  /** 测试/诊断用：跳过磁盘空间预检 */
  skipSpaceCheck?: boolean;
  onProgress?: (p: RelocateProgress) => void;
}

const TMP_PREFIX = '.moqi-data-tmp-';
const CLEANUP_FILE = 'pending-cleanup.json';
const JOURNAL_FILE = 'migration.json';
const DEFAULT_KEEP_DAYS = 7;
const DAY = 86_400_000;
const MAX_PATH = 240;

function lower(p: string): string {
  return path.resolve(p).toLowerCase();
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isEmptyDir(p: string): boolean {
  try {
    return isDir(p) && fs.readdirSync(p).length === 0;
  } catch {
    return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const c = lower(child);
  const p = lower(parent);
  return c === p || c.startsWith(`${p}${path.sep}`);
}

/** 严格在内部（不含「就是它自己」） */
function strictlyInside(child: string, parent: string): boolean {
  const c = lower(child);
  const p = lower(parent);
  return c !== p && c.startsWith(`${p}${path.sep}`);
}

function isInsideOrEqual(child: string, parent: string): boolean {
  return isInside(child, parent);
}

function stamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function hasReservedName(target: string): boolean {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  return target
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => reserved.test(segment));
}

function hasIllegalChar(target: string): boolean {
  // 盘符里的冒号是合法的；ADS / 其余 < > " | ? * 一律拒绝。
  const rest = target.replace(/^[a-zA-Z]:/, '');
  return /[<>:"|?*\u0000-\u001f]/.test(rest);
}

function protectedRoots(): string[] {
  const env = process.env;
  return [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    env.WINDIR,
    env.ProgramData,
  ]
    .filter((p): p is string => !!p)
    .map((p) => path.resolve(p));
}

function isProtected(target: string): boolean {
  return protectedRoots().some((p) => isInsideOrEqual(target, p));
}

/**
 * 程序目录与数据目录不能互相包含。
 * 便携版的默认数据 `<exeDir>\MoQiData` 是唯一例外：它就在程序目录里，但这是设计。
 */
function overlapsProgram(target: string): boolean {
  const prog = programDir();
  if (!prog) return false;
  if (isPortable() && lower(target) === lower(path.join(prog, LEGACY_DATA_DIR_NAME))) return false;
  return isInsideOrEqual(target, prog) || isInsideOrEqual(prog, target);
}

function freeSpaceOf(dir: string): number | undefined {
  try {
    const stat = fs.statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return undefined;
  }
}

/** 认出「这确实是墨栖的数据」：扁平目录，或 v0.5.x 的容器 + data */
export function isMoqiDataDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    if (fs.existsSync(path.join(dir, DATA_MARKER))) return true;
    if (
      fs.existsSync(path.join(dir, 'library.json')) ||
      fs.existsSync(path.join(dir, 'user', 'notes.json'))
    ) {
      return true;
    }
    // v0.5.x：数据在容器的 data\ 里层
    const nested = path.join(dir, 'data');
    return (
      fs.existsSync(path.join(nested, DATA_MARKER)) ||
      fs.existsSync(path.join(nested, 'library.json'))
    );
  } catch {
    return false;
  }
}

/** 用户选中的目录 → 实际要创建的数据目录（扁平：末级固定 MoQiData，数据直接放里面） */
export function planDataLocation(parent: string): LocationPlan {
  let raw = (parent ?? '').trim();
  const current = getDataRootInfo();
  const base: LocationPlan = {
    parent: raw,
    root: '',
    dataDir: '',
    same: false,
    inside: false,
    existing: 'none',
    empty: false,
  };

  if (!raw) {
    return { ...base, invalid: 'empty', detail: '请选择一个文件夹。' };
  }
  // 允许用户直接输入 D: / D:\，统一成 D:\ 再判断
  if (/^[a-zA-Z]:$/.test(raw)) raw = `${raw}${path.sep}`;
  if (!path.isAbsolute(raw)) {
    return { ...base, invalid: 'relative', detail: '请使用完整的绝对路径。' };
  }

  const resolved = path.resolve(raw);
  const root =
    path.basename(resolved).toLowerCase() === LEGACY_DATA_DIR_NAME.toLowerCase()
      ? resolved
      : path.join(resolved, LEGACY_DATA_DIR_NAME);
  const plan: LocationPlan = {
    ...base,
    parent: resolved,
    root,
    dataDir: root,
    freeBytes: freeSpaceOf(resolved),
  };

  if (!isDir(resolved)) {
    return { ...plan, invalid: 'missing-parent', detail: '这个文件夹不存在，请重新选择。' };
  }
  if (root.length > MAX_PATH) {
    return {
      ...plan,
      invalid: 'too-long',
      detail: `这个位置太长了（超过 ${MAX_PATH} 个字符），请换一个更浅的目录。`,
    };
  }
  if (hasIllegalChar(root)) {
    return {
      ...plan,
      invalid: 'illegal-char',
      detail: '路径里有 Windows 不允许的字符（< > : " | ? *）。',
    };
  }
  if (hasReservedName(root)) {
    return {
      ...plan,
      invalid: 'reserved-name',
      detail: '路径里有 Windows 保留名（CON / PRN / AUX / NUL / COM1-9 / LPT1-9）。',
    };
  }
  if (isProtected(root)) {
    return {
      ...plan,
      invalid: 'protected',
      detail: '不要放在系统受保护目录（Program Files / Windows / ProgramData）。',
    };
  }
  if (overlapsProgram(root)) {
    return {
      ...plan,
      invalid: 'program-dir',
      detail: '数据目录不能和程序目录互相包含，请分开存放。',
    };
  }
  if (fs.existsSync(root) && !isDir(root)) {
    return { ...plan, invalid: 'not-directory', detail: '这个位置已经有一个同名文件，不能当数据目录。' };
  }

  const empty = isEmptyDir(root);
  const existing: ExistingKind = !fs.existsSync(root)
    ? 'none'
    : empty
      ? 'none'
      : isMoqiDataDir(root)
        ? 'moqi'
        : 'other';

  const same =
    lower(root) === lower(current.root) || lower(root) === lower(current.dataDir);
  const inside =
    strictlyInside(resolved, current.root) ||
    strictlyInside(resolved, current.dataDir) ||
    strictlyInside(root, current.dataDir);

  return { ...plan, existing, empty, same, inside };
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
    if (!rel && (entry.name === CLEANUP_FILE || entry.name.startsWith(TMP_PREFIX))) continue;
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) listFiles(root, next, out);
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function measure(root: string): { files: number; bytes: number } {
  const files = listFiles(root);
  let bytes = 0;
  for (const rel of files) {
    try {
      bytes += fs.statSync(path.join(root, rel)).size;
    } catch {
      /* 统计失败不影响迁移 */
    }
  }
  return { files: files.length, bytes };
}

/** 与 paths.ts 的 ensureDirs 保持一致的标记内容 */
function markerBody(): string {
  return JSON.stringify({ app: APP_NAME_EN, kind: 'data-dir', layout: 'flat', version: 2 }, null, 2);
}

function readJsonStrict<T>(file: string): { exists: boolean; value: T | null } {
  if (!fs.existsSync(file)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) as T };
  } catch {
    return { exists: true, value: null };
  }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function copyData(
  from: string,
  to: string,
  onProgress?: (p: RelocateProgress) => void
): Promise<{ files: number; bytes: number }> {
  const files = listFiles(from);
  let done = 0;
  let bytes = 0;
  let last = 0;

  await fs.promises.mkdir(to, { recursive: true });

  for (const rel of files) {
    const src = path.join(from, rel);
    const dest = path.join(to, rel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
    try {
      bytes += (await fs.promises.stat(dest)).size;
    } catch {
      /* 统计失败不影响迁移 */
    }
    done += 1;
    const now = Date.now();
    if (now - last > 120 || done === files.length) {
      last = now;
      onProgress?.({ done, total: files.length, bytes });
    }
  }

  // 目录里可能只有空文件夹（书删光了但目录还在），也要把结构带过去
  if (!files.length) onProgress?.({ done: 0, total: 1, bytes: 0 });
  return { files: done, bytes };
}

function safeName(raw: string): string {
  const name = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  return name || 'book.file';
}

/**
 * 搬完之后的校验：
 *   · 文件数量一致
 *   · 每个文件大小一致
 *   · library.json / settings.json 能解析，书数一致
 *   · 关键 JSON 的 sha256 一致
 * 只比数量是不够的：半截复制也可能数量一样。
 */
function verifyCopy(from: string, to: string): void {
  const srcFiles = listFiles(from);
  const dstFiles = listFiles(to);
  if (srcFiles.length !== dstFiles.length) {
    throw new Error(`复制不完整（${dstFiles.length}/${srcFiles.length} 个文件），已取消，原数据未动`);
  }

  const dstSet = new Set(dstFiles);
  for (const rel of srcFiles) {
    if (!dstSet.has(rel)) throw new Error(`新位置缺少文件：${rel}`);
    const a = fs.statSync(path.join(from, rel));
    const b = fs.statSync(path.join(to, rel));
    if (a.size !== b.size) throw new Error(`文件大小不一致：${rel}`);
  }

  const lib = readJsonStrict<BookMeta[]>(path.join(to, 'library.json'));
  if (lib.exists && !Array.isArray(lib.value)) {
    throw new Error('新位置的 library.json 读不出来，已取消');
  }
  const settings = readJsonStrict<object>(path.join(to, 'settings.json'));
  if (settings.exists && (settings.value === null || typeof settings.value !== 'object')) {
    throw new Error('新位置的 settings.json 读不出来，已取消');
  }

  const srcLib = readJsonStrict<BookMeta[]>(path.join(from, 'library.json'));
  if (srcLib.exists && !Array.isArray(srcLib.value)) {
    throw new Error('旧位置的 library.json 本身读不出来，为了不丢数据已取消迁移');
  }
  if (
    Array.isArray(srcLib.value) &&
    Array.isArray(lib.value) &&
    srcLib.value.length !== lib.value.length
  ) {
    throw new Error('书架数量对不上，已取消，原数据未动');
  }

  for (const rel of ['library.json', 'settings.json']) {
    const a = path.join(from, rel);
    const b = path.join(to, rel);
    if (fs.existsSync(a) && fs.existsSync(b) && sha256(a) !== sha256(b)) {
      throw new Error(`${rel} 校验和不一致，已取消，原数据未动`);
    }
  }
}

/**
 * 迁移前给「笔记 / 进度 / 书架索引 / 设置」留一份小快照。
 * 书文件不重复打包：旧目录本身在迁移完成前一个字节都不会动，就是书文件的备份。
 */
function snapshotCritical(dataDir: string): string | null {
  if (!isDir(dataDir)) return null;
  const dir = path.join(dataDir, 'backups', `migration-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  for (const rel of [
    'library.json',
    'settings.json',
    'user/progress.json',
    'user/notes.json',
    'user/sessions.json',
  ]) {
    const src = path.join(dataDir, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files.push(rel);
  }

  const lib = readJsonStrict<BookMeta[]>(path.join(dataDir, 'library.json'));
  writeJsonAtomic(path.join(dir, 'manifest.json'), {
    app: APP_NAME_EN,
    kind: 'migration-snapshot',
    createdAt: Date.now(),
    source: dataDir,
    books: Array.isArray(lib.value) ? lib.value.length : 0,
    files,
  });
  return dir;
}

/**
 * 搬家后修正 library.json 里的书文件路径。
 *
 * 1. 原本就在数据目录里的书：把绝对路径前缀换成新的 dataDir
 *    （不换的话，旧目录一删，书就打不开了）
 * 2. 原本指向外部文件夹的书：复制一本进 dataDir/books/{id}/source，
 *    让新的数据目录真正「自带书」，以后整个文件夹拷走就能用
 */
function rewriteLibrary(
  newDataDir: string,
  oldDataDir: string
): { adopted: number; bytes: number; missing: string[] } {
  const file = path.join(newDataDir, 'library.json');
  const parsed = readJsonStrict<BookMeta[]>(file);
  if (!parsed.exists) return { adopted: 0, bytes: 0, missing: [] };
  if (!Array.isArray(parsed.value)) {
    throw new Error('搬家后的 library.json 结构不对，已取消，原数据未动');
  }
  const library = parsed.value;

  let changed = false;
  let adopted = 0;
  let bytes = 0;
  const missing: string[] = [];

  for (const meta of library) {
    for (const variant of meta.variants ?? []) {
      if (!variant.path) continue;

      // ❶ 本来就在数据目录里：只换前缀
      if (isInside(variant.path, oldDataDir)) {
        variant.path = path.join(newDataDir, path.relative(oldDataDir, variant.path));
        changed = true;
        continue;
      }
      if (isInside(variant.path, newDataDir)) continue;

      // ❷ 外部书：复制进新数据目录
      let size = 0;
      try {
        size = fs.statSync(variant.path).size;
      } catch {
        size = 0;
      }
      if (!size) {
        missing.push(`${meta.title}：${path.basename(variant.path)}`);
        continue;
      }

      const sourceDir = path.join(newDataDir, 'books', meta.id, 'source');
      const wanted = safeName(path.basename(variant.path));
      let dest = path.join(sourceDir, wanted);

      try {
        fs.mkdirSync(sourceDir, { recursive: true });
        // 目标已有同名同大小的文件，直接复用，不重复复制
        let reuse = false;
        try {
          reuse = fs.statSync(dest).size === size;
        } catch {
          /* 不存在 */
        }
        if (!reuse) {
          let n = 2;
          while (fs.existsSync(dest)) {
            const ext = path.extname(wanted);
            dest = path.join(sourceDir, `${path.basename(wanted, ext)}-${n++}${ext}`);
          }
          fs.copyFileSync(variant.path, dest);
        }
      } catch {
        missing.push(`${meta.title}：${path.basename(variant.path)}`);
        continue;
      }

      variant.path = dest;
      variant.sizeBytes = size;
      adopted += 1;
      bytes += size;
      changed = true;
    }
  }

  if (changed) writeJsonAtomic(file, library);
  return { adopted, bytes, missing };
}

function nextAsidePath(root: string, action: ExistingAction, renameTo?: string): string {
  const parent = path.dirname(root);
  const fallback =
    action === 'replace'
      ? `${LEGACY_DATA_DIR_NAME}-backup-${stamp()}`
      : `${LEGACY_DATA_DIR_NAME}-old-${stamp()}`;
  const wanted = renameTo ? path.basename(renameTo).replace(/[\\/:*?"<>|]/g, '_') : fallback;
  let candidate = path.join(parent, wanted || fallback);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${wanted || fallback}-${n++}`);
  }
  return candidate;
}

function uniqueTmp(root: string): string {
  const parent = path.dirname(root);
  let n = 0;
  while (true) {
    const candidate = path.join(parent, `${TMP_PREFIX}${Date.now()}-${process.pid}-${n++}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function journalPath(): string {
  return path.join(configDir(), JOURNAL_FILE);
}

function writeJournal(data: Record<string, unknown>): void {
  try {
    writeJsonAtomic(journalPath(), { ...data, at: Date.now() });
  } catch {
    /* 日志写不进去不影响迁移本身 */
  }
}

function removeJournal(): void {
  try {
    if (fs.existsSync(journalPath())) fs.rmSync(journalPath(), { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * 迁移数据到新位置。
 * 成功后需要调用方重启应用（app.relaunch），让所有模块重新读路径。
 *
 * 扁平结构下 dataDir === root，所以临时副本必须放在 root 的**同级**，
 * 校验通过后 rename 成 root；直接把 root\tmp 改名成 root 是会失败的。
 */
export async function relocateData(
  target: RelocateTarget,
  mode: RelocateMode = 'move',
  options: RelocateOptions = {}
): Promise<RelocateResult> {
  const effectiveMode: RelocateMode = mode === 'copy' ? 'copy' : 'move';
  const current = getDataRootInfo();
  const oldData = current.dataDir;
  const defaultRoot = effectiveDefaultDataDir();
  const plan =
    target.kind === 'default'
      ? planDataLocation(path.dirname(defaultRoot))
      : planDataLocation(target.parent);

  if (plan.invalid) {
    return { ok: false, reason: 'invalid', detail: plan.detail, root: plan.root, dataDir: plan.dataDir };
  }
  if (plan.same) {
    return { ok: false, reason: 'same', root: plan.root, dataDir: plan.dataDir };
  }
  if (plan.inside) {
    return {
      ok: false,
      reason: 'inside',
      detail: '不能把数据放到当前数据目录里面，请换一个位置。',
      root: plan.root,
      dataDir: plan.dataDir,
    };
  }

  const action = options.existingAction;
  if (action === 'cancel') {
    return { ok: false, canceled: true, reason: 'canceled', root: plan.root, dataDir: plan.dataDir };
  }

  // 复用：不复制，直接把指针指过去。当前数据留在原处，不合并。
  if (plan.existing === 'moqi' && action === 'reuse') {
    const lib = readJsonStrict<BookMeta[]>(path.join(plan.dataDir, 'library.json'));
    if (lib.exists && !Array.isArray(lib.value)) {
      return {
        ok: false,
        reason: 'io',
        detail: '目标位置的 library.json 读不出来，为了安全没有切换。',
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    try {
      setDataRootPointer(plan.root);
      if (target.kind === 'default') clearDataRootPointer({ clearPrevious: false });
    } catch (err) {
      return {
        ok: false,
        reason: 'io',
        detail: err instanceof Error ? err.message : String(err),
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    return {
      ok: true,
      root: plan.root,
      dataDir: plan.dataDir,
      files: 0,
      bytes: 0,
      adopted: 0,
      missing: [],
      mode: effectiveMode,
      reused: true,
    };
  }

  if (plan.existing !== 'none') {
    if (!action) {
      return {
        ok: false,
        reason: 'conflict',
        detail: `${plan.root} 里已经有内容，请选择复用、覆盖或重命名。`,
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    if (plan.existing === 'other' && action === 'replace') {
      return {
        ok: false,
        reason: 'conflict',
        detail: '这个文件夹不是墨栖的数据，不能覆盖；可以重命名后保留它。',
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    if (action !== 'replace' && action !== 'rename') {
      return {
        ok: false,
        reason: 'conflict',
        detail: `${plan.root} 里已经有内容，请选择复用、覆盖或重命名。`,
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
  }

  const need =
    isDir(oldData) && fs.existsSync(oldData) ? measure(oldData) : { files: 0, bytes: 0 };
  if (
    !options.skipSpaceCheck &&
    plan.freeBytes !== undefined &&
    need.bytes > 0 &&
    plan.freeBytes < need.bytes * 1.1 + 64 * 1024 * 1024
  ) {
    return {
      ok: false,
      reason: 'space',
      detail: `目标磁盘剩余空间不够：大约需要 ${Math.ceil((need.bytes * 1.1) / 1024 / 1024)} MB。`,
      root: plan.root,
      dataDir: plan.dataDir,
    };
  }

  let aside: string | null = null;
  let tmp: string | null = null;
  let placed = false;
  let snapshot: string | null = null;

  try {
    if (plan.existing !== 'none') {
      aside = nextAsidePath(plan.root, action ?? 'replace', options.renameTo);
      // 先记日志再改名：改名与写指针之间崩溃时，启动能靠 aside 还原。
      writeJournal({
        from: oldData,
        to: plan.root,
        aside,
        phase: 'aside',
        mode: effectiveMode,
      });
      fs.renameSync(plan.root, aside);
    } else if (plan.empty && fs.existsSync(plan.root)) {
      fs.rmdirSync(plan.root);
    }

    try {
      snapshot = snapshotCritical(oldData);
    } catch {
      // 快照失败不阻塞：旧目录本身在迁移完成前不动，仍然是最可靠的备份。
      snapshot = null;
    }

    writeJournal({
      from: oldData,
      to: plan.root,
      aside,
      phase: 'copying',
      mode: effectiveMode,
    });

    tmp = uniqueTmp(plan.root);
    const copied = await copyData(oldData, tmp, options.onProgress);
    verifyCopy(oldData, tmp);

    fs.writeFileSync(path.join(tmp, DATA_MARKER), markerBody(), 'utf8');
    fs.renameSync(tmp, plan.root);
    placed = true;
    tmp = null;
    writeJournal({ from: oldData, to: plan.root, aside, phase: 'placed', mode: effectiveMode });

    const rewritten = rewriteLibrary(plan.dataDir, oldData);

    // 从这里开始，下一次启动读新位置（flat 下指针就是数据目录本身）。
    // 搬回默认位置时不写指针：默认位置靠解析得到，留指针反而多一层。
    setDataRootPointer(plan.root);
    if (target.kind === 'default') clearDataRootPointer({ clearPrevious: false });
    writeJournal({ from: oldData, to: plan.root, aside, phase: 'pointed', mode: effectiveMode });

    let deleteAfter: number | undefined;
    if (effectiveMode === 'move' && lower(oldData) !== lower(plan.dataDir)) {
      const days = Math.max(0, options.keepOldDays ?? DEFAULT_KEEP_DAYS);
      deleteAfter = Date.now() + days * DAY;
      try {
        writeJsonAtomic(path.join(plan.dataDir, CLEANUP_FILE), {
          old: oldData,
          at: Date.now(),
          deleteAfter,
          mode: effectiveMode,
        });
      } catch {
        // 清理指令写不进去不影响「数据已经搬好」；旧目录只是不会被自动删。
        deleteAfter = undefined;
      }
    }

    removeJournal();

    return {
      ok: true,
      root: plan.root,
      dataDir: plan.dataDir,
      files: copied.files + rewritten.adopted,
      bytes: copied.bytes + rewritten.bytes,
      adopted: rewritten.adopted,
      missing: rewritten.missing,
      mode: effectiveMode,
      backupDir: snapshot ?? undefined,
      asideDir: aside ?? undefined,
      deleteAfter,
    };
  } catch (err) {
    // 回滚：删本次产物 → 把改名的旧目标改回来 → 指针回到旧位置。
    try {
      if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      if (placed && fs.existsSync(plan.root)) fs.rmSync(plan.root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      if (aside && fs.existsSync(aside) && !fs.existsSync(plan.root)) {
        fs.renameSync(aside, plan.root);
      }
    } catch {
      /* ignore */
    }
    try {
      if (current.isCustom) setDataRootPointer(oldData, { rememberPrevious: false });
      else clearDataRootPointer({ clearPrevious: false });
    } catch {
      /* ignore */
    }
    removeJournal();

    return {
      ok: false,
      reason: 'io',
      detail: err instanceof Error ? err.message : String(err),
      root: plan.root,
      dataDir: plan.dataDir,
    };
  }
}

/** 读取「移动模式」留下的旧位置清理计划 */
export function getPendingCleanup(): PendingCleanup | null {
  const current = getDataRootInfo();
  const file = path.join(current.dataDir, CLEANUP_FILE);
  const raw = readJson<{ old?: string; at?: number; deleteAfter?: number } | null>(file, null);
  if (!raw || typeof raw.old !== 'string' || !raw.old) return null;
  const at = Number(raw.at) || 0;
  const deleteAfter = Number(raw.deleteAfter) || (at ? at + DEFAULT_KEEP_DAYS * DAY : 0);
  return { old: raw.old, at, deleteAfter };
}

/**
 * 启动时调用：上一次迁移成功的话，到了保留期才把旧位置删掉。
 * 只在「新数据能读」「旧目录确实带墨栖标记」且「不是当前目录、不在当前目录之上」时才删。
 */
export function cleanupPreviousDataDir(force = false): { cleaned: boolean; reason?: string } {
  const current = getDataRootInfo();
  const file = path.join(current.dataDir, CLEANUP_FILE);
  const pending = getPendingCleanup();
  if (!pending) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
    return { cleaned: false, reason: 'none' };
  }

  const old = path.resolve(pending.old);
  const cur = path.resolve(current.dataDir);

  if (!fs.existsSync(old)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
    return { cleaned: false, reason: 'gone' };
  }

  if (!force && Date.now() < pending.deleteAfter) {
    return { cleaned: false, reason: 'not-due' };
  }

  // 新位置必须至少有一份能读的书架，才允许删旧位置。
  const lib = readJsonStrict<BookMeta[]>(path.join(cur, 'library.json'));
  if (!lib.exists || !Array.isArray(lib.value)) {
    return { cleaned: false, reason: 'current-incomplete' };
  }

  const driveRoot = path.parse(old).root;
  const safe =
    lower(old) !== lower(cur) &&
    lower(old) !== lower(driveRoot) &&
    !lower(cur).startsWith(`${lower(old)}${path.sep}`) &&
    !lower(old).startsWith(`${lower(cur)}${path.sep}`) &&
    isMoqiDataDir(old) &&
    lower(old) !== lower(programDir());

  if (!safe) return { cleaned: false, reason: 'unsafe' };

  try {
    fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
    return { cleaned: true };
  } catch {
    /* 删不掉就留着，不影响使用 */
    return { cleaned: false, reason: 'busy' };
  }
}

/** 设置页「立即清理」：忽略保留期，但仍走安全校验 */
export function cleanupNow(): { cleaned: boolean; reason?: string } {
  return cleanupPreviousDataDir(true);
}

/** 设置页「保留」：不删旧目录，只取消自动清理 */
export function cancelPendingCleanup(): boolean {
  const file = path.join(getDataRootInfo().dataDir, CLEANUP_FILE);
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 崩溃恢复：上次迁移在 rename/写指针之间中断时，尽量把现场还原。
 * 只做安全动作：删除本次的临时目录；目标不在但 aside 在，就把 aside 改回去。
 * 绝不主动删「看起来像数据」的目录。
 */
export function recoverInterruptedMigration(): void {
  const file = journalPath();
  if (!fs.existsSync(file)) return;

  const journal = readJson<{ from?: string; to?: string; aside?: string; phase?: string } | null>(
    file,
    null
  );
  if (!journal) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const to = journal.to ? path.resolve(journal.to) : '';
    const aside = journal.aside ? path.resolve(journal.aside) : '';

    if (aside && fs.existsSync(aside) && (!to || !fs.existsSync(to))) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(aside, to);
    }

    if (to) {
      const parent = path.dirname(to);
      try {
        for (const name of fs.readdirSync(parent)) {
          if (/^\.moqi-data-tmp-\d+/.test(name)) {
            fs.rmSync(path.join(parent, name), { recursive: true, force: true });
          }
        }
      } catch {
        /* 扫不了就算了 */
      }
    }
  } catch {
    /* 恢复失败保留原样，下次启动再试 */
  }

  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

/** 给设置页用的「上一位置」（data-root.previous.txt） */
export function getRollbackTarget(): string | null {
  return getPreviousDataDir();
}

// 这些常量给测试/诊断读，避免测试里再写死文件名。
export const LOCATION_FILES = {
  cleanup: CLEANUP_FILE,
  journal: JOURNAL_FILE,
  previousPointer: POINTER_PREV_FILE,
  tempPrefix: TMP_PREFIX,
} as const;

export { defaultDataDir };
