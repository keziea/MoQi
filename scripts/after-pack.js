/**
 * electron-builder 的 afterPack 钩子：把图标和产品信息写进 exe。
 *
 * 为什么不用 electron-builder 自带的 signAndEditExecutable：
 * 它依赖 winCodeSign 缓存包，包里含 macOS 的符号链接，普通 Windows 账户
 * 解压时会报「客户端没有所需的特权」并反复重试，导致打包直接失败。
 *
 * 这里改成打包后自己调 rcedit（缓存里本来就有），只做两件事：
 * 换图标、写产品名/版本/公司/版权。不做任何签名。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

function findRcedit() {
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'winCodeSign'
  );
  if (!fs.existsSync(cacheRoot)) return null;

  const dirs = fs.readdirSync(cacheRoot);
  // 优先找最新的那批缓存（名字是数字哈希，按修改时间排更靠谱）
  const scored = dirs
    .map((name) => {
      const full = path.join(cacheRoot, name);
      const rcedit = path.join(full, 'rcedit-x64.exe');
      if (!fs.existsSync(rcedit)) return null;
      return { rcedit, mtime: fs.statSync(full).mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  return scored.length ? scored[0].rcedit : null;
}

exports.default = async function afterPack(context) {
  const outDir = context.appOutDir;
  const candidates = fs
    .readdirSync(outDir)
    .filter((n) => n.toLowerCase().endsWith('.exe') && !n.startsWith('__'));

  if (!candidates.length) {
    console.warn('[after-pack] 没找到可执行文件，跳过');
    return;
  }

  const exe = path.join(outDir, candidates[0]);
  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn('[after-pack] 没找到 rcedit，图标不会写入');
    return;
  }

  const icon = path.join(ROOT, 'build', 'icon.ico');
  if (!fs.existsSync(icon)) {
    console.warn('[after-pack] 缺少 build/icon.ico');
    return;
  }

  const version = pkg.version;
  const args = [
    exe,
    '--set-icon',
    icon,
    '--set-file-version',
    `${version}.0`,
    '--set-product-version',
    version,
    '--set-version-string',
    'ProductName',
    '墨栖',
    '--set-version-string',
    'FileDescription',
    '墨栖 · 中文阅读器',
    '--set-version-string',
    'CompanyName',
    'Moqi',
    '--set-version-string',
    'LegalCopyright',
    'Copyright © 2026 Moqi',
    '--set-version-string',
    'OriginalFilename',
    '墨栖.exe',
  ];

  execFileSync(rcedit, args, { stdio: 'inherit' });
  console.log(`[after-pack] 图标与产品信息已写入 ${path.basename(exe)}（v${version}）`);
};
