import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { writeTextAtomic } from './json';
import { deriveSingleRoot, type SingleRootLayout } from './layout';
import {
  APP_NAME_EN,
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  PROGRAM_DIR_NAME,
} from '../../shared/names.generated';

/**
 * 数据目录定位（v0.6 扁平结构，v0.7 加固）
 *
 * 数据目录本身就是用户数据根，不再套一层 data：
 *
 *   %APPDATA%\MoQiData\            ← 安装版默认
 *   <exeDir>\MoQiData\             ← 便携版默认
 *   E:\MoQiData\                   ← 自定义（用户只选上级，这一层固定）
 *
 * 里面直接放 library.json / settings.json / books / user / backups / logs。
 * 「改到哪了」记在 %APPDATA%\moqi-reader\data-root.txt（配置与数据分开），
 * 上一次的位置记在 data-root.previous.txt，用于迁移失败/新位置打不开时回滚。
 *
 * 兼容 v0.5.x 的旧结构：如果指针指向的目录里有 data\library.json，
 * 就按 nested 布局解析（dataDir = root\data），不强制搬家。
 */

/** v0.8 新布局的数据文件夹名（来自 package.json → moqi.dataDir） */
export { DATA_DIR_NAME, LEGACY_DATA_DIR_NAME, PROGRAM_DIR_NAME };

/** 数据目录标记文件：用来认出「这确实是墨栖的数据」，避免误删、误覆盖 */
export const DATA_MARKER = '.moqi-data';

/** 指针文件：一行绝对路径，指向数据根（flat 下就是数据目录本身） */
export const POINTER_FILE = 'data-root.txt';

/** 上一次的数据位置：迁移成功/失败都留一份，启动时可回滚 */
export const POINTER_PREV_FILE = 'data-root.previous.txt';

export type DataLayout = 'flat' | 'nested';

export interface DataRootInfo {
  /** 指针指向的目录；flat 布局下等于 dataDir */
  root: string;
  /** 真正的数据目录：flat = root；nested = root\data（v0.5.x 旧结构） */
  dataDir: string;
  /** 布局版本：flat 是 v0.6/v0.8 扁平结构，nested 是旧结构 */
  layout: DataLayout;
  /** single-root = v0.8 的 <容器>\Program + <容器>\Data；legacy = v0.7 及以前 */
  mode: 'single-root' | 'legacy';
  /** v0.8 容器目录（<容器>\Program 的上一级） */
  containerDir?: string;
  /** 是不是用户自己选的位置 */
  isCustom: boolean;
  /** 配置指向、但当前不可用的位置 */
  unavailable?: string;
  /** 便携版（exe 同级有 portable.flag） */
  portable: boolean;
  /** 便携版但数据还在系统目录（老用户），先沿用避免书架突然空 */
  legacyPortable?: boolean;
  /** 便携目录只读，已退回系统目录 */
  portableReadonly?: boolean;
  /** 指针失效后自动回退到上一个有数据的位置 */
  rolledBackFrom?: string;
}

let cached: DataRootInfo | null = null;

/** 配置目录：v0.8 是 <Data>\runtime；旧版是 %APPDATA%\moqi-reader */
export function configDir(): string {
  const single = singleRootLayout();
  return single ? path.join(single.dataDir, 'runtime') : app.getPath('userData');
}

/** 程序目录：打包后是 exe 所在目录（v0.8 为 ...\MoQiReader\Program），开发时是项目根 */
export function programDir(): string {
  try {
    if (process.env.MOQI_PROGRAM_DIR) return path.resolve(process.env.MOQI_PROGRAM_DIR);
    return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  } catch {
    return '';
  }
}

/** v0.8 的单根布局；开发/测试可用 MOQI_PROGRAM_DIR 强制模拟 */
export function singleRootLayout(): SingleRootLayout | null {
  if (!app.isPackaged && !process.env.MOQI_PROGRAM_DIR) return null;
  return deriveSingleRoot(programDir());
}

/** v0.8 容器目录（...\MoQiReader）；旧布局返回空串 */
export function containerDir(): string {
  return singleRootLayout()?.containerDir ?? '';
}

/** 默认数据目录：v0.8 固定为 <容器>\Data；旧布局仍按 %APPDATA%\MoQiData */
export function defaultDataDir(): string {
  const single = singleRootLayout();
  if (single) return single.dataDir;
  return path.join(app.getPath('appData'), LEGACY_DATA_DIR_NAME);
}

/** 便携版默认数据目录：v0.8 同 Data；旧布局为程序旁 MoQiData */
export function portableDataDir(): string {
  const single = singleRootLayout();
  if (single) return single.dataDir;
  return path.join(programDir(), LEGACY_DATA_DIR_NAME);
}

/** 当前形态下的默认数据目录 */
export function effectiveDefaultDataDir(): string {
  return isPortable() ? portableDataDir() : defaultDataDir();
}

/** 兼容旧调用：默认数据根 = 默认数据目录 */
export function defaultDataRoot(): string {
  return defaultDataDir();
}

/** 测试/诊断用：忘掉缓存，下一次重新解析 */
export function resetDataRootCache(): void {
  cached = null;
}

/**
 * v0.8 启动前必须调用：把 Electron 的 userData/sessionData 指到 <Data>\runtime。
 * 这样绿色版整个文件夹搬走时，Chromium 的缓存/锁也跟着走，不会在 AppData 里留一份。
 * 旧布局（开发/测试）不做任何事。
 */
export function configureRuntimePaths(): { ok: boolean; error?: string } {
  const single = singleRootLayout();
  if (!single) return { ok: true };

  try {
    fs.mkdirSync(single.dataDir, { recursive: true });
    const runtime = path.join(single.dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });

    // 写一次探针，提前发现“程序旁边不能写”的情况
    const probe = path.join(runtime, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '', 'utf8');
    fs.rmSync(probe, { force: true });

    app.setPath('userData', runtime);
    app.setPath('sessionData', runtime);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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

function parentExists(p: string): boolean {
  try {
    return fs.statSync(path.dirname(p)).isDirectory();
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

function jsonHasContent(file: string, kind: 'array' | 'object'): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kind === 'array') return Array.isArray(value) && value.length > 0;
    return !!value && typeof value === 'object' && Object.keys(value as object).length > 0;
  } catch {
    return false;
  }
}

/**
 * 这个目录里有没有「真正可读的用户数据」。
 * 只认非空的 library.json / 旧 data\library.json / user\notes.json / progress / sessions；
 * `.moqi-data` 标记只说明「这里曾经是墨栖目录」，不能单独当成有数据，
 * 否则一次中断迁移留下的空壳、或空书架，会把真正的旧数据挡住。
 */
function hasData(dir: string): boolean {
  try {
    return (
      jsonHasContent(path.join(dir, 'library.json'), 'array') ||
      jsonHasContent(path.join(dir, 'data', 'library.json'), 'array') ||
      jsonHasContent(path.join(dir, 'user', 'notes.json'), 'object') ||
      jsonHasContent(path.join(dir, 'user', 'progress.json'), 'object') ||
      jsonHasContent(path.join(dir, 'user', 'sessions.json'), 'array')
    );
  } catch {
    return false;
  }
}

/**
 * v0.5.x 的默认数据在 %APPDATA%\moqi-reader\data。
 * v0.6 默认在 %APPDATA%\MoQiData。同盘 rename 是瞬时的；
 * 失败（权限/占用）就继续用旧目录，不阻塞启动。
 *
 * v0.7 修复：如果新目录已经存在但是空的（以前失败留下的壳），
 * 先删掉空壳再搬；如果新目录已经有数据，不动它，避免把老数据藏起来。
 */
function migrateLegacyDefault(): void {
  const legacy = path.join(configDir(), 'data');
  const next = defaultDataDir();
  if (!fs.existsSync(legacy)) return;

  if (!fs.existsSync(next)) {
    try {
      fs.mkdirSync(path.dirname(next), { recursive: true });
      fs.renameSync(legacy, next);
    } catch {
      /* 保持旧目录，默认解析会回退到它 */
    }
    return;
  }

  // 新目录已经有数据 → 不动；这是正常的 v0.6 用户。
  if (hasData(next)) return;

  // 新目录只有空壳/标记 → 清掉空壳再搬。
  let clutter: string[] = [];
  try {
    clutter = fs.readdirSync(next).filter(
      (name) => name !== DATA_MARKER && !name.startsWith('.moqi-data-tmp-')
    );
  } catch {
    return;
  }
  if (clutter.length) return;

  try {
    fs.rmSync(next, { recursive: true, force: true });
    fs.renameSync(legacy, next);
  } catch {
    /* 下一次启动再试 */
  }
}

/** 便携包判据：exe 同级有 portable.flag；开发模式永远按安装版处理 */
export function isPortable(): boolean {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(programDir(), 'portable.flag'));
  } catch {
    return false;
  }
}

function canWrite(dir: string): boolean {
  try {
    const probe = path.join(dir, `.moqi-write-${process.pid}`);
    fs.writeFileSync(probe, '', 'utf8');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 指针文件：便携版优先 exe 同级（跟着文件夹走），否则 userData */
function pointerFiles(): string[] {
  const out: string[] = [];
  if (isPortable()) out.push(path.join(programDir(), POINTER_FILE));
  out.push(path.join(configDir(), POINTER_FILE));
  return out;
}

/** 读出所有指针候选（便携目录优先，然后系统配置目录） */
function readPointers(): string[] {
  const out: string[] = [];
  for (const file of pointerFiles()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!raw) continue;
      const resolved = path.resolve(raw);
      if (!out.some((p) => lower(p) === lower(resolved))) out.push(resolved);
    } catch {
      /* 换下一个 */
    }
  }
  return out;
}

/** 上一次的数据位置（用于迁移失败/新位置打不开时回滚） */
export function getPreviousDataDir(): string | null {
  try {
    const file = path.join(configDir(), POINTER_PREV_FILE);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    return raw ? path.resolve(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 判断指针指向的是新扁平目录，还是 v0.5.x 的「容器 + data」：
 * · root\library.json 存在        → flat
 * · root\data 存在                → nested（dataDir = root\data）
 * · 都没有（新建/空目录）          → flat
 */
function resolveLayout(root: string): { dataDir: string; layout: DataLayout } {
  if (fs.existsSync(path.join(root, 'library.json'))) {
    return { dataDir: root, layout: 'flat' };
  }
  if (fs.existsSync(path.join(root, 'data'))) {
    return { dataDir: path.join(root, 'data'), layout: 'nested' };
  }
  return { dataDir: root, layout: 'flat' };
}

/** 已知的可能有数据的位置：上一位置 → 当前形态默认 → 安装版默认 → 旧默认 */
function knownDataDirs(portable: boolean): string[] {
  const list: string[] = [];
  const prev = getPreviousDataDir();
  if (prev) list.push(prev);
  list.push(portable ? portableDataDir() : defaultDataDir());
  list.push(defaultDataDir());
  list.push(path.join(configDir(), 'data'));
  return [...new Set(list.map((p) => path.resolve(p)))];
}

export function getDataRootInfo(): DataRootInfo {
  if (cached) return cached;

  // v0.8：数据目录由 exe 位置直接推导，不再读指针。
  const single = singleRootLayout();
  if (single) {
    cached = {
      root: single.dataDir,
      dataDir: single.dataDir,
      layout: 'flat',
      mode: 'single-root',
      containerDir: single.containerDir,
      isCustom: false,
      portable: isPortable(),
    };
    return cached;
  }

  migrateLegacyDefault();

  const portable = isPortable();
  const pointers = readPointers();
  const pointer = pointers[0] ?? null;

  // 1. 指针优先（新指针指向数据目录；旧指针指向容器，resolveLayout 会认出来）
  for (const candidate of pointers) {
    if (!isDir(candidate)) continue;

    // 指针指向一个空壳（以前中断/误删留下的），而上一位置还有数据：
    // 先回到上一位置，别让用户打开一个空书架。
    if (isEmptyDir(candidate)) {
      const prev = getPreviousDataDir();
      if (prev && lower(prev) !== lower(candidate) && isDir(prev) && hasData(prev)) {
        const { dataDir, layout } = resolveLayout(prev);
        cached = {
          root: prev,
          dataDir,
          layout,
          mode: 'legacy',
          isCustom: lower(prev) !== lower(effectiveDefaultDataDir()),
          portable,
          unavailable: candidate,
          rolledBackFrom: candidate,
        };
        return cached;
      }
    }

    const { dataDir, layout } = resolveLayout(candidate);
    cached = {
      root: candidate,
      dataDir,
      layout,
      mode: 'legacy',
      isCustom: true,
      portable,
    };
    return cached;
  }

  // 1b. 指针指向的目录没了：先找「已知有数据的位置」回退，别默默建一个空书架。
  if (pointer) {
    const fallback = knownDataDirs(portable).find(
      (p) => lower(p) !== lower(pointer) && isDir(p) && hasData(p)
    );
    if (fallback) {
      const { dataDir, layout } = resolveLayout(fallback);
      cached = {
        root: fallback,
        dataDir,
        layout,
        mode: 'legacy',
        isCustom: lower(fallback) !== lower(effectiveDefaultDataDir()),
        portable,
        unavailable: pointer,
        rolledBackFrom: pointer,
        legacyPortable: portable && lower(fallback) !== lower(portableDataDir()),
      };
      return cached;
    }

    // 盘还在，只是数据文件夹被删了 → 允许在用户选的位置重建（旧行为）。
    if (parentExists(pointer)) {
      cached = {
        root: pointer,
        dataDir: pointer,
        layout: 'flat',
        mode: 'legacy',
        isCustom: true,
        portable,
      };
      return cached;
    }
  }

  // 2. 便携版默认：程序同级 MoQiData（flat）
  if (portable) {
    const portableData = portableDataDir();
    const systemData = defaultDataDir();
    const legacySystem = path.join(configDir(), 'data');

    // 老便携用户：数据还在系统目录，先继续用，避免书架突然空
    const systemExisting = [systemData, legacySystem].find((p) => isDir(p) && hasData(p));
    if ((!isDir(portableData) || !hasData(portableData)) && systemExisting) {
      cached = {
        root: systemExisting,
        dataDir: systemExisting,
        layout: 'flat',
        mode: 'legacy',
        isCustom: false,
        portable,
        legacyPortable: true,
        unavailable: pointer ?? undefined,
      };
      return cached;
    }

    const writable = isDir(portableData) ? canWrite(portableData) : canWrite(programDir());
    if (writable) {
      cached = {
        root: portableData,
        dataDir: portableData,
        layout: 'flat',
        mode: 'legacy',
        isCustom: false,
        portable,
      };
      return cached;
    }

    // 只读介质：退回系统目录并标记
    const fallback = systemExisting ?? systemData;
    cached = {
      root: fallback,
      dataDir: fallback,
      layout: 'flat',
      mode: 'legacy',
      isCustom: false,
      portable,
      portableReadonly: true,
      unavailable: pointer ?? undefined,
    };
    return cached;
  }

  // 3. 安装版默认：%APPDATA%\MoQiData；迁移失败时回退到旧 %APPDATA%\moqi-reader\data
  const next = defaultDataDir();
  const legacy = path.join(configDir(), 'data');
  const withData = [next, legacy].find((p) => isDir(p) && hasData(p));
  const def = withData ?? (isDir(next) ? next : isDir(legacy) ? legacy : next);
  const { dataDir, layout } = resolveLayout(def);
  cached = {
    root: def,
    dataDir,
    layout,
    mode: 'legacy',
    isCustom: false,
    portable: false,
    unavailable: pointer ?? undefined,
  };
  return cached;
}

/**
 * 记住新的数据位置（下一次启动生效）。传的是数据根；
 * flat 下等于数据目录，nested 旧布局下是容器目录。
 *
 * 写指针前先把旧位置记到 data-root.previous.txt：
 * 新位置万一打不开，启动时可以回退，而不是开一个空书架。
 */
export function setDataRootPointer(
  dataDir: string,
  opts: { rememberPrevious?: boolean } = {}
): void {
  // v0.8 单根布局没有指针，数据位置由 exe 推导，不能改。
  if (singleRootLayout()) return;
  const current = getDataRootInfo();
  const targetPath = path.resolve(dataDir);
  if (opts.rememberPrevious !== false && lower(current.dataDir) !== lower(targetPath)) {
    try {
      writeTextAtomic(path.join(configDir(), POINTER_PREV_FILE), current.dataDir);
    } catch {
      /* 记不住上一位置不影响本次写入 */
    }
  }

  const target =
    isPortable() && canWrite(programDir())
      ? path.join(programDir(), POINTER_FILE)
      : path.join(configDir(), POINTER_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeTextAtomic(target, targetPath);
  cached = null;
}

/** 忘掉自定义位置，回到默认（迁移回默认目录后调用） */
export function clearDataRootPointer(opts: { clearPrevious?: boolean } = {}): void {
  if (singleRootLayout()) return;
  for (const file of pointerFiles()) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  if (opts.clearPrevious) {
    try {
      const file = path.join(configDir(), POINTER_PREV_FILE);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  cached = null;
}

/**
 * 早期备份写在 data\_backups，paths.backups() 却是 data\backups。
 * 启动时把「新目录还是空的」这种情况一次搬过去；两者都有内容就保留旧目录，不硬合并。
 */
function migrateLegacyBackups(info: DataRootInfo): void {
  const legacy = path.join(info.dataDir, '_backups');
  const target = path.join(info.dataDir, 'backups');
  if (!fs.existsSync(legacy)) return;
  try {
    if (!fs.existsSync(target)) {
      fs.renameSync(legacy, target);
      return;
    }
    if (isEmptyDir(target)) {
      fs.rmdirSync(target);
      fs.renameSync(legacy, target);
    }
  } catch {
    /* 备份目录搬不动不影响启动，下次再试 */
  }
}

function createDataDirs(info: DataRootInfo): void {
  for (const dir of [
    info.dataDir,
    path.join(info.dataDir, 'books'),
    path.join(info.dataDir, 'user'),
    path.join(info.dataDir, 'backups'),
    path.join(info.dataDir, 'exports'),
    path.join(info.dataDir, 'runtime'),
    paths.logs(),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  migrateLegacyBackups(info);

  // 打上「这是墨栖数据」的记号，换位置时用来识别
  const marker = path.join(info.dataDir, DATA_MARKER);
  if (!fs.existsSync(marker)) {
    try {
      fs.writeFileSync(
        marker,
        JSON.stringify(
          {
            app: APP_NAME_EN,
            kind: 'data-dir',
            layout: 'flat',
            version: info.mode === 'single-root' ? 3 : 2,
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      /* 标记失败不影响使用 */
    }
  }
}

export const paths = {
  data: () => getDataRootInfo().dataDir,
  container: () => containerDir() || path.dirname(getDataRootInfo().dataDir),
  program: () => programDir(),
  runtime: () => configDir(),
  library: () => path.join(getDataRootInfo().dataDir, 'library.json'),
  settings: () => path.join(getDataRootInfo().dataDir, 'settings.json'),
  books: () => path.join(getDataRootInfo().dataDir, 'books'),
  bookDir: (id: string) => path.join(getDataRootInfo().dataDir, 'books', id),
  bookFile: (id: string) => path.join(getDataRootInfo().dataDir, 'books', id, 'book.json'),
  bookAssets: (id: string) => path.join(getDataRootInfo().dataDir, 'books', id, 'assets'),
  user: () => path.join(getDataRootInfo().dataDir, 'user'),
  progress: () => path.join(getDataRootInfo().dataDir, 'user', 'progress.json'),
  notes: () => path.join(getDataRootInfo().dataDir, 'user', 'notes.json'),
  sessions: () => path.join(getDataRootInfo().dataDir, 'user', 'sessions.json'),
  backups: () => path.join(getDataRootInfo().dataDir, 'backups'),
  exports: () => path.join(getDataRootInfo().dataDir, 'exports'),
  logs: () => path.join(getDataRootInfo().dataDir, 'logs'),
};

export function ensureDirs(): void {
  const info = getDataRootInfo();
  try {
    createDataDirs(info);
  } catch (err) {
    logError('ensureDirs', err);
    // 自定义位置写不了（权限 / 盘掉了）→ 退回默认，至少让软件能开
    if (info.isCustom) {
      const fallback: DataRootInfo = {
        root: defaultDataDir(),
        dataDir: defaultDataDir(),
        layout: 'flat',
        mode: 'legacy',
        isCustom: false,
        portable: info.portable,
        unavailable: info.root,
        rolledBackFrom: info.root,
      };
      cached = fallback;
      try {
        createDataDirs(fallback);
      } catch (e) {
        logError('ensureDirs:fallback', e);
      }
    }
  }
}

export function logError(scope: string, err: unknown): void {
  try {
    const dir = paths.logs();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] [${scope}] ${
      err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    }\n`;
    fs.appendFileSync(path.join(dir, 'main.log'), line, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}
