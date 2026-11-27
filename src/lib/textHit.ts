/**
 * 点字命中：把一次鼠标点击换算成「哪个段落、第几个字」。
 *
 * 不能直接读 selection：单击会清空选区，而且分页模式下正文被切成多列。
 * 这里用 caretRangeFromPoint 拿到点击处的插入点，再换算成 block.text 的下标。
 */

export interface CharHit {
  blockId: string;
  /** 在 block.text 中的下标 */
  index: number;
  char: string;
  /** 这个字在屏幕上的矩形，用来画外框 */
  rect: DOMRect | null;
}

const HAN = /^\p{Script=Han}$/u;

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

interface TextPos {
  node: Text;
  offset: number;
}

/** 在元素的所有文本节点里，找到全局下标对应的 DOM 位置 */
function posOfIndex(el: HTMLElement, index: number): TextPos | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const t = node as Text;
    const len = t.data.length;
    if (index < acc + len) return { node: t, offset: index - acc };
    acc += len;
    node = walker.nextNode();
  }
  return null;
}

/** 某个下标上的字符（UTF-16 感知：扩展区汉字占两个码元） */
function unitAt(text: string, index: number): { char: string; length: number } | null {
  if (index < 0 || index >= text.length) return null;
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    return { char: text.slice(index, index + 2), length: 2 };
  }
  return { char: text[index], length: 1 };
}

/** 单个字在屏幕上的矩形；分页时跨列的字也能取到自己那一格 */
export function rectOfChar(el: HTMLElement, index: number): DOMRect | null {
  const text = el.textContent ?? '';
  const unit = unitAt(text, index);
  if (!unit) return null;
  const a = posOfIndex(el, index);
  const b = posOfIndex(el, index + unit.length);
  if (!a) return null;
  try {
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    if (b) r.setEnd(b.node, b.offset);
    else r.setEnd(a.node, a.offset + unit.length);
    const rects = r.getClientRects();
    if (rects.length) return rects[0];
    return r.getBoundingClientRect();
  } catch {
    return null;
  }
}

type CaretDoc = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function isHan(s: string | null | undefined): s is string {
  return !!s && HAN.test(s);
}

/**
 * 点击处的汉字。
 * caretRangeFromPoint 落点可能在字前也可能在字后，所以前后各试一个，
 * 取离鼠标最近、且确实是汉字的那个。
 */
export function hitCharAt(x: number, y: number): CharHit | null {
  const doc = document as CaretDoc;
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range) return null;

  const block = closestBlock(range.startContainer);
  if (!block) return null;
  const blockId = block.dataset.blockId;
  if (!blockId) return null;
  if (block.tagName === 'FIGURE' || block.classList.contains('blk-hr')) return null;

  const text = block.textContent ?? '';
  if (!text) return null;

  const base = offsetWithin(block, range.startContainer, range.startOffset);
  const candidates: number[] = [];
  for (const i of [base, base - 1, base + 1]) {
    if (i >= 0 && i < text.length && !candidates.includes(i)) candidates.push(i);
  }

  let best: { index: number; rect: DOMRect | null; dist: number } | null = null;
  for (const i of candidates) {
    const unit = unitAt(text, i);
    if (!unit || !isHan(unit.char)) continue;
    const rect = rectOfChar(block, i);
    const dist = rect ? Math.abs(rect.left + rect.width / 2 - x) : 999;
    if (!best || dist < best.dist) best = { index: i, rect, dist };
  }
  if (!best) return null;

  const unit = unitAt(text, best.index)!;
  return { blockId, index: best.index, char: unit.char, rect: best.rect };
}
