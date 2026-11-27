import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 版本唯一来源是项目根的 package.json。
 *
 * 不用 app.getVersion()：截图 / 测试脚本的入口在临时目录时，Electron 会在启动时
 * 把版本缓存成 Electron 自己的版本（如 33.4.11），导致界面和 package.json 对不上。
 * 这里直接读 app path 下的 package.json；读不到才退回 app.getVersion()。
 */
export function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: string }).version;
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* 打包异常时退回 Electron 自带版本 */
  }
  return app.getVersion();
}
