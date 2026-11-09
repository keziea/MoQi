import { app, BrowserWindow, Menu, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths, ensureDirs, logError } from './store/paths';
import { getSettings, saveSettings } from './store/userdata';
import { registerIpc, setMainWindow, runScan } from './ipc';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

/** 启动自检日志：打包版若启动即退，用它定位停在哪一步 */
function bootLog(msg: string) {
  try {
    const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'moqi-reader');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'boot.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {
    /* 日志失败不影响启动 */
  }
}

bootLog(
  `start pid=${process.pid} packaged=${app.isPackaged} exec=${process.execPath} argv=${JSON.stringify(
    process.argv.slice(1)
  )}`
);

bootLog('registerSchemesAsPrivileged');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'moqi-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

let win: BrowserWindow | null = null;

// 部分 Windows 环境（虚拟显卡 / 远程桌面 / 沙箱）里 GPU 进程初始化失败会让主进程直接退出，
// 窗口还没建出来就没了。这里关掉硬件加速，改用软件渲染，稳定优先。
// 受限环境（远程桌面 / 沙箱 / 精简系统）里 Chromium 的沙箱初始化会失败，
// 表现为窗口刚建好进程就退出（exit=3），所以要关掉沙箱。
//
// 但**绝不能关硬件加速**：一旦 disableHardwareAcceleration()，
// 整个界面退化成 CPU 软件光栅化，弹层模糊、粒子、页面过渡会明显掉帧。
// 沙箱和 GPU 是两件事，之前混在一起处理，牺牲了流畅度。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

function createWindow() {
  bootLog('createWindow:enter');
  const settings = getSettings();
  bootLog('createWindow:settings');
  const bounds = settings.windowBounds;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', '..', 'build', 'icon.ico');

  const w = new BrowserWindow({
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    width: bounds?.width && bounds.width >= 960 ? bounds.width : 1320,
    height: bounds?.height && bounds.height >= 640 ? bounds.height : 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#F5F2EA',
    autoHideMenuBar: true,
    title: '墨栖',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  bootLog('createWindow:browserwindow');
  Menu.setApplicationMenu(null);
  win = w;
  setMainWindow(w);

  w.once('ready-to-show', () => {
    bootLog('window ready-to-show');
    w.show();
  });
  w.webContents.on('render-process-gone', (_e, d) => {
    bootLog(`render-process-gone ${JSON.stringify(d)}`);
  });

  w.on('close', () => {
    // 截图自检不改用户记住的窗口大小
    if (process.env.MOQI_SHOT) return;
    try {
      const b = w.getBounds();
      if (b && !w.isMaximized() && !w.isFullScreen()) {
        saveSettings({ windowBounds: b });
      }
    } catch {
      /* ignore */
    }
  });

  w.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
      w.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'F11') {
      w.setFullScreen(!w.isFullScreen());
      event.preventDefault();
    }
  });

  // 外部链接走系统浏览器
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) import('electron').then(({ shell }) => shell.openExternal(url));
    return { action: 'deny' };
  });

  const indexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
  bootLog(`load index from ${indexPath} exists=${fs.existsSync(indexPath)}`);
  if (DEV_URL) {
    w.loadURL(DEV_URL);
  } else {
    w.loadFile(indexPath, {
      hash: process.env.MOQI_SHOT_PAGE === 'reader' ? 'reader' : undefined,
    });
  }
  w.webContents.on('did-fail-load', (_e, code, desc, url) => {
    bootLog(`did-fail-load ${code} ${desc} ${url}`);
  });

  if (process.env.MOQI_SHOT) {
    w.webContents.once('did-finish-load', () => {
      if (process.env.MOQI_SHOT_W || process.env.MOQI_SHOT_H) {
        w.setContentSize(
          Number(process.env.MOQI_SHOT_W) || 1320,
          Number(process.env.MOQI_SHOT_H) || 860
        );
      }
      setTimeout(async () => {
        try {
          if (process.env.MOQI_SHOT_JS) {
            const r = await w.webContents.executeJavaScript(process.env.MOQI_SHOT_JS);
            if (r !== undefined) console.log('JS_RESULT:', typeof r === 'string' ? r : JSON.stringify(r));
            await new Promise((r2) => setTimeout(r2, 1400));
          }
          const img = await w.webContents.capturePage();
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('node:fs').writeFileSync(process.env.MOQI_SHOT!, img.toPNG());
        } catch (e) {
          logError('shot', e);
        }
        app.quit();
      }, Number(process.env.MOQI_SHOT_DELAY ?? 4200));
    });
  }

  win.on('closed', () => {
    win = null;
  });
}

function registerAssetProtocol() {
  protocol.handle('moqi-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return new Response('bad request', { status: 400 });

      const bookId = decodeURIComponent(parts[0]);
      const rel = parts.slice(1).map((p) => decodeURIComponent(p)).join('/');

      const base = path.resolve(paths.bookDir(bookId));
      const target = path.resolve(base, rel);
      if (!target.startsWith(base + path.sep) && target !== base) {
        return new Response('forbidden', { status: 403 });
      }
      return await net.fetch(pathToFileURL(target).toString());
    } catch (err) {
      logError('asset-protocol', err);
      return new Response('not found', { status: 404 });
    }
  });
}

bootLog('requestSingleInstanceLock');
const gotLock = app.requestSingleInstanceLock();
bootLog(`lock=${gotLock}`);
if (!gotLock) {
  bootLog('another instance, quit');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    bootLog('ready');
    ensureDirs();
    bootLog('dirs ok');
    registerAssetProtocol();
    bootLog('protocol ok');
    registerIpc();
    bootLog('ipc ok');
    createWindow();
    bootLog('window created');

    // 后台刷新书库（不阻塞界面）
    setTimeout(() => {
      runScan(true).catch((e) => logError('startup-scan', e));
    }, 800);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  process.on('uncaughtException', (err) => {
    bootLog(`uncaught: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    logError('uncaught', err);
  });
  process.on('unhandledRejection', (err) => {
    bootLog(`unhandledRejection: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    logError('unhandledRejection', err);
  });
}
