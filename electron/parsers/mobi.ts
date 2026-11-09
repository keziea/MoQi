import iconv from 'iconv-lite';
import type { BookFormat } from '../../shared/models';
import { htmlToBlocks, decodeEntities, type RawHtmlBlock } from './html';
import type { ParseContext, ParsedChapter, ParsedBook, ParsedTocItem } from './epub';
import { mergeShortChapters } from './epub';

/** PalmDOC (LZ77) 解压 */
function palmDocDecompress(data: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i++];
    if (c === 0x00) {
      out.push(0);
    } else if (c <= 0x08) {
      for (let j = 0; j < c && i < data.length; j++) out.push(data[i++]);
    } else if (c <= 0x7f) {
      out.push(c);
    } else if (c <= 0xbf) {
      if (i >= data.length) break;
      const c2 = data[i++];
      const pair = (c << 8) | c2;
      const dist = (pair >> 3) & 0x07ff;
      const len = (c2 & 0x07) + 3;
      const start = out.length - dist;
      if (start < 0) continue;
      for (let j = 0; j < len; j++) out.push(out[start + j] ?? 0);
    } else {
      out.push(32);
      out.push(c ^ 0x80);
    }
  }
  return Buffer.from(out);
}

interface PdbRecord {
  offset: number;
  length: number;
}

function readPdb(buf: Buffer): { records: PdbRecord[]; type: string; creator: string } {
  if (buf.length < 78) throw new Error('文件过小，不是有效的 MOBI');
  const type = buf.toString('ascii', 60, 64);
  const creator = buf.toString('ascii', 64, 68);
  const numRecords = buf.readUInt16BE(76);
  const records: PdbRecord[] = [];
  for (let i = 0; i < numRecords; i++) {
    const p = 78 + i * 8;
    if (p + 8 > buf.length) break;
    const offset = buf.readUInt32BE(p);
    records.push({ offset, length: 0 });
  }
  for (let i = 0; i < records.length; i++) {
    const next = i + 1 < records.length ? records[i + 1].offset : buf.length;
    records[i].length = Math.max(0, next - records[i].offset);
  }
  return { records, type, creator };
}

interface ExthMeta {
  title?: string;
  author?: string;
  publisher?: string;
}

function parseExth(rec0: Buffer, mobiStart: number, headerLen: number): ExthMeta {
  const meta: ExthMeta = {};
  const exthStart = mobiStart + headerLen;
  if (exthStart + 12 > rec0.length) return meta;
  if (rec0.toString('ascii', exthStart, exthStart + 4) !== 'EXTH') return meta;

  const count = rec0.readUInt32BE(exthStart + 8);
  let p = exthStart + 12;
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const type = rec0.readUInt32BE(p);
    const len = rec0.readUInt32BE(p + 4);
    if (len < 8 || p + len > rec0.length) break;
    const value = rec0.subarray(p + 8, p + len);
    if (type === 100) meta.author = value.toString('utf8').replace(/\0/g, '').trim();
    else if (type === 503) meta.title = value.toString('utf8').replace(/\0/g, '').trim();
    else if (type === 101) meta.publisher = value.toString('utf8').replace(/\0/g, '').trim();
    p += len;
  }
  return meta;
}

/** 从 MOBI HTML 中按标题切章 */
function splitByHeadings(html: string, baseTitle: string): { chapters: ParsedChapter[]; toc: ParsedTocItem[] } {
  // 先把 <mbp:pagebreak> 变成块级分隔
  const cleaned = html.replace(/<mbp:pagebreak[^>]*>/gi, '<hr data-pagebreak="1"/>');

  // 找所有标题位置
  const headRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks: { idx: number; level: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(cleaned)) !== null) {
    const title = decodeEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!title || title.length > 80) continue;
    marks.push({ idx: m.index, level: Number(m[1]), title });
  }

  if (marks.length < 2) {
    const blocks = htmlToBlocks(cleaned, {});
    if (!blocks.length) return { chapters: [], toc: [] };
    return {
      chapters: [{ title: baseTitle, level: 1, blocks }],
      toc: [{ title: baseTitle, chapterIndex: 0, blockIndex: 0, level: 1 }],
    };
  }

  const chapters: ParsedChapter[] = [];
  const toc: ParsedTocItem[] = [];

  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].idx;
    const to = i + 1 < marks.length ? marks[i + 1].idx : cleaned.length;
    const blocks = htmlToBlocks(cleaned.slice(from, to), {});
    if (!blocks.length) continue;
    const idx = chapters.length;
    chapters.push({ title: marks[i].title, level: Math.min(marks[i].level, 4), blocks });
    toc.push({ title: marks[i].title, chapterIndex: idx, blockIndex: 0, level: Math.min(marks[i].level, 4) });
  }

  return { chapters, toc };
}

export async function parseMobi(buf: Buffer, ctx: ParseContext): Promise<ParsedBook> {
  const { records, type, creator } = readPdb(buf);
  if (type !== 'BOOK' && creator !== 'MOBI') {
    // 部分 azw 也是 BOOK/MOBI，其它类型直接报错
    if (!/BOOK|TEXt/.test(type)) throw new Error('不是有效的 MOBI / AZW 文件');
  }

  const rec0 = buf.subarray(records[0].offset, records[0].offset + records[0].length);
  if (rec0.length < 24) throw new Error('MOBI 头部损坏');

  const compression = rec0.readUInt16BE(0);
  const textLength = rec0.readUInt32BE(4);
  const recordCount = rec0.readUInt16BE(8);
  const encryption = rec0.readUInt16BE(12);

  if (encryption !== 0) {
    throw new Error('这本书受 DRM 保护，无法解析。请改用同书的 EPUB 或 PDF 版本');
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error('MOBI 使用了 HUFF/CDIC 压缩，暂不支持。请改用 EPUB 版本');
  }

  let encoding = 'utf8';
  let meta: ExthMeta = {};
  let mobiStart = 16;

  if (rec0.length > 24 && rec0.toString('ascii', 16, 20) === 'MOBI') {
    const headerLen = rec0.readUInt32BE(20);
    const enc = rec0.readUInt32BE(28);
    encoding = enc === 65001 ? 'utf8' : 'win1252';
    if (headerLen > 0 && headerLen < 4096) {
      try {
        meta = parseExth(rec0, mobiStart, headerLen);
      } catch {
        /* 忽略 EXTH 错误 */
      }
    }
  }

  // 拼接文本记录（record 1 .. recordCount）
  const limit = Math.min(recordCount, records.length - 1);
  const parts: Buffer[] = [];
  for (let i = 1; i <= limit; i++) {
    const r = records[i];
    if (!r || r.length <= 0) continue;
    const chunk = buf.subarray(r.offset, r.offset + r.length);
    parts.push(compression === 2 ? palmDocDecompress(chunk) : chunk);
  }
  let raw = Buffer.concat(parts);
  if (textLength > 0 && textLength < raw.length) raw = raw.subarray(0, textLength);

  const html = iconv.decode(raw, encoding);
  if (!html || html.length < 30) throw new Error('MOBI 文本内容为空');

  const fallbackTitle = meta.title || '未命名';
  const { chapters, toc } = splitByHeadings(html, fallbackTitle);
  mergeShortChapters(chapters, toc);

  // 封面：MOBI 通常在 EXTH 201 (coverOffset) 指向的图片记录里
  let cover: Buffer | undefined;
  let coverExt: string | undefined;
  try {
    const coverOffset = findExthValue(rec0, 201);
    if (coverOffset !== undefined) {
      const firstImage = 1 + limit;
      const recIdx = firstImage + coverOffset;
      const r = records[recIdx];
      if (r && r.length > 64) {
        cover = buf.subarray(r.offset, r.offset + r.length);
        coverExt = sniffImageExt(cover);
      }
    }
  } catch {
    /* 无封面 */
  }

  return {
    title: fallbackTitle,
    author: meta.author || '未知作者',
    publisher: meta.publisher,
    cover,
    coverExt,
    chapters,
    toc,
    format: 'mobi' as BookFormat,
  };
}

function findExthValue(rec0: Buffer, wantType: number): number | undefined {
  if (rec0.toString('ascii', 16, 20) !== 'MOBI') return undefined;
  const headerLen = rec0.readUInt32BE(20);
  const exthStart = 16 + headerLen;
  if (exthStart + 12 > rec0.length) return undefined;
  if (rec0.toString('ascii', exthStart, exthStart + 4) !== 'EXTH') return undefined;
  const count = rec0.readUInt32BE(exthStart + 8);
  let p = exthStart + 12;
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const type = rec0.readUInt32BE(p);
    const len = rec0.readUInt32BE(p + 4);
    if (len < 8 || p + len > rec0.length) break;
    if (type === wantType) return rec0.readUInt32BE(p + 8);
    p += len;
  }
  return undefined;
}

function sniffImageExt(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  return 'jpeg';
}
