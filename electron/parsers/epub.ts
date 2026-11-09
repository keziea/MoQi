import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import path from 'node:path';
import type { BookFormat } from '../../shared/models';
import { htmlToBlocks, decodeEntities, type RawHtmlBlock } from './html';

export interface ParseContext {
  bookId: string;
  saveAsset: (zipPath: string, data: Buffer) => string;
  warnings: string[];
}

export interface ParsedChapter {
  title: string;
  level: number;
  blocks: RawHtmlBlock[];
}

export interface ParsedTocItem {
  title: string;
  chapterIndex: number;
  blockIndex?: number;
  level: number;
}

export interface ParsedBook {
  title: string;
  author: string;
  publisher?: string;
  cover?: Buffer;
  coverExt?: string;
  chapters: ParsedChapter[];
  toc: ParsedTocItem[];
  format: BookFormat;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface TocPoint {
  title: string;
  absPath: string;
  anchor: string;
  level: number;
  order: number;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray(v: unknown): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return decodeEntities(node).replace(/\s+/g, ' ').trim();
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ('#text' in o) return textOf(o['#text']);
  }
  return '';
}

function normalizeZipPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function joinZip(baseDir: string, rel: string): string {
  const clean = decodeURIComponent(rel.split('#')[0]);
  if (!clean) return normalizeZipPath(baseDir);
  if (/^[a-zA-Z]+:\/\//.test(clean) || clean.startsWith('/')) return normalizeZipPath(clean.replace(/^\//, ''));
  return normalizeZipPath(path.posix.join(baseDir, clean));
}

function splitHref(href: string): { p: string; anchor: string } {
  const i = href.indexOf('#');
  return i < 0 ? { p: href, anchor: '' } : { p: href.slice(0, i), anchor: href.slice(i + 1) };
}

/** 找到某个 navPoint 下第一个真正有 content 的后代链接。 */
function firstNcxSrc(node: unknown): string {
  for (const np of asArray(node)) {
    if (!np || typeof np !== 'object') continue;
    const o = np as Record<string, unknown>;
    const src = String((o.content as Record<string, unknown> | undefined)?.['@_src'] ?? '');
    if (src) return src;
    const child = firstNcxSrc(o.navPoint);
    if (child) return child;
  }
  return '';
}

function parseNcx(ncxXml: unknown, opfDir: string): TocPoint[] {
  const out: TocPoint[] = [];
  let order = 0;

  const walk = (node: unknown, level: number) => {
    for (const np of asArray(node)) {
      if (!np || typeof np !== 'object') continue;
      const o = np as Record<string, unknown>;
      const navLabel = o.navLabel as Record<string, unknown> | undefined;
      const label = textOf(navLabel?.text) || textOf(navLabel);

      // 有些书的中间层分组没有 content，但它仍是原生层级的一部分。
      // 用第一个有链接的后代作为落点，保留这个分组，不要把层级压平。
      const own = String((o.content as Record<string, unknown> | undefined)?.['@_src'] ?? '');
      const srcRaw = own || firstNcxSrc(o.navPoint);
      if (srcRaw && label) {
        const { p, anchor } = splitHref(srcRaw);
        out.push({
          title: label,
          absPath: joinZip(opfDir, p),
          anchor,
          level: Math.min(level, 6),
          order: order++,
        });
      }
      if (o.navPoint) walk(o.navPoint, level + 1);
    }
  };

  const root = ncxXml as Record<string, unknown>;
  const ncx = (root?.ncx as Record<string, unknown> | undefined) ?? root;
  const navMap = ncx?.navMap as Record<string, unknown> | undefined;
  if (navMap) walk(navMap.navPoint, 1);
  return out;
}

function parseNavXhtml(text: string, navAbsPath: string): TocPoint[] {
  const out: TocPoint[] = [];
  let order = 0;
  const dir = path.posix.dirname(navAbsPath);
  const navBlock = text.match(/<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i);
  const body = navBlock ? navBlock[1] : text;

  let level = 0;
  const tokenRe = /<(\/?)ol\b[^>]*>|<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(body)) !== null) {
    if (m[1] !== undefined) {
      level = m[1] === '/' ? Math.max(1, level - 1) : level + 1;
      continue;
    }
    const href = m[2];
    const label = decodeEntities(m[3].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!href) continue;
    const { p, anchor } = splitHref(href);
    out.push({
      title: label || '未命名',
      absPath: joinZip(dir, p),
      anchor,
      level: Math.max(1, Math.min(level, 4)),
      order: order++,
    });
  }
  return out;
}

function findAnchorIndex(html: string, anchor: string): number {
  if (!anchor) return -1;
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:id|name)\\s*=\\s*["']${esc}["']`, 'i');
  const m = re.exec(html);
  return m ? m.index : -1;
}

function snapToBlockStart(html: string, idx: number): number {
  if (idx <= 0) return 0;
  // 先退到当前标签的起点，避免从标签内部切开（否则 <body id=...> 会变成正文）
  const lt = html.lastIndexOf('<', idx);
  if (lt < 0) return 0;

  // 包含锚点所在的这个标签：<h3 id="Point28"> 应该从 h3 开始切，
  // 而不是退回到上一个 <h2>，否则目录会整体错位一节。
  const before = html.slice(0, idx);
  const re = /<(p|div|h[1-6]|section|blockquote|figure|li)\b/gi;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) last = m.index;
  if (last >= 0 && lt - last < 800) return last;
  return lt;
}

const SKIP_TITLE = /^(目录|目次|contents|cover|封面|titlepage|书名页|扉页)$/i;

export async function parseEpub(buf: Buffer, ctx: ParseContext): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buf);
  const cache = new Map<string, string>();

  const readText = async (p: string): Promise<string> => {
    const key = normalizeZipPath(p);
    if (cache.has(key)) return cache.get(key)!;
    const f = zip.file(key);
    const t = f ? await f.async('string') : '';
    cache.set(key, t);
    return t;
  };

  // ① container → OPF
  const containerXml = await readText('META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB 结构异常：缺少 container.xml');
  const container = xml.parse(containerXml) as Record<string, unknown>;
  const rootfiles = (container.container as Record<string, unknown> | undefined)?.rootfiles as
    | Record<string, unknown>
    | undefined;
  const opfPath = normalizeZipPath(String(asArray(rootfiles?.rootfile as Record<string, unknown>)[0]?.['@_full-path'] ?? ''));
  if (!opfPath) throw new Error('EPUB 结构异常：找不到 OPF 文件');
  const opfDir = path.posix.dirname(opfPath);
  const opfBase = opfDir === '.' ? '' : opfDir;

  // ② OPF
  const opf = xml.parse(await readText(opfPath)) as Record<string, unknown>;
  const pkg = opf.package as Record<string, unknown> | undefined;
  if (!pkg) throw new Error('EPUB 结构异常：OPF 解析失败');

  const meta = (pkg.metadata as Record<string, unknown> | undefined) ?? {};
  const title = textOf(meta['dc:title'] ?? meta.title) || '未命名';
  const author = textOf(meta['dc:creator'] ?? meta.creator) || '未知作者';
  const publisher = textOf(meta['dc:publisher'] ?? meta.publisher) || undefined;

  const items = new Map<string, ManifestItem>();
  for (const it of asArray((pkg.manifest as Record<string, unknown> | undefined)?.item as Record<string, unknown>)) {
    const id = String(it['@_id'] ?? '');
    if (!id) continue;
    items.set(id, {
      id,
      href: normalizeZipPath(String(it['@_href'] ?? '')),
      mediaType: String(it['@_media-type'] ?? ''),
      properties: it['@_properties'] ? String(it['@_properties']) : undefined,
    });
  }
  const itemAbs = (item: ManifestItem) => joinZip(opfBase, item.href);

  const spineRaw = pkg.spine as Record<string, unknown> | undefined;
  const spineItems = asArray(spineRaw?.itemref as Record<string, unknown>)
    .map((r) => items.get(String(r['@_idref'] ?? '')))
    .filter(
      (x): x is ManifestItem =>
        !!x && (x.mediaType.includes('html') || /\.x?html?$/i.test(x.href))
    );

  // ③ 目录
  let tocPoints: TocPoint[] = [];
  const ncxId = spineRaw?.['@_toc'] ? String(spineRaw['@_toc']) : '';
  const ncxItem = ncxId ? items.get(ncxId) : undefined;
  const tocItem = ncxItem ?? [...items.values()].find((i) => i.mediaType.includes('dtbncx'));
  if (tocItem) {
    const t = await readText(itemAbs(tocItem));
    if (t) {
      try {
        tocPoints = parseNcx(xml.parse(t), opfBase);
      } catch {
        ctx.warnings.push('NCX 目录解析失败，已改用正文标题');
      }
    }
  }
  if (tocPoints.length === 0) {
    const navItem = [...items.values()].find(
      (i) => (i.properties ?? '').includes('nav') || /nav\.x?html?$/i.test(i.href)
    );
    if (navItem) {
      const t = await readText(itemAbs(navItem));
      if (t) tocPoints = parseNavXhtml(t, itemAbs(navItem));
    }
  }

  const tocByPath = new Map<string, TocPoint[]>();
  for (const p of tocPoints) {
    if (!tocByPath.has(p.absPath)) tocByPath.set(p.absPath, []);
    tocByPath.get(p.absPath)!.push(p);
  }
  for (const list of tocByPath.values()) list.sort((a, b) => a.order - b.order);

  // ④ 预解码图片
  const imgData = new Map<string, Buffer>();
  const imgUrl = new Map<string, string | null>();
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (!/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name)) continue;
    const f = zip.file(name);
    if (!f) continue;
    try {
      const d = await f.async('nodebuffer');
      if (d.length > 0 && d.length <= 6 * 1024 * 1024) imgData.set(normalizeZipPath(name), d);
    } catch {
      /* 跳过 */
    }
  }

  const resolveImage = (src: string, baseDir: string): string | null => {
    if (/^(data:|https?:|blob:)/i.test(src)) return null;
    const key = joinZip(baseDir, src);
    if (imgUrl.has(key)) return imgUrl.get(key)!;
    const d = imgData.get(key);
    if (!d) {
      imgUrl.set(key, null);
      return null;
    }
    const url = ctx.saveAsset(key, d);
    imgUrl.set(key, url);
    return url;
  };

  // ⑤ 逐篇解析（章 = spine 文件，目录项带章内锚点）
  const chapters: ParsedChapter[] = [];
  const toc: ParsedTocItem[] = [];

  for (const item of spineItems) {
    if ((item.properties ?? '').includes('nav')) continue;

    const abs = itemAbs(item);
    const raw = await readText(abs);
    if (!raw || raw.length < 30) continue;

    const dir = path.posix.dirname(abs);
    const points = (tocByPath.get(abs) ?? []).filter((p) => p.title.trim());
    const headTitle = points[0]?.title ?? guessTitle(raw) ?? `第 ${chapters.length + 1} 节`;
    if (SKIP_TITLE.test(headTitle.trim())) continue;

    const chapterIdx = chapters.length;
    const blocks: RawHtmlBlock[] = [];
    const localToc: { title: string; level: number; blockIndex: number }[] = [];

    if (points.length === 0) {
      blocks.push(...htmlToBlocks(raw, { basePath: dir, resolveImage }));
      if (blocks.length === 0) continue;
      localToc.push({ title: headTitle, level: 1, blockIndex: 0 });
    } else {
      // 目录只负责“位置”，不负责制造层级。
      // 同一个锚点可能同时是「节」和它的第一个「小节」；只切一次正文，
      // 但目录里的每一个原生节点都要保留。
      const marks = points
        .map((p) => {
          const idx = p.anchor ? findAnchorIndex(raw, p.anchor) : -1;
          return { idx: idx >= 0 ? snapToBlockStart(raw, idx) : 0, point: p };
        })
        .sort((a, b) => a.idx - b.idx || a.point.order - b.point.order);

      const marksByIdx = new Map<number, typeof marks>();
      for (const mk of marks) {
        const list = marksByIdx.get(mk.idx) ?? [];
        list.push(mk);
        marksByIdx.set(mk.idx, list);
      }
      const splitIdx = [...marksByIdx.keys()].sort((a, b) => a - b);

      // 第一个锚点之前的内容（书名页、章首图等）
      if (splitIdx[0] > 8) {
        const preBlocks = htmlToBlocks(raw.slice(0, splitIdx[0]), { basePath: dir, resolveImage });
        if (preBlocks.length) blocks.push(...preBlocks);
      }

      const blockAt = new Map<number, number>();
      for (let i = 0; i < splitIdx.length; i++) {
        const from = splitIdx[i];
        const to = i + 1 < splitIdx.length ? splitIdx[i + 1] : raw.length;
        blockAt.set(from, blocks.length);
        const segBlocks = htmlToBlocks(raw.slice(from, to), { basePath: dir, resolveImage });
        if (segBlocks.length) blocks.push(...segBlocks);
      }

      const markByPoint = new Map(marks.map((mk) => [mk.point, mk]));
      for (const p of [...points].sort((a, b) => a.order - b.order)) {
        const mk = markByPoint.get(p);
        localToc.push({
          title: p.title,
          level: p.level,
          blockIndex: mk ? (blockAt.get(mk.idx) ?? 0) : 0,
        });
      }
    }

    if (blocks.length === 0) continue;

    chapters.push({
      title: localToc[0]?.title ?? headTitle,
      level: localToc[0]?.level ?? 1,
      blocks,
    });
    for (const lt of localToc) {
      toc.push({
        title: lt.title,
        chapterIndex: chapterIdx,
        blockIndex: lt.blockIndex,
        level: lt.level,
      });
    }
  }

  // ⑥ 合并"标题页"式短章
  mergeShortChapters(chapters, toc);

  // ⑥.5 跳过开头的版权/未知页
  if (chapters.length > 1) {
    const c0 = chapters[0];
    const chars0 = c0.blocks.reduce((s, b) => s + b.text.length, 0);
    if (!hasSubstance(c0) && chars0 < 160 && /^(未知|untitled|版权.*|cover|封面|书名页|扉页)?$/i.test(c0.title.trim())) {
      chapters.shift();
      for (const t of toc) t.chapterIndex -= 1;
      for (let k = toc.length - 1; k >= 0; k--) if (toc[k].chapterIndex < 0) toc.splice(k, 1);
    }
  }

  // ⑦ 封面（只接受图片）
  let cover: Buffer | undefined;
  let coverExt: string | undefined;

  const coverId = (() => {
    const metas = asArray(meta.meta as Record<string, unknown>);
    const c = metas.find((m) => String(m['@_name'] ?? '').toLowerCase() === 'cover');
    return c?.['@_content'] ? String(c['@_content']) : '';
  })();

  const trySetCover = async (abs: string) => {
    if (cover) return;
    const d = imgData.get(normalizeZipPath(abs));
    if (!d) return;
    cover = d;
    coverExt = (abs.split('.').pop() ?? 'jpeg').toLowerCase();
  };

  if (coverId && items.has(coverId)) {
    const it = items.get(coverId)!;
    if (it.mediaType.startsWith('image/')) await trySetCover(itemAbs(it));
  }
  if (!cover) {
    const guide = pkg.guide as Record<string, unknown> | undefined;
    for (const ref of asArray(guide?.reference as Record<string, unknown>)) {
      if (!/cover/i.test(String(ref['@_type'] ?? ''))) continue;
      const href = String(ref['@_href'] ?? '');
      if (!href) continue;
      const abs = joinZip(opfBase, href);
      if (/\.(jpe?g|png|gif|webp)$/i.test(abs)) await trySetCover(abs);
    }
  }
  if (!cover) {
    const first = [...items.values()].find(
      (i) => i.mediaType.startsWith('image/') && !/\.(svg|gif)$/i.test(i.href) && /cover/i.test(i.href)
    );
    if (first) await trySetCover(itemAbs(first));
  }
  if (!cover) {
    const first = [...items.values()].find(
      (i) => i.mediaType.startsWith('image/') && !/\.(svg|gif)$/i.test(i.href)
    );
    if (first) await trySetCover(itemAbs(first));
  }

  // ⑧ 兜底
  if (chapters.length === 0) {
    const all = await Promise.all(spineItems.map((i) => readText(itemAbs(i))));
    const blocks = htmlToBlocks(all.join('\n'), { basePath: opfBase, resolveImage });
    if (blocks.length > 0) {
      chapters.push({ title, level: 1, blocks });
      toc.push({ title, chapterIndex: 0, blockIndex: 0, level: 1 });
    }
  }

  if (toc.length === 0 && chapters.length > 0) {
    chapters.forEach((c, i) => toc.push({ title: c.title, chapterIndex: i, blockIndex: 0, level: 1 }));
  }

  return { title, author, publisher, cover, coverExt, chapters, toc, format: 'epub' };
}

/** 判断一章是否有"实质正文"（存在较长段落） */
function hasSubstance(ch: ParsedChapter): boolean {
  return ch.blocks.some((b) => b.type === 'p' && b.text.length >= 40);
}

/** 把标题页式短章并入相邻章，并修正目录指向 */
export function mergeShortChapters(chapters: ParsedChapter[], toc: ParsedTocItem[]): void {
  let i = 0;
  while (i < chapters.length - 1) {
    const chars = chapters[i].blocks.reduce((s, b) => s + b.text.length, 0);
    if (!hasSubstance(chapters[i]) && chars < 220) {
      const offset = chapters[i].blocks.length;
      chapters[i].blocks.push(...chapters[i + 1].blocks);
      if (!chapters[i].title || /^(未知|untitled)$/i.test(chapters[i].title)) {
        chapters[i].title = chapters[i + 1].title;
      }
      chapters.splice(i + 1, 1);
      for (const t of toc) {
        if (t.chapterIndex === i + 1) {
          t.chapterIndex = i;
          t.blockIndex = (t.blockIndex ?? 0) + offset;
        } else if (t.chapterIndex > i + 1) {
          t.chapterIndex -= 1;
        }
      }
      continue;
    }
    i++;
  }

  // 末章若只有署名，并入上一章
  if (chapters.length > 1) {
    const last = chapters[chapters.length - 1];
    const chars = last.blocks.reduce((s, b) => s + b.text.length, 0);
    if (!hasSubstance(last) || chars < 120) {
      const prevIdx = chapters.length - 2;
      chapters[prevIdx].blocks.push(...last.blocks);
      chapters.pop();
      for (let k = toc.length - 1; k >= 0; k--) {
        if (toc[k].chapterIndex >= chapters.length) toc.splice(k, 1);
      }
    }
  }
}

function guessTitle(html: string): string | null {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    const v = decodeEntities(t[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (v) return v;
  }
  const h = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (h) {
    const v = decodeEntities(h[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (v && v.length < 60) return v;
  }
  return null;
}
