import path from 'node:path';
import type { BookFormat } from '../../shared/models';
import { decodeText, splitTxt } from './text';
import type { ParsedBook, ParsedChapter, ParsedTocItem } from './epub';

function fromHeadMeta(text: string): { title?: string; author?: string; publisher?: string } {
  const head = text.slice(0, 4000);
  const pick = (re: RegExp): string | undefined => {
    const m = head.match(re);
    const v = m?.[1]?.trim();
    return v && v.length < 60 ? v : undefined;
  };
  return {
    title: pick(/^书[名名][：:]\s*(.+)$/m),
    author: pick(/^作\s*者[：:]\s*(.+)$/m),
    publisher: pick(/^版权[：:]\s*(.+)$/m),
  };
}

export function titleFromFileName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const cleaned = base
    .replace(/\[[^\]]*\]/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\.(txt|epub|mobi|azw3?|pdf)$/i, '')
    .replace(/_+$/, '')
    .trim();
  return cleaned || base;
}

export async function parseTxt(buf: Buffer, filePath: string): Promise<ParsedBook> {
  const text = decodeText(buf);
  const raw = splitTxt(text);

  const chapters: ParsedChapter[] = raw.map((c) => ({
    title: c.title,
    level: c.level,
    blocks: c.blocks.map((b) => ({ type: b.type, text: b.text })),
  }));

  const toc: ParsedTocItem[] = chapters.map((c, i) => ({
    title: c.title,
    chapterIndex: i,
    blockIndex: 0,
    level: c.level,
  }));

  const meta = fromHeadMeta(text);

  return {
    title: meta.title ?? titleFromFileName(filePath),
    author: meta.author ?? '未知作者',
    publisher: meta.publisher,
    chapters,
    toc,
    format: 'txt' as BookFormat,
  };
}
