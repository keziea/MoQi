/**
 * 生成「固定英文名」的两个投影文件，保证安装器与运行时用同一份名字。
 *
 * 真相在 package.json → moqi：
 *   appNameEn      包名 / 旧版 %APPDATA% 配置目录名
 *   containerDir   新布局容器名：<父目录>\MoQiReader
 *   programDir     容器内的程序目录：MoQiReader\Program
 *   dataDir        容器内的数据目录：MoQiReader\Data
 *   legacyDataDir  v0.7 及以前的默认数据目录名：%APPDATA%\MoQiData
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
const containerDir = names.containerDir || 'MoQiReader';
const programDir = names.programDir || 'Program';
const dataDir = names.dataDir || 'Data';
const legacyDataDir = names.legacyDataDir || 'MoQiData';

const valid = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
for (const [key, value] of Object.entries({
  appNameEn,
  containerDir,
  programDir,
  dataDir,
  legacyDataDir,
})) {
  if (!valid.test(value)) {
    throw new Error(`moqi.${key} 只能是英文/数字/._-：${value}`);
  }
}

const header = '/* eslint-disable */\n// 由 scripts/gen-names.js 生成，不要手改。改名字请改 package.json → moqi。\n';

const nsh = `; 由 scripts/gen-names.js 生成，不要手改。改名字请改 package.json → moqi。
!define APP_NAME_EN "${appNameEn}"
!define CONTAINER_DIR_NAME "${containerDir}"
!define PROGRAM_DIR_NAME "${programDir}"
!define DATA_DIR_NAME "${dataDir}"
!define LEGACY_DATA_DIR_NAME "${legacyDataDir}"
`;

const ts = `${header}export const APP_NAME_EN = '${appNameEn}';
export const CONTAINER_DIR_NAME = '${containerDir}';
export const PROGRAM_DIR_NAME = '${programDir}';
export const DATA_DIR_NAME = '${dataDir}';
export const LEGACY_DATA_DIR_NAME = '${legacyDataDir}';
`;

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'shared'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'folder-names.nsh'), nsh, 'utf8');
fs.writeFileSync(path.join(ROOT, 'shared', 'names.generated.ts'), ts, 'utf8');

console.log(
  `  names: app=${appNameEn} container=${containerDir} program=${programDir} data=${dataDir} legacy=${legacyDataDir}`
);
