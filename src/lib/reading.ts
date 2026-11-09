import type { Progress } from '@shared/models';

/** 一本书的阅读状态。三种分开，一眼能分清"没开始 / 读到一半 / 读完了"。 */
export type ReadStatus = 'unread' | 'reading' | 'finished';

export const STATUS_LABEL: Record<ReadStatus, string> = {
  unread: '未读',
  reading: '在读',
  finished: '读完',
};

export const STATUS_HINT: Record<ReadStatus, string> = {
  unread: '还没翻开过',
  reading: '正在读',
  finished: '已完成',
};

/**
 * 判定规则（重要）：
 * - 「读完」只能由用户明确标记，且**一旦标记就锁住**：再翻开、再滚动都不会掉；
 *   只有用户自己点「取消读完」才回到「在读」。翻到最后一页不等于读完。
 * - 「在读」= 打开过这本书（openedAt），哪怕一页都没往下翻。
 * - 「未读」= 从未在软件里打开过。
 */
export function readStatus(progress?: Progress | null): ReadStatus {
  if (progress?.finished) return 'finished';
  if (progress?.openedAt || (progress?.ratio ?? 0) > 0.001) return 'reading';
  return 'unread';
}

/** 详情页/卡片展示用的进度百分比：读完固定 100% */
export function displayPercent(progress?: Progress | null): number {
  if (progress?.finished) return 100;
  return Math.round(Math.max(0, Math.min(1, progress?.ratio ?? 0)) * 100);
}
