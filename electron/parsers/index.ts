import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Book, BookFormat, Block, Chapter, TocItem } from '../../shared/models';
import { paths, logError } from '../store/paths';
import { readJson, writeJsonAtomic } from '../store/json';
import { parseEpub, type ParseContext, type ParsedBook } from './epub';
import { parseMobi } from './mobi';
import { parsePdf } from './pdf';
import { parseTxt, titleFromFileName } from './txt';

/** 解析逻辑变更时必须 +1，使旧缓存失效 */
export const PARSE_VERSION = 8;

interface CacheStamp {
  version: number;
  mtimeMs: number;
  size: number;
}

const stampFile = (bookId: string) => path.join(paths.bookDir(bookId), 'stamp.json');

export function cleanTitle(raw: string): string {
  let t = raw.replace(/\[[^\]]*\]/g, '').replace(/【[^】]*】/g, '').trim();
  t = t.replace(/[（(][^）)]{6,}[）)]\s*$/g, '').trim();
  t = t.replace(/[_—-]+$/, '').trim();
  return t || raw;
}

function saveAssetFactory(bookId: string) {
  const dir = paths.bookAssets(bookId);
  return (zipPath: string, data: Buffer): string => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const hash = crypto.createHash('md5').update(data).digest('hex').slice(0, 12);
    const ext = (path.extname(zipPath) || '.jpg').toLowerCase();
    const name = `${hash}${ext}`;
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) {
      try {
        fs.writeFileSync(target, data);
      } catch (e) {
        logError('saveAsset', e);
        return '';
      }
    }
    return `moqi-asset://local/${encodeURIComponent(bookId)}/assets/${name}`;
  };
}

async function dispatch(filePath: string, bookId: string, warnings: string[]): Promise<ParsedBook> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const ctx: ParseContext = { bookId, saveAsset: saveAssetFactory(bookId), warnings };

  switch (ext) {
    case '.epub':
      return parseEpub(buf, ctx);
    case '.txt':
      return parseTxt(buf, filePath);
    case '.pdf':
      return parsePdf(buf, ctx);
    case '.mobi':
    case '.azw':
    case '.azw3':
      return parseMobi(buf, ctx);
    default:
      throw new Error(`不支持的格式：${ext}`);
  }
}

const norm = (s: string) => s.replace(/[\s\u3000]/g, '');

/** 去掉书名页 / 版权页（仅作用于第一章开头），返回被删掉的块数 */
function stripCopyrightPage(ch: { blocks: { type: string; text: string }[] }): number {
  const RE_CP =
    /^(版权信息|版權信息|书名[:：]|作者[:：]|译者[:：]|版权[:：]|出版[:：]|出版社[:：]|ISBN|字数[:：]|开本|定价|印张|责任编辑|封面设计)/;
  const win = ch.blocks.slice(0, 10);
  const hits = win.filter((b) => RE_CP.test(b.text.trim())).length;
  if (hits < 2) return 0;
  let last = -1;
  for (let i = 0; i < win.length; i++) {
    if (RE_CP.test(win[i].text.trim())) last = i;
  }
  if (last < 0) return 0;
  ch.blocks.splice(0, last + 1);
  return last + 1;
}

function toBook(parsed: ParsedBook, bookId: string): Book {
  // 第一章开头的版权页会被整段删掉，目录锚点必须跟着回退，否则整体后移
  const headTrim = parsed.chapters.length > 0 ? stripCopyrightPage(parsed.chapters[0]) : 0;

  /** 每章因「与章名重复」被删掉的标题块下标（删前坐标），-1 表示没删 */
  const dupRemoved: number[] = [];

  const chapters: Chapter[] = parsed.chapters.map((c, i) => {
    const id = `c${i}`;
    let src = c.blocks;

    // 章节开头若有与章节名重复的标题块，去掉（避免标题出现两次）
    const ct = norm(c.title);
    const headLimit = Math.min(4, src.length);
    let removedAt = -1;
    for (let k = 0; k < headLimit; k++) {
      const b = src[k];
      if (b.type !== 'h1' && b.type !== 'h2') continue;
      const bt = norm(b.text);
      if (bt && (bt === ct || ct.includes(bt) || bt.includes(ct))) {
        src = [...src.slice(0, k), ...src.slice(k + 1)];
        removedAt = k;
        break;
      }
    }
    dupRemoved[i] = removedAt;

    const blocks: Block[] = src.map((b, j) => ({
      id: `${id}#${j}`,
      type: b.type,
      text: b.text,
      html: b.html,
      src: b.src,
      alt: b.alt,
      level: b.level,
    }));
    return {
      id,
      title: c.title,
      level: c.level,
      charCount: blocks.reduce((s, b) => s + b.text.length, 0),
      blocks,
    };
  });

  const toc: TocItem[] = [];
  for (const t of parsed.toc) {
    const ch = chapters[t.chapterIndex];
    if (!ch) continue;

    // 目录锚点记录在「删除之前」的块数组上，这里按删除量逐一回推。
    // 不回推的话，锚点会整体后移一格 —— 点目录时高亮就落在标题下面那段正文上了。
    let bi = t.blockIndex ?? 0;
    let pointsAtTitle = false;

    if (t.chapterIndex === 0 && headTrim > 0) bi -= headTrim;
    const rm = dupRemoved[t.chapterIndex] ?? -1;
    if (rm >= 0) {
      if (bi === rm) pointsAtTitle = true;
      else if (bi > rm) bi -= 1;
    }
    const maxIdx = Math.max(0, ch.blocks.length - 1);
    bi = Math.max(0, Math.min(bi, maxIdx));

    // 章首目录项（以及原本就指向被删章标题的那一项）直接锚到渲染出来的章标题，
    // 这样点亮的一定是标题本身，而不是标题下面的第一段正文。
    if (pointsAtTitle || bi <= 0) {
      toc.push({
        title: t.title,
        chapterId: ch.id,
        blockId: `${ch.id}#title`,
        level: Math.max(1, Math.min(t.level, 4)),
      });
      continue;
    }

    toc.push({
      title: t.title,
      chapterId: ch.id,
      blockId: `${ch.id}#${bi}`,
      level: Math.max(1, Math.min(t.level, 4)),
    });
  }
  if (toc.length === 0) {
    chapters.forEach((c) =>
      toc.push({ title: c.title, chapterId: c.id, blockId: `${c.id}#title`, level: 1 })
    );
  }

  // 过滤无意义 / 重复的目录项（如 calibre 生成的「未知」）
  const meaningful = toc.filter((t) => !/^(未知|未命名|untitled|unknown)$/i.test(t.title.trim()));
  const finalToc = meaningful.length >= Math.max(5, toc.length * 0.4) ? meaningful : toc;

  const totalChars = chapters.reduce((s, c) => s + c.charCount, 0);

  return {
    meta: {
      id: bookId,
      title: cleanTitle(parsed.title) || titleFromFileName(bookId),
      author: parsed.author || '未知作者',
      publisher: parsed.publisher,
      format: parsed.format,
      variants: [],
      totalChars,
      chapterCount: chapters.length,
      addedAt: Date.now(),
    },
    chapters,
    toc: finalToc,
  };
}

export interface BuildResult {
  book: Book;
  coverFileName?: string;
  warnings: string[];
}

/** 解析（或读缓存）一本书 */
export async function loadBookContent(
  bookId: string,
  filePath: string,
  force = false
): Promise<BuildResult> {
  const bookFile = paths.bookFile(bookId);
  const stampPath = stampFile(bookId);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error('书文件不存在或无法访问');
  }

  if (!force) {
    const cached = readJson<Book | null>(bookFile, null);
    const stamp = readJson<CacheStamp | null>(stampPath, null);
    if (
      cached &&
      stamp &&
      stamp.version === PARSE_VERSION &&
      stamp.mtimeMs === stat.mtimeMs &&
      stamp.size === stat.size &&
      Array.isArray(cached.chapters) &&
      cached.chapters.length > 0
    ) {
      return { book: cached, warnings: [] };
    }
  }

  const warnings: string[] = [];
  const parsed = await dispatch(filePath, bookId, warnings);
  const book = toBook(parsed, bookId);

  if (book.chapters.length === 0) {
    throw new Error('这本书没有可显示的正文内容');
  }

  // 封面
  let coverFileName: string | undefined;
  if (parsed.cover && parsed.cover.length > 128) {
    const dir = paths.bookDir(bookId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = parsed.coverExt && /png/i.test(parsed.coverExt) ? 'png' : 'jpg';
    coverFileName = `cover.${ext}`;
    try {
      fs.writeFileSync(path.join(dir, coverFileName), parsed.cover);
    } catch (e) {
      logError('saveCover', e);
      coverFileName = undefined;
    }
  }

  writeJsonAtomic(bookFile, book);
  writeJsonAtomic(stampPath, {
    version: PARSE_VERSION,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  } satisfies CacheStamp);

  return { book, coverFileName, warnings };
}

export { titleFromFileName };
export type { ParsedBook, ParseContext };
