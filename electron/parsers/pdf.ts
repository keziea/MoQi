import path from 'node:path';
import type { BookFormat } from '../../shared/models';
import type { RawHtmlBlock } from './html';
import type { ParseContext, ParsedChapter, ParsedBook, ParsedTocItem } from './epub';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));

interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
  width?: number;
}

interface Line {
  y: number;
  x: number;
  text: string;
  /** 该行的主字号（按字数投票，避免上标 / 脚注把小字号带进来） */
  size: number;
  page: number;
}

/** 一个自然段，带页内纵向坐标，供目录按 (页, y) 精确定位 */
interface Para {
  text: string;
  page: number;
  y: number;
  size: number;
}

const SENT_END = /[。！？…；：.?!;:"'”』」）)\]】]$/;
const PAGE_NUM = /^[\s\-—–·•]*\d{1,4}[\s\-—–·•]*$/;
const RE_CHAPTER =
  /^(第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节卷篇部回]|序[章言]?|前言|引言|楔子|后记|尾声|终章|结语|附录|致谢)([\s\u3000]+.*)?$/;

const CJK_CLASS = '\\u3000-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff01-\\uff65';
const CJK_JOIN = new RegExp(`([${CJK_CLASS}]) +([${CJK_CLASS}])`, 'g');

/**
 * PDF 文字层常见两种脏数据：
 *  1. 康熙部首字符（⽇ / ⼀ / ⾦ …），字体里没有对应字形，会显示成大小不一、粗细错乱的怪字；
 *  2. 片段之间被错误插入的空格，中文因此被撑开。
 *
 * 注意：只能对「部首 / 兼容汉字」这几个区做 NFKC。
 * 整串 NFKC 会把中文全角标点一起压成半角（，→, ：→: ①→1），中文排版会立刻变味。
 */
function tidy(raw: string): string {
  let s = raw
    .replace(/[\u2e80-\u2fdf\uf900-\ufaff]/g, (c) => c.normalize('NFKC'))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(CJK_JOIN, '$1$2');
  }
  return s.trim();
}

/** 行内片段拼接：中文直接连，英文单词之间补一个空格 */
function joinText(a: string, b: string): string {
  if (!a) return b;
  const needSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return a + (needSpace ? ' ' : '') + b;
}

/** 把 pdfjs 的文本片段按基线聚成行 */
function groupLines(items: PdfTextItem[], page: number): Line[] {
  const rows: { y: number; items: { x: number; w: number; str: string; h: number }[] }[] = [];

  for (const it of items) {
    const raw = it.str;
    if (!raw || !raw.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.height) || Math.abs(it.transform[3]) || 12;
    // 用真实宽度，不要用「字数 × 字号 × 0.55」估算：
    // 中文是全角，估小之后每个片段都会误判成需要空格
    const w = typeof it.width === 'number' && it.width > 0 ? it.width : raw.length * h;

    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, h * 0.45));
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, w, str: raw, h });
  }

  rows.sort((a, b) => b.y - a.y);

  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = -1;
    const votes = new Map<number, number>();

    for (const it of r.items) {
      const key = Math.round(it.h * 10) / 10;
      votes.set(key, (votes.get(key) ?? 0) + it.str.length);
      // 只有明显断开的间隙才补空格
      if (prevEnd >= 0 && it.x - prevEnd > Math.max(2, it.h * 0.34)) text += ' ';
      text += it.str;
      prevEnd = it.x + it.w;
    }

    let size = 12;
    let best = -1;
    for (const [k, v] of votes) {
      if (v > best) {
        best = v;
        size = k;
      }
    }

    return {
      y: r.y,
      x: r.items[0]?.x ?? 0,
      text: tidy(text),
      size,
      page,
    };
  });
}

/** 全书基准：正文字号 + 正文行距。PDF 的排版判断必须以它为锚，不能用全局平均值 */
function computeBaseline(lines: Line[]): { size: number; gap: number } {
  const sizeVotes = new Map<number, number>();
  for (const l of lines) {
    if (!l.text) continue;
    const k = Math.round(l.size * 10) / 10;
    sizeVotes.set(k, (sizeVotes.get(k) ?? 0) + l.text.length);
  }
  let size = 12;
  let best = 0;
  for (const [k, v] of sizeVotes) {
    if (v > best) {
      best = v;
      size = k;
    }
  }

  const gapVotes = new Map<number, number>();
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    if (a.page !== b.page) continue;
    const g = a.y - b.y;
    if (g <= 1 || g > size * 6) continue;
    const k = Math.round(g * 10) / 10;
    gapVotes.set(k, (gapVotes.get(k) ?? 0) + 1);
  }
  let gap = size * 1.45;
  let bestG = 0;
  for (const [k, v] of gapVotes) {
    if (v > bestG) {
      bestG = v;
      gap = k;
    }
  }

  return { size, gap };
}

/** 全书行流 → 自然段。必须整本连续处理，否则每一页第一行都会被硬切成新段。 */
function pagesToParagraphs(lines: Line[], pageHeights: number[], base: { size: number; gap: number }): Para[] {
  const out: Para[] = [];
  if (!lines.length) return out;

  // 重复短行（页眉页脚候选）
  const freq = new Map<string, number>();
  for (const l of lines) {
    if (l.text.length > 30) continue;
    const key = l.text.replace(/\d+/g, '#');
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  let cur = '';
  let curPage = lines[0].page;
  let curY = lines[0].y;
  let curSize = lines[0].size;
  let prev: Line | null = null;

  const flush = () => {
    const t = cur.trim();
    if (t && !PAGE_NUM.test(t)) out.push({ text: t, page: curPage, y: curY, size: curSize });
    cur = '';
  };

  for (const line of lines) {
    const pageHeight = pageHeights[line.page] ?? 800;
    const nearTop = line.y > pageHeight * 0.92;
    const nearBottom = line.y < pageHeight * 0.08;
    const repeated = (freq.get(line.text.replace(/\d+/g, '#')) ?? 0) >= 3;
    if (line.text.length <= 30 && repeated && (nearTop || nearBottom)) continue;
    if (PAGE_NUM.test(line.text)) continue;

    if (!prev) {
      cur = line.text;
      curPage = line.page;
      curY = line.y;
      curSize = line.size;
      prev = line;
      continue;
    }

    const pageChanged = line.page !== prev.page;
    const gap = prev.y - line.y;
    const prevEnded = SENT_END.test(prev.text);
    // 段间距按「该行字号对应的正常行距」判断：
    // 标题字号大、行距自然也大，若统一拿正文行距当阈值，标题两行会被拆成两段。
    const expectedGap = base.gap * (line.size / base.size);
    const paraGap = !pageChanged && gap > expectedGap * 1.12 && gap >= expectedGap + 2;
    // 首行缩进（约一个字宽以上）
    const indent = !pageChanged && line.x - prev.x > base.size * 0.7;
    // 字号突变：标题 / 脚注的边界
    const sizeChanged = Math.abs(line.size - prev.size) > Math.max(0.8, base.size * 0.08);

    let newPara: boolean;
    if (pageChanged) {
      // 跨页：上一行句子没说完就续接。
      // 不能拿「上一行很短」当断段依据 —— 分页正好切在句中时，下一句会被硬生生拆成新段。
      newPara = prevEnded || sizeChanged;
    } else {
      newPara = paraGap || sizeChanged || (indent && prevEnded);
    }

    if (newPara) {
      flush();
      cur = line.text;
      curPage = line.page;
      curY = line.y;
      curSize = line.size;
    } else {
      // 短标题行（「第1章」+「被抛弃的房屋和土地」）拼起来要留一个空格，
      // 长标题自动换行则直接续接
      const sep = cur.length <= 6 && line.size >= base.size * 1.1 ? ' ' : '';
      cur = sep ? `${cur}${sep}${line.text}` : joinText(cur, line.text);
    }
    prev = line;
  }
  flush();

  return refineParagraphs(out, base.size);
}

/** 段落收尾：合并上标注释号、合并被行宽拆开的标题 */
function refineParagraphs(list: Para[], baseSize: number): Para[] {
  const out: Para[] = [];
  for (const p of list) {
    const last = out[out.length - 1];

    // ①、②、*、[1] 这类上标注释号会单独成行，并回前一段，避免正文里孤零零一行符号
    if (last && p.text.length <= 3 && p.size < baseSize * 0.92) {
      last.text = joinText(last.text, p.text);
      continue;
    }

    // 标题跨行：字号相同且偏大、行距紧凑 → 合成一个完整标题
    if (
      last &&
      p.size >= baseSize * 1.1 &&
      Math.abs(p.size - last.size) < 0.6 &&
      last.text.length < 40 &&
      p.text.length < 40 &&
      Math.abs(last.y - p.y) < p.size * 2.4
    ) {
      last.text = `${last.text} ${p.text}`;
      continue;
    }

    out.push({ ...p });
  }
  return out;
}

/** 按字号相对正文的比例决定块类型 */
function blockTypeOf(p: Para, baseSize: number): RawHtmlBlock['type'] {
  const ratio = p.size / baseSize;
  if (ratio >= 1.7) return 'h1';
  if (ratio >= 1.28) return 'h2';
  if (ratio >= 1.1) return 'h3';
  if (ratio <= 0.86) return 'caption';
  return 'p';
}

interface OutlinePoint {
  title: string;
  page: number;
  y: number;
  level: number;
}

export async function parsePdf(buf: Buffer, ctx: ParseContext): Promise<ParsedBook> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: path.join(PDFJS_ROOT, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(PDFJS_ROOT, 'standard_fonts') + path.sep,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, string>;
  const title = (info.Title ?? '').trim() || '未命名';
  const author = (info.Author ?? '').trim() || '未知作者';

  // ① 抽全部页的行
  const allLines: Line[] = [];
  const pageHeights: number[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pageHeights[p] = vp.height;
    const content = await page.getTextContent();
    allLines.push(...groupLines(content.items as PdfTextItem[], p));
    page.cleanup();
  }

  if (allLines.length === 0) {
    throw new Error('这本 PDF 没有文字层（可能是扫描版），无法提取文字。建议改用同书的 EPUB 或 TXT 版本');
  }

  // ② 全书基准 + 连续切段
  const base = computeBaseline(allLines);
  const allParas = pagesToParagraphs(allLines, pageHeights, base);

  // ②.5 剔掉书前的目录页：成页的短行、几乎不带句末标点。
  // 这些文字否则会被塞进「前言」里，读者翻过去会读到一整页目录条目。
  const tocPages = new Set<number>();
  const scanLimit = Math.min(doc.numPages, 28);
  for (let p = 2; p <= scanLimit; p++) {
    const pageParas = allParas.filter((x) => x.page === p);
    if (pageParas.length < 12) continue;
    const short = pageParas.filter((x) => x.text.length < 26 && !/[。！？；]$/.test(x.text)).length;
    if (short / pageParas.length >= 0.8) tocPages.add(p);
  }
  const bodyParas = tocPages.size ? allParas.filter((p) => !tocPages.has(p.page)) : allParas;

  // ③ 目录（outline）：连页内纵向位置一起取，才能区分同一页上的多级标题
  const flat: OutlinePoint[] = [];
  const outline = await doc.getOutline().catch(() => null);

  const resolveDest = async (dest: unknown): Promise<{ page: number; y: number }> => {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (Array.isArray(d) && d[0]) {
        const idx = await doc.getPageIndex(d[0] as never);
        const top =
          typeof d[3] === 'number' ? d[3] : typeof d[2] === 'number' ? d[2] : Number.POSITIVE_INFINITY;
        return { page: idx + 1, y: top };
      }
    } catch {
      /* ignore */
    }
    return { page: 1, y: Number.POSITIVE_INFINITY };
  };

  if (outline && outline.length) {
    const walk = async (nodes: typeof outline, level: number) => {
      for (const node of nodes) {
        const pos = node.dest ? await resolveDest(node.dest) : { page: 1, y: Number.POSITIVE_INFINITY };
        if (node.title?.trim()) {
          flat.push({ title: node.title.trim(), page: pos.page, y: pos.y, level });
        }
        if (node.items?.length) await walk(node.items, level + 1);
      }
    };
    await walk(outline, 1);
  }

  // ④ 组章
  const chapters: ParsedChapter[] = [];
  const toc: ParsedTocItem[] = [];

  const pushChapter = (chTitle: string, level: number, paras: Para[], withToc: boolean) => {
    const blocks: RawHtmlBlock[] = [];
    for (const para of paras) {
      const t = para.text.trim();
      if (!t) continue;
      let type = blockTypeOf(para, base.size);
      if (type === 'p' && t.length <= 22 && !/[。！？；，、：,.;:!?]/.test(t) && RE_CHAPTER.test(t)) {
        type = 'h2';
      }
      // 整段都被判成标题的情况（引文大字号）压回正文，避免版面忽大忽小
      if ((type === 'h1' || type === 'h2') && t.length > 80) type = 'p';
      blocks.push({ type, text: t });
    }
    if (!blocks.length) return;
    const idx = chapters.length;
    chapters.push({ title: chTitle, level, blocks });
    if (withToc) toc.push({ title: chTitle, chapterIndex: idx, blockIndex: 0, level });
  };

  if (flat.length >= 2) {
    // 按 (页, 页内纵坐标) 排序；y 越大越靠上
    const points = flat
      .slice()
      .sort((a, b) => a.page - b.page || b.y - a.y || a.level - b.level);

    /** 段落是否落在锚点之后（含锚点所在行） */
    const after = (p: Para, s: OutlinePoint) =>
      p.page > s.page || (p.page === s.page && p.y <= s.y + Math.max(4, base.gap * 0.6));

    // 第一个目录项之前的页
    if (points[0].page > 1) {
      const pre = bodyParas.filter((p) => p.page < points[0].page);
      pushChapter(title, 1, pre, false);
    }

    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      const end = i + 1 < points.length ? points[i + 1] : null;
      // 同一页上的多个层级也能各自切到自己的那一段，不再被「同页去重」吃掉
      const paras = bodyParas.filter((p) => after(p, start) && (!end || !after(p, end)));
      pushChapter(start.title, Math.min(start.level, 4), paras, true);
    }
  } else {
    // 无 outline：每 15 页一章
    const per = 15;
    for (let p = 1; p <= doc.numPages; p += per) {
      const paras = bodyParas.filter((x) => x.page >= p && x.page < Math.min(p + per, doc.numPages + 1));
      pushChapter(`第 ${p}–${Math.min(p + per - 1, doc.numPages)} 页`, 1, paras, true);
    }
  }

  if (chapters.length === 0) {
    pushChapter(title, 1, bodyParas, true);
  }

  ctx.warnings.push(`PDF 共 ${doc.numPages} 页`);

  return {
    title,
    author,
    chapters,
    toc,
    format: 'pdf' as BookFormat,
  };
}
