/**
 * 安装器路径逻辑测试（NSIS 真编译 + 真运行，不开界面）。
 *
 * 为什么要这个测试：
 *   v0.6 的 installer.nsh 里 `${GetFileName} $4 "$0"` 参数顺序写反，
 *   数据目录会变成「3\MoQiData」；而 `D:\Apps2` 会被误判在 `D:\Apps` 里。
 *   这两类问题 `tsc` / `vite build` 都发现不了，只有真编 NSIS 才暴露。
 *
 * 依赖：electron-builder 下载过的 NSIS（跑过一次 `npm run dist` 就有）。
 * 用法：npm run test:installer
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NSI = path.join(ROOT, 'scripts', 'test-installer-paths.nsi');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'moqi-installer-test-'));
const OUT = path.join(SANDBOX, 'installer-path-test.exe');
const RESULT = path.join(SANDBOX, 'result.txt');

function findMakensis() {
  const cache = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'nsis'
  );
  if (!fs.existsSync(cache)) return null;
  for (const name of fs.readdirSync(cache)) {
    if (!name.startsWith('nsis-')) continue;
    for (const candidate of [
      path.join(cache, name, 'makensis.exe'),
      path.join(cache, name, 'Bin', 'makensis.exe'),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

function main() {
  const makensis = findMakensis();
  if (!makensis) {
    console.error('✗ 没找到 makensis.exe。先跑一次 `npm run dist` 让 electron-builder 下载 NSIS，再重试。');
    process.exit(1);
  }

  console.log(`▸ 编译 ${path.relative(ROOT, NSI)}`);
  execFileSync(
    makensis,
    ['/V2', '/INPUTCHARSET', 'UTF8', `/DROOT=${ROOT}`, `/DOUT=${OUT}`, `/DRESULT=${RESULT}`, NSI],
    { stdio: 'inherit' }
  );

  console.log('▸ 运行编译出的测试安装器');
  execFileSync(OUT, ['/S'], { stdio: 'inherit' });

  const actual = parse(fs.readFileSync(RESULT, 'utf8'));
  const expected = {
    // 只选一个上级，自动补 MoQiReader
    join_drive: 'D:\\MoQiReader',
    join_drive_no_slash: 'D:\\MoQiReader',
    join_parent: 'D:\\Apps\\MoQiReader',
    join_already_named: 'D:\\Apps\\MoQiReader',
    join_backups: 'E:\\Backups\\MoQiReader',
    // 路径
    path_normal: '0',
    path_illegal: '1',
    path_too_long: '1',
    // 受保护目录
    protected_program_files: '1',
    protected_normal: '0',
    // 目录是否有内容
    entries_empty: '0',
    entries_empty_child: '1',
    entries_file: '1',
    entries_missing: '0',
  };

  let pass = 0;
  let fail = 0;
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key];
    if (got === want) {
      pass += 1;
      console.log(`  ✓ ${key} = ${got}`);
    } else {
      fail += 1;
      console.log(`  ✗ ${key} = ${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`);
    }
  }

  console.log(`\n${pass} 项通过 · ${fail} 项失败`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error(err);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(1);
}
