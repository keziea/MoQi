/**
 * 生成「固定英文名」的两个投影文件，保证安装器与运行时用同一份名字。
 *
 * 真相在 package.json → moqi：
 *   appNameEn   %APPDATA% 下的配置目录名（也是包名）
 *   programDir  程序安装目录的固定末级名
 *   dataDir     数据根目录的固定名（用户只能选上级目录，不能改这一层）
 *
 * 产出：
 *   build/folder-names.nsh        → NSIS !define
 *   shared/names.generated.ts     → 主进程 / 渲染层 import
 *
 * 用法：node scripts/gen-names.js（已挂在 npm run build 前面）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const names = pkg.moqi || {};

const appNameEn = names.appNameEn || pkg.name;
const programDir = names.programDir || pkg.name;
const dataDir = names.dataDir || 'AppData';

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appNameEn)) {
  throw new Error(`moqi.appNameEn 只能是英文/数字/._-：${appNameEn}`);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(programDir)) {
  throw new Error(`moqi.programDir 只能是英文/数字/._-：${programDir}`);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dataDir)) {
  throw new Error(`moqi.dataDir 只能是英文/数字/._-：${dataDir}`);
}

const header = '/* eslint-disable */\n// 由 scripts/gen-names.js 生成，不要手改。改名字请改 package.json → moqi。\n';

const nsh = `; 由 scripts/gen-names.js 生成，不要手改。改名字请改 package.json → moqi。
!define APP_NAME_EN "${appNameEn}"
!define PROGRAM_DIR_NAME "${programDir}"
!define DATA_DIR_NAME "${dataDir}"
`;

const ts = `${header}export const APP_NAME_EN = '${appNameEn}';
export const PROGRAM_DIR_NAME = '${programDir}';
export const DATA_DIR_NAME = '${dataDir}';
`;

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'shared'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'folder-names.nsh'), nsh, 'utf8');
fs.writeFileSync(path.join(ROOT, 'shared', 'names.generated.ts'), ts, 'utf8');

console.log(`  names: app=${appNameEn} program=${programDir} data=${dataDir}`);
