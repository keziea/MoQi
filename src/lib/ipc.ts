import type {
  Book,
  BookMeta,
  DailyStat,
  Note,
  OpenBookResult,
  Progress,
  ReadingSession,
  Settings,
} from '@shared/models';

export interface ScanProgress {
  done: number;
  total: number;
  title: string;
}

export interface AppInfoLite {
  version: string;
  /** Electron / Chromium / Node 运行时版本，关于面板用 */
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  dataDir: string;
  dataRoot: string;
  isCustomDataRoot: boolean;
  unavailableDataRoot: string;
  defaultDataDir: string;
  dataFolderName: string;
  portable: boolean;
  legacyPortable: boolean;
  libraryDir: string;
  documents: string;
  exeDir: string;
}

export interface DataLocationInfo {
  root: string;
  dataDir: string;
  isCustom: boolean;
  unavailable: string;
  /** 会自动创建的文件夹名，例如 MoQiData */
  folderName: string;
  defaultDataDir: string;
  /** 便携版（exe 同级有 portable.flag） */
  portable: boolean;
  /** 便携版但数据仍在系统目录（老用户） */
  legacyPortable: boolean;
  /** 便携目录只读，已退回系统目录 */
  portableReadonly: boolean;
  /** flat = v0.6/v0.8 新结构；nested = v0.5.x「容器 + data」旧结构 */
  layout: 'flat' | 'nested';
  /** single-root = v0.8 固定 <容器>\Data；legacy = v0.7 及以前 */
  mode?: 'single-root' | 'legacy';
  /** v0.8 容器目录 */
  containerDir?: string;
  /** 移动模式留下的旧位置清理计划 */
  pendingCleanup: { old: string; at: number; deleteAfter: number } | null;
  /** 上一次的数据位置（迁移前记录，用于回滚提示） */
  previous: string;
  programDir: string;
  configDir: string;
  /** 指针失效后自动回退的来源 */
  rolledBackFrom: string;
}

export interface RelocateProgress {
  done: number;
  total: number;
  bytes: number;
}

export interface LocationPickResult {
  canceled?: boolean;
  parent?: string;
  plan?: {
    root: string;
    dataDir: string;
    existing: 'none' | 'moqi' | 'other';
    same: boolean;
    inside: boolean;
    empty: boolean;
    invalid?: string;
    detail?: string;
  };
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
      /** 复制失败的外部书 */
      missing: string[];
      /** copy = 旧数据保留；move = 保留 7 天后清理 */
      mode: 'copy' | 'move';
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
      reason?: 'inside' | 'same' | 'conflict' | 'io' | 'invalid' | 'space' | 'canceled';
      detail?: string;
      root?: string;
      dataDir?: string;
    };

export interface DataCounts {
  books: number;
  notes: number;
  days: number;
  sessions: number;
}

export interface BackupCounts extends DataCounts {
  /** 书架上有多少本 */
  shelf: number;
}

export interface BackupStats extends BackupCounts {
  bookBytes: number;
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

export type BackupRestoreResult =
  | {
      ok: true;
      sourceKind: 'zip' | 'folder';
      source: string;
      counts: BackupCounts;
      merged: BackupCounts;
      booksAdded: number;
      booksUpdated: number;
      booksSkipped: number;
      bookFiles: number;
      backupDir: string;
      warnings: string[];
      legacy: boolean;
      includeBooks: boolean;
    }
  | {
      ok: false;
      canceled?: boolean;
      reason?: 'unsupported' | 'not-moqi-data' | 'empty' | 'read-error' | 'zip-error';
      detail?: string;
    };

export interface MoqiApi {
  library: {
    list(): Promise<BookMeta[]>;
    scan(opts?: { silent?: boolean }): Promise<BookMeta[]>;
    import(
      paths: string[]
    ): Promise<{ ok: boolean; added: number; scanned: number; titles: string[]; books: BookMeta[] }>;
    remove(bookId: string, deleteCache: boolean): Promise<{ ok: boolean; books: BookMeta[] }>;
    pickFolder(): Promise<string[] | null>;
    pickFiles(): Promise<string[] | null>;
    setCategories(bookId: string, categories: string[]): Promise<{ ok: boolean; meta?: BookMeta }>;
    switchVariant(bookId: string, format: string): Promise<{ ok: boolean; meta?: BookMeta; error?: string }>;
  };
  book: {
    open(bookId: string): Promise<OpenBookResult>;
  };
  progress: {
    get(bookId: string): Promise<Progress | null>;
    all(): Promise<Record<string, Progress>>;
    save(progress: Progress): Promise<boolean>;
  };
  note: {
    list(bookId: string): Promise<Note[]>;
    save(note: Note): Promise<Note>;
    remove(bookId: string, noteId: string): Promise<boolean>;
    export(bookId: string): Promise<string>;
    exportAll(
      mode: 'single' | 'folder'
    ): Promise<{ ok: boolean; count?: number; path?: string; error?: string; canceled?: boolean }>;
  };
  category: {
    rename(
      kind: 'book' | 'note',
      from: string,
      to: string
    ): Promise<{ ok: boolean; error?: string; books?: BookMeta[]; count?: number }>;
    remove(
      kind: 'book' | 'note',
      name: string
    ): Promise<{ ok: boolean; error?: string; books?: BookMeta[]; count?: number }>;
    setNoteColor(name: string, color: string): Promise<{ ok: boolean; error?: string }>;
  };
  session: {
    add(session: ReadingSession): Promise<boolean>;
  };
  stats: {
    get(days: number): Promise<DailyStat[]>;
    books(): Promise<Record<string, { seconds: number; notes: number }>>;
    resetBookToday(bookId: string): Promise<{ removed: number; today: number }>;
    finishedSummary(bookId: string): Promise<{
      notes: number;
      seconds: number;
      days: number;
      yearIndex: number;
      yearTotal: number;
    }>;
    totals(): Promise<{ seconds: number; days: number; notes: number; allNotes: number }>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: Partial<Settings>): Promise<Settings>;
  };
  backup: {
    info(): Promise<BackupStats>;
    export(opts?: { includeBooks?: boolean }): Promise<BackupExportResult>;
    import(mode: 'zip' | 'folder'): Promise<BackupRestoreResult>;
  };
  location: {
    info(): Promise<DataLocationInfo>;
    pick(): Promise<LocationPickResult>;
    change(opts?: { parent?: string }): Promise<RelocateResult>;
    reset(): Promise<RelocateResult>;
    cleanupNow(): Promise<{ cleaned: boolean; reason?: string }>;
    cancelCleanup(): Promise<boolean>;
  };
  app: {
    info(): Promise<AppInfoLite>;
    openDataDir(): Promise<boolean>;
    openPath(p: string): Promise<boolean>;
    /** 只允许打开「关于」里写死的几个官方链接 */
    openExternal(url: string): Promise<boolean>;
  };
  win: {
    setFullScreen(on: boolean): Promise<boolean>;
    isFullScreen(): Promise<boolean>;
  };
  on: {
    scanProgress(cb: (p: ScanProgress) => void): () => void;
    backupProgress(cb: (p: BackupProgress) => void): () => void;
    locationProgress(cb: (p: RelocateProgress) => void): () => void;
  };
}

declare global {
  interface Window {
    moqi: MoqiApi;
  }
}

export const ipc: MoqiApi = window.moqi;

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.moqi;
}

export type { Book, BookMeta, DailyStat, Note, Progress, ReadingSession, Settings };
