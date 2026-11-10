import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Book, Settings } from '@shared/models';

export interface PageInfo {
  page: number;
  total: number;
  chapterId: string;
  blockId: string;
  ratio: number;
}

export interface PagedHandle {
  next: () => void;
  prev: () => void;
  goToPage: (page: number, animate?: boolean) => void;
  goToBlock: (
    chapterId: string,
    blockId?: string,
    opts?: { breathe?: boolean; animate?: boolean }
  ) => void;
  getPosition: () => { page: number; total: number };
  /** 某个段落是否在当前页（跨页段落只要有一段在当前页就算） */
  isBlockOnPage: (blockId: string) => boolean;
  relayout: () => void;
}

interface Props {
  book: Book;
  settings: Settings;
  initialBlockId?: string;
  initialPage?: number;
  initialChapterId?: string;
  /** 面板打开时为 false，滚轮不再翻页 */
  enabled: boolean;
  blockChars: Map<string, number>;
  totalChars: number;
  onPageChange: (info: PageInfo) => void;
  children: ReactNode;
}

interface PendingJump {
  chapterId?: string;
  blockId?: string;
  breathe?: boolean;
}

interface Anchor {
  chapterId: string;
  blockId: string;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * 分页阅读。
 *
 * 原理：正文容器是一列固定高度、列宽 = 页宽的多列布局（column-fill: auto）。
 * 每个向右溢出的列就是一页，翻页只改 scrollLeft，文字始终落在整数像素上，不发虚。
 * 定位仍以 blockId 为主锚点，pageIndex 只是兜底。
 */
export const PagedView = memo(
  forwardRef<PagedHandle, Props>(function PagedView(
    {
      book,
      settings,
      initialBlockId,
      initialPage,
      initialChapterId,
      enabled,
      blockChars,
      totalChars,
      onPageChange,
      children,
    },
    ref
  ) {
    const clipRef = useRef<HTMLDivElement>(null);
    const flowRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [pos, setPos] = useState({ page: 0, total: 0 });

    const readyRef = useRef(false);
    const widthRef = useRef(0);
    const totalRef = useRef(0);
    const pageRef = useRef(0);
    const anchorRef = useRef<Anchor | null>(null);
    const initialsRef = useRef({ blockId: initialBlockId, page: initialPage, chapterId: initialChapterId });
    const pendingRef = useRef<PendingJump | null>(null);

    const bookRef = useRef(book);
    const blockCharsRef = useRef(blockChars);
    const totalCharsRef = useRef(totalChars);
    const onPageChangeRef = useRef(onPageChange);
    const enabledRef = useRef(enabled);

    bookRef.current = book;
    blockCharsRef.current = blockChars;
    totalCharsRef.current = totalChars;
    onPageChangeRef.current = onPageChange;
    enabledRef.current = enabled;

    const syncingRef = useRef(false);
    const reportRafRef = useRef(0);
    const flashTimerRef = useRef(0);
    const layoutTimerRef = useRef(0);
    const lastReportRef = useRef('');

    // ── 位置测量 ──

    const pageOfElement = useCallback((el: Element | null): number | null => {
      const flow = flowRef.current;
      const w = widthRef.current;
      if (!flow || !el || w <= 0) return null;
      const fr = flow.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const page = Math.floor((r.left - fr.left) / w + 0.01);
      return clamp(page, 0, Math.max(0, totalRef.current - 1));
    }, []);

    const pageOfBlock = useCallback(
      (blockId: string): number | null => pageOfElement(document.getElementById(blockId)),
      [pageOfElement]
    );

    /** 当前页左上角那一行属于哪个 block；caret 命不中时退化为按列位置扫描。 */
    const resolveAnchor = useCallback((): Anchor => {
      const clip = clipRef.current;
      const flow = flowRef.current;
      const book = bookRef.current;
      const w = widthRef.current;
      const empty: Anchor = { chapterId: '', blockId: '' };
      if (!clip || !flow || !book || w <= 0) return empty;

      const cr = clip.getBoundingClientRect();
      const cs = getComputedStyle(flow);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const x = cr.left + cr.width / 2;
      const y = cr.top + padTop + 12;

      const doc = document as CaretDocument;
      const range = doc.caretRangeFromPoint?.(x, y) ?? null;
      let el: Element | null = null;
      if (range) {
        const node = range.startContainer;
        el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        while (
          el &&
          !el.hasAttribute('data-block-id') &&
          !el.hasAttribute('data-chapter-id')
        ) {
          el = el.parentElement;
        }
      }

      const page = pageRef.current;
      let caret: Anchor | null = null;

      if (el) {
        const blockEl = el.closest('[data-block-id]');
        if (blockEl) {
          const blockId = blockEl.getAttribute('data-block-id') ?? '';
          const chapterId =
            blockEl.closest('[data-chapter-id]')?.getAttribute('data-chapter-id') ??
            blockId.split('#')[0];
          caret = { chapterId, blockId };
        } else {
          const chapterEl = el.closest('[data-chapter-id]');
          if (chapterEl) {
            const chapterId = chapterEl.getAttribute('data-chapter-id') ?? '';
            const first = book.chapters.find((c) => c.id === chapterId)?.blocks[0]?.id;
            caret = { chapterId, blockId: first ?? `${chapterId}#0` };
          }
        }
      }

      // caret 已经落在“从本页开始”的段落上，就是最精确的锚点
      if (caret?.blockId && pageOfBlock(caret.blockId) === page) return caret;

      // 否则找本页第一个从本页开始的 block：这样翻页/切模式都不会退回上一页
      const fr = flow.getBoundingClientRect();
      let continuing: Anchor | null = null;
      let firstOnPage: Anchor | null = null;
      let firstBlock: Anchor | null = null;
      const blocks = flow.querySelectorAll<HTMLElement>('[data-block-id]');
      for (let i = 0; i < blocks.length; i++) {
        const node = blocks[i];
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const start = Math.floor((r.left - fr.left) / w + 0.01);
        const end = Math.max(start, Math.ceil((r.right - fr.left) / w - 0.01) - 1);
        const blockId = node.dataset.blockId ?? '';
        if (!blockId) continue;
        const info: Anchor = {
          blockId,
          chapterId:
            node.closest('[data-chapter-id]')?.getAttribute('data-chapter-id') ??
            blockId.split('#')[0],
        };
        if (!firstBlock) firstBlock = info;
        if (!continuing && start < page && end >= page) continuing = info;
        if (start === page && !firstOnPage) firstOnPage = info;
        if (firstOnPage && continuing) break;
      }
      return firstOnPage ?? caret ?? continuing ?? firstBlock ?? empty;
    }, [pageOfBlock]);

    const report = useCallback(() => {
      if (!readyRef.current) return;
      const anchor = resolveAnchor();
      // 章节标题块不在字数索引里（blocks 只收正文段），当锚点正好落在标题上时
      // 查不到累计字数，会让全书进度变成 0%。此时按页码比例兜底。
      const base = blockCharsRef.current.get(anchor.blockId);
      const byPage = totalRef.current > 1 ? (pageRef.current - 1) / totalRef.current : 0;
      const chars = base && base > 0 ? base : byPage * totalCharsRef.current;
      const ratio = totalCharsRef.current ? Math.min(1, chars / totalCharsRef.current) : 0;
      const sig = `${pageRef.current}|${totalRef.current}|${anchor.blockId}`;
      if (sig === lastReportRef.current) return;
      lastReportRef.current = sig;
      if (anchor.blockId) anchorRef.current = anchor;
      onPageChangeRef.current({
        page: pageRef.current,
        total: totalRef.current,
        chapterId: anchor.chapterId,
        blockId: anchor.blockId,
        ratio,
      });
    }, [resolveAnchor]);

    const scheduleReport = useCallback(() => {
      cancelAnimationFrame(reportRafRef.current);
      reportRafRef.current = requestAnimationFrame(() => {
        cancelAnimationFrame(reportRafRef.current);
        reportRafRef.current = requestAnimationFrame(report);
      });
    }, [report]);

    const flashPage = useCallback(() => {
      const clip = clipRef.current;
      if (!clip) return;
      clip.classList.remove('page-turn');
      // 强制重排，让同一动画能连续触发
      void clip.offsetWidth;
      clip.classList.add('page-turn');
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => clip.classList.remove('page-turn'), 220);
    }, []);

    const applyPage = useCallback(
      (page: number, animate = true) => {
        const clip = clipRef.current;
        if (!clip) return;
        const total = Math.max(1, totalRef.current);
        const next = clamp(Math.round(page), 0, total - 1);
        const changed = next !== pageRef.current;
        pageRef.current = next;
        setPos((prev) =>
          prev.page === next && prev.total === total ? prev : { page: next, total }
        );
        syncingRef.current = true;
        clip.scrollLeft = next * widthRef.current;
        requestAnimationFrame(() => {
          syncingRef.current = false;
        });
        if (animate && changed) flashPage();
        if (changed || animate) scheduleReport();
      },
      [flashPage, scheduleReport]
    );

    // ── 排版 ──

    const breathe = useCallback((blockId?: string, chapterId?: string) => {
      const el = blockId
        ? document.getElementById(blockId)
        : chapterId
          ? document.getElementById(`ch-${chapterId}`)
          : null;
      if (!el) return;
      el.classList.add('breathe');
      window.setTimeout(() => el.classList.remove('breathe'), 1700);
    }, []);

    const layout = useCallback(
      (opts?: { keepAnchor?: boolean; initial?: boolean }) => {
        const clip = clipRef.current;
        const flow = flowRef.current;
        if (!clip || !flow) return;
        // 必须用带小数的实际宽度：clientWidth 会取整，翻到后面会累计错位
        const w = clip.getBoundingClientRect().width;
        if (w <= 0) return;

        widthRef.current = w;
        const col = `${w}px`;
        if (flow.style.columnWidth !== col) flow.style.columnWidth = col;

        // 图片上限按当前页内容高度算，保证图片 + 图注能落在同一页
        const cs = getComputedStyle(flow);
        const contentH =
          clip.getBoundingClientRect().height -
          (parseFloat(cs.paddingTop) || 0) -
          (parseFloat(cs.paddingBottom) || 0);
        flow.style.setProperty('--page-media-max', `${Math.max(160, Math.round(contentH * 0.6))}px`);

        // 强制浏览器按新列宽完成一次布局
        const scrollWidth = flow.scrollWidth;
        let total = Math.max(1, Math.round(scrollWidth / w));

        // 多列布局偶尔会因尾部 margin 多出一列空白，按内容右缘裁掉
        if (total > 1) {
          const fr = flow.getBoundingClientRect();
          let maxRight = 0;
          const nodes = flow.querySelectorAll<HTMLElement>(
            '[data-block-id], .chapter-title, .chapter-end, .blk-hr'
          );
          for (let i = 0; i < nodes.length; i++) {
            const r = nodes[i].getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const right = r.right - fr.left;
            if (right > maxRight) maxRight = right;
          }
          const contentPages = Math.max(1, Math.ceil((maxRight - 1) / w));
          if (contentPages < total) total = contentPages;
        }

        totalRef.current = total;

        let target = pageRef.current;
        if (opts?.initial) {
          const init = initialsRef.current;
          const byBlock = init.blockId ? pageOfBlock(init.blockId) : null;
          const byChapter = init.chapterId
            ? pageOfElement(document.getElementById(`ch-${init.chapterId}`))
            : null;
          target =
            byBlock ??
            (typeof init.page === 'number' ? clamp(init.page, 0, total - 1) : null) ??
            byChapter ??
            0;
        } else if (opts?.keepAnchor && anchorRef.current?.blockId) {
          target = pageOfBlock(anchorRef.current.blockId) ?? target;
        } else if (opts?.keepAnchor) {
          target = pageRef.current;
        }

        const pending = pendingRef.current;
        if (pending) {
          pendingRef.current = null;
          const pBlock = pending.blockId ? pageOfBlock(pending.blockId) : null;
          const pChapter = pending.chapterId
            ? pageOfElement(document.getElementById(`ch-${pending.chapterId}`))
            : null;
          const p = pBlock ?? pChapter;
          if (p != null) {
            target = p;
            if (pending.breathe) breathe(pending.blockId, pending.chapterId);
          }
        }

        pageRef.current = clamp(target, 0, total - 1);
        const wasReady = readyRef.current;
        if (!wasReady) readyRef.current = true;
        applyPage(pageRef.current, false);
        setPos({ page: pageRef.current, total });
        lastReportRef.current = '';
        scheduleReport();
        if (!wasReady) setReady(true);
      },
      [applyPage, breathe, pageOfBlock, pageOfElement, scheduleReport]
    );

    // ── 首次排版：等字体就绪，避免先按 fallback 字体排一遍再跳 ──

    useLayoutEffect(() => {
      let cancelled = false;
      let raf = 0;
      const run = () => {
        if (cancelled) return;
        raf = requestAnimationFrame(() => {
          if (!cancelled) layout({ initial: true });
        });
      };
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.ready.then(run).catch(run);
      } else {
        run();
      }
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }, [book.meta.id, layout]);

    // 字号 / 行距 / 版心 / 字体变化 → 保住当前段，重新分页
    useLayoutEffect(() => {
      if (!readyRef.current) return;
      const t = window.setTimeout(() => layout({ keepAnchor: true }), 60);
      return () => window.clearTimeout(t);
    }, [
      settings.fontSize,
      settings.lineHeight,
      settings.measure,
      settings.fontFamily,
      settings.letterSpacing,
      settings.paraGap,
      settings.indent,
      layout,
    ]);

    // 窗口尺寸变化 → 防抖重排
    useEffect(() => {
      const clip = clipRef.current;
      if (!clip) return;
      const ro = new ResizeObserver(() => {
        if (!readyRef.current) return;
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = window.setTimeout(() => layout({ keepAnchor: true }), 130);
      });
      ro.observe(clip);
      return () => {
        ro.disconnect();
        window.clearTimeout(layoutTimerRef.current);
      };
    }, [layout]);

    // 图片加载完成会改变列高，重新分页并保住当前段
    useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return;
      let timer = 0;
      const onLoad = (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (!target || target.tagName !== 'IMG') return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => layout({ keepAnchor: true }), 80);
      };
      flow.addEventListener('load', onLoad, true);
      return () => {
        flow.removeEventListener('load', onLoad, true);
        window.clearTimeout(timer);
      };
    }, [layout]);

    // 选区拖动到页边时浏览器可能自己滚，把状态追回来
    useEffect(() => {
      const clip = clipRef.current;
      if (!clip) return;
      const onScroll = () => {
        if (syncingRef.current || !readyRef.current) return;
        const w = widthRef.current;
        if (w <= 0) return;
        const p = clamp(Math.round(clip.scrollLeft / w), 0, Math.max(0, totalRef.current - 1));
        if (p === pageRef.current) return;
        pageRef.current = p;
        setPos((prev) =>
          prev.page === p && prev.total === totalRef.current
            ? prev
            : { page: p, total: totalRef.current }
        );
        scheduleReport();
      };
      clip.addEventListener('scroll', onScroll, { passive: true });
      return () => clip.removeEventListener('scroll', onScroll);
    }, [scheduleReport]);

    // 滚轮 / 触控板翻页
    useEffect(() => {
      const el = clipRef.current;
      if (!el) return;
      let acc = 0;
      let lastAt = 0;
      let lastFlip = 0;
      const onWheel = (e: WheelEvent) => {
        if (!enabledRef.current || e.ctrlKey) return;
        let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        if (e.deltaMode === 1) delta *= 24;
        else if (e.deltaMode === 2) delta *= el.clientHeight;

        e.preventDefault();
        const now = performance.now();
        if (now - lastAt > 260) acc = 0;
        lastAt = now;
        acc += delta;
        if (Math.abs(acc) >= 32 && now - lastFlip > 240) {
          const dir = acc > 0 ? 1 : -1;
          acc = 0;
          lastFlip = now;
          applyPage(pageRef.current + dir, true);
        }
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [applyPage]);

    useImperativeHandle(
      ref,
      () => ({
        next: () => applyPage(pageRef.current + 1, true),
        prev: () => applyPage(pageRef.current - 1, true),
        goToPage: (page, animate = true) => applyPage(page, animate),
        goToBlock: (chapterId, blockId, opts) => {
          if (!readyRef.current) {
            pendingRef.current = { chapterId, blockId, breathe: opts?.breathe };
            return;
          }
          const target =
            (blockId ? pageOfBlock(blockId) : null) ??
            pageOfElement(document.getElementById(`ch-${chapterId}`)) ??
            0;
          applyPage(target, opts?.animate ?? true);
          if (opts?.breathe) breathe(blockId, chapterId);
        },
        getPosition: () => ({ page: pageRef.current, total: totalRef.current }),
        isBlockOnPage: (blockId) => {
          const flow = flowRef.current;
          const el = document.getElementById(blockId);
          const w = widthRef.current;
          if (!flow || !el || w <= 0) return false;
          const fr = flow.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const start = Math.floor((r.left - fr.left) / w + 0.01);
          const end = Math.max(start, Math.ceil((r.right - fr.left) / w - 0.01) - 1);
          return pageRef.current >= start && pageRef.current <= end;
        },
        relayout: () => layout({ keepAnchor: true }),
      }),
      [applyPage, breathe, layout, pageOfBlock, pageOfElement]
    );

    useEffect(
      () => () => {
        cancelAnimationFrame(reportRafRef.current);
        window.clearTimeout(flashTimerRef.current);
        window.clearTimeout(layoutTimerRef.current);
      },
      []
    );

    return (
      <div className="reader-paged" aria-label="正文">
        <div
          className={`reader-page-clip${ready ? ' is-ready' : ''}`}
          ref={clipRef}
          tabIndex={-1}
        >
          <div ref={flowRef} className="reader-page-flow reader-body">
            {children}
          </div>
        </div>

        {/* 末页的「全书完」放在页面下留白里，不进入正文流，避免多出一张空白页 */}
        {ready && pos.total > 0 && pos.page === pos.total - 1 && (
          <div className="reader-the-end" aria-hidden="true">
            全书完 · 共 {(book.meta.totalChars / 10000).toFixed(1)} 万字
          </div>
        )}
      </div>
    );
  })
);
