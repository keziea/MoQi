/**
 * 数据位置：规划 / 迁移 / 旧位置清理
 *
 * 迁移是一套「复制 → 校验 → 落位 → 记指针 → 下次启动删旧」的流程，
 * 不做原地 rename（跨盘会失败），也不在迁移过程中删除任何东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BookMeta } from '../../shared/models';
import {
  DATA_FOLDER_NAME,
  DATA_MARKER,
  clearDataRootPointer,
  defaultDataDir,
  defaultDataRoot,
  getDataRootInfo,
  setDataRootPointer,
} from './paths';
import { readJson, writeJsonAtomic } from './json';

export interface LocationPlan {
  parent: string;
  root: string;
  dataDir: string;
  /** 选的就是现在的位置 */
  same: boolean;
  /** 目标位置已经有墨栖的数据 */
  conflict: boolean;
  /** 选到了当前数据目录里面 */
  inside: boolean;
}

export interface RelocateProgress {
  done: number;
  total: number;
  bytes: number;
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
    }
  | {
      ok: false;
      reason: 'inside' | 'same' | 'conflict' | 'io';
      detail?: string;
      root?: string;
      dataDir?: string;
    };

export type RelocateTarget = { kind: 'custom'; parent: string } | { kind: 'default' };

const TMP_PREFIX = '.moqi-data-tmp-';
const CLEANUP_FILE = 'pending-cleanup.json';

function lower(p: string): string {
  return path.resolve(p).toLowerCase();
}

export function isMoqiDataDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    if (fs.existsSync(path.join(dir, DATA_MARKER))) return true;
    return (
      fs.existsSync(path.join(dir, 'library.json')) ||
      fs.existsSync(path.join(dir, 'user', 'notes.json'))
    );
  } catch {
    return false;
  }
}

/** 用户选中的目录 → 实际要创建的 MoQiReader 目录 */
export function planDataLocation(parent: string): LocationPlan {
  const resolved = path.resolve(parent.trim());
  const base = path.basename(resolved).toLowerCase();
  const root = base === DATA_FOLDER_NAME.toLowerCase() ? resolved : path.join(resolved, DATA_FOLDER_NAME);
  const dataDir = path.join(root, 'data');

  const current = getDataRootInfo();
  const same = lower(root) === lower(current.root);
  const inside =
    lower(resolved) === lower(current.dataDir) ||
    lower(resolved).startsWith(`${lower(current.dataDir)}${path.sep}`);
  const conflict = !same && isMoqiDataDir(dataDir);

  return { parent: resolved, root, dataDir, same, conflict, inside };
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

function markerBody(): string {
  return JSON.stringify({ app: 'moqi-reader', kind: 'data-dir', version: 1 }, null, 2);
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

function isInside(child: string, parent: string): boolean {
  const c = lower(child);
  const p = lower(parent);
  return c === p || c.startsWith(`${p}${path.sep}`);
}

function safeName(raw: string): string {
  const name = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  return name || 'book.file';
}

/**
 * 搬家后修正 library.json 里的书文件路径。
 *
 * 1. 原本就在 data/books 里的书：把绝对路径前缀换成新的 dataDir
 *    （不换的话，旧目录一删，书就打不开了）
 * 2. 原本指向外部文件夹的书：复制一本进 data/books/{id}/source，
 *    让新的数据目录真正「自带书」，以后整个文件夹拷走就能用
 */
function rewriteLibrary(
  newDataDir: string,
  oldDataDir: string
): { adopted: number; bytes: number; missing: string[] } {
  const file = path.join(newDataDir, 'library.json');
  const library = readJson<BookMeta[]>(file, []);
  if (!Array.isArray(library) || !library.length) return { adopted: 0, bytes: 0, missing: [] };

  let changed = false;
  let adopted = 0;
  let bytes = 0;
  const missing: string[] = [];

  for (const meta of library) {
    for (const variant of meta.variants ?? []) {
      if (!variant.path) continue;

      // ❶ 本来就在 data 里：只换前缀
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

/**
 * 迁移数据到新位置。
 * 成功后需要调用方重启应用（app.relaunch），让所有模块重新读路径。
 */
export async function relocateData(
  target: RelocateTarget,
  onProgress?: (p: RelocateProgress) => void
): Promise<RelocateResult> {
  const current = getDataRootInfo();
  const oldData = current.dataDir;

  let root: string;
  let dataDir: string;

  if (target.kind === 'default') {
    root = defaultDataRoot();
    dataDir = defaultDataDir();
  } else {
    const plan = planDataLocation(target.parent);
    if (plan.inside) {
      return { ok: false, reason: 'inside', detail: '不能把数据放到当前数据目录里面，请换一个位置。' };
    }
    if (plan.same) return { ok: false, reason: 'same', root: plan.root, dataDir: plan.dataDir };
    if (plan.conflict) {
      return {
        ok: false,
        reason: 'conflict',
        detail: `${plan.root} 里已经有墨栖的数据了，请换一个位置。`,
        root: plan.root,
        dataDir: plan.dataDir,
      };
    }
    root = plan.root;
    dataDir = plan.dataDir;
  }

  if (lower(root) === lower(current.root)) {
    return { ok: false, reason: 'same', root, dataDir };
  }

  const tmp = path.join(root, `${TMP_PREFIX}${Date.now()}`);
  let placed = false;

  try {
    fs.mkdirSync(root, { recursive: true });
    if (fs.existsSync(dataDir)) {
      // 走到这里说明目标 data 已存在但不是墨栖的数据，绝不覆盖
      return { ok: false, reason: 'conflict', detail: `${dataDir} 已经存在，请换一个位置。`, root, dataDir };
    }

    let copied = { files: 0, bytes: 0 };
    if (fs.existsSync(oldData)) {
      copied = await copyData(oldData, tmp, onProgress);
    } else {
      fs.mkdirSync(tmp, { recursive: true });
    }

    // 校验：文件数量必须一致，否则不落位
    const expected = fs.existsSync(oldData) ? listFiles(oldData).length : 0;
    const actual = listFiles(tmp).length;
    if (actual !== expected) {
      throw new Error(`复制不完整（${actual}/${expected} 个文件），已取消，原数据未动`);
    }

    fs.writeFileSync(path.join(tmp, DATA_MARKER), markerBody(), 'utf8');
    fs.renameSync(tmp, dataDir);
    placed = true;

    // 修 library.json 里的绝对路径；外部书顺手复制进来，让新目录自带书
    const rewritten = rewriteLibrary(dataDir, oldData);

    // 记指针：从这里开始，下一次启动读新位置
    try {
      if (target.kind === 'default') clearDataRootPointer();
      else setDataRootPointer(root);
    } catch (err) {
      // 指针写不进去就回滚，别留下一个「有数据但软件不知道」的副本
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }

    // 旧位置留给下一次启动清理：此时当前进程可能还有零星写入，立刻删不安全
    if (lower(oldData) !== lower(dataDir)) {
      writeJsonAtomic(path.join(dataDir, CLEANUP_FILE), { old: oldData, at: Date.now() });
    }

    return {
      ok: true,
      root,
      dataDir,
      files: copied.files + rewritten.adopted,
      bytes: copied.bytes + rewritten.bytes,
      adopted: rewritten.adopted,
      missing: rewritten.missing,
    };
  } catch (err) {
    try {
      const partial = placed ? dataDir : tmp;
      if (fs.existsSync(partial)) fs.rmSync(partial, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      reason: 'io',
      detail: err instanceof Error ? err.message : String(err),
      root,
      dataDir,
    };
  }
}

/**
 * 启动时调用：上一次迁移成功的话，把旧位置删掉。
 * 只在「旧目录确实带墨栖标记」且「不是当前目录、不在当前目录之上」时才删。
 */
export function cleanupPreviousDataDir(): void {
  const current = getDataRootInfo();
  const file = path.join(current.dataDir, CLEANUP_FILE);
  const pending = readJson<{ old?: string } | null>(file, null);
  if (!pending?.old) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
    return;
  }

  try {
    const old = path.resolve(pending.old);
    const cur = path.resolve(current.dataDir);
    const safe =
      lower(old) !== lower(cur) &&
      !lower(cur).startsWith(`${lower(old)}${path.sep}`) &&
      isMoqiDataDir(old);
    if (safe) fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
  } catch {
    /* 删不掉就留着，不影响使用 */
  }
}
