import fs from 'node:fs';
import path from 'node:path';

/**
 * 原子写：tmp → rename，写前备份 .bak
 * 契约见 docs/03-数据模型与存储.md §4.1
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = `${file}.tmp`;
  const bak = `${file}.bak`;
  const body = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmp, body, 'utf8');

  try {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, bak);
      fs.unlinkSync(file);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    // 回滚
    try {
      if (fs.existsSync(bak) && !fs.existsSync(file)) fs.copyFileSync(bak, file);
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function readJson<T>(file: string, fallback: T): T {
  for (const candidate of [file, `${file}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8').trim();
      if (!raw) continue;
      return JSON.parse(raw) as T;
    } catch {
      /* 尝试下一个 */
    }
  }
  return fallback;
}

export function writeTextAtomic(file: string, text: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw err;
  }
}
