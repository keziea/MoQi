import path from 'node:path';
import { PROGRAM_DIR_NAME, DATA_DIR_NAME } from '../../shared/names.generated';

/**
 * v0.8 单根布局：exe 必须放在 <容器>\Program 里，数据固定为 <容器>\Data。
 *
 *   D:\Apps\MoQiReader\
 *   ├── Program\墨栖.exe
 *   └── Data\library.json ...
 *
 * 这里只做纯路径推导，不碰文件系统，方便单测。
 * 容器叫什么不重要（用户可以把 MoQiReader 改名），关键是 exe 的父目录名必须是 Program。
 */
export interface SingleRootLayout {
  containerDir: string;
  programDir: string;
  dataDir: string;
}

export function deriveSingleRoot(programDir: string): SingleRootLayout | null {
  if (!programDir) return null;
  const program = path.resolve(programDir);
  if (path.basename(program).toLowerCase() !== PROGRAM_DIR_NAME.toLowerCase()) return null;

  const container = path.dirname(program);
  // 不允许把 Program 直接放在盘符根下（那样 Data 会跑到 D:\Data）
  if (!path.basename(container)) return null;

  return {
    containerDir: container,
    programDir: program,
    dataDir: path.join(container, DATA_DIR_NAME),
  };
}
