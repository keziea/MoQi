import type { HighlightColor, TextRange } from '@shared/models';

export interface Segment {
  text: string;
  em?: boolean;
  strong?: boolean;
  notes: { id: string; color: HighlightColor; kind?: 'selection' | 'paragraph' }[];
}

export interface NoteRangeInput {
  noteId: string;
  color: HighlightColor;
  start: number;
  end: number;
  /** 句子笔记 / 整段笔记，用来区分视觉 */
  kind?: 'selection' | 'paragraph';
}

interface Token {
  text: string;
  em: boolean;
  strong: boolean;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&mdash;': '—',
  '&hellip;': '…',
};

function unescapeText(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp|ldquo|rdquo|mdash|hellip);/g, (m) => ENTITIES[m] ?? m);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把精简内联 HTML 拆成带格式标记的 token */
function parseInline(html: string): Token[] {
  const tokens: Token[] = [];
  let em = 0;
  let strong = 0;
  let buf = '';

  const flush = () => {
    if (buf) {
      tokens.push({ text: buf, em: em > 0, strong: strong > 0 });
      buf = '';
    }
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      buf += unescapeText(html.slice(i));
      break;
    }
    if (lt > i) buf += unescapeText(html.slice(i, lt));
    const gt = html.indexOf('>', lt);
    if (gt < 0) {
      buf += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    const m = tag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
    const name = m ? m[1].toLowerCase() : '';
    const closing = /^<\//.test(tag);

    if (name === 'em' || name === 'i') {
      flush();
      em = Math.max(0, em + (closing ? -1 : 1));
    } else if (name === 'strong' || name === 'b') {
      flush();
      strong = Math.max(0, strong + (closing ? -1 : 1));
    } else if (name === 'br') {
      flush();
    }
    i = gt + 1;
  }
  flush();
  return tokens;
}

/**
 * 把一段文字按「内联格式边界 + 高亮边界」切成最小片段。
 * 见 docs/05-阅读引擎与定位.md §6
 */
export function buildSegments(
  html: string | undefined,
  text: string,
  ranges: NoteRangeInput[]
): Segment[] {
  const source = html ?? escapeText(text);
  let tokens = parseInline(source);

  // offset 基准：token 拼接结果。与 text 不一致时以 text 为准（放弃内联格式，保证高亮正确）
  const joined = tokens.map((t) => t.text).join('');
  if (joined.length !== text.length) {
    return splitByRanges(text, ranges);
  }
  if (tokens.length === 0) tokens = [{ text, em: false, strong: false }];

  let cursor = 0;
  const positioned = tokens.map((t) => {
    const start = cursor;
    cursor += t.text.length;
    return { ...t, start, end: cursor };
  });
  const total = cursor;

  const points = new Set<number>([0, total]);
  for (const t of positioned) {
    points.add(t.start);
    points.add(t.end);
  }
  for (const r of ranges) {
    points.add(Math.max(0, Math.min(total, r.start)));
    points.add(Math.max(0, Math.min(total, r.end)));
  }
  const pts = [...points].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i];
    const e = pts[i + 1];
    if (e <= s) continue;
    const slice = text.slice(s, e);
    if (!slice) continue;
    const tok = positioned.find((t) => t.start <= s && t.end >= e);
    const notes = ranges
      .filter((r) => r.start <= s && r.end >= e)
      .map((r) => ({ id: r.noteId, color: r.color }));
    out.push({ text: slice, em: tok?.em, strong: tok?.strong, notes });
  }
  return out;
}

function splitByRanges(text: string, ranges: NoteRangeInput[]): Segment[] {
  const total = text.length;
  const points = new Set<number>([0, total]);
  for (const r of ranges) {
    points.add(Math.max(0, Math.min(total, r.start)));
    points.add(Math.max(0, Math.min(total, r.end)));
  }
  const pts = [...points].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i];
    const e = pts[i + 1];
    if (e <= s) continue;
    const notes = ranges
      .filter((r) => r.start <= s && r.end >= e)
      .map((r) => ({ id: r.noteId, color: r.color }));
    out.push({ text: text.slice(s, e), notes });
  }
  return out;
}

// ───────────────────────── 选区 → TextRange ─────────────────────────

function closestBlock(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.dataset.blockId) el = el.parentElement;
  return el;
}

function offsetWithin(el: HTMLElement, node: Node, offset: number): number {
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return r.toString().length;
  } catch {
    return 0;
  }
}

export interface SelectionResult {
  ranges: TextRange[];
  text: string;
  rect: DOMRect | null;
}

/** 从当前选区提取跨段落的 TextRange 列表 */
export function selectionToRanges(
  selection: Selection | null,
  container: HTMLElement | null
): SelectionResult | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const text = range.toString();
  if (!text.trim()) return null;

  const startEl = closestBlock(range.startContainer);
  const endEl = closestBlock(range.endContainer);
  if (!startEl || !endEl || !container) return null;

  const all = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]'));
  const i0 = all.indexOf(startEl);
  const i1 = all.indexOf(endEl);
  if (i0 < 0 || i1 < 0) return null;

  const between = all.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  const ranges: TextRange[] = [];

  for (const el of between) {
    const blockId = el.dataset.blockId;
    if (!blockId) continue;
    const full = el.textContent ?? '';
    let start = 0;
    let end = full.length;

    if (el === startEl) start = offsetWithin(el, range.startContainer, range.startOffset);
    if (el === endEl) end = offsetWithin(el, range.endContainer, range.endOffset);
    if (el === startEl && el === endEl && end < start) [start, end] = [end, start];

    start = Math.max(0, Math.min(full.length, start));
    end = Math.max(0, Math.min(full.length, end));
    if (end > start) ranges.push({ blockId, start, end });
  }

  if (ranges.length === 0) return null;

  let rect: DOMRect | null = null;
  try {
    const rects = range.getClientRects();
    rect = rects.length ? rects[0] : range.getBoundingClientRect();
  } catch {
    rect = null;
  }

  return { ranges, text: text.replace(/\s+/g, ' ').trim(), rect };
}

/** 把笔记的 ranges 按 blockId 分组，供渲染时查询 */
export function rangesByBlock(
  ranges: {
    blockId: string;
    start: number;
    end: number;
    noteId: string;
    color: HighlightColor;
    kind?: 'selection' | 'paragraph';
  }[]
): Map<string, NoteRangeInput[]> {
  const map = new Map<string, NoteRangeInput[]>();
  for (const r of ranges) {
    if (!map.has(r.blockId)) map.set(r.blockId, []);
    map.get(r.blockId)!.push({
      noteId: r.noteId,
      color: r.color,
      start: r.start,
      end: r.end,
      kind: r.kind,
    });
  }
  return map;
}

export function findBlockEl(blockId: string): HTMLElement | null {
  return document.getElementById(blockId);
}
