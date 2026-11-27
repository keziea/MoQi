import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Block, Chapter, HighlightColor, Note, PageMode, TextRange, VocabEntry } from '@shared/models';
import { useReader } from '@/store/useReader';
import { ipc } from '@/lib/ipc';
import { splitSentences, type Sentence } from '@/lib/sentences';
import { useSettings } from '@/store/useSettings';
import { useLibrary } from '@/store/useLibrary';
import { useStats } from '@/store/useStats';
import { rangesByBlock, selectionToRanges } from '@/lib/anchor';
import { flushReaderProgress } from '@/store/useReader';
import { toast } from '@/lib/toast';
import { Icon } from '@/components/ui/Icon';
import { TopBar } from '@/components/reader/TopBar';
import { BottomBar } from '@/components/reader/BottomBar';
import { ChapterView } from '@/components/reader/ChapterView';
import { PagedView, type PagedHandle, type PageInfo } from '@/components/reader/PagedView';
import { ResumeChip } from '@/components/reader/ResumeChip';
import { SelectionToolbar } from '@/components/reader/SelectionToolbar';
import { NoteEditor } from '@/components/reader/NoteEditor';
import { TocPanel } from '@/components/reader/TocPanel';
import { NotesPanel } from '@/components/reader/NotesPanel';
import { StatsPanel } from '@/components/reader/StatsPanel';
import { SettingsPanel } from '@/components/reader/SettingsPanel';
import { SearchPanel } from '@/components/reader/SearchPanel';
import { ParaDock } from '@/components/reader/ParaDock';
import { DictCard, type DictAnchor } from '@/components/reader/DictCard';
import { NoteScopeDialog } from '@/components/reader/NoteScopeDialog';
import { briefOf, lookupChar, lookupWord, preloadDict, readingOf, type LookupResult } from '@/lib/dict';
import { hitCharAt } from '@/lib/textHit';
import { FinishedCelebration, type FinishedSummary } from '@/components/workspace/FinishedCelebration';
import { NavRail } from '@/components/reader/NavRail';
import { buildTocTree, findActiveToc, type TocNode } from '@/lib/toc';
import type { OpenTarget } from '@/lib/workspace';

interface Props {
  bookId: string;
  onBack: () => void;
  /** 从工作台笔记点进来时，直接定位到那条笔记。 */
  openTarget?: OpenTarget | null;
}

// 调试用：暴露 store 供自动化检查
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__moqiReader = useReader;
}

interface OffsetEntry {
  id: string;
  chapterId: string;
  top: number;
}

interface PendingSelection {
  ranges: TextRange[];
  text: string;
  rect: DOMRect | null;
}

export function Reader({ bookId, onBack, openTarget }: Props) {
  const book = useReader((s) => s.book);
  const loading = useReader((s) => s.loading);
  const error = useReader((s) => s.error);
  const notes = useReader((s) => s.notes);
  const panel = useReader((s) => s.panel);
  const setPanel = useReader((s) => s.setPanel);
  const locate = useReader((s) => s.locate);
  const markBlockId = useReader((s) => s.progress?.mark?.blockId ?? null);
  const mark = useReader((s) => s.progress?.mark);
  const progress = useReader((s) => s.progress);
  const ratio = useReader((s) => s.progress?.ratio ?? 0);

  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const isPaged = settings.pageMode === 'paged';

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pagedRef = useRef<PagedHandle>(null);
  const offsetsRef = useRef<OffsetEntry[]>([]);
  const rafRef = useRef(0);
  const restoredRef = useRef(false);
  const activeChapterRef = useRef<string | null>(null);
  const lastToolbarClose = useRef(0);
  const lastPageRef = useRef(-1);
  const openTargetRef = useRef<string | null>(null);

  const [scrolled, setScrolled] = useState(false);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number }>({ page: 0, total: 0 });
  const [navOpen, setNavOpen] = useState(false);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dock, setDock] = useState<{ block: Block; chapter: Chapter } | null>(null);
  const [lens, setLens] = useState<{ blockId: string; chapterTitle: string } | null>(null);
  const [card, setCard] = useState<{
    key: string;
    kind: 'char' | 'word';
    blockId: string;
    chapterTitle: string;
    anchor: DictAnchor;
    charRect: DOMRect | null;
  } | null>(null);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);
  const lookupSeq = useRef(0);
  const lastLookupRef = useRef<{
    kind: 'char' | 'word';
    key: string;
    blockId: string;
    chapterTitle: string;
    charRect: DOMRect | null;
  } | null>(null);
  const [scope, setScope] = useState<{ block: Block; chapter: Chapter } | null>(null);
  const [finishHint, setFinishHint] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishSummary, setFinishSummary] = useState<FinishedSummary | null>(null);
  const [editor, setEditor] = useState<{
    open: boolean;
    noteId?: string;
    quote: string;
    comment: string;
    color: HighlightColor;
    ranges: TextRange[];
    chapterId: string;
    chapterTitle: string;
    kind: 'selection' | 'paragraph';
    category?: string;
    title?: string;
  } | null>(null);

  // ── 打开 / 关闭 ──
  useEffect(() => {
    restoredRef.current = false;
    activeChapterRef.current = null;
    useReader.getState().open(bookId);
    return () => {
      useReader.getState().close();
      flushReaderProgress();
      useLibrary.getState().refreshProgress();
    };
  }, [bookId]);

  // ── 初始化位置 ──
  useEffect(() => {
    const st = useReader.getState();
    if (!st.progress) return;
    setActiveChapterId(st.progress.chapterId);
    activeChapterRef.current = st.progress.chapterId;
  }, [book]);

  // ── 从工作台笔记定位 ──
  useEffect(() => {
    if (!book || !openTarget) return;
    const key = `${book.meta.id}:${openTarget.chapterId}:${openTarget.blockId ?? ''}`;
    if (openTargetRef.current === key) return;
    openTargetRef.current = key;
    const timer = window.setTimeout(() => {
      useReader.getState().jumpTo(openTarget.chapterId, openTarget.blockId, true);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [book, openTarget]);

  // ── 首次进入的引导 ──
  useEffect(() => {
    if (!book) return;
    try {
      if (localStorage.getItem('moqi:hinted-v1')) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      toast('单击任意段落，可以标记「读到此处」', 5200);
      try {
        localStorage.setItem('moqi:hinted-v1', '1');
      } catch {
        /* ignore */
      }
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [book?.meta.id]);

  // ── 计时 ──
  useEffect(() => {
    if (!book) return;
    useStats.getState().start(book.meta.id, book.meta.title);
    return () => {
      useStats.getState().stop();
    };
  }, [book?.meta.id]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) useStats.getState().pause(false);
      else useStats.getState().resume(false);
    };
    const onBlur = () => useStats.getState().pause(false);
    const onFocus = () => useStats.getState().resume(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // ── 字数索引 ──
  const { blockChars, totalChars } = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    if (book) {
      book.chapters.forEach((ch) => {
        for (const b of ch.blocks) {
          map.set(b.id, acc);
          acc += b.text.length;
        }
      });
    }
    return { blockChars: map, totalChars: acc };
  }, [book]);

  // ── 底栏章节标签：一级章 + 当前节 ──
  const chapterLabel = useMemo(() => {
    if (!book) return '';
    const idx = activeChapterId ? book.chapters.findIndex((c) => c.id === activeChapterId) : 0;
    const cur = book.chapters[idx] ?? book.chapters[0];
    if (!cur) return '';
    let parent: (typeof book.chapters)[number] | null = null;
    for (let i = idx; i >= 0; i--) {
      if (book.chapters[i].level === 1) {
        parent = book.chapters[i];
        break;
      }
    }
    if (!parent || parent.id === cur.id) return cur.title;
    const m = parent.title.match(/^第[一二三四五六七八九十百千0-9]+章/);
    return m ? `${m[0]} · ${cur.title}` : cur.title;
  }, [book, activeChapterId]);

  // ── 目录树：章 → 节 → 小节，按当前 block 定位 ──
  const tocTree = useMemo(() => (book ? buildTocTree(book) : null), [book]);
  const activeToc = useMemo(
    () => (tocTree ? findActiveToc(tocTree, progress) : null),
    [tocTree, progress]
  );

  // ── 分页翻页后：更新进度与当前章 ──
  const handlePageChange = useCallback((info: PageInfo) => {
    setPageInfo((prev) =>
      prev.page === info.page && prev.total === info.total ? prev : { page: info.page, total: info.total }
    );
    // 翻页 / 重排换页时，段落坞与字词卡都失效
    if (info.page !== lastPageRef.current) {
      lastPageRef.current = info.page;
      setDock(null);
      setLens(null);
      setCard(null);
    }
    if (!info.blockId) return;
    useReader.getState().patchProgress({
      chapterId: info.chapterId,
      blockId: info.blockId,
      delta: 0,
      ratio: info.ratio,
      pageIndex: info.page,
    });
    if (info.chapterId && info.chapterId !== activeChapterRef.current) {
      activeChapterRef.current = info.chapterId;
      setActiveChapterId(info.chapterId);
    }
  }, []);

  const prevPage = useCallback(() => pagedRef.current?.prev(), []);
  const nextPage = useCallback(() => pagedRef.current?.next(), []);

  const closeNavOnNarrow = useCallback(() => {
    if (window.innerWidth < 1180) setNavOpen(false);
  }, []);

  const jumpToc = useCallback(
    (node: TocNode) => {
      useReader.getState().jumpTo(node.chapterId, node.blockId, true);
      closeNavOnNarrow();
    },
    [closeNavOnNarrow]
  );

  const jumpNote = useCallback(
    (note: Note) => {
      setPanel(null);
      useReader.getState().jumpTo(note.chapterId, note.ranges[0]?.blockId, true);
      closeNavOnNarrow();
    },
    [closeNavOnNarrow, setPanel]
  );

  const composeNote = useCallback(() => {
    if (!book) return;
    const cur = useReader.getState().progress;
    const chapter = book.chapters.find((c) => c.id === cur?.chapterId) ?? book.chapters[0];
    if (!chapter) return;
    // 章节起点常常落在标题上；写整段笔记时优先取标题后的第一个正文段落。
    const currentIndex = chapter.blocks.findIndex((b) => b.id === cur?.blockId);
    const near = currentIndex >= 0 ? chapter.blocks.slice(currentIndex) : chapter.blocks;
    const block =
      near.find((b) => b.type === 'p' && b.text.trim()) ??
      near.find((b) => b.type === 'quote' && b.text.trim()) ??
      near.find((b) => b.text.trim()) ??
      chapter.blocks.find((b) => b.text.trim());
    if (!block) {
      toast('这一页没有可以摘录的文字');
      return;
    }
    const end = block.text.length;
    setEditor({
      open: true,
      quote: block.text,
      comment: '',
      color: 'clay',
      ranges: [{ blockId: block.id, start: 0, end }],
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      kind: 'paragraph',
    });
    setPanel(null);
    setNavOpen(false);
    setDock(null);
    setLens(null);
    setCard(null);
  }, [book]);

  const setPageMode = useCallback(
    (mode: PageMode) => {
      update({ pageMode: mode });
    },
    [update]
  );

  // ── 位置测量 ──
  const measure = useCallback(() => {
    const container = scrollRef.current;
    const body = bodyRef.current;
    if (!container || !body) return;
    const cRect = container.getBoundingClientRect();
    const st = container.scrollTop;
    const els = body.querySelectorAll<HTMLElement>('[data-block-id]');
    const arr: OffsetEntry[] = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const r = el.getBoundingClientRect();
      arr.push({
        id: el.dataset.blockId!,
        chapterId: el.closest('[data-chapter-id]')?.getAttribute('data-chapter-id') ?? '',
        top: r.top - cRect.top + st,
      });
    }
    offsetsRef.current = arr;
  }, []);

  useLayoutEffect(() => {
    if (!book) return;
    if (isPaged) {
      restoredRef.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => {
      measure();
      if (restoredRef.current) return;
      restoredRef.current = true;
      const p = useReader.getState().progress;
      const container = scrollRef.current;
      if (!container) return;
      if (p?.blockId) {
        const el = document.getElementById(p.blockId);
        if (el) {
          const cRect = container.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const top = r.top - cRect.top + container.scrollTop;
          container.scrollTop = Math.max(0, top - (p.delta ?? 0));
          return;
        }
      }
      container.scrollTop = 0;
    });

    const ro = new ResizeObserver(() => measure());
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [book, measure, isPaged]);

  // 字号/版心变化 → 重新测量并保持位置
  useLayoutEffect(() => {
    if (!book || isPaged) return;
    const container = scrollRef.current;
    if (!container) return;
    const p = useReader.getState().progress;
    const anchorId = p?.blockId;
    const anchorDelta = p?.delta ?? 0;
    const raf = requestAnimationFrame(() => {
      measure();
      if (!anchorId) return;
      const el = document.getElementById(anchorId);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = r.top - cRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, top - anchorDelta);
    });
    return () => cancelAnimationFrame(raf);
  }, [settings.fontSize, settings.lineHeight, settings.measure, settings.fontFamily, settings.indent, settings.letterSpacing, settings.paraGap, measure, book, isPaged]);

  // 窗口尺寸变化 → 重排后把用户所在段落拉回原处
  useEffect(() => {
    if (isPaged) return;
    let timer: number | null = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const container = scrollRef.current;
        const st = useReader.getState().progress;
        if (!container || !st?.blockId) {
          measure();
          return;
        }
        measure();
        const el = document.getElementById(st.blockId);
        if (!el) return;
        const cRect = container.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const top = r.top - cRect.top + container.scrollTop;
        container.scrollTop = Math.max(0, top - (st.delta ?? 0));
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, [measure, isPaged]);

  // ── 滚动 ──
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    const arr = offsetsRef.current;
    if (!container || arr.length === 0) return;

    const st = container.scrollTop;
    setScrolled(st > 40);
    useStats.getState().markActivity();

    let lo = 0;
    let hi = arr.length - 1;
    let idx = 0;
    const probe = st + 88;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].top <= probe) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const cur = arr[idx];
    if (!cur) return;

    if (cur.chapterId !== activeChapterRef.current) {
      activeChapterRef.current = cur.chapterId;
      setActiveChapterId(cur.chapterId);
    }

    const chars = blockChars.get(cur.id) ?? 0;
    useReader.getState().patchProgress({
      chapterId: cur.chapterId,
      blockId: cur.id,
      delta: cur.top - st,
      ratio: totalChars ? Math.max(0, Math.min(1, chars / totalChars)) : 0,
    });
  }, [blockChars, totalChars]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      handleScroll();
    });
  }, [handleScroll]);

  // ── 跳转 ──
  useEffect(() => {
    if (!locate) return;
    if (isPaged) {
      pagedRef.current?.goToBlock(locate.chapterId, locate.blockId, {
        breathe: locate.breathe,
        animate: true,
      });
      if (locate.chapterId !== activeChapterRef.current) {
        activeChapterRef.current = locate.chapterId;
        setActiveChapterId(locate.chapterId);
      }
      return;
    }
    const container = scrollRef.current;
    if (!container) return;
    const targetId = locate.blockId ?? `ch-${locate.chapterId}`;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = r.top - cRect.top + container.scrollTop - 76;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      if (locate.breathe) {
        el.classList.add('breathe');
        window.setTimeout(() => el.classList.remove('breathe'), 1700);
      }
      if (locate.chapterId !== activeChapterRef.current) {
        activeChapterRef.current = locate.chapterId;
        setActiveChapterId(locate.chapterId);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [locate?.nonce, isPaged]);

  // ── 选区 ──
  useEffect(() => {
    // 分页模式的正文根节点也要挂到 bodyRef：划词范围提取依赖它
    if (!isPaged) return;
    bodyRef.current = document.querySelector<HTMLDivElement>('.reader-page-flow');
  }, [isPaged, book?.meta.id]);

  useEffect(() => {
    const onSelChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.toString().trim()) {
        setSelection(null);
        return;
      }
      const res = selectionToRanges(s, bodyRef.current);
      if (res) setSelection({ ranges: res.ranges, text: res.text, rect: res.rect });
      else setSelection(null);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  // ── 点击段落标记 ──
  /** 把某一段设为「读到此处」 */
  const markHere = useCallback(
    (block: Block, chapter: Chapter) => {
      const st = useReader.getState();
      if (st.progress?.mark?.blockId === block.id) {
        st.clearMark();
        toast('已取消标记');
        return;
      }
      const chars = blockChars.get(block.id) ?? 0;
      st.setMark({
        chapterId: chapter.id,
        blockId: block.id,
        excerpt: block.text.slice(0, 40),
        createdAt: Date.now(),
        ratio: totalChars ? chars / totalChars : 0,
      });
      toast('已标记 · 下次从这里读');
    },
    [blockChars, totalChars]
  );

  /** 关掉段落坞、查字态与字典卡 */
  const closeDock = useCallback(() => {
    setDock(null);
    setLens(null);
    setCard(null);
    lookupSeq.current += 1;
  }, []);

  /** 打开字词卡：先定位到正文栏外侧，再异步取词条 */
  const openLookup = useCallback(
    async (
      kind: 'char' | 'word',
      key: string,
      blockId: string,
      charRect: DOMRect | null,
      chapterTitle: string,
      anchorOverride?: DictAnchor
    ) => {
      const el = document.getElementById(blockId);
      if (!el) return;

      const blockW = el.offsetWidth || el.getBoundingClientRect().width;
      const clip = document.querySelector<HTMLElement>('.reader-page-clip');
      let column = { left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right };
      if (clip && blockW > 0) {
        const cr = clip.getBoundingClientRect();
        const left = cr.left + (cr.width - blockW) / 2;
        column = { left, right: left + blockW };
      }

      const anchor =
        anchorOverride ?? {
          charTop: charRect?.top ?? el.getBoundingClientRect().top,
          charX: charRect
            ? charRect.left + charRect.width / 2
            : column.left + (column.right - column.left) / 2,
          column,
        };

      lastLookupRef.current = { kind, key, blockId, chapterTitle, charRect };
      setCard({ key, kind, blockId, chapterTitle, anchor, charRect });
      setDictError(null);
      setLookup(null);
      setDictLoading(true);

      preloadDict();
      const seq = ++lookupSeq.current;
      try {
        if (kind === 'char') {
          const entry = await lookupChar(key);
          if (seq !== lookupSeq.current) return;
          if (entry) setLookup({ kind: 'char', char: entry });
          else setDictError('这个字暂未收录。');
        } else {
          const entry = await lookupWord(key);
          if (seq !== lookupSeq.current) return;
          setLookup({ kind: 'word', word: entry });
        }
      } catch (err) {
        if (seq !== lookupSeq.current) return;
        setDictError(err instanceof Error ? err.message : '字词库读取失败');
      } finally {
        if (seq === lookupSeq.current) setDictLoading(false);
      }
    },
    []
  );

  /** 点段落：只打开固定位置的操作坞，不再跟着点击点上下翻 */
  const onBlockClick = useCallback(
    (block: Block, chapter: Chapter, _rect: DOMRect) => {
      if (!settings.clickToMark) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (Date.now() - lastToolbarClose.current < 300) return;
      setScope(null);
      setLens(null);
      setCard(null);
      setDock({ block, chapter });
    },
    [settings.clickToMark]
  );

  /** 打开「记笔记」：先选范围（整段 / 某几句） */
  const openScope = useCallback((block: Block, chapter: Chapter) => {
    setDock(null);
    setLens(null);
    setCard(null);
    setScope({ block, chapter });
  }, []);

  /** 进入 / 退出查字态 */
  const toggleLens = useCallback(() => {
    if (!dock) return;
    if (lens?.blockId === dock.block.id) {
      setLens(null);
      setCard(null);
      return;
    }
    preloadDict();
    setLens({ blockId: dock.block.id, chapterTitle: dock.chapter.title });
    toast('点这一段里的任意一个字，查看拼音、释义和组词', 4200);
  }, [dock, lens]);

  /** 查字态里点字 */
  const onCharClick = useCallback(
    (block: Block, e: React.MouseEvent) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const hit = hitCharAt(e.clientX, e.clientY);
      if (!hit) {
        toast('没有点到字，再试一次');
        return;
      }
      void openLookup('char', hit.char, block.id, hit.rect, lens?.chapterTitle ?? '');
    },
    [lens?.chapterTitle, openLookup]
  );

  /** 划词查词：1 个字查字，多个字查词 */
  const lookupFromSelection = useCallback(() => {
    if (!selection || !book) return;
    // 去掉标点与空白，只取第一段连续的汉字
    const run = selection.text.match(/\p{Script=Han}+/u)?.[0] ?? '';
    const chars = [...run];
    if (chars.length === 0) {
      toast('选中的内容里没有汉字');
      return;
    }
    if (chars.length > 8) {
      toast('一次最多查 8 个字');
      return;
    }
    const blockId = selection.ranges[0].blockId;
    const chapter = book.chapters.find((c) => c.id === blockId.split('#')[0]);
    const rect = selection.rect;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    lastToolbarClose.current = Date.now();
    void openLookup(
      chars.length > 1 ? 'word' : 'char',
      chars.join(''),
      blockId,
      rect,
      chapter?.title ?? ''
    );
  }, [selection, book, openLookup]);

  const vocab = settings.vocab ?? [];
  const currentTerm = lookup ? (lookup.kind === 'char' ? lookup.char.char : lookup.word.word) : '';
  const savedTerm = vocab.some((v) => v.term === currentTerm);

  const toggleSave = useCallback(() => {
    if (!lookup) return;
    const term = lookup.kind === 'char' ? lookup.char.char : lookup.word.word;
    const exists = vocab.some((v) => v.term === term);
    const next = exists
      ? vocab.filter((v) => v.term !== term)
      : [
          {
            term,
            pinyin: readingOf(lookup),
            brief: briefOf(lookup),
            at: Date.now(),
            kind: lookup.kind,
          },
          ...vocab,
        ].slice(0, 200);
    update({ vocab: next });
    toast(exists ? `已从生字本移除「${term}」` : `已收进生字本「${term}」`);
  }, [lookup, vocab, update]);

  const removeVocab = useCallback(
    (term: string) => {
      update({ vocab: vocab.filter((v) => v.term !== term) });
    },
    [vocab, update]
  );

  const pickVocab = useCallback(
    (v: VocabEntry) => {
      if (!card) return;
      void openLookup(v.kind, v.term, card.blockId, null, card.chapterTitle, card.anchor);
    },
    [card, openLookup]
  );

  const retryLookup = useCallback(() => {
    const last = lastLookupRef.current;
    if (!last) return;
    void openLookup(last.kind, last.key, last.blockId, last.charRect, last.chapterTitle, card?.anchor);
  }, [card?.anchor, openLookup]);

  const speak = useCallback((text: string) => {
    if (!text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 0.85;
      const voices = window.speechSynthesis?.getVoices() ?? [];
      const zh = voices.find((v) => /^zh|Chinese|中文/i.test(`${v.lang} ${v.name}`));
      if (zh) u.voice = zh;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      toast('这台电脑没有可用的中文语音');
    }
  }, []);

  // ── 笔记 ──
  const rangesMap = useMemo(() => {
    const flat = notes.flatMap((n) =>
      n.ranges.map((r) => ({
        blockId: r.blockId,
        start: r.start,
        end: r.end,
        noteId: n.id,
        color: n.color,
        kind: n.kind,
      }))
    );
    return rangesByBlock(flat);
  }, [notes]);

  const createHighlight = useCallback(
    async (color: HighlightColor, comment = '') => {
      if (!selection || !book) return;
      const chapterId = selection.ranges[0].blockId.split('#')[0];
      const chapter = book.chapters.find((c) => c.id === chapterId);
      const created = await useReader.getState().createNote({
        chapterId,
        chapterTitle: chapter?.title ?? '',
        ranges: selection.ranges,
        text: selection.text,
        comment,
        color,
        kind: 'selection',
      });
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      lastToolbarClose.current = Date.now();
      toast(created ? (comment ? '笔记已保存' : '已高亮') : '保存失败');
    },
    [selection, book]
  );

  const onNoteClick = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      closeDock();
      setEditor({
        open: true,
        noteId: note.id,
        quote: note.text,
        comment: note.comment,
        color: note.color,
        ranges: note.ranges,
        chapterId: note.chapterId,
        chapterTitle: note.chapterTitle,
        kind: note.kind,
        category: note.category,
        title: note.title,
      });
      lastToolbarClose.current = Date.now();
    },
    [notes, closeDock]
  );

  const saveEditor = useCallback(
    async (comment: string, color: HighlightColor, category: string, title: string) => {
      if (!editor) return;
      if (editor.noteId) {
        await useReader.getState().updateNote(editor.noteId, { comment, color, category, title });
        toast('已更新');
      } else {
        const chapter = book?.chapters.find((c) => c.id === editor.chapterId);
        await useReader.getState().createNote({
          chapterId: editor.chapterId,
          chapterTitle: chapter?.title ?? editor.chapterTitle,
          ranges: editor.ranges,
          text: editor.quote,
          comment,
          color,
          kind: editor.kind,
          category,
          title,
        });
        toast('笔记已保存');
      }
      setEditor(null);
      window.getSelection()?.removeAllRanges();
      lastToolbarClose.current = Date.now();
    },
    [editor, book]
  );

  // ── 快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable;

      if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setPanel(panel === 'toc' ? null : 'toc');
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setPanel(panel === 'notes' ? null : 'notes');
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setPanel(panel === 'stats' ? null : 'stats');
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPanel(panel === 'search' ? null : 'search');
        return;
      }
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault();
        setNavOpen((v) => !v);
        return;
      }
      if (typing) return;

      const control = (e.target as HTMLElement | null)?.closest?.('button, [role="slider"]');
      const onSlider = control?.getAttribute('role') === 'slider';

      if (isPaged && !panel && !selection && !onSlider) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          e.preventDefault();
          nextPage();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          prevPage();
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          pagedRef.current?.goToPage(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          pagedRef.current?.goToPage(Number.MAX_SAFE_INTEGER);
          return;
        }
      }

      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        update({ fontSize: Math.min(32, settings.fontSize + 1) });
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        update({ fontSize: Math.max(14, settings.fontSize - 1) });
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        update({ fontSize: 19 });
      } else if (e.key === ' ' && !e.ctrlKey) {
        if (panel || selection || control) return;
        e.preventDefault();
        if (isPaged) {
          if (e.shiftKey) prevPage();
          else nextPage();
          return;
        }
        const c = scrollRef.current;
        if (c) c.scrollBy({ top: e.shiftKey ? -c.clientHeight * 0.86 : c.clientHeight * 0.86, behavior: 'smooth' });
      } else if (e.key === 'Escape') {
        if (card) {
          setCard(null);
          lookupSeq.current += 1;
        } else if (lens) {
          setLens(null);
        } else if (dock) {
          setDock(null);
        } else if (panel) {
          setPanel(null);
        } else if (selection) {
          setSelection(null);
          window.getSelection()?.removeAllRanges();
        } else if (navOpen) {
          setNavOpen(false);
        } else {
          onBack();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const st = useReader.getState();
        const cur = st.progress;
        if (!cur) return;
        if (cur.mark?.blockId === cur.blockId) {
          st.clearMark();
          toast('已取消标记');
        } else if (book) {
          const ch = book.chapters.find((c) => c.id === cur.chapterId);
          const blk = ch?.blocks.find((b) => b.id === cur.blockId);
          if (ch && blk) {
            st.setMark({
              chapterId: ch.id,
              blockId: blk.id,
              excerpt: blk.text.slice(0, 40),
              createdAt: Date.now(),
              ratio: totalChars ? (blockChars.get(blk.id) ?? 0) / totalChars : 0,
            });
            toast('已标记 · 下次从这里读');
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, setPanel, settings.fontSize, update, selection, onBack, book, blockChars, totalChars, isPaged, prevPage, nextPage, navOpen, card, lens, dock]);

  // 读到接近结尾时，提供「标记读完」的入口（不自动判定）
  const ratioNow = useReader((s) => s.progress?.ratio ?? 0);
  const finishedNow = useReader((s) => !!s.progress?.finished);
  useEffect(() => {
    // 已读完的书也保留这条提示，方便在书里直接取消「读完」
    setFinishHint(ratioNow >= 0.96 || finishedNow);
  }, [ratioNow, finishedNow]);

  const markFinished = useCallback(async () => {
    const st = useReader.getState();
    const cur = st.progress;
    if (!cur || !book) return;
    const next = { ...cur, finished: true, finishedAt: Date.now() };
    await ipc.progress.save(next);
    st.patchProgress({ finished: true, finishedAt: Date.now() });
    setFinishHint(false);
    try {
      const summary = await ipc.stats.finishedSummary(book.meta.id);
      setFinishSummary(summary);
    } catch {
      setFinishSummary(null);
    }
    setFinishOpen(true);
  }, [book]);

  /** 取消「已读完」：回到在读，进度保留 */
  const unfinishBook = useCallback(async () => {
    const st = useReader.getState();
    const cur = st.progress;
    if (!cur) return;
    const ratio = Math.min(cur.ratio || 0, 0.98);
    const next = { ...cur, finished: false, finishedAt: undefined, ratio };
    await ipc.progress.save(next);
    st.patchProgress({ finished: false, finishedAt: undefined, ratio });
    setFinishHint(false);
    toast('已取消「读完」，回到在读');
  }, []);

  // ── 打开面板时清空选区与浮层 ──
  useEffect(() => {
    if (panel) {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      closeDock();
    }
  }, [panel, closeDock]);

  // ── 点空白处收走段落坞 / 查字态 / 字典卡 ──
  useEffect(() => {
    if (!dock && !lens && !card) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.para-dock, .dict-card, .dict-ring')) return;
      if (lens) {
        const blockEl = document.getElementById(lens.blockId);
        if (blockEl?.contains(t)) return;
      }
      if (dock) {
        const blockEl = document.getElementById(dock.block.id);
        if (blockEl?.contains(t)) return;
      }
      closeDock();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [dock, lens, card, closeDock]);

  // ── 滚动模式下，滚动即收走浮层（位置不再有效） ──
  useEffect(() => {
    if (isPaged) return;
    if (!dock && !lens && !card) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => closeDock();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isPaged, dock, lens, card, closeDock]);

  const seek = useCallback(
    (r: number) => {
      if (!book) return;
      const target = totalChars * Math.max(0, Math.min(1, r));
      let acc = 0;
      for (const ch of book.chapters) {
        for (const b of ch.blocks) {
          if (acc + b.text.length >= target) {
            useReader.getState().jumpTo(ch.id, b.id, false);
            return;
          }
          acc += b.text.length;
        }
      }
      const last = book.chapters[book.chapters.length - 1];
      const lastBlock = last?.blocks[last.blocks.length - 1];
      if (last) useReader.getState().jumpTo(last.id, lastBlock?.id, false);
    },
    [book, totalChars]
  );

  const isNight = settings.theme === 'night';

  const readerStyle = {
    '--reader-size': `${settings.fontSize}px`,
    '--reader-leading': String(settings.lineHeight),
    '--reader-tracking': `${settings.letterSpacing}em`,
    '--reader-measure': String(settings.measure),
    '--reader-para-gap': `${settings.paraGap}em`,
    '--reader-indent': settings.indent ? '2em' : '0',
    '--reader-font': `var(--font-${settings.fontFamily})`,
  } as React.CSSProperties;

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-reader">
        <div className="relative h-8 w-8">
          <div
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: 'var(--line)' }}
          />
          <div
            className="absolute inset-0 animate-spin rounded-full border-2 border-transparent"
            style={{ borderTopColor: 'var(--accent)', animationDuration: '0.9s' }}
          />
        </div>
        <p className="mt-5 text-[12.5px] text-ink-3">正在打开…</p>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-reader px-8">
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-[16px]"
          style={{ background: 'var(--surface-sunken)', color: 'var(--text-tertiary)' }}
        >
          <Icon name="info" size={24} />
        </div>
        <h2 className="text-[16px] font-medium text-ink">这本书打不开</h2>
        <p className="mt-2.5 max-w-[360px] text-center text-[12.5px] leading-relaxed text-ink-3">
          {error ?? '未知错误'}
        </p>
        <button
          className="mt-7 rounded-[10px] border border-line px-5 py-2 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          onClick={onBack}
        >
          返回首页
        </button>
      </div>
    );
  }

  const initialProgress = useReader.getState().progress;
  const markChapterTitle = mark
    ? book.chapters.find((c) => c.id === mark.chapterId)?.title ?? ''
    : '';
  const markOnPage =
    isPaged && mark ? pagedRef.current?.isBlockOnPage(mark.blockId) ?? false : false;
  const markChip =
    isPaged && mark && !markOnPage
      ? {
          label: `上次标记在《${markChapterTitle}》`,
          onClick: () => useReader.getState().jumpTo(mark.chapterId, mark.blockId, true),
        }
      : null;
  const chapters = book.chapters.map((ch, i) => (
    <ChapterView
      key={ch.id}
      chapter={ch}
      markedBlockId={markBlockId}
      rangesByBlock={rangesMap}
      onBlockClick={onBlockClick}
      onNoteClick={onNoteClick}
      onImageClick={setLightbox}
      focusedBlockId={dock?.block.id ?? null}
      lensBlockId={lens?.blockId ?? null}
      onCharClick={onCharClick}
      isLast={i === book.chapters.length - 1}
      totalChars={book.meta.totalChars}
      paged={isPaged}
    />
  ));

  return (
    <div className="reader-root relative" data-mode={settings.pageMode} style={readerStyle}>
      <TopBar
        book={book}
        panel={panel}
        onBack={onBack}
        onPanel={setPanel}
        onToggleTheme={() => update({ theme: isNight ? 'paper' : 'night' })}
        isNight={isNight}
        scrolled={isPaged ? pageInfo.page > 0 : scrolled}
        autoHide={settings.autoHideBar}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCompose={composeNote}
      />

      {tocTree && (
        <NavRail
          book={book}
          progress={progress}
          notes={notes}
          tree={tocTree}
          activeToc={activeToc}
          open={navOpen}
          mode={settings.pageMode}
          onClose={() => setNavOpen(false)}
          onJump={jumpToc}
          onOpenToc={() => {
            setPanel('toc');
            closeNavOnNarrow();
          }}
          onOpenNotes={() => {
            setPanel('notes');
            closeNavOnNarrow();
          }}
          onCompose={composeNote}
          onJumpNote={jumpNote}
          onPageMode={setPageMode}
          onOpenStats={() => {
            setPanel('stats');
            closeNavOnNarrow();
          }}
        />
      )}

      {isPaged ? (
        <PagedView
          ref={pagedRef}
          book={book}
          settings={settings}
          initialBlockId={initialProgress?.blockId}
          initialPage={initialProgress?.pageIndex}
          initialChapterId={initialProgress?.chapterId}
          enabled={!panel}
          blockChars={blockChars}
          totalChars={totalChars}
          onPageChange={handlePageChange}
        >
          {chapters}
        </PagedView>
      ) : (
        <div ref={scrollRef} className="reader-scroll" onScroll={onScroll} tabIndex={-1}>
          <div className="reader-inner">
            <div
              ref={bodyRef}
              className={`reader-body fade-in${settings.indent ? '' : ' no-indent'}`}
            >
              {chapters}
            </div>
          </div>
        </div>
      )}

      <BottomBar
        mode={settings.pageMode}
        percent={ratio}
        page={pageInfo.page}
        totalPages={pageInfo.total}
        chapterLabel={chapterLabel}
        scrolled={scrolled}
        showTimer={settings.showTimer}
        onSeek={seek}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onOpenStats={() => setPanel('stats')}
        markChip={markChip}
      />

      {!isPaged && (
        <ResumeChip
          mark={mark ?? null}
          chapterTitle={markChapterTitle}
          show={!!mark && mark.blockId !== useReader.getState().progress?.blockId}
          onJump={() => mark && useReader.getState().jumpTo(mark.chapterId, mark.blockId, true)}
        />
      )}

      <AnimatePresence>
        {finishHint && !finishOpen && (
          <motion.div
            className="reader-finish-hint"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          >
            <Icon name="check" size={15} />
            <span>{finishedNow ? '这本书已读完' : '快读完了？'}</span>
            {finishedNow ? (
              <>
                <button type="button" onClick={() => void unfinishBook()}>
                  取消读完
                </button>
                <button
                  type="button"
                  className="reader-finish-dismiss"
                  onClick={() => setFinishHint(false)}
                  aria-label="收起提示"
                >
                  <Icon name="close" size={13} />
                </button>
              </>
            ) : (
              <button type="button" onClick={markFinished}>
                标记为已读完
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <FinishedCelebration
        open={finishOpen}
        bookTitle={book.meta.title}
        summary={finishSummary}
        onClose={() => setFinishOpen(false)}
        onLibrary={onBack}
      />

      {dock && !card && (
        <ParaDock
          blockId={dock.block.id}
          lens={lens?.blockId === dock.block.id}
          marked={mark?.blockId === dock.block.id}
          onLookup={toggleLens}
          onMark={() => {
            markHere(dock.block, dock.chapter);
            setDock(null);
          }}
          onNote={() => openScope(dock.block, dock.chapter)}
          onClose={closeDock}
        />
      )}

      {card?.charRect && (
        <span
          className="dict-ring"
          aria-hidden
          style={{
            left: card.charRect.left - 3,
            top: card.charRect.top - 2,
            width: card.charRect.width + 6,
            height: card.charRect.height + 4,
          }}
        />
      )}

      <DictCard
        open={!!card}
        result={lookup}
        term={card?.key ?? ''}
        termKind={card?.kind ?? 'char'}
        loading={dictLoading}
        error={dictError}
        anchor={card?.anchor ?? null}
        saved={savedTerm}
        vocab={vocab}
        onClose={() => {
          setCard(null);
          lookupSeq.current += 1;
        }}
        onToggleSave={toggleSave}
        onRetry={retryLookup}
        onLookupChar={(ch) => {
          if (!card) return;
          void openLookup('char', ch, card.blockId, card.charRect, card.chapterTitle, card.anchor);
        }}
        onLookupWord={(w) => {
          if (!card) return;
          void openLookup('word', w, card.blockId, card.charRect, card.chapterTitle, card.anchor);
        }}
        onPickVocab={pickVocab}
        onRemoveVocab={removeVocab}
        onSpeak={speak}
      />

      <NoteScopeDialog
        open={!!scope}
        blockText={scope?.block.text ?? ''}
        sentences={scope ? splitSentences(scope.block.text) : []}
        onConfirm={(mode, picked) => {
          if (!scope) return;
          const { block, chapter } = scope;
          const ranges =
            mode === 'whole'
              ? [{ blockId: block.id, start: 0, end: block.text.length }]
              : picked.map((sen) => ({ blockId: block.id, start: sen.start, end: sen.end }));
          const quote =
            mode === 'whole' ? block.text : picked.map((sen) => sen.text).join('');
          setEditor({
            open: true,
            quote,
            comment: '',
            color: 'clay',
            ranges,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            kind: mode === 'whole' ? 'paragraph' : 'selection',
          });
          setScope(null);
          lastToolbarClose.current = Date.now();
        }}
        onClose={() => setScope(null)}
      />

      <SelectionToolbar
        open={!!selection}
        rect={selection?.rect ?? null}
        onPick={(c) => createHighlight(c)}
        onComment={() => {
          if (!selection || !book) return;
          const chapterId = selection.ranges[0].blockId.split('#')[0];
          const chapter = book.chapters.find((c) => c.id === chapterId);
          setEditor({
            open: true,
            quote: selection.text,
            comment: '',
            color: 'clay',
            ranges: selection.ranges,
            chapterId,
            chapterTitle: chapter?.title ?? '',
            kind: 'selection',
          });
          setSelection(null);
        }}
        onCopy={() => {
          if (selection) {
            navigator.clipboard.writeText(selection.text);
            toast('已复制');
          }
        }}
        onLookup={lookupFromSelection}
      />

      <NoteEditor
        open={!!editor?.open}
        quote={editor?.quote ?? ''}
        initialComment={editor?.comment ?? ''}
        initialColor={editor?.color ?? 'clay'}
        initialCategory={editor?.category}
        initialTitle={editor?.title}
        isNew={!editor?.noteId}
        onSave={saveEditor}
        onDelete={async () => {
          if (editor?.noteId) {
            await useReader.getState().deleteNote(editor.noteId);
            toast('笔记已删除');
          }
          setEditor(null);
        }}
        onClose={() => {
          setEditor(null);
          lastToolbarClose.current = Date.now();
        }}
      />

      <TocPanel
        open={panel === 'toc'}
        onClose={() => setPanel(null)}
        tree={tocTree!}
        active={activeToc}
        ratio={ratio}
        onJump={(node) => {
          setPanel(null);
          jumpToc(node);
        }}
      />

      <NotesPanel
        open={panel === 'notes'}
        onClose={() => setPanel(null)}
        notes={notes}
        bookId={book.meta.id}
        bookTitle={book.meta.title}
        onCompose={composeNote}
        onJump={jumpNote}
        onEdit={(n: Note) =>
          setEditor({
            open: true,
            noteId: n.id,
            quote: n.text,
            comment: n.comment,
            color: n.color,
            ranges: n.ranges,
            chapterId: n.chapterId,
            chapterTitle: n.chapterTitle,
            kind: n.kind,
          })
        }
        onDelete={async (n: Note) => {
          await useReader.getState().deleteNote(n.id);
          toast('笔记已删除');
        }}
      />

      <StatsPanel open={panel === 'stats'} onClose={() => setPanel(null)} book={book} progress={progress} notes={notes} />

      <SettingsPanel
        open={panel === 'settings'}
        onClose={() => setPanel(null)}
        settings={settings}
        update={update}
      />

      <SearchPanel
        open={panel === 'search'}
        onClose={() => setPanel(null)}
        book={book}
        onJump={(chapterId, blockId) => {
          setPanel(null);
          useReader.getState().jumpTo(chapterId, blockId, true);
        }}
      />

      {/* 图片放大 */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[95] flex items-center justify-center p-10"
            style={{ background: 'rgba(12,10,8,0.86)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setLightbox(null)}
          >
            <motion.img
              src={lightbox}
              alt=""
              className="max-h-full max-w-full rounded-sm object-contain"
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
