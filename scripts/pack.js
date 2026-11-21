/**
 * 打包成可直接双击运行的绿色版。
 *
 * 背景：electron-builder 在 Windows 上会用硬链接复用 node_modules，
 * 本机（E 盘）上这些链接在运行时解析失败，Electron 会在加载 JS 前就退出（exit=3）。
 * 解法：打包后用 fs.cpSync 解引用复制一份，全部变成实体文件。
 *
 * 用法：npm run pack
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const APP_NAME = '墨栖';
const BUILD_DIR = path.join(os.tmpdir(), 'moqi-build');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const VERSION4 = `${VERSION}.0`;

// 输出目录必须在项目之外，且路径不含中文：
// 这台机器上 Electron 从「中文目录」或「本项目目录」内启动会直接退出（exit=3）。
// 早期版本默认输出到工作区顶层的 Moqi/，既污染目录、又容易和旧版混淆（已废弃）。
// 现在默认放到用户目录下的 Moqi-portable，可用环境变量 MOQI_PACK_DIR 覆盖。
// v0.8：输出结构是 <PACK_ROOT>\MoQiReader\{Program,Data}，压缩包根目录就是 MoQiReader。
const pkg = require(path.join(ROOT, 'package.json'));
const PACK_ROOT = process.env.MOQI_PACK_DIR
  ? path.resolve(process.env.MOQI_PACK_DIR)
  : path.join(os.homedir(), 'Moqi-portable');
const CONTAINER = pkg.moqi?.containerDir || 'MoQiReader';
const PROGRAM_SUBDIR = pkg.moqi?.programDir || 'Program';
const DATA_SUBDIR = pkg.moqi?.dataDir || 'Data';
const FINAL_DIR = path.join(PACK_ROOT, CONTAINER);
const FINAL_PROGRAM = path.join(FINAL_DIR, PROGRAM_SUBDIR);
const FINAL_DATA = path.join(FINAL_DIR, DATA_SUBDIR);

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

function findRcedit() {
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'winCodeSign'
  );
  if (!fs.existsSync(cacheRoot)) return null;
  for (const dir of fs.readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, dir, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function safeRemove(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 2 });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  console.log('\n▸ 1/5 构建前端与主进程');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  console.log('▸ 2/5 调用 electron-builder 生成运行时');
  safeRemove(BUILD_DIR);
  execSync(`npx electron-builder --win --dir -c.directories.output="${BUILD_DIR}"`, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });

  const src = path.join(BUILD_DIR, 'win-unpacked');
  if (!fs.existsSync(src)) {
    console.error('✗ 打包失败：没有生成 win-unpacked');
    process.exit(1);
  }

  console.log('▸ 3/5 写入图标与版本信息');
  const exePath = path.join(src, `${APP_NAME}.exe`);
  const rcedit = findRcedit();
  const icon = path.join(ROOT, 'build', 'icon.ico');
  if (rcedit && fs.existsSync(exePath) && fs.existsSync(icon)) {
    try {
      execSync(
        `"${rcedit}" "${exePath}" --set-icon "${icon}" --set-file-version ${VERSION4} --set-product-version ${VERSION} --set-version-string ProductName "${APP_NAME}" --set-version-string FileDescription "${APP_NAME} · 中文阅读器" --set-version-string CompanyName Moqi`,
        { stdio: 'ignore' }
      );
      log('图标已写入');
    } catch {
      log('图标写入跳过（不影响运行）');
    }
  } else {
    log('未找到 rcedit，保留默认图标');
  }

  console.log('▸ 4/5 实体化复制（绕开硬链接）');
  safeRemove(FINAL_DIR);
  fs.mkdirSync(FINAL_DIR, { recursive: true });
  // 关键：必须逐文件 copyFileSync。
  // electron-builder 产出的 node_modules 含硬链接，Electron 在本机读不了，
  // 会在加载 JS 之前就退出（exit=3）。copyFileSync 会真正读内容写新文件，
  // 一定产生独立的实体文件。cpSync / robocopy 都会保留链接，别用。
  let fileCount = 0;
  const copyTree = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      let isDir = entry.isDirectory();
      let real = s;
      if (entry.isSymbolicLink()) {
        try {
          real = fs.realpathSync(s);
          isDir = fs.statSync(real).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) copyTree(real, d);
      else {
        fs.copyFileSync(real, d);
        fileCount += 1;
      }
    }
  };
  copyTree(src, FINAL_PROGRAM);
  log(`已实体化 ${fileCount} 个文件到 Program`);

  // 便携模式标记：只用于“这是绿色版”的提示；数据路径由 exe 位置推导，不靠它。
  fs.writeFileSync(
    path.join(FINAL_PROGRAM, 'portable.flag'),
    JSON.stringify(
      { app: pkg.moqi?.appNameEn || 'moqi-reader', version: VERSION, mode: 'portable' },
      null,
      2
    ),
    'utf8'
  );
  log('已写入 Program\\portable.flag');

  // Data 空骨架：压缩包自带 Data 文件夹，但绝不带开发机的真实数据
  for (const dir of ['books', 'user', 'backups', 'exports', 'logs']) {
    fs.mkdirSync(path.join(FINAL_DATA, dir), { recursive: true });
  }
  fs.writeFileSync(
    path.join(FINAL_DATA, '.moqi-data'),
    JSON.stringify(
      { app: pkg.moqi?.appNameEn || 'moqi-reader', kind: 'data-dir', layout: 'flat', version: 3 },
      null,
      2
    ),
    'utf8'
  );

  // 容器根放一个启动器，省得用户进 Program 里找 exe
  fs.writeFileSync(
    path.join(FINAL_DIR, '启动墨栖.cmd'),
    '@echo off\r\nfor %%f in ("%~dp0' + PROGRAM_SUBDIR + '\\*.exe") do start "" "%%~f"\r\n',
    'utf8'
  );
  log('已创建 Data 空骨架与启动器');

  console.log('▸ 5/5 清理临时目录');
  safeRemove(BUILD_DIR);

  const size = (() => {
    let total = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else {
          try {
            total += fs.statSync(p).size;
          } catch {}
        }
      }
    };
    walk(FINAL_DIR);
    return (total / 1024 / 1024).toFixed(0);
  })();

  console.log(`\n✓ 完成：${FINAL_DIR}（${size} MB）`);
  console.log(`  双击 ${path.join(FINAL_PROGRAM, `${APP_NAME}.exe`)} 即可运行`);
  console.log(`  或双击 ${path.join(FINAL_DIR, '启动墨栖.cmd')}\n`);
})();
