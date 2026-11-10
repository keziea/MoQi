/**
 * 只截「数据备份」面板，用来检查视觉。
 * 隔离环境：userData 指到 <app>/.userData，不碰真实数据。
 *
 * 用法：node scripts/run-electron-script.js scripts/capture-data-backup.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const USERDATA = path.join(ROOT, '.userData');
const OUT = path.join(ROOT, 'docs', 'screenshots');

app.setPath('userData', USERDATA);
app.setPath('documents', ROOT);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function seed() {
  const dir = path.join(USERDATA, 'data', 'user');
  fs.mkdirSync(dir, { recursive: true });

  const books = [
    { id: 'b1', title: '山中来信' },
    { id: 'b2', title: '灯下长夜' },
    { id: 'b3', title: '纸上的四季' },
  ];
  const now = Date.now();

  const progress = {};
  const notes = {};
  const sessions = [];

  books.forEach((b, i) => {
    progress[b.id] = {
      bookId: b.id,
      chapterId: 'c1',
      blockId: 'c1#0',
      ratio: 0.24 + i * 0.21,
      updatedAt: now - i * 86400000,
    };
    notes[b.id] = Array.from({ length: 3 }, (_, k) => ({
      id: `n-${b.id}-${k}`,
      bookId: b.id,
      chapterId: 'c1',
      chapterTitle: '第一章',
      ranges: [{ blockId: 'c1#0', start: 0, end: 4 }],
      text: '一段被划下来的原文',
      comment: '',
      color: ['clay', 'moss', 'indigo'][k % 3],
      kind: 'selection',
      createdAt: now - k * 3600000,
      updatedAt: now - k * 3600000,
    }));
  });

  for (let d = 0; d < 14; d += 1) {
    const book = books[d % books.length];
    const day = new Date(now - d * 86400000);
    sessions.push({
      id: `s-${d}`,
      bookId: book.id,
      bookTitle: book.title,
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      startedAt: day.getTime(),
      endedAt: day.getTime() + 1200000,
      seconds: 1200,
    });
  }

  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(progress, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(notes, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(sessions, null, 2), 'utf8');
}

async function pickWindow() {
  for (let i = 0; i < 40; i += 1) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) return wins[0];
    await wait(250);
  }
  throw new Error('窗口没有创建出来');
}

async function main() {
  const win = await pickWindow();
  await wait(2200);

  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector('[aria-label="数据备份与恢复"]');
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
  console.log('打开面板:', opened);

  // 主进程会用保存的窗口尺寸覆盖，截图前统一一次，保证和其余截图为同一规格
  await wait(900);
  win.setSize(1500, 1000);
  await wait(700);
  const img = await win.capturePage();
  fs.writeFileSync(path.join(OUT, '08-data-backup.png'), img.toPNG());
  console.log('saved: 08-data-backup.png', img.getSize());

  app.quit();
}

// 必须在 app ready 之前准备环境并加载主进程（它内部会 registerSchemesAsPrivileged）
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(USERDATA, { recursive: true });
seed();
require(path.join(ROOT, 'dist-electron', 'electron', 'main.js'));

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  });
});
