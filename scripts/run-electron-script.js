/**
 * 用 Electron 运行一个 Node 脚本，并确保 ELECTRON_RUN_AS_NODE 被清掉。
 *
 * 背景：某些环境（包括 WorkBuddy 的终端）会预设 ELECTRON_RUN_AS_NODE，
 * 导致 `electron xxx.js` 以纯 Node 模式启动，`require('electron').app` 为 undefined。
 * 这个包装在子进程里删掉该变量，保证拿到真正的 Electron 主进程 API。
 *
 * 用法：node scripts/run-electron-script.js scripts/test-userdata.js
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronPath = require('electron');
const target = process.argv[2];

if (!target) {
  console.error('用法：node scripts/run-electron-script.js <脚本路径>');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [target], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env,
});

process.exit(result.status ?? 1);
