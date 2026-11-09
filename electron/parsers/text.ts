import chardet from 'chardet';
import iconv from 'iconv-lite';

/** 章节标题：第N章 / 第N节 …… */
const RE_CHAPTER =
  /^(第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节卷篇部回])(?:[\s\u3000]+(.*))?$/;
/** 特殊标题 */
const RE_SPECIAL =
  /^(序章|序幕|序言|前言|引言|楔子|引子|后记|尾声|终章|结语|结局|附录|致谢|跋|自序|译后记)(?:[\s\u3000]+(.*))?$/;
/** 目录标志行 */
const RE_TOC_FLAG = /^[\s\u3000]*(目\s*录|目\s*次|contents)[\s\u3000]*$/i;
/** 图片占位 */
const RE_IMAGE = /^[\s\u3000]*[\[【（(]\s*(插图|图片|图|image|figure|photo)\s*\d*\s*[\]】）)][\s\u3000]*$/i;
/** 句末标点 */
const SENT_END = /[。！？…；：”』」）)\]】]$/;

export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf.subarray(2), 'utf16-le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf.subarray(2), 'utf16-be');
  }

  let enc = 'UTF-8';
  try {
    const guess = chardet.detect(buf);
    if (guess) enc = String(guess);
  } catch {
    /* 保持 UTF-8 */
  }

  const normalize = (e: string): string => {
    const u = e.toUpperCase();
    if (u.includes('GB') || u.includes('BIG5') || u.includes('EUC')) return 'GB18030';
    if (u.includes('UTF-16')) return 'utf16-le';
    if (u.includes('UTF-8') || u.includes('ASCII')) return 'utf8';
    return 'utf8';
  };

  let text = iconv.decode(buf, normalize(enc));

  // 质量校验：中文字符占比过低则换编码重试
  const cn = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  if (cn / Math.max(text.length, 1) < 0.05 && enc !== 'UTF-8') {
    const alt = iconv.decode(buf, 'utf8');
    const altCn = (alt.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    if (altCn > cn) text = alt;
  }
  return text;
}

interface Candidate {
  line: number;
  num: string;
  inlineTitle: string;
  full: string;
  isSpecial: boolean;
}

function collectCandidates(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\u3000/g, ' ').trim();
    if (!t || t.length > 40) continue;
    const m = RE_CHAPTER.exec(t) ?? RE_SPECIAL.exec(t);
    if (!m) continue;
    out.push({
      line: i,
      num: m[1],
      inlineTitle: (m[2] ?? '').trim(),
      full: (m[2] ?? '').trim() || m[1],
      isSpecial: !RE_CHAPTER.test(t),
    });
  }
  return out;
}

/** 章节编号归一（第1章 / 第一章 → 同 key） */
function chapterKey(num: string): string {
  const map: Record<string, string> = {
    零: '0', 〇: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4',
    五: '5', 六: '6', 七: '7', 八: '8', 九: '9',
  };
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  const m = num.match(/第([0-9０-９零〇一二三四五六七八九十百千万两]+)([章节卷篇部回])/);
  if (!m) return num;
  let s = m[1].replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
  let value = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (digit !== 0 && unit[ch]) {
      section += digit * unit[ch];
      digit = 0;
    } else if (unit[ch]) {
      section += unit[ch];
    } else if (map[ch] !== undefined) {
      digit = Number(map[ch]);
    } else if (/\d/.test(ch)) {
      digit = digit * 10 + Number(ch);
    }
  }
  value = section + digit;
  return `${m[2]}:${value}`;
}

export interface RawBlock {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'img' | 'caption' | 'hr';
  text: string;
}

export interface RawChapter {
  title: string;
  level: number;
  blocks: RawBlock[];
}

function pushParagraphBlocks(blocks: RawBlock[], paras: string[]): void {
  for (const raw of paras) {
    const t = raw.trim();
    if (!t) continue;
    if (RE_IMAGE.test(t)) {
      blocks.push({ type: 'img', text: '' });
      continue;
    }
    // 星号/短横线类的分隔装饰
    if (/^[*＊#·•◇◆※=~_\-—\s]{1,16}$/.test(t)) {
      blocks.push({ type: 'hr', text: '' });
      continue;
    }
    // 短行且无句读 → 小标题（排除署名、书名、日期、图表号）
    if (
      t.length <= 20 &&
      !/[。！？；，、：,.;:!?]/.test(t) &&
      !/^[“"'「『（(《<*＊#·•\-—\d]/.test(t) &&
      !/[《》·・]/.test(t) &&
      !SENT_END.test(t)
    ) {
      blocks.push({ type: 'h2', text: t });
      continue;
    }
    blocks.push({ type: 'p', text: t });
  }
}

/** 把一段文字切成段落（空行分隔，块内软换行合并） */
export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  const chunks = text.split(/\n[ \t\u3000]*\n+/);
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    out.push(lines.join(''));
  }
  return out;
}

/**
 * TXT 章节切分
 *
 * 处理本书这类结构：
 *   [版权信息][前言正文][目录区][正文：第1章...]
 * 策略见 docs/04-书籍解析规范.md §3.2
 */
export function splitTxt(text: string): RawChapter[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const candidates = collectCandidates(lines);

  const bodyCands = candidates.filter((c) => !c.inlineTitle && !c.isSpecial);
  const inlineCands = candidates.filter((c) => c.inlineTitle);

  // 找"目录"标志行
  let tocFlagLine = -1;
  for (let i = 0; i < Math.min(lines.length, Math.floor(lines.length * 0.5)); i++) {
    if (RE_TOC_FLAG.test(lines[i])) {
      tocFlagLine = i;
      break;
    }
  }

  let bodyStart = -1;
  let tocStart = -1;

  if (bodyCands.length >= 2) {
    bodyStart = bodyCands[0].line;
  }

  if (bodyStart > 0) {
    if (tocFlagLine > 0 && tocFlagLine < bodyStart) {
      tocStart = tocFlagLine;
    } else {
      // 用"内联标题与正文标题重复"判定目录起点
      const bodyKeys = new Set(bodyCands.map((c) => chapterKey(c.num)));
      const dup = inlineCands.find((c) => bodyKeys.has(chapterKey(c.num)));
      if (dup && dup.line < bodyStart) tocStart = dup.line;
    }
  }

  const chapters: RawChapter[] = [];

  // ── 前段（目录之前）──
  const frontEnd = tocStart > 0 ? tocStart : bodyStart > 0 ? bodyStart : lines.length;
  const frontLines = lines.slice(0, frontEnd);
  const frontCands = candidates.filter((c) => c.line < frontEnd);

  if (frontCands.length > 0) {
    for (let i = 0; i < frontCands.length; i++) {
      const c = frontCands[i];
      const from = c.line + 1;
      const to = i + 1 < frontCands.length ? frontCands[i + 1].line : frontEnd;
      const blocks: RawBlock[] = [];
      pushParagraphBlocks(blocks, splitParagraphs(frontLines.slice(from, to).join('\n')));
      if (blocks.length === 0) continue;
      chapters.push({
        title: c.inlineTitle ? `${c.num} ${c.inlineTitle}` : c.num,
        level: 1,
        blocks,
      });
    }
  } else if (frontLines.join('').trim().length > 0) {
    // 前段无标题，作为"开篇"并入
    const blocks: RawBlock[] = [];
    pushParagraphBlocks(blocks, splitParagraphs(frontLines.join('\n')));
    if (blocks.length > 0) chapters.push({ title: '开篇', level: 1, blocks });
  }

  // ── 正文段 ──
  const bodyLines = lines;
  const roots =
    bodyCands.length >= 2
      ? bodyCands
      : candidates.filter((c) => c.line >= Math.max(bodyStart, 0));

  if (roots.length > 0) {
    for (let i = 0; i < roots.length; i++) {
      const c = roots[i];
      const from = c.line + 1;
      const to = i + 1 < roots.length ? roots[i + 1].line : lines.length;
      const seg = bodyLines.slice(from, to);
      const blocks: RawBlock[] = [];

      // 标题行：下一非空行若不长且无句读 → 作为章名
      let title = c.inlineTitle || '';
      let consumed = 0;
      if (!title) {
        for (let k = 0; k < Math.min(seg.length, 4); k++) {
          const t = seg[k].trim();
          if (!t) continue;
          if (t.length <= 30 && !/[。！？；]/.test(t)) {
            title = t;
            consumed = k + 1;
          }
          break;
        }
      }
      const label = title ? `${c.num} ${title}` : c.num;

      // 章名之后若有图注（紧随的短句），保留为 caption
      const rest = seg.slice(consumed);
      pushParagraphBlocks(blocks, splitParagraphs(rest.join('\n')));

      if (blocks.length === 0) continue;
      chapters.push({ title: label, level: 1, blocks });
    }
  }

  // ── 兜底：没有任何章节 ──
  if (chapters.length === 0) {
    const paras = splitParagraphs(normalized);
    if (paras.length === 0) return [];
    const per = 60; // 每 60 段一章
    for (let i = 0; i < paras.length; i += per) {
      const blocks: RawBlock[] = [];
      pushParagraphBlocks(blocks, paras.slice(i, i + per));
      chapters.push({
        title: `第 ${Math.floor(i / per) + 1} 节`,
        level: 1,
        blocks,
      });
    }
  }

  return chapters;
}

export function countChars(blocks: { text: string }[]): number {
  return blocks.reduce((s, b) => s + b.text.length, 0);
}
