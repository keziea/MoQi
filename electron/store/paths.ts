import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 数据目录定位
 *
 * 默认放在 %APPDATA%\moqi-reader\data。用户可以在软件里、或安装时改到别处
 * （比如 D:\ 或移动硬盘），改法统一成：
 *
 *   你选一个目录  →  在里面建 MoQiReader 文件夹  →  数据放 MoQiReader\data
 *
 * 「改到哪了」记在 %APPDATA%\moqi-reader\data-root.txt，先于一切读写生效。
 * 如果这个位置不可用（移动硬盘没插、父目录也没了），自动退回默认位置，
 * 并把不可用的原路径记下来，界面可以据此提示。
 */

/** 用户选定目录下自动创建的数据文件夹名，一眼能认出是墨栖 */
export const DATA_FOLDER_NAME = 'MoQiReader';

/** 数据目录标记文件：用来认出「这确实是墨栖的数据」，避免误删、误覆盖 */
export const DATA_MARKER = '.moqi-data';

const POINTER_FILE = 'data-root.txt';

export interface DataRootInfo {
  /** 数据根目录（MoQiReader 文件夹，或默认的 userData） */
  root: string;
  /** 真正的数据目录 = root/data */
  dataDir: string;
  /** 是不是用户自己选的位置 */
  isCustom: boolean;
  /** 配置指向、但当前不可用的位置 */
  unavailable?: string;
}

let cached: DataRootInfo | null = null;

export function defaultDataRoot(): string {
  return app.getPath('userData');
}

export function defaultDataDir(): string {
  return path.join(defaultDataRoot(), 'data');
}

/**
 * 「数据放到哪了」的指针文件。
 *
 * 只认当前进程的 userData：打包后的 app 名是 package.json 里的 moqi-reader，
 * 和安装器写入的位置一致；不做多目录猜测，避免考试/测试环境读到别处的配置。
 */
function pointerFile(): string {
  return path.join(app.getPath('userData'), POINTER_FILE);
}

function readPointer(): string | null {
  try {
    const file = pointerFile();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) return null;
    return path.resolve(raw);
  } catch {
    return null;
  }
}

/**
 * 这个位置现在能不能用：
 * · 目录已存在 → 可用
 * · 目录不存在 → 只要父目录在，就允许启动时重建（用户误删了 MoQiReader）
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

  const pointer = readPointer();
  if (pointer && usable(pointer)) {
    cached = {
      root: pointer,
      dataDir: path.join(pointer, 'data'),
      isCustom: true,
    };
    return cached;
  }

  cached = {
    root: defaultDataRoot(),
    dataDir: defaultDataDir(),
    isCustom: false,
    unavailable: pointer ?? undefined,
  };
  return cached;
}

/** 记住新的数据位置（下一次启动生效）。只写当前进程真正使用的 userData */
export function setDataRootPointer(root: string): void {
  const file = pointerFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, path.resolve(root), 'utf8');
  cached = null;
}

/** 忘掉自定义位置，回到默认（迁移回默认目录后调用） */
export function clearDataRootPointer(): void {
  try {
    const file = pointerFile();
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
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
        JSON.stringify({ app: 'moqi-reader', kind: 'data-dir', version: 1 }, null, 2),
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
