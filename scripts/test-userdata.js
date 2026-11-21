/**
 * 备份 / 恢复 / **旧布局 v0.7 及以前**的数据位置测试。
 * v0.8 的单根布局（Program + Data）在 scripts/test-single-root.js。
 *
 * 不启动界面，直接在 Electron 主进程里跑；每次用一个全新的临时 appData / userData，
 * 不会碰你真实的阅读数据。
 *
 * 覆盖：
 *  1. 连书导出 → zip 里该有的都有（zip 内部仍是 data/ 布局，与磁盘布局无关）
 *  2. 换到「新电脑」（清空数据）→ 从 zip 恢复，书架 / 书文件 / 笔记 / 进度都回来
 *  3. 同一个 zip 再恢复一次 → 不重复、不多出文件
 *  4. 解压后的文件夹也能恢复
 *  5. 旧版只有三个 json 的备份也能恢复（只恢复阅读数据）
 *  6. 不带书的轻量备份不产生 books 条目
 *  7. 乱七八糟的文件明确报错
 *  8. 数据位置迁移（扁平 MoQiData、复制/移动、路径改写、外部书收编、回退）
 *  9. v0.5.x「容器 + data」旧布局仍能被认出来（老用户不丢数据）
 * 10. 旧 _backups 归并到 backups
 * 11. 坏 library.json 中止迁移、原数据逐字节不变
 * 12. v0.5 默认目录自动并入 %APPDATA%\MoQiData（空壳不挡数据）
 * 13. 路径规划校验（空/相对/不存在/程序目录/固定层追加）
 * 14. 空壳指针回退与 migration.json 崩溃恢复
 *
 * 运行：npm run test:data
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(os.tmpdir(), `moqi-backup-test-${process.pid}-${Date.now()}`);
const APPDATA = path.join(SANDBOX, 'appData');
const USERDATA = path.join(APPDATA, 'moqi-reader'); // 配置目录（指针、boot.log）
const OUT = path.join(SANDBOX, 'out');

// v0.6：配置在 %APPDATA%\moqi-reader，数据在 %APPDATA%\MoQiData，两者分开。
// 必须把 appData 也指到沙箱，否则 defaultDataDir() 会写到真实的 %APPDATA%。
app.setPath('appData', APPDATA);
app.setPath('userData', USERDATA);
app.setPath('documents', SANDBOX);

const backup = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'backup.js'));
const zip = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'zip.js'));
const store = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'library.js'));
const userdata = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'userdata.js'));
const pathsMod = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'paths.js'));
const { paths } = pathsMod;

// 这组测试跑的是 v0.7 及以前的“旧布局”（开发/测试模式），用 LEGACY_DATA_DIR_NAME；
// v0.8 单根布局另见 scripts/test-single-root.js。
const DATA_DIR_NAME = pathsMod.LEGACY_DATA_DIR_NAME;
const DEFAULT_DATA_DIR = pathsMod.defaultDataDir();
const POINTER = path.join(USERDATA, 'data-root.txt');

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

/** 清空当前数据目录（扁平结构：直接删 paths.data()，不再假设 USERDATA\data） */
function wipeMachine() {
  const dataDir = paths.data();
  fs.rmSync(dataDir, { recursive: true, force: true });
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

  // ── 0. 旧布局（v0.7 及以前）──
  console.log('\n[0] 旧布局（v0.7 及以前）');
  check('默认数据目录是 %APPDATA%\\MoQiData', pathsMod.getDataRootInfo().dataDir === DEFAULT_DATA_DIR, pathsMod.getDataRootInfo().dataDir);
  check('数据目录与配置目录分开', path.dirname(DEFAULT_DATA_DIR) === APPDATA);
  seedFullMachine();
  pathsMod.ensureDirs();
  check('library.json 直接放在数据目录里', fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json')));
  check('不再有内层 data 目录', !fs.existsSync(path.join(DEFAULT_DATA_DIR, 'data')));
  check('导出目录在数据域 exports', fs.existsSync(path.join(DEFAULT_DATA_DIR, 'exports')));
  const exportedNote = userdata.exportNotes(BOOK_ID, '活着');
  check(
    '单本笔记导出到 exports',
    exportedNote.startsWith(path.join(DEFAULT_DATA_DIR, 'exports')),
    exportedNote
  );
  const marker = readJson(path.join(DEFAULT_DATA_DIR, '.moqi-data'), {});
  check('标记写明 layout=flat / version=2', marker.layout === 'flat' && marker.version === 2, JSON.stringify(marker));

  // ── 1. 导出 ──
  console.log('\n[1] 连书导出为 zip');
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
  check(
    '安全备份写在 backups 而不是 _backups',
    fs.existsSync(paths.backups()) && !fs.existsSync(path.join(paths.data(), '_backups'))
  );

  const lib = store.readLibrary();
  check('书架回到 1 本', lib.length === 1, String(lib.length));
  const meta = lib[0] || {};
  const variant = (meta.variants || [])[0] || {};
  check('书文件落在墨栖数据目录', path.resolve(variant.path || '').startsWith(path.resolve(paths.books())), variant.path);
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

  // ── 8. 数据位置迁移（扁平） ──
  console.log('\n[8] 换一个数据存放位置');
  const loc = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'location.js'));
  const previousPointer = path.join(USERDATA, 'data-root.previous.txt');

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
  check('建的是 MoQiData 文件夹', moved.ok && moved.root === path.join(targetParent, DATA_DIR_NAME), moved.root);
  check('扁平：数据目录就是 root', moved.ok && moved.dataDir === moved.root);
  check('数据直接落在 MoQiData 里', moved.ok && fs.existsSync(path.join(moved.root, 'library.json')));
  check('没有多余的 data 里层', moved.ok && !fs.existsSync(path.join(moved.root, 'data')));
  check(
    '记下了新位置（指针就是数据目录）',
    fs.readFileSync(POINTER, 'utf8').trim() === path.join(targetParent, DATA_DIR_NAME)
  );
  check('迁移前记录了上一位置', fs.existsSync(previousPointer) && fs.readFileSync(previousPointer, 'utf8').trim() === DEFAULT_DATA_DIR);
  check('指针写入没有留下 .tmp', !fs.existsSync(`${POINTER}.tmp`));
  check('墨栖认得新位置', pathsMod.getDataRootInfo().dataDir === path.join(targetParent, DATA_DIR_NAME));
  const movedLib = store.readLibrary();
  check('迁移后书架还在', movedLib.length === 2, String(movedLib.length));
  const innerVariant = (movedLib.find((b) => b.id === BOOK_ID)?.variants || [])[0];
  check(
    '原来在数据目录里的书，路径跟着换了',
    !!innerVariant && innerVariant.path.startsWith(path.join(targetParent, DATA_DIR_NAME)),
    innerVariant?.path
  );
  check('换完路径书文件还在', !!innerVariant && fs.existsSync(innerVariant.path));

  const adoptedVariant = (movedLib.find((b) => b.id === '外置书-xyz789')?.variants || [])[0];
  check('外部书被复制进新数据目录', moved.ok && moved.adopted === 1, String(moved.adopted));
  check(
    '外部书路径已指向新目录',
    !!adoptedVariant && adoptedVariant.path.startsWith(path.join(targetParent, DATA_DIR_NAME)),
    adoptedVariant?.path
  );
  check('外部书复制后能读', !!adoptedVariant && fs.existsSync(adoptedVariant.path));
  check('迁移前留了关键 JSON 快照', !!moved.backupDir && fs.existsSync(path.join(moved.backupDir, 'manifest.json')), moved.backupDir);

  const pendingAfterMove = loc.getPendingCleanup();
  check(
    '移动模式记下 7 天保留期',
    !!pendingAfterMove && pendingAfterMove.deleteAfter > Date.now(),
    JSON.stringify(pendingAfterMove)
  );
  const earlyCleanup = loc.cleanupPreviousDataDir();
  check(
    '保留期内不删旧位置',
    earlyCleanup.cleaned === false && fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json')),
    JSON.stringify(earlyCleanup)
  );
  const forcedCleanup = loc.cleanupNow();
  check(
    '立即清理能删旧位置',
    forcedCleanup.cleaned === true && !fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json')),
    JSON.stringify(forcedCleanup)
  );

  // 目标已有墨栖数据：默认拒绝，然后分别验证复用 / 覆盖 / 重命名
  const conflictParent = path.join(SANDBOX, '另一个盘');
  const conflictDir = path.join(conflictParent, DATA_DIR_NAME);
  fs.mkdirSync(conflictDir, { recursive: true });
  writeJson(path.join(conflictDir, 'library.json'), []);
  writeJson(path.join(conflictDir, '.moqi-data'), {
    app: 'moqi-reader',
    kind: 'data-dir',
    layout: 'flat',
    version: 2,
  });

  const conflict = await loc.relocateData({ kind: 'custom', parent: conflictParent });
  check('目标已有数据时默认拒绝覆盖', conflict.ok === false && conflict.reason === 'conflict');

  const reuse = await loc.relocateData(
    { kind: 'custom', parent: conflictParent },
    'copy',
    { existingAction: 'reuse' }
  );
  check('复用：切换指针不复制', reuse.ok === true && reuse.reused === true, reuse.detail);
  check('复用：指针指向已有数据', fs.readFileSync(POINTER, 'utf8').trim() === conflictDir);
  check(
    '复用：当前数据仍留在原处',
    fs.existsSync(path.join(targetParent, DATA_DIR_NAME, 'library.json'))
  );
  pathsMod.setDataRootPointer(path.join(targetParent, DATA_DIR_NAME));

  // 覆盖 = 旧目标改名备份，再迁入当前数据
  const replaceParent = path.join(SANDBOX, '替换盘');
  const replaceDir = path.join(replaceParent, DATA_DIR_NAME);
  fs.mkdirSync(replaceDir, { recursive: true });
  writeJson(path.join(replaceDir, '.moqi-data'), { app: 'moqi-reader', kind: 'data-dir' });
  fs.writeFileSync(path.join(replaceDir, 'old.txt'), 'old-target', 'utf8');
  const replaced = await loc.relocateData(
    { kind: 'custom', parent: replaceParent },
    'copy',
    { existingAction: 'replace' }
  );
  check('覆盖：迁移成功', replaced.ok === true, replaced.detail);
  check(
    '覆盖：旧目标被改名备份而不是删除',
    !!replaced.asideDir && fs.existsSync(path.join(replaced.asideDir, 'old.txt')),
    replaced.asideDir
  );
  check('覆盖：新位置有当前书架', fs.existsSync(path.join(replaceDir, 'library.json')));
  pathsMod.setDataRootPointer(path.join(targetParent, DATA_DIR_NAME));

  // 重命名 = 用户给旧目标起名，再迁入当前数据
  const renameParent = path.join(SANDBOX, '改名盘');
  const renameDir = path.join(renameParent, DATA_DIR_NAME);
  fs.mkdirSync(renameDir, { recursive: true });
  writeJson(path.join(renameDir, '.moqi-data'), { app: 'moqi-reader', kind: 'data-dir' });
  fs.writeFileSync(path.join(renameDir, 'old2.txt'), 'old-target-2', 'utf8');
  const renamed = await loc.relocateData(
    { kind: 'custom', parent: renameParent },
    'copy',
    { existingAction: 'rename', renameTo: 'MoQiData-keep-me' }
  );
  check('重命名：迁移成功', renamed.ok === true, renamed.detail);
  check(
    '重命名：旧目标按指定名字保留',
    !!renamed.asideDir && path.basename(renamed.asideDir) === 'MoQiData-keep-me',
    renamed.asideDir
  );
  check(
    '重命名：旧目标里的文件还在',
    !!renamed.asideDir && fs.existsSync(path.join(renamed.asideDir, 'old2.txt'))
  );
  pathsMod.setDataRootPointer(path.join(targetParent, DATA_DIR_NAME));

  // 非墨栖的非空目录：不能复用/覆盖，只能改名或取消
  const otherParent = path.join(SANDBOX, '别人的盘');
  const otherDir = path.join(otherParent, DATA_DIR_NAME);
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'foreign.txt'), 'not-moqi', 'utf8');
  const otherReplace = await loc.relocateData(
    { kind: 'custom', parent: otherParent },
    'copy',
    { existingAction: 'replace' }
  );
  check('非墨栖目录不允许覆盖', otherReplace.ok === false && otherReplace.reason === 'conflict');
  const otherReuse = await loc.relocateData(
    { kind: 'custom', parent: otherParent },
    'copy',
    { existingAction: 'reuse' }
  );
  check('非墨栖目录不允许复用', otherReuse.ok === false && otherReuse.reason === 'conflict');
  const otherRenamed = await loc.relocateData(
    { kind: 'custom', parent: otherParent },
    'copy',
    { existingAction: 'rename', renameTo: 'MoQiData-foreign-keep' }
  );
  check('非墨栖目录可以改名保留', otherRenamed.ok === true, otherRenamed.detail);
  check(
    '非墨栖目录改名后文件还在',
    !!otherRenamed.asideDir && fs.existsSync(path.join(otherRenamed.asideDir, 'foreign.txt'))
  );
  pathsMod.setDataRootPointer(path.join(targetParent, DATA_DIR_NAME));

  const cancelParent = path.join(SANDBOX, '取消盘');
  fs.mkdirSync(path.join(cancelParent, DATA_DIR_NAME), { recursive: true });
  const canceled = await loc.relocateData(
    { kind: 'custom', parent: cancelParent },
    'copy',
    { existingAction: 'cancel' }
  );
  check('取消：不改动任何东西', canceled.ok === false && canceled.canceled === true);

  const emptyParent = path.join(SANDBOX, '空目录盘');
  fs.mkdirSync(path.join(emptyParent, DATA_DIR_NAME), { recursive: true });
  const emptyMoved = await loc.relocateData({ kind: 'custom', parent: emptyParent }, 'copy');
  check('空的目标目录可以直接用', emptyMoved.ok === true, emptyMoved.detail);
  pathsMod.setDataRootPointer(path.join(targetParent, DATA_DIR_NAME));

  const inside = await loc.relocateData({
    kind: 'custom',
    parent: path.join(targetParent, DATA_DIR_NAME, 'books'),
  });
  check('不允许搬进数据目录内部', inside.ok === false && inside.reason === 'inside');

  // 搬回默认：默认位置先清空，旧自定义位置保留 7 天
  fs.rmSync(DEFAULT_DATA_DIR, { recursive: true, force: true });
  const backHome = await loc.relocateData({ kind: 'default' });
  check('能搬回默认位置', backHome.ok === true, backHome.detail);
  check('默认位置又有了书架', fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json')));
  check('指针已清掉', !fs.existsSync(POINTER));
  const pendingHome = loc.getPendingCleanup();
  check(
    '搬回默认也保留旧位置',
    !!pendingHome && fs.existsSync(path.join(targetParent, DATA_DIR_NAME, 'library.json')),
    JSON.stringify(pendingHome)
  );
  const homeClean = loc.cleanupNow();
  check(
    '立即清理搬回默认时的旧位置',
    homeClean.cleaned === true && !fs.existsSync(path.join(targetParent, DATA_DIR_NAME)),
    JSON.stringify(homeClean)
  );

  // 移动硬盘拔掉：指针失效，但默认位置有数据 → 回退，不建空书架
  pathsMod.setDataRootPointer(path.join(SANDBOX, '没插上的移动硬盘', DATA_DIR_NAME));
  const fallback = pathsMod.getDataRootInfo();
  check('位置打不开时回退有数据的位置', fallback.isCustom === false, JSON.stringify(fallback));
  check('记得不可用的原位置', String(fallback.unavailable || '').includes('没插上的移动硬盘'));
  check('记得回退来源', String(fallback.rolledBackFrom || '').includes('没插上的移动硬盘'));
  check('回退后数据还能读', fs.existsSync(path.join(fallback.dataDir, 'library.json')));
  pathsMod.clearDataRootPointer({ clearPrevious: true });

  // 复制模式：旧位置保留，不写 pending-cleanup
  const copyParent = path.join(SANDBOX, '复制模式盘');
  fs.mkdirSync(copyParent, { recursive: true });
  const copied = await loc.relocateData({ kind: 'custom', parent: copyParent }, 'copy');
  check('复制模式迁移成功', copied.ok === true, copied.detail);
  check('复制模式旧位置还在', fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json')));
  check(
    '复制模式不写清理指令',
    !fs.existsSync(path.join(copyParent, DATA_DIR_NAME, 'pending-cleanup.json'))
  );
  const copyClean = loc.cleanupPreviousDataDir();
  check(
    '清理任务不会动复制模式的旧数据',
    copyClean.cleaned === false && fs.existsSync(path.join(DEFAULT_DATA_DIR, 'library.json'))
  );

  // ── 9. v0.5.x 旧布局兼容（老用户不丢数据） ──
  console.log('\n[9] 旧版「容器 + data」布局仍可用');
  const legacyRoot = path.join(SANDBOX, '旧版容器');
  fs.mkdirSync(path.join(legacyRoot, 'data'), { recursive: true });
  writeJson(path.join(legacyRoot, 'data', 'library.json'), []);
  pathsMod.setDataRootPointer(legacyRoot);
  const legacyInfo = pathsMod.getDataRootInfo();
  check('认出 nested 旧布局', legacyInfo.layout === 'nested', legacyInfo.layout);
  check('旧布局数据目录指向 data 里层', legacyInfo.dataDir === path.join(legacyRoot, 'data'));
  check('旧布局的书架能读', fs.existsSync(path.join(legacyInfo.dataDir, 'library.json')));
  pathsMod.clearDataRootPointer();
  check('清掉指针后回到默认', pathsMod.getDataRootInfo().dataDir === DEFAULT_DATA_DIR);

  // ── 10. _backups → backups 一次性归并 ──
  console.log('\n[10] 旧 _backups 目录归并');
  const currentData = paths.data();
  fs.rmSync(path.join(currentData, 'backups'), { recursive: true, force: true });
  fs.mkdirSync(path.join(currentData, '_backups', '20260101'), { recursive: true });
  fs.writeFileSync(path.join(currentData, '_backups', '20260101', 'old.json'), 'old', 'utf8');
  pathsMod.ensureDirs();
  check(
    '旧 _backups 的内容并进了 backups',
    fs.existsSync(path.join(currentData, 'backups', '20260101', 'old.json'))
  );
  check('不再留下 _backups 目录', !fs.existsSync(path.join(currentData, '_backups')));

  // ── 11. 坏 library.json：校验失败必须原样保留 ──
  console.log('\n[11] 搬家遇到坏掉的 library.json');
  const badParent = path.join(SANDBOX, '坏数据盘');
  const badRoot = path.join(badParent, DATA_DIR_NAME);
  fs.mkdirSync(badRoot, { recursive: true });
  fs.writeFileSync(path.join(badRoot, 'library.json'), '{ this is not json', 'utf8');
  writeJson(path.join(badRoot, '.moqi-data'), { app: 'moqi-reader', kind: 'data-dir' });
  pathsMod.setDataRootPointer(badRoot);
  pathsMod.resetDataRootCache();
  const beforeBad = fs.readFileSync(path.join(badRoot, 'library.json'), 'utf8');
  const goodParent = path.join(SANDBOX, '好数据盘');
  fs.mkdirSync(goodParent, { recursive: true });
  const badMove = await loc.relocateData({ kind: 'custom', parent: goodParent }, 'copy');
  check('坏掉的 library.json 会中止迁移', badMove.ok === false && badMove.reason === 'io', JSON.stringify(badMove));
  check('坏数据原样保留', fs.readFileSync(path.join(badRoot, 'library.json'), 'utf8') === beforeBad);
  check('失败时不留下新目录', !fs.existsSync(path.join(goodParent, DATA_DIR_NAME)));
  pathsMod.clearDataRootPointer({ clearPrevious: true });

  // ── 12. v0.5 默认目录自动并入 %APPDATA%\MoQiData ──
  console.log('\n[12] 旧默认目录自动搬家');
  pathsMod.clearDataRootPointer({ clearPrevious: true });
  pathsMod.resetDataRootCache();
  const legacyDefault = path.join(USERDATA, 'data');
  fs.rmSync(legacyDefault, { recursive: true, force: true });
  if (fs.existsSync(DEFAULT_DATA_DIR)) fs.renameSync(DEFAULT_DATA_DIR, legacyDefault);
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true }); // 模拟以前失败留下的空壳
  pathsMod.resetDataRootCache();
  const migratedDefault = pathsMod.getDataRootInfo();
  check('空壳不会挡住旧数据', migratedDefault.dataDir === DEFAULT_DATA_DIR, JSON.stringify(migratedDefault));
  check('旧默认书架已经可见', fs.existsSync(path.join(migratedDefault.dataDir, 'library.json')));
  check('旧默认目录已经搬走', !fs.existsSync(legacyDefault));

  // ── 13. 路径规划校验 ──
  console.log('\n[13] 路径规划校验');
  check('空路径拒绝', loc.planDataLocation('').invalid === 'empty');
  check('相对路径拒绝', loc.planDataLocation('relative\\path').invalid === 'relative');
  check(
    '不存在的上级拒绝',
    loc.planDataLocation(path.join(SANDBOX, '确实不存在')).invalid === 'missing-parent'
  );
  check(
    '程序目录内拒绝',
    loc.planDataLocation(pathsMod.programDir()).invalid === 'program-dir',
    JSON.stringify(loc.planDataLocation(pathsMod.programDir()))
  );
  const mineParent = path.join(SANDBOX, '我的数据盘');
  check(
    '已选到上级会自动补 MoQiData',
    loc.planDataLocation(mineParent).root === path.join(mineParent, DATA_DIR_NAME)
  );
  check(
    '已经选到 MoQiData 就不再套一层',
    loc.planDataLocation(path.join(mineParent, DATA_DIR_NAME)).root ===
      path.join(mineParent, DATA_DIR_NAME)
  );
  check(
    '上级不存在时给出可读原因',
    !!loc.planDataLocation(path.join(SANDBOX, '确实不存在')).detail
  );

  // ── 14. 空壳指针回退 + 崩溃恢复 ──
  console.log('\n[14] 空壳指针与崩溃恢复');
  pathsMod.clearDataRootPointer({ clearPrevious: true });
  pathsMod.resetDataRootCache();
  const emptyShell = path.join(SANDBOX, '空壳指针');
  fs.mkdirSync(emptyShell, { recursive: true });
  pathsMod.setDataRootPointer(emptyShell); // previous = 默认位置（有数据）
  const shellInfo = pathsMod.getDataRootInfo();
  check(
    '空壳指针回退到有数据的位置',
    shellInfo.dataDir === DEFAULT_DATA_DIR,
    JSON.stringify(shellInfo)
  );
  check('空壳回退记得来源', shellInfo.rolledBackFrom === emptyShell);
  pathsMod.clearDataRootPointer({ clearPrevious: true });

  // 模拟：旧目标已改名 aside，新目标还没落位，迁移日志还在
  const crashParent = path.join(SANDBOX, '崩溃恢复');
  const crashTarget = path.join(crashParent, DATA_DIR_NAME);
  const crashAside = path.join(crashParent, `${DATA_DIR_NAME}-backup-test`);
  fs.mkdirSync(crashAside, { recursive: true });
  writeJson(path.join(crashAside, 'library.json'), []);
  writeJson(path.join(USERDATA, 'migration.json'), {
    from: DEFAULT_DATA_DIR,
    to: crashTarget,
    aside: crashAside,
    phase: 'aside',
    at: Date.now(),
  });
  loc.recoverInterruptedMigration();
  check(
    '崩溃恢复把 aside 改回目标',
    fs.existsSync(crashTarget) && !fs.existsSync(crashAside)
  );
  check('崩溃恢复清掉迁移日志', !fs.existsSync(path.join(USERDATA, 'migration.json')));

  const staleTmp = path.join(crashParent, '.moqi-data-tmp-999999-1-0');
  fs.mkdirSync(staleTmp, { recursive: true });
  writeJson(path.join(USERDATA, 'migration.json'), {
    from: DEFAULT_DATA_DIR,
    to: crashTarget,
    aside: '',
    phase: 'copying',
    at: Date.now(),
  });
  loc.recoverInterruptedMigration();
  check('崩溃恢复清掉临时目录', !fs.existsSync(staleTmp));
  check('崩溃恢复不动已经落位的数据', fs.existsSync(crashTarget));

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
