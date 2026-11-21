import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME_EN, DATA_DIR_NAME } from '../../shared/names.generated';

/**
 * 数据目录定位
 *
 * 默认放在 %APPDATA%\moqi-reader\data。用户可以在软件里、或安装时改到别处
 * （比如 D:\ 或移动硬盘），改法统一成：
 *
 *   你选一个目录  →  在里面建 <dataDir> 文件夹  →  数据放 <dataDir>\data
 *
 * 「改到哪了」记在 %APPDATA%\moqi-reader\data-root.txt，先于一切读写生效。
 * 如果这个位置不可用（移动硬盘没插、父目录也没了），自动退回默认位置，
 * 并把不可用的原路径记下来，界面可以据此提示。
 */

/** 用户选定目录下自动创建的数据文件夹名（来自 package.json → moqi.dataDir） */
export { DATA_DIR_NAME };

/** 数据目录标记文件：用来认出「这确实是墨栖的数据」，避免误删、误覆盖 */
export const DATA_MARKER = '.moqi-data';

const POINTER_FILE = 'data-root.txt';

export interface DataRootInfo {
  /** 数据根目录（<dataDir> 文件夹，或默认的 userData） */
  root: string;
  /** 真正的数据目录 = root/data */
  dataDir: string;
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
}

let cached: DataRootInfo | null = null;

export function defaultDataRoot(): string {
  return app.getPath('userData');
}

export function defaultDataDir(): string {
  return path.join(defaultDataRoot(), 'data');
}

function exeDir(): string {
  try {
    return path.dirname(app.getPath('exe'));
  } catch {
    return '';
  }
}

/** 便携包判据：exe 同级有 portable.flag；开发模式永远按安装版处理 */
export function isPortable(): boolean {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(exeDir(), 'portable.flag'));
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
  if (isPortable()) out.push(path.join(exeDir(), POINTER_FILE));
  out.push(path.join(app.getPath('userData'), POINTER_FILE));
  return out;
}

function readPointer(): string | null {
  for (const file of pointerFiles()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!raw) continue;
      return path.resolve(raw);
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

/**
 * 这个位置现在能不能用：
 * · 目录已存在 → 可用
 * · 目录不存在 → 只要父目录在，就允许启动时重建（用户误删了数据文件夹）
 * · 父目录也不在（盘符没插）→ 不可用
 */
function usable(root: string): boolean {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    try {
      const parent = path.dirname(root);
      return parent !== root && fs.statSync(parent).isDirectory();
    } catch {
      return false;
    }
  }
}

export function getDataRootInfo(): DataRootInfo {
  if (cached) return cached;

  const portable = isPortable();
  const pointer = readPointer();

  // 1. 指针优先（便携版的 exe 同级指针也在 readPointer 里）
  if (pointer && usable(pointer)) {
    cached = {
      root: pointer,
      dataDir: path.join(pointer, 'data'),
      isCustom: true,
      portable,
    };
    return cached;
  }

  // 2. 便携版默认：程序同级 <dataDir>
  if (portable) {
    const portableRoot = path.join(exeDir(), DATA_DIR_NAME);
    const portableData = path.join(portableRoot, 'data');
    const appDataRoot = defaultDataRoot();
    const appDataData = path.join(appDataRoot, 'data');

    // 老便携用户：数据还在系统目录，先继续用，避免书架突然空
    if (!fs.existsSync(portableData) && fs.existsSync(appDataData)) {
      cached = {
        root: appDataRoot,
        dataDir: appDataData,
        isCustom: false,
        portable,
        legacyPortable: true,
        unavailable: pointer ?? undefined,
      };
      return cached;
    }

    const writable = fs.existsSync(portableRoot)
      ? canWrite(portableRoot)
      : canWrite(exeDir());
    if (writable) {
      cached = {
        root: portableRoot,
        dataDir: portableData,
        isCustom: false,
        portable,
      };
      return cached;
    }

    // 只读介质：退回系统目录并标记
    cached = {
      root: appDataRoot,
      dataDir: appDataData,
      isCustom: false,
      portable,
      portableReadonly: true,
      unavailable: pointer ?? undefined,
    };
    return cached;
  }

  // 3. 安装版默认
  cached = {
    root: defaultDataRoot(),
    dataDir: defaultDataDir(),
    isCustom: false,
    portable: false,
    unavailable: pointer ?? undefined,
  };
  return cached;
}

/** 记住新的数据位置（下一次启动生效）。便携版写 exe 同级，跟着文件夹走 */
export function setDataRootPointer(root: string): void {
  const target =
    isPortable() && canWrite(exeDir())
      ? path.join(exeDir(), POINTER_FILE)
      : path.join(app.getPath('userData'), POINTER_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, path.resolve(root), 'utf8');
  cached = null;
}

/** 忘掉自定义位置，回到默认（迁移回默认目录后调用） */
export function clearDataRootPointer(): void {
  for (const file of pointerFiles()) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  cached = null;
}

function createDataDirs(info: DataRootInfo): void {
  for (const dir of [
    info.dataDir,
    path.join(info.dataDir, 'books'),
    path.join(info.dataDir, 'user'),
    paths.logs(),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // 打上「这是墨栖数据」的记号，换位置时用来识别
  const marker = path.join(info.dataDir, DATA_MARKER);
  if (!fs.existsSync(marker)) {
    try {
      fs.writeFileSync(
        marker,
        JSON.stringify({ app: APP_NAME_EN, kind: 'data-dir', version: 1 }, null, 2),
        'utf8'
      );
    } catch {
      /* 标记失败不影响使用 */
    }
  }
}

export const paths = {
  data: () => getDataRootInfo().dataDir,
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
  logs: () => path.join(app.getPath('userData'), 'logs'),
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
        root: defaultDataRoot(),
        dataDir: defaultDataDir(),
        isCustom: false,
        portable: info.portable,
        unavailable: info.root,
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
