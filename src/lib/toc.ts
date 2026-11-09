import type { Book, Progress, TocItem } from '@shared/models';

/**
 * 目录树节点。
 *
 * 目录的真实结构比 level 更复杂：
 *   · level 1 是「章」
 *   · 无 blockId 的 level 2/3 是「节起点」
 *   · 有 blockId 的 level 3 是「章内小节」
 * 这里按“章 → 节 → 小节”三层归一，blockId 决定它是不是可折叠的小节。
 */
export interface TocNode extends TocItem {
  key: string;
  /** 在全书中的位置（按 block 顺序），用于判断当前读到哪一节 */
  order: number;
  /** 视觉层级：0 章 / 1 节 / 2 小节 */
  depth: number;
  isSection: boolean;
  isRoot: boolean;
  parentKey: string | null;
  children: TocNode[];
  /** 该节点下直接挂着的小节数 */
  subsectionCount: number;
}

export interface TocTree {
  roots: TocNode[];
  byKey: Map<string, TocNode>;
  flat: TocNode[];
  blockOrder: Map<string, number>;
  chapterOrder: Map<string, number>;
  sectionCount: number;
  subsectionCount: number;
}

export function buildTocTree(book: Book): TocTree {
  const blockOrder = new Map<string, number>();
  const chapterOrder = new Map<string, number>();
  const chapterStart = new Map<string, number>();
  let n = 0;
  for (const ch of book.chapters) {
    chapterOrder.set(ch.id, n);
    chapterStart.set(ch.id, n);
    // 章标题在正文里是渲染出来的 <h2>，不在 blocks 里，
    // 单独登记一个 `${chapterId}#title` 锚点，让章级目录项也能算出正确位置。
    blockOrder.set(`${ch.id}#title`, n);
    for (const b of ch.blocks) {
      blockOrder.set(b.id, n++);
    }
  }

  const raw: TocNode[] = [];
  book.toc.forEach((item, index) => {
    if (!item.chapterId) return;
    // 没有 blockId 的目录项表示“从这一章/这一节开头算起”，
    // 必须用本章第一个 block 的序号，不能混用 chapter 下标。
    const order = item.blockId
      ? blockOrder.get(item.blockId)
      : chapterStart.get(item.chapterId);
    if (order === undefined) return;
    raw.push({
      ...item,
      key: `${item.chapterId}#${item.blockId ?? 'chapter'}#${index}`,
      order,
      depth: 0,
      isSection: false,
      isRoot: false,
      parentKey: null,
      children: [],
      subsectionCount: 0,
    });
  });

  // 严格按文件自带的层级建树：level 只用来找父级，不再根据 blockId
  // 猜“这是节还是小节”。原生目录跳级时，挂到最近的浅层节点上。
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const item of raw) {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    item.depth = parent ? parent.depth + 1 : 0;
    item.isRoot = !parent;
    item.isSection = !!parent && item.depth === 1;
    if (parent) {
      item.parentKey = parent.key;
      parent.children.push(item);
    } else {
      roots.push(item);
    }
    stack.push(item);
  }

  if (roots.length === 0) {
    const fallback = book.chapters[0];
    if (fallback) {
      roots.push({
        title: fallback.title,
        chapterId: fallback.id,
        level: 1,
        key: `${fallback.id}#chapter#fallback`,
        order: chapterOrder.get(fallback.id) ?? 0,
        depth: 0,
        isSection: false,
        isRoot: true,
        parentKey: null,
        children: [],
        subsectionCount: 0,
      });
    }
  }

  const byKey = new Map<string, TocNode>();
  const flat: TocNode[] = [];
  const walk = (node: TocNode) => {
    byKey.set(node.key, node);
    node.subsectionCount = node.children.filter((child) => !child.isSection).length;
    flat.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  flat.sort((a, b) => a.order - b.order || a.depth - b.depth);

  const sectionCount = flat.filter((node) => !node.isRoot && node.isSection).length;
  const subsectionCount = flat.filter((node) => !node.isRoot && !node.isSection).length;

  return { roots, byKey, flat, blockOrder, chapterOrder, sectionCount, subsectionCount };
}

/** 当前读到哪一节/小节：取“起点不晚于当前 block”的最后一个目录项。 */
export function findActiveToc(tree: TocTree, progress: Progress | null): TocNode | null {
  if (!progress) return null;
  const order = progress.blockId
    ? tree.blockOrder.get(progress.blockId)
    : tree.chapterOrder.get(progress.chapterId);
  if (order === undefined) {
    return tree.flat.find((node) => node.chapterId === progress.chapterId) ?? null;
  }
  let best: TocNode | null = null;
  for (const node of tree.flat) {
    if (node.order <= order + 0.001) best = node;
    else break;
  }
  if (best) return best;
  return tree.flat.find((node) => node.chapterId === progress.chapterId) ?? null;
}

/** 从当前节点回溯到章，用于展开和高亮。 */
export function findTocPath(tree: TocTree, key: string | null | undefined): TocNode[] {
  if (!key) return [];
  const path: TocNode[] = [];
  let node = tree.byKey.get(key);
  while (node) {
    path.unshift(node);
    node = node.parentKey ? tree.byKey.get(node.parentKey) : undefined;
  }
  return path;
}

export function activeRoot(tree: TocTree, node: TocNode | null): TocNode | null {
  if (!node) return null;
  const path = findTocPath(tree, node.key);
  return path.find((item) => item.isRoot) ?? null;
}

/** 当前章内被点亮的那一行：小节点亮时，优先点亮它的“节”父级。 */
export function activeSection(node: TocNode | null): TocNode | null {
  if (!node || node.isRoot) return null;
  return node.isSection ? node : null;
}
