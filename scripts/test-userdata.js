/**
 * 个人数据导入 / 导出的自动化测试。
 *
 * 不启动界面，直接在 Electron 主进程里跑，用临时 userData 目录隔离，
 * 不会碰你真实的阅读数据。
 *
 * 运行：npm run test:data
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(os.tmpdir(), 'moqi-userdata-test');
const USERDATA = path.join(SANDBOX, 'userData');
const OUT = path.join(SANDBOX, 'out');

app.disableHardwareAcceleration();
app.setPath('userData', USERDATA);
app.setPath('documents', SANDBOX);

const store = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'userdata.js'));
const { paths } = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'paths.js'));

let pass = 0;
let fail = 0;

function check(name, ok, extra) {
  if (ok) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${extra ? ` :: ${extra}` : ''}`);
  }
}

function resetUserFiles() {
  fs.mkdirSync(paths.user(), { recursive: true });
  for (const name of fs.readdirSync(paths.user())) {
    const target = path.join(paths.user(), name);
    try {
      if (fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.rmSync(target, { force: true });
    } catch {
      /* 测试隔离目录，忽略 */
    }
  }
}

function writeUser(name, data) {
  fs.writeFileSync(path.join(paths.user(), name), JSON.stringify(data, null, 2), 'utf8');
}

function readUser(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.user(), name), 'utf8'));
  } catch {
    return fallback;
  }
}

const NOTE = (id, blockId) => ({
  id,
  bookId: 'b1',
  chapterId: 'c1',
  chapterTitle: '第一章',
  ranges: [{ blockId, start: 0, end: 3 }],
  text: '测试原文',
  comment: '',
  color: 'clay',
  kind: 'selection',
  createdAt: 1,
  updatedAt: 2,
});

const SESSION = (id, date, seconds) => ({
  id,
  bookId: 'b1',
  bookTitle: '测试书',
  date,
  startedAt: 1,
  endedAt: 2,
  seconds,
});

const PROGRESS = (ratio, updatedAt) => ({
  b1: { bookId: 'b1', chapterId: 'c1', blockId: 'c1#2', ratio, updatedAt },
});

function run() {
  console.log('\n▸ 准备测试环境');
  fs.mkdirSync(SANDBOX, { recursive: true });
  resetUserFiles();
  writeUser('progress.json', PROGRESS(0.42, 2000));
  writeUser('notes.json', { b1: [NOTE('n1', 'c1#0'), NOTE('n2', 'c1#1')] });
  writeUser('sessions.json', [SESSION('s1', '2026-11-09', 600), SESSION('s2', '2026-11-10', 300)]);
  console.log(`  userData: ${USERDATA}`);

  console.log('\n▸ 1. 导出');
  const exp = store.exportUserData(OUT, '0.4.0');
  check('导出返回成功', exp.ok === true, exp.detail);
  const dir = exp.ok ? exp.dir : '';
  check('三个数据文件都在', dir && ['progress.json', 'notes.json', 'sessions.json'].every((f) => fs.existsSync(path.join(dir, f))));
  check('附带白话说明文件', !!dir && fs.existsSync(path.join(dir, '导入说明.txt')));
  check('导出统计正确（1 本 / 2 条 / 2 天）', exp.ok && exp.counts.books === 1 && exp.counts.notes === 2 && exp.counts.days === 2, JSON.stringify(exp.counts));

  console.log('\n▸ 2. 导出的内容与源文件一致');
  const sameNotes = JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'), 'utf8'))) === JSON.stringify(readUser('notes.json', {}));
  check('notes.json 内容一致', sameNotes);

  console.log('\n▸ 3. 导入到空环境');
  resetUserFiles();
  const imp = store.importUserData(dir);
  check('标准导入成功', imp.ok === true, imp.reason);
  check('落盘条数正确', readUser('notes.json', {})['b1']?.length === 2);
  check('导入后自动备份', imp.ok && fs.existsSync(path.join(paths.user(), imp.backupDir)));

  console.log('\n▸ 4. 选中导出文件夹的上一层');
  resetUserFiles();
  const upstream = store.importUserData(OUT);
  check('父目录也能识别', upstream.ok === true, upstream.reason);

  console.log('\n▸ 5. 文件夹改名后仍能导入');
  const renamed = path.join(OUT, 'abc123');
  if (fs.existsSync(renamed)) fs.rmSync(renamed, { recursive: true, force: true });
  fs.renameSync(dir, renamed);
  resetUserFiles();
  const renamedRes = store.importUserData(renamed);
  check('不依赖目录名', renamedRes.ok === true, renamedRes.reason);

  console.log('\n▸ 6. 拒绝非本软件的数据');
  const junk = path.join(SANDBOX, 'junk');
  fs.mkdirSync(junk, { recursive: true });
  fs.writeFileSync(path.join(junk, 'readme.txt'), 'hello', 'utf8');
  resetUserFiles();
  writeUser('notes.json', { b1: [NOTE('keep', 'c1#0')] });
  const before = JSON.stringify(readUser('notes.json', {}));
  const junkRes = store.importUserData(junk);
  check("返回 not-moqi-data", junkRes.ok === false && junkRes.reason === 'not-moqi-data', junkRes.reason);
  check('拒绝时现有数据零变化', JSON.stringify(readUser('notes.json', {})) === before);

  console.log('\n▸ 7. 空数据被拒');
  const emptyDir = path.join(SANDBOX, 'empty');
  fs.mkdirSync(emptyDir, { recursive: true });
  fs.writeFileSync(path.join(emptyDir, 'progress.json'), '{}', 'utf8');
  resetUserFiles();
  const emptyRes = store.importUserData(emptyDir);
  check("返回 empty", emptyRes.ok === false && emptyRes.reason === 'empty', emptyRes.reason);

  console.log('\n▸ 8. 损坏的 JSON 被拒');
  const brokenDir = path.join(SANDBOX, 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'progress.json'), '{ not valid json', 'utf8');
  resetUserFiles();
  const brokenRes = store.importUserData(brokenDir);
  check("返回 read-error", brokenRes.ok === false && brokenRes.reason === 'read-error', brokenRes.reason);

  console.log('\n▸ 9. 同一份数据导入两次不翻倍');
  resetUserFiles();
  store.importUserData(renamed);
  const once = store.countUserData();
  store.importUserData(renamed);
  const twice = store.countUserData();
  check(
    '笔记 / 会话 / 书数均不翻倍',
    once.notes === twice.notes && once.sessions === twice.sessions && once.books === twice.books,
    JSON.stringify({ once, twice })
  );

  console.log('\n▸ 10. 旧数据不覆盖新数据');
  resetUserFiles();
  writeUser('progress.json', PROGRESS(0.9, 2000));
  const olderDir = path.join(SANDBOX, 'older');
  fs.mkdirSync(olderDir, { recursive: true });
  fs.writeFileSync(path.join(olderDir, 'progress.json'), JSON.stringify(PROGRESS(0.1, 1000)), 'utf8');
  store.importUserData(olderDir);
  const kept = readUser('progress.json', {})['b1'];
  check('保留较新的进度', kept.updatedAt === 2000 && kept.ratio === 0.9, JSON.stringify(kept));

  const backups = fs
    .readdirSync(paths.user())
    .filter((n) => n.startsWith('_backup-'))
    .sort();
  const latestBackup = backups[backups.length - 1];
  check(
    '备份里保留了导入前的旧文件',
    !!latestBackup && fs.existsSync(path.join(paths.user(), latestBackup, 'progress.json')),
    String(latestBackup)
  );

  console.log('\n▸ 11. 不碰书架索引');
  putLibrary();
  resetUserFiles();
  store.importUserData(renamed);
  check('library.json 未变', readAbs(paths.library()) === '[{"id":"keep"}]');

  console.log('\n▸ 12. 统计接口');
  const counts = store.countUserData();
  check('countUserData 字段完整', typeof counts.books === 'number' && typeof counts.notes === 'number' && typeof counts.days === 'number' && typeof counts.sessions === 'number');
}

function putLibrary() {
  fs.mkdirSync(path.dirname(paths.library()), { recursive: true });
  fs.writeFileSync(paths.library(), '[{"id":"keep"}]', 'utf8');
}

function readAbs(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

app.whenReady().then(() => {
  try {
    run();
  } catch (err) {
    fail += 1;
    console.error('\n测试执行出错：', err);
  }
  console.log(`\n结果：通过 ${pass} 项 / 失败 ${fail} 项\n`);
  app.exit(fail === 0 ? 0 : 1);
});
