/**
 * 截图脚本 —— 在【完全隔离】的环境里跑，绝不碰作者真实书库。
 *
 * 用法（需在 app 根目录，即 package.json 所在目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/capture-screens.js
 *
 * 隔离方式：
 *   - userData 指到 <app>/.userData，不读写 %APPDATA%/moqi-reader
 *   - documents 指到 <app>，于是默认书库变成 <app>/墨栖书库（只有示例书）
 *   - app.getAppPath() 也是 <app>，不会扫到真实项目里的书
 *
 * 产物：docs/screenshots/*.png
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const USERDATA = path.join(ROOT, '.userData');
const OUT = path.join(ROOT, 'docs', 'screenshots');

app.setPath('userData', USERDATA);
app.setPath('documents', ROOT);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(USERDATA, { recursive: true });

require('../dist-electron/electron/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  // 主进程会用上次保存的窗口大小覆盖，这里每次强制统一，保证所有图尺寸一致
  win.setSize(1500, 1000);
  await wait(600);
  const img = await win.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log('saved:', name, img.getSize());
}

async function clickText(win, text) {
  const ok = await win.webContents.executeJavaScript(`
    (() => {
      const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const t = ${JSON.stringify(text.replace(/\s+/g, ''))};
      const hit = all.find((el) => (el.textContent || '').replace(/\\s+/g, '').includes(t));
      if (hit) { hit.click(); return true; }
      return false;
    })()
  `);
  console.log(`click "${text}":`, ok);
  return ok;
}

/** 造一批历史阅读记录，让统计页与热力图有内容（数据全部虚构） */
function seedSessions(books) {
  if (!books.length) return 0;
  const out = [];
  const today = new Date();
  for (let d = 29; d >= 0; d--) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    // 约七成日子有阅读，偶尔连读两本
    const r = ((d * 7919) % 100) / 100;
    if (d !== 0 && r > 0.72) continue;
    // 今天只留一条短记录：避免超过每日目标触发「目标达成」庆祝弹窗，挡住截图
    const count = d === 0 ? 1 : r < 0.28 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const book = books[(d + i) % books.length];
      const minutes = d === 0 ? 22 : 18 + ((d * 37 + i * 53) % 60);
      const started = new Date(day);
      started.setHours(20 + i, 12 + ((d * 13) % 40), 0, 0);
      const ended = new Date(started.getTime() + minutes * 60000);
      out.push({
        id: `seed-${d}-${i}`,
        bookId: book.id,
        bookTitle: book.title,
        date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
        startedAt: started.getTime(),
        endedAt: ended.getTime(),
        seconds: minutes * 60,
      });
    }
  }
  const userDir = path.join(USERDATA, 'data', 'user');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'sessions.json'), JSON.stringify(out, null, 2), 'utf8');
  return out.length;
}

function readLibrary() {
  const p = path.join(USERDATA, 'data', 'library.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

async function run(win) {
  win.setSize(1500, 1000);
  win.showInactive();
  await wait(500);
  await new Promise((res) => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', res);
    else res();
  });

  // 等首次扫描完成（示例书只有 4 本，很快）
  await wait(6000);
  const books = readLibrary();
  console.log('扫描到书籍：', books.length, books.map((b) => b.title).join(' / '));

  const n = seedSessions(books);
  console.log('已写入历史阅读记录：', n, '条');

  // 重新加载，让统计与首页拿到新数据
  win.reload();
  await wait(5000);

  await clickText(win, '书架');
  await wait(1600);
  await shot(win, '01-shelf');

  // 打开排在第一位的书（EPUB）
  const opened = await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.book-card-main'); if (el) { el.click(); return true; } return false; })()`
  );
  console.log('打开书籍：', opened);
  await wait(2600);

  // 进入正文
  const entered = await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').replace(/\\s+/g, '') === '阅读');
      if (b) { b.click(); return true; }
      return false;
    })()
  `);
  console.log('进入阅读器：', entered);
  await wait(6000);

  // 往后翻几页，产生真实阅读进度
  for (let i = 0; i < 3; i++) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await wait(900);
  }
  await wait(1200);
  await shot(win, '02-reader');

  // 目录面板
  await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') || '').includes('目录') || (x.title || '').includes('目录'));
      if (b) b.click();
    })()
  `);
  await wait(1400);
  await shot(win, '03-toc');

  // 退出阅读器，回工作台
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(1200);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(1800);

  // 回书架再点进详情：此时已有真实进度与「最近打开」
  await clickText(win, '书架');
  await wait(1400);
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.book-card-main'); if (el) el.click(); })()`
  );
  await wait(2400);
  await shot(win, '04-book-detail');

  // 先回首页：读过几页后这里应出现「继续阅读」
  await clickText(win, '首页');
  await wait(1800);
  await shot(win, '05-home');

  await clickText(win, '阅读统计');
  await wait(2000);
  await shot(win, '06-analysis');

  await clickText(win, '阅读记录');
  await wait(2000);
  await shot(win, '07-history');

  console.log('done');
  app.exit(0);
}

app.on('browser-window-created', (_e, win) => {
  run(win).catch((err) => {
    console.error('CAPTURE FAILED:', err);
    app.exit(1);
  });
});

setTimeout(() => {
  console.error('timeout');
  app.exit(2);
}, 120000);
