const { app } = require('electron');
const path = require('path');
app.setPath('userData', path.join(process.env.APPDATA, 'moqi-reader'));
app.whenReady().then(() => {
  const { readLibrary, groupBooks } = require('./dist-electron/electron/store/library.js');
  const { getAllProgress } = require('./dist-electron/electron/store/userdata.js');
  const books = readLibrary();
  const prog = getAllProgress();
  const groups = groupBooks(books, prog);
  for (const g of groups) {
    const p = prog[g.meta.id] || g.copies.map((c) => prog[c.id]).find(Boolean);
    const st = p ? (p.finished ? 'finished' : p.openedAt || p.ratio > 0 ? 'reading' : 'unread') : 'unread';
    console.log(`${g.meta.title} | meta=${g.meta.id} | copies=${g.copies.length} | progress=${p ? 'yes' : 'no'} | status=${st}`);
  }
  app.quit();
});
