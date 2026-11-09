import type { BookFormat, BookMeta, Progress } from '@shared/models';

export type ProgressLite = Record<string, Pick<Progress, 'ratio' | 'chapterId'> & { mark?: unknown }>;

export interface ShelfGroup {
  meta: BookMeta;
  copies: BookMeta[];
  formats: BookFormat[];
}

export const FORMAT_ORDER: BookFormat[] = ['epub', 'mobi', 'pdf', 'txt'];

export const FORMAT_LABEL: Record<BookFormat, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  pdf: 'PDF',
  txt: 'TXT',
};

/** 归一化书名/作者，用于判断“同一本书的多个文件”。 */
export function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s·・:：,，.。!！?？'"“”‘’()（）[\]【】《》<>—–-]/g, '');
}

/**
 * 同一个书库或项目目录里可能同时存在同一本书的多个副本。
 * 这里只做展示层合并，不删除任何原始条目。
 */
export function groupBooks(
  books: BookMeta[],
  progressMap: Record<string, { ratio?: number } | undefined>
): ShelfGroup[] {
  const map = new Map<string, BookMeta[]>();
  for (const book of books) {
    const key = `${norm(book.title)}::${norm(book.author)}`;
    const list = map.get(key);
    if (list) list.push(book);
    else map.set(key, [book]);
  }

  return [...map.values()]
    .map((copies) => {
      // 先选最近活动的那份（切换格式也会更新活动时间），再比格式完整度和进度。
      const primary = [...copies].sort((a, b) => {
        const at = a.lastOpenedAt ?? 0;
        const bt = b.lastOpenedAt ?? 0;
        if (at !== bt) return bt - at;
        if (b.variants.length !== a.variants.length) return b.variants.length - a.variants.length;
        return (progressMap[b.id]?.ratio ?? 0) - (progressMap[a.id]?.ratio ?? 0);
      })[0];
      const formats = FORMAT_ORDER.filter(
        (f) => f === primary.format || copies.some((c) => c.variants.some((v) => v.format === f))
      );
      return { meta: primary, copies, formats };
    })
    .sort((a, b) => {
      const at = a.meta.lastOpenedAt ?? 0;
      const bt = b.meta.lastOpenedAt ?? 0;
      if (at !== bt) return bt - at;
      return a.meta.title.localeCompare(b.meta.title, 'zh-CN');
    });
}

export function ratioOf(
  progressMap: Record<string, { ratio?: number } | undefined>,
  bookId: string
): number {
  return progressMap[bookId]?.ratio ?? 0;
}
