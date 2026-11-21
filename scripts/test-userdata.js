/**
 * 备份 / 恢复的自动化测试。
 *
 * 不启动界面，直接在 Electron 主进程里跑；每次用一个全新的临时 userData，
 * 不会碰你真实的阅读数据。
 *
 * 覆盖：
 *  1. 连书导出 → zip 里该有的都有
 *  2. 换到「新电脑」（清空数据）→ 从 zip 恢复，书架 / 书文件 / 笔记 / 进度都回来
 *  3. 同一个 zip 再恢复一次 → 不重复、不多出文件
 *  4. 解压后的文件夹也能恢复
 *  5. 旧版只有三个 json 的备份也能恢复（只恢复阅读数据）
 *  6. 不带书的轻量备份不产生 books 条目
 *
 * 运行：npm run test:data
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(os.tmpdir(), `moqi-backup-test-${process.pid}-${Date.now()}`);
const USERDATA = path.join(SANDBOX, 'userData');
const OUT = path.join(SANDBOX, 'out');

app.setPath('userData', USERDATA);
app.setPath('documents', SANDBOX);

const backup = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'backup.js'));
const zip = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'zip.js'));
const store = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'library.js'));
const userdata = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'userdata.js'));
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

const BOOK_ID = '活着-abc123';
const BOOK_TEXT = `第一章\n${'这是正文，用来凑够一本书的体积。'.repeat(300)}`;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function note(id, text, updatedAt, bookId = BOOK_ID) {
  return {
    id,
    bookId,
    chapterId: 'c0',
    chapterTitle: '第一章',
    ranges: [{ blockId: 'c0#0', start: 0, end: 3 }],
    text,
    comment: '',
    color: 'clay',
    kind: 'selection',
    createdAt: updatedAt,
    updatedAt,
  };
}

function seedFullMachine() {
  fs.mkdirSync(paths.books(), { recursive: true });
  fs.mkdirSync(paths.user(), { recursive: true });

  const sourceDir = path.join(SANDBOX, '我的书');
  fs.mkdirSync(sourceDir, { recursive: true });
  const bookFile = path.join(sourceDir, '活着.txt');
  fs.writeFileSync(bookFile, BOOK_TEXT, 'utf8');

  fs.mkdirSync(paths.bookDir(BOOK_ID), { recursive: true });
  fs.writeFileSync(path.join(paths.bookDir(BOOK_ID), 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const now = Date.now();
  store.writeLibrary([
    {
      id: BOOK_ID,
      title: '活着',
      author: '余华',
      format: 'txt',
      variants: [
        { format: 'txt', path: bookFile, sizeBytes: Buffer.byteLength(BOOK_TEXT), quality: 60 },
      ],
      totalChars: BOOK_TEXT.length,
      chapterCount: 1,
      addedAt: now,
      lastOpenedAt: now,
      categories: ['文学'],
      cover: 'cover.jpg',
    },
  ]);

  writeJson(paths.progress(), {
    [BOOK_ID]: {
      bookId: BOOK_ID,
      chapterId: 'c0',
      blockId: 'c0#0',
      delta: 0,
      ratio: 0.42,
      updatedAt: now,
    },
  });
  writeJson(paths.notes(), { [BOOK_ID]: [note('n1', '人是为了活着本身而活着', now)] });
  writeJson(paths.sessions(), [
    {
      id: 's1',
      bookId: BOOK_ID,
      bookTitle: '活着',
      date: '2026-11-20',
      startedAt: now - 3600000,
      endedAt: now,
      seconds: 1800,
    },
  ]);
  writeJson(paths.settings(), {
    ...readJson(paths.settings(), {}),
    categories: ['文学', '历史'],
    noteCategories: [{ name: '想法', color: 'clay' }],
    dailyGoalMinutes: 45,
  });
}

function wipeMachine() {
  fs.rmSync(path.join(USERDATA, 'data'), { recursive: true, force: true });
  fs.mkdirSync(paths.user(), { recursive: true });
  fs.mkdirSync(paths.books(), { recursive: true });
  store.writeLibrary([]);
  writeJson(paths.progress(), {});
  writeJson(paths.notes(), {});
  writeJson(paths.sessions(), []);
  writeJson(paths.settings(), {});
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ── 1. 导出 ──
  console.log('\n[1] 连书导出为 zip');
  seedFullMachine();
  const zipFile = path.join(OUT, '墨栖备份.zip');
  const exported = await backup.exportBackup(zipFile, { includeBooks: true });
  check('导出成功', exported.ok === true, exported.detail);
  check('zip 文件已生成', fs.existsSync(zipFile) && fs.statSync(zipFile).size > 0);

  const index = await zip.readZipIndex(zipFile);
  const names = index.map((e) => e.name);
  check('清单在包里', names.includes('manifest.json'));
  check('导入说明在包里', names.includes('导入说明.txt'));
  check('书架索引在包里', names.includes('data/library.json'));
  check('笔记在包里', names.includes('data/user/notes.json'));
  check(
    '书文件在包里',
    names.some((n) => n.startsWith(`data/books/${BOOK_ID}/source/`)),
    names.filter((n) => n.includes('books')).join(', ')
  );
  check('封面在包里', names.includes(`data/books/${BOOK_ID}/cover.jpg`));

  const manifest = JSON.parse(
    (await zip.readZipEntryBuffer(zipFile, index.find((e) => e.name === 'manifest.json'))).toString('utf8')
  );
  check('清单数量正确', manifest.counts.shelf === 1 && manifest.counts.notes === 1, JSON.stringify(manifest.counts));

  // ── 2. 换电脑恢复 ──
  console.log('\n[2] 清空数据后从 zip 恢复');
  wipeMachine();
  const restored = await backup.restoreBackup(zipFile);
  check('恢复成功', restored.ok === true, restored.detail);
  check('新放入 1 本书', restored.booksAdded === 1, String(restored.booksAdded));

  const lib = store.readLibrary();
  check('书架回到 1 本', lib.length === 1, String(lib.length));
  const meta = lib[0] || {};
  const variant = (meta.variants || [])[0] || {};
  check('书文件落在墨栖数据目录', /data[\\/]books/.test(variant.path || ''), variant.path);
  check('书文件真的存在', !!variant.path && fs.existsSync(variant.path));
  check('封面回来了', !!meta.cover && fs.existsSync(path.join(paths.bookDir(BOOK_ID), meta.cover)));
  check('分类回来了', Array.isArray(meta.categories) && meta.categories.includes('文学'));

  const progress = readJson(paths.progress(), {});
  const notes = readJson(paths.notes(), {});
  const sessions = readJson(paths.sessions(), []);
  check('进度回来了', progress[BOOK_ID] && progress[BOOK_ID].ratio === 0.42);
  check('笔记回来了', (notes[BOOK_ID] || []).length === 1);
  check('阅读记录回来了', sessions.length === 1);
  check('每日目标回来了', readJson(paths.settings(), {}).dailyGoalMinutes === 45);

  // ── 3. 重复导入 ──
  console.log('\n[3] 同一个 zip 再导入一次');
  const again = await backup.restoreBackup(zipFile);
  check('再次恢复成功', again.ok === true, again.detail);
  check('笔记没有重复', (readJson(paths.notes(), {})[BOOK_ID] || []).length === 1);
  check('书架没有重复', store.readLibrary().length === 1);
  const copies = fs.readdirSync(path.join(paths.bookDir(BOOK_ID), 'source'));
  check('书文件没有越导越多', copies.length === 1, copies.join(','));

  // ── 4. 从解压后的文件夹恢复 ──
  console.log('\n[4] 从解压出来的文件夹恢复（外面又套了一层文件夹）');
  const unpacked = path.join(OUT, '用户解压到这里', '墨栖备份-2026-11-20');
  for (const entry of index) {
    if (entry.isDir) continue;
    const target = path.join(unpacked, ...entry.name.split('/'));
    await zip.extractZipEntry(zipFile, entry, target);
  }
  wipeMachine();
  const fromFolder = await backup.restoreBackup(path.join(OUT, '用户解压到这里'));
  check('文件夹恢复成功', fromFolder.ok === true, fromFolder.detail);
  check('文件夹里也认出了书', fromFolder.booksAdded === 1, String(fromFolder.booksAdded));
  check('认得出这份备份带书', fromFolder.includeBooks === true);

  // ── 5. 旧版备份 ──
  console.log('\n[5] 旧版三文件备份');
  const legacy = path.join(OUT, '墨栖个人数据-2026-01-01');
  fs.mkdirSync(legacy, { recursive: true });
  writeJson(path.join(legacy, 'progress.json'), readJson(paths.progress(), {}));
  writeJson(path.join(legacy, 'notes.json'), {
    [BOOK_ID]: [note('n-old', '旧版备份里的笔记', Date.now())],
  });
  writeJson(path.join(legacy, 'sessions.json'), []);
  const legacyResult = await backup.restoreBackup(legacy);
  check('旧版备份能恢复', legacyResult.ok === true, legacyResult.detail);
  check('识别为旧版', legacyResult.ok && legacyResult.legacy === true);
  const legacyNotes = readJson(paths.notes(), {})[BOOK_ID] || [];
  check('旧版笔记合并进来了', legacyNotes.some((n) => n.id === 'n-old'));

  // ── 6. 轻量备份不带书 ──
  console.log('\n[6] 不勾选「连书一起打包」');
  const lightZip = path.join(OUT, '轻量.zip');
  const light = await backup.exportBackup(lightZip, { includeBooks: false });
  check('轻量导出成功', light.ok === true, light.detail);
  const lightNames = (await zip.readZipIndex(lightZip)).map((e) => e.name);
  check('没有 books 条目', !lightNames.some((n) => n.includes('books/')));
  check('书架的 json 还在', lightNames.includes('data/library.json'));
  check('笔记还在', lightNames.includes('data/user/notes.json'));

  // ── 7. 不是墨栖的压缩包 ──
  console.log('\n[7] 乱七八糟的文件');
  const junk = path.join(OUT, '随便.zip');
  fs.writeFileSync(junk, 'not a zip', 'utf8');
  const bad = await backup.restoreBackup(junk);
  check('明确报错而不是崩溃', bad.ok === false && !!bad.reason, JSON.stringify(bad));

  // ── 8. 数据位置迁移 ──
  console.log('\n[8] 换一个数据存放位置');
  const loc = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'location.js'));
  const pathsMod = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'paths.js'));

  const targetParent = path.join(SANDBOX, '我的数据盘');
  fs.mkdirSync(targetParent, { recursive: true });

  // 再加一本「放在外部文件夹」的书，验证搬家时会复制进数据目录
  const externalFile = path.join(SANDBOX, '我的书', '外置书.txt');
  fs.mkdirSync(path.dirname(externalFile), { recursive: true });
  fs.writeFileSync(externalFile, `第一章\n${'外置书的正文。'.repeat(200)}`, 'utf8');
  store.writeLibrary([
    ...store.readLibrary(),
    {
      id: '外置书-xyz789',
      title: '外置书',
      author: '某人',
      format: 'txt',
      variants: [
        {
          format: 'txt',
          path: externalFile,
          sizeBytes: fs.statSync(externalFile).size,
          quality: 60,
        },
      ],
      totalChars: 1600,
      chapterCount: 1,
      addedAt: Date.now(),
    },
  ]);

  const moved = await loc.relocateData({ kind: 'custom', parent: targetParent });
  check('迁移成功', moved.ok === true, moved.detail);
  check('建的是 MoQiReader 文件夹', moved.ok && moved.root === path.join(targetParent, 'MoQiReader'), moved.root);
  check('数据落在 MoQiReader\\data', moved.ok && fs.existsSync(path.join(moved.root, 'data', 'library.json')));
  check(
    '记下了新位置',
    fs.readFileSync(path.join(USERDATA, 'data-root.txt'), 'utf8').trim() ===
      path.join(targetParent, 'MoQiReader')
  );
  check('墨栖认得新位置', pathsMod.getDataRootInfo().dataDir === path.join(targetParent, 'MoQiReader', 'data'));
  const movedLib = store.readLibrary();
  check('迁移后书架还在', movedLib.length === 2, String(movedLib.length));
  const innerVariant = (movedLib.find((b) => b.id === BOOK_ID)?.variants || [])[0];
  check(
    '原来在数据目录里的书，路径跟着换了',
    !!innerVariant && innerVariant.path.startsWith(path.join(targetParent, 'MoQiReader', 'data')),
    innerVariant?.path
  );
  check('换完路径书文件还在', !!innerVariant && fs.existsSync(innerVariant.path));

  const adoptedVariant = (movedLib.find((b) => b.id === '外置书-xyz789')?.variants || [])[0];
  check('外部书被复制进新数据目录', moved.ok && moved.adopted === 1, String(moved.adopted));
  check(
    '外部书路径已指向新目录',
    !!adoptedVariant && adoptedVariant.path.startsWith(path.join(targetParent, 'MoQiReader', 'data')),
    adoptedVariant?.path
  );
  check('外部书复制后能读', !!adoptedVariant && fs.existsSync(adoptedVariant.path));

  loc.cleanupPreviousDataDir();
  check('旧位置已清理', !fs.existsSync(path.join(USERDATA, 'data')));

  const conflictDir = path.join(SANDBOX, '另一个盘', 'MoQiReader', 'data');
  fs.mkdirSync(conflictDir, { recursive: true });
  fs.writeFileSync(path.join(conflictDir, 'library.json'), '[]', 'utf8');
  const conflict = await loc.relocateData({ kind: 'custom', parent: path.join(SANDBOX, '另一个盘') });
  check('目标已有数据时拒绝覆盖', conflict.ok === false && conflict.reason === 'conflict');

  const inside = await loc.relocateData({ kind: 'custom', parent: path.join(targetParent, 'MoQiReader', 'data') });
  check('不允许搬进数据目录内部', inside.ok === false && inside.reason === 'inside');

  const backHome = await loc.relocateData({ kind: 'default' });
  check('能搬回默认位置', backHome.ok === true, backHome.detail);
  check('默认位置又有了书架', fs.existsSync(path.join(USERDATA, 'data', 'library.json')));
  check('指针已清掉', !fs.existsSync(path.join(USERDATA, 'data-root.txt')));
  loc.cleanupPreviousDataDir();
  check('自定义位置已清理', !fs.existsSync(path.join(targetParent, 'MoQiReader', 'data')));

  // 移动硬盘拔掉的情况：记录的位置打不开，应自动退回默认
  pathsMod.setDataRootPointer(path.join(SANDBOX, '没插上的移动硬盘', 'MoQiReader'));
  const fallback = pathsMod.getDataRootInfo();
  check('位置打不开时回退默认', fallback.isCustom === false, JSON.stringify(fallback));
  check('记得不可用的原位置', String(fallback.unavailable || '').includes('没插上的移动硬盘'));
  check('回退后数据还能读', fs.existsSync(path.join(fallback.dataDir, 'library.json')));
  pathsMod.clearDataRootPointer();

  console.log(`\n${pass} 项通过 · ${fail} 项失败`);
  console.log(`临时目录：${SANDBOX}`);
  app.exit(fail ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  });
});
