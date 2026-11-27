/**
 * 版本一致性检查：发版前必须通过。
 *
 *   npm run check:version            # 检查 package / README / AGENTS / CHANGELOG / 发布说明
 *   npm run check:version -- --assets # 再检查 release/ 里的两个安装包是否存在
 *
 * 版本号唯一来源是 package.json；这个脚本只读，不改任何文件。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const checks = [];

function check(ok, label, detail = '') {
  checks.push({ ok: !!ok, label, detail });
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), 'package.json 版本号格式', version);

const lock = (() => {
  try {
    return JSON.parse(read('package-lock.json'));
  } catch {
    return null;
  }
})();
check(!!lock, 'package-lock.json 可读');
if (lock) {
  check(lock.version === version, 'package-lock.json 顶层版本', `${lock.version} / ${version}`);
  const root = lock.packages && lock.packages[''] ? lock.packages[''].version : undefined;
  check(root === version, 'package-lock.json packages[""] 版本', `${root} / ${version}`);
}

const readme = read('README.md');
check(!!readme, 'README.md 可读');
if (readme) {
  check(readme.includes(`## 最新改动 · v${version}`), 'README 最新改动标题', `应为 v${version}`);
  check(readme.includes(`当前版本 v${version}`), 'README 下载区当前版本', `应为 v${version}`);
  check(
    readme.includes(`> 安装包与绿色版已构建到 v${version}`),
    'README 发布状态行',
    `应为 v${version}`
  );

  const links = [...readme.matchAll(/releases\/download\/v([0-9][^/]*)\//g)].map((m) => m[1]);
  const unique = [...new Set(links)];
  check(
    unique.length === 1 && unique[0] === version,
    'README 下载链接版本',
    unique.length ? unique.join(', ') : '没有找到下载链接'
  );

  const hosts = [
    ['gitee.com/azs_A/MoQi', 'Gitee'],
    ['github.com/keziea/MoQi', 'GitHub'],
  ];
  for (const [host, name] of hosts) {
    for (const kind of ['Setup.exe', 'portable.7z']) {
      const file = `Moqi-${version}-${kind}`;
      check(
        readme.includes(`${host}/releases/download/v${version}/${file}`),
        `README ${name} ${kind} 链接`,
        file
      );
    }
  }

  // jsdelivr 会缓存 @main 的截图；URL 带 ?v= 才能让新版截图立刻生效
  for (const name of ['05-home.png', '02-reader.png']) {
    check(
      readme.includes(`docs/screenshots/${name}?v=${version}`),
      `README 截图缓存版本 ${name}`,
      `应为 ?v=${version}`
    );
  }
}

const agents = read('AGENTS.md');
check(!!agents, 'AGENTS.md 可读');
if (agents) {
  check(agents.includes(`版本 v${version}`), 'AGENTS 顶部版本', `应为 v${version}`);
  check(agents.includes(`当前 v${version}`) || agents.includes(`v${version} 安装包`), 'AGENTS 发布状态');
}

const changelog = read('docs/CHANGELOG.md');
check(!!changelog, 'docs/CHANGELOG.md 可读');
if (changelog) {
  check(changelog.slice(0, 4000).includes(`v${version}`), 'CHANGELOG 顶部条目', `应包含 v${version}`);
}

const releaseNotes = path.join('docs', 'releases', `v${version}.md`);
check(fs.existsSync(path.join(ROOT, releaseNotes)), '发布说明文件', releaseNotes);

const workspace = read('src/pages/Workspace.tsx');
check(workspace.includes('ipc.app'), '工作台版本号走 IPC', '不应硬编码版本');
const hardVersion = workspace.match(/v0\.\d+\.\d+/)?.[0];
check(!hardVersion, '工作台没有硬编码版本', hardVersion ? `发现 ${hardVersion}` : '');

if (process.argv.includes('--assets')) {
  for (const kind of ['Setup.exe', 'portable.7z']) {
    const file = path.join('release', `Moqi-${version}-${kind}`);
    let size = 0;
    try {
      size = fs.statSync(path.join(ROOT, file)).size;
    } catch {
      /* missing */
    }
    check(size > 0, '安装包存在', `${file}${size ? `（${(size / 1048576).toFixed(1)}MB）` : ''}`);
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n版本一致性检查 · v${version}\n`);
for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? `  ${c.detail}` : ''}`);
}
if (failed.length) {
  console.log(`\n${failed.length} 项不通过。发版前请按 docs/12-版本管理与发布清单.md 逐项改完。\n`);
  process.exit(1);
}
console.log('\n全部通过。\n');
