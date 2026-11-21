/**
 * v0.8 单根布局测试：<容器>\Program + <容器>\Data
 *
 * 覆盖：
 *  1. deriveSingleRoot 纯路径推导（容器可改名、Program 必须在容器里）
 *  2. exe 相对推导 Data；没有指针也能找到
 *  3. 整个容器搬走后数据目录跟着变
 *  4. 旧数据迁移进 Data，旧目录保留、library 路径改写
 *  5. 外部书收进 Data\books；移动后绝对路径失效时自动改回内部路径
 *
 * 运行：npm run test:single-root（需要先 build:electron）
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(os.tmpdir(), `moqi-single-root-${process.pid}-${Date.now()}`);
const APPDATA = path.join(SANDBOX, 'appData');
const CONTAINER = path.join(SANDBOX, 'Apps', 'MoQiReader');
const PROGRAM = path.join(CONTAINER, 'Program');

app.setPath('appData', APPDATA);
app.setPath('userData', path.join(APPDATA, 'moqi-reader'));
app.setPath('documents', SANDBOX);
process.env.MOQI_PROGRAM_DIR = PROGRAM;
fs.mkdirSync(PROGRAM, { recursive: true });

const layout = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'layout.js'));
const pathsMod = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'paths.js'));
const migrate = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'migrate.js'));
const store = require(path.join(ROOT, 'dist-electron', 'electron', 'store', 'library.js'));

const DATA = path.join(CONTAINER, 'Data');
let pass = 0;
let fail = 0;

function check(name, ok, extra) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` :: ${extra}` : ''}`);
  }
}

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

function book(id, file, size) {
  return {
    id,
    title: id,
    author: '测试',
    format: 'txt',
    variants: [{ format: 'txt', path: file, sizeBytes: size, quality: 60 }],
    totalChars: 100,
    chapterCount: 1,
    addedAt: Date.now(),
  };
}

async function main() {
  console.log('\n[1] deriveSingleRoot');
  const d1 = layout.deriveSingleRoot(path.join('D:', 'Apps', 'MoQiReader', 'Program'));
  check('Program 的上一级是容器', d1 && d1.containerDir === path.join('D:', 'Apps', 'MoQiReader'), JSON.stringify(d1));
  check('Data 与 Program 同级', d1 && d1.dataDir === path.join('D:', 'Apps', 'MoQiReader', 'Data'));
  const d2 = layout.deriveSingleRoot(path.join('D:', 'Apps', '随便改名', 'Program'));
  check('容器可以改名', d2 && d2.dataDir === path.join('D:', 'Apps', '随便改名', 'Data'));
  check('没有 Program 层不算新布局', layout.deriveSingleRoot(path.join('D:', 'Apps', 'MoQiReader')) === null);
  check('盘符根下不算新布局', layout.deriveSingleRoot(path.join('D:', 'Program')) === null);

  console.log('\n[2] 运行时路径');
  const runtime = pathsMod.configureRuntimePaths();
  check('runtime 目录可写', runtime.ok === true, JSON.stringify(runtime));
  const info = pathsMod.getDataRootInfo();
  check('识别为单根布局', info.mode === 'single-root', JSON.stringify(info));
  check('数据目录是容器\\Data', info.dataDir === DATA, info.dataDir);
  check('容器目录正确', info.containerDir === CONTAINER, info.containerDir);
  check('没有指针也能解析', pathsMod.defaultDataDir() === DATA, pathsMod.defaultDataDir());
  check('Electron userData 在 Data\\runtime', app.getPath('userData') === path.join(DATA, 'runtime'), app.getPath('userData'));
  pathsMod.ensureDirs();
  check('Data 子目录已创建', fs.existsSync(path.join(DATA, 'books')) && fs.existsSync(path.join(DATA, 'user')));
  check('exports 在 Data 里', fs.existsSync(path.join(DATA, 'exports')));

  console.log('\n[3] 旧数据迁移');
  const legacy = path.join(APPDATA, 'MoQiData');
  const legacyBook = path.join(legacy, 'books', 'book-legacy', 'source', 'old.txt');
  fs.mkdirSync(path.dirname(legacyBook), { recursive: true });
  fs.writeFileSync(legacyBook, 'old book content', 'utf8');
  writeJson(path.join(legacy, 'library.json'), [book('book-legacy', legacyBook, fs.statSync(legacyBook).size)]);
  writeJson(path.join(legacy, 'user', 'notes.json'), { 'book-legacy': [{ id: 'n1', text: '旧笔记' }] });
  writeJson(path.join(legacy, 'settings.json'), { fontSize: 19, dailyGoalMinutes: 45 });

  const found = migrate.findLegacyData();
  check('能找到旧数据', !!found && found.dir === legacy, JSON.stringify(found));
  const beforeLegacy = fs.readFileSync(legacyBook, 'utf8');
  const migrated = await migrate.migrateLegacyData(legacy, DATA);
  check('迁移成功', migrated.migrated === true, migrated.error);
  check('旧数据没有被删', fs.existsSync(legacyBook) && fs.readFileSync(legacyBook, 'utf8') === beforeLegacy);
  check('新 Data 有书架', fs.existsSync(path.join(DATA, 'library.json')));
  const migratedLib = store.readLibrary();
  check('书架数量正确', migratedLib.length === 1, String(migratedLib.length));
  check(
    '书路径已改写进新 Data',
    migratedLib[0]?.variants?.[0]?.path === path.join(DATA, 'books', 'book-legacy', 'source', 'old.txt'),
    migratedLib[0]?.variants?.[0]?.path
  );
  check('笔记也搬过来了', fs.existsSync(path.join(DATA, 'user', 'notes.json')));
  check('迁移清单存在', fs.existsSync(path.join(DATA, 'legacy-import.json')));

  console.log('\n[4] 外部书收进 Data');
  const external = path.join(SANDBOX, '外部书', 'outside.txt');
  fs.mkdirSync(path.dirname(external), { recursive: true });
  fs.writeFileSync(external, 'outside book content', 'utf8');
  store.writeLibrary([
    ...store.readLibrary(),
    book('book-outside', external, fs.statSync(external).size),
  ]);
  check('能识别 Data 外部的书', migrate.hasExternalBooks() === true);
  const adopted = await migrate.adoptExternalBooks();
  check('至少收进一本外部书', adopted.copied >= 1, JSON.stringify(adopted));
  const outsideMeta = store.readLibrary().find((b) => b.id === 'book-outside');
  const outsidePath = outsideMeta?.variants?.[0]?.path ?? '';
  check('外部书路径已指向 Data', outsidePath.startsWith(DATA), outsidePath);
  check('外部书文件还在原处', fs.existsSync(external));
  check('Data 里真的有这本书', fs.existsSync(outsidePath));

  console.log('\n[5] 移动整个容器');
  const moved = path.join(SANDBOX, '换了个位置', 'MoQiReader');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  // 用复制模拟“整个容器搬走”；运行中的 Chromium 可能锁着旧 Data\runtime，rename 不一定可行
  fs.cpSync(CONTAINER, moved, { recursive: true });
  process.env.MOQI_PROGRAM_DIR = path.join(moved, 'Program');
  pathsMod.resetDataRootCache();
  const movedInfo = pathsMod.getDataRootInfo();
  check('移动后数据目录跟着变', movedInfo.dataDir === path.join(moved, 'Data'), movedInfo.dataDir);
  check('移动后书架还能读', fs.existsSync(path.join(movedInfo.dataDir, 'library.json')));

  // 模拟“书路径还是旧绝对路径”，adopt 应该按 id 找回 Data 内部文件
  const movedLib = store.readLibrary();
  movedLib[0].variants[0].path = path.join(SANDBOX, '已经不存在的旧路径', 'old.txt');
  store.writeLibrary(movedLib);
  await migrate.adoptExternalBooks();
  check(
    '移动后失效的路径能自动修回 Data',
    store.readLibrary()[0].variants[0].path.startsWith(path.join(moved, 'Data')),
    store.readLibrary()[0].variants[0].path
  );

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
