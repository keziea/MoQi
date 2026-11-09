import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = () => path.join(app.getPath('userData'), 'data');

export const paths = {
  data: () => DATA_DIR(),
  library: () => path.join(DATA_DIR(), 'library.json'),
  settings: () => path.join(DATA_DIR(), 'settings.json'),
  books: () => path.join(DATA_DIR(), 'books'),
  bookDir: (id: string) => path.join(DATA_DIR(), 'books', id),
  bookFile: (id: string) => path.join(DATA_DIR(), 'books', id, 'book.json'),
  bookAssets: (id: string) => path.join(DATA_DIR(), 'books', id, 'assets'),
  user: () => path.join(DATA_DIR(), 'user'),
  progress: () => path.join(DATA_DIR(), 'user', 'progress.json'),
  notes: () => path.join(DATA_DIR(), 'user', 'notes.json'),
  sessions: () => path.join(DATA_DIR(), 'user', 'sessions.json'),
  logs: () => path.join(app.getPath('userData'), 'logs'),
};

export function ensureDirs(): void {
  for (const dir of [paths.data(), paths.books(), paths.user(), paths.logs()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
