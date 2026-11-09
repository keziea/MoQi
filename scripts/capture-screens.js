/**
 * 截图脚本 —— 仅用于生成 README 展示图，不参与打包。
 *
 * 用法：npx electron scripts/capture-screens.js
 * 产物：docs/screenshots/*.png
 *
 * 原理：直接加载项目主进程（复用全部 IPC 与书库读取），
 * 在真实数据下依次切换界面并截图，保证图片与实际运行效果一致。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// 让主进程按我们给的尺寸和默认主题启动
process.env.MOQI_CAPTURE = '1';

require('../dist-electron/electron/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.capturePage();
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log('saved:', name, img.getSize());
}

async function clickText(win, text) {
  const ok = await win.webContents.executeJavaScript(`
    (() => {
      const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const hit = all.find((el) => (el.textContent || '').replace(/\\s+/g, '').includes(${JSON.stringify(
        text.replace(/\s+/g, '')
      )}));
      if (hit) { hit.click(); return true; }
      return false;
    })()
  `);
  console.log(`click "${text}":`, ok);
  return ok;
}

async function run(win) {
  win.setSize(1500, 1000);
  win.showInactive();
  await wait(500);
  await new Promise((res) => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', res);
    else res();
  });
  await wait(4500); // 等书库扫描与封面生成

  await shot(win, '01-workspace');

  await clickText(win, '书架');
  await wait(1500);
  await shot(win, '02-shelf');

  // 进书籍详情页
  const opened = await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.book-card-main'); if (el) { el.click(); return true; } return false; })()`
  );
  console.log('open book:', opened);
  await wait(2500);
  await shot(win, '03-book-detail');

  // 从详情页点「阅读」进入正文
  const entered = await win.webContents.executeJavaScript(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hit = btns.find((b) => (b.textContent || '').replace(/\\s+/g, '') === '阅读');
      if (hit) { hit.click(); return true; }
      return false;
    })()
  `);
  console.log('enter reader:', entered);
  await wait(8000);
  await shot(win, '04-reader');

  // 打开目录面板
  await win.webContents.executeJavaScript(
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label')||'').includes('目录') || (x.title||'').includes('目录')); if (b) b.click(); })()`
  );
  await wait(1200);
  await shot(win, '05-toc');

  // 关闭面板，回到工作台
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(1200);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(1500);

  await clickText(win, '阅读统计');
  await wait(1800);
  await shot(win, '06-analysis');

  await clickText(win, '阅读记录');
  await wait(1800);
  await shot(win, '07-history');

  await clickText(win, '笔记');
  await wait(1500);
  await shot(win, '08-notes');

  console.log('done');
  app.exit(0);
}

app.on('browser-window-created', (_e, win) => {
  run(win).catch((err) => {
    console.error('CAPTURE FAILED:', err);
    app.exit(1);
  });
});

// 兜底：30 秒还没截完就退出，避免挂住
setTimeout(() => {
  console.error('timeout');
  app.exit(2);
}, 90000);
