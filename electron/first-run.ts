import { BrowserWindow, dialog } from 'electron';
import {
  adoptExternalBooks,
  clearExternalLibraryDirs,
  clearLegacyPointers,
  findLegacyData,
  hasExternalBooks,
  hasUserData,
  migrateLegacyData,
} from './store/migrate';
import { paths, singleRootLayout } from './store/paths';

/**
 * v0.8 首次启动：
 *  · 旧版数据存在、新 Data 还是空的 → 复制进 Data（旧数据保留）
 *  · 书库里有 Data 外部的书 → 复制进 Data\books
 *  · 整个过程用一个无边框小窗显示进度；失败不影响旧数据
 */
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#1b1917;color:#cfc7ba}
body{display:flex;flex-direction:column;justify-content:center;padding:24px 26px;box-sizing:border-box}
#t{font-size:14px;line-height:1.5}
#bar{height:6px;border-radius:99px;background:#3a342e;overflow:hidden;margin-top:14px}
#b{height:100%;width:8%;background:#c9a86a;transition:width .15s ease}
#s{margin-top:9px;font-size:11px;color:#8f867a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<div id="t">正在准备数据…</div>
<div id="bar"><div id="b"></div></div>
<div id="s"></div>
<script>
window.__moqi = function (p) {
  if (p.text) document.getElementById('t').textContent = p.text;
  if (typeof p.percent === 'number') {
    document.getElementById('b').style.width = Math.max(3, Math.min(100, p.percent)) + '%';
  }
  document.getElementById('s').textContent = p.sub || '';
};
</script></body></html>`;

async function createSplash(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 460,
    height: 164,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1B1917',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  win.show();
  return win;
}

function update(win: BrowserWindow | null, text: string, percent: number, sub = ''): void {
  if (!win || win.isDestroyed()) return;
  const payload = JSON.stringify({ text, percent, sub });
  win.webContents.executeJavaScript(`window.__moqi(${payload})`).catch(() => {
    /* 窗口正在关闭 */
  });
}

export async function prepareDataLayout(): Promise<void> {
  const single = singleRootLayout();
  if (!single) return;

  const target = paths.data();

  // 先把旧的外部扫描目录清掉：v0.8 的书都进 Data，避免启动时按旧目录重复扫描
  try {
    clearExternalLibraryDirs();
  } catch {
    /* 配置读不出来不影响启动 */
  }

  const legacy = hasUserData(target) ? null : findLegacyData();
  const needAdopt = hasExternalBooks();
  if (!legacy && !needAdopt) {
    // 没有要搬的，但仍要修复“文件夹被移动后绝对路径失效”的书
    try {
      await adoptExternalBooks();
      clearExternalLibraryDirs();
    } catch {
      /* 修复失败不影响启动 */
    }
    return;
  }

  let splash: BrowserWindow | null = null;
  try {
    splash = await createSplash();
  } catch {
    splash = null;
  }

  try {
    if (legacy) {
      update(splash, '发现旧版数据，正在复制到新的 Data 文件夹…', 3, legacy.dir);
      const result = await migrateLegacyData(legacy.dir, target, (p) => {
        const percent =
          p.total > 0 ? Math.round((p.done / p.total) * 70) + 3 : 5;
        update(
          splash,
          p.phase === 'verify' ? '正在核对文件…' : '正在复制旧数据…',
          percent,
          p.name ?? legacy.dir
        );
      });

      if (!result.migrated) {
        update(splash, '旧数据没能自动迁移', 100, result.error ?? '');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        throw new Error(result.error ?? '旧数据迁移失败');
      }
      clearLegacyPointers();
    }

    if (hasExternalBooks()) {
      update(splash, '正在把书收进数据目录…', legacy ? 76 : 8, '');
      const adopted = await adoptExternalBooks((done, total, title) => {
        const base = legacy ? 76 : 8;
        const span = legacy ? 22 : 90;
        update(
          splash,
          '正在把书收进数据目录…',
          base + Math.round((done / Math.max(1, total)) * span),
          title
        );
      });
      if (adopted.missing.length) {
        update(splash, '有些书不在原位置，先跳过', 100, adopted.missing[0]);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    // 迁移后 settings.json 是从旧数据复制过来的，这里再清一次外部扫描目录
    clearExternalLibraryDirs();

    update(splash, '数据准备好了', 100, '');
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch (err) {
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = null;
    await dialog.showMessageBox({
      type: 'warning',
      title: '旧数据迁移没有完成',
      message: '旧位置的数据没有被删除，仍然安全。',
      detail: [
        '这次先使用新的空 Data 打开。你可以关掉软件，确认旧数据位置可读后重启再试。',
        `旧数据：${legacy?.dir ?? '(未知)'}`,
        `新数据：${target}`,
        err instanceof Error ? `原因：${err.message}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      buttons: ['知道了'],
    });
  } finally {
    if (splash && !splash.isDestroyed()) splash.destroy();
  }
}
