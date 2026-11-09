import type { Book, Note, PageMode, Progress } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { TimerControls } from '@/components/reader/TimerControls';
import { TocTree } from '@/components/reader/TocTree';
import { useStats } from '@/store/useStats';
import { coverUrl, formatChars, formatClock, formatPercent, formatShortDuration } from '@/lib/format';
import type { TocNode, TocTree as TocTreeData } from '@/lib/toc';

interface NavRailProps {
  book: Book;
  progress: Progress | null;
  notes: Note[];
  tree: TocTreeData;
  activeToc: TocNode | null;
  open: boolean;
  mode: PageMode;
  onClose: () => void;
  onJump: (node: TocNode) => void;
  onOpenToc: () => void;
  onOpenNotes: () => void;
  onCompose: () => void;
  onJumpNote: (note: Note) => void;
  onPageMode: (mode: PageMode) => void;
  onOpenStats: () => void;
}

export function NavRail({
  book,
  progress,
  notes,
  tree,
  activeToc,
  open,
  mode,
  onClose,
  onJump,
  onOpenToc,
  onOpenNotes,
  onCompose,
  onJumpNote,
  onPageMode,
  onOpenStats,
}: NavRailProps) {
  const activeSeconds = useStats((s) => s.activeSeconds);
  const todaySeconds = useStats((s) => s.todaySeconds);
  const bookTodaySeconds = useStats((s) => s.bookTodaySeconds);
  const running = useStats((s) => s.running);
  const ratio = progress?.ratio ?? 0;
  const cover = coverUrl(book.meta);
  const latestNote = [...notes].sort((a, b) => b.createdAt - a.createdAt)[0];

  return (
    <>
      {open && <div className="reader-nav-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className="reader-nav" data-open={open || undefined} aria-hidden={!open} aria-label="阅读导航">
        <div className="reader-nav-head">
          <span className="reader-nav-brand">
            <i aria-hidden="true" />
            <span>
              <b>墨栖</b>
              <em>我的阅读</em>
            </span>
          </span>
          <button type="button" className="reader-nav-icon" onClick={onClose} aria-label="收起导航" title="收起导航">
            <Icon name="panel-left" size={17} />
          </button>
        </div>

        <div className="reader-nav-book">
          <span className="reader-nav-book-kicker">正在读</span>
          {cover ? (
            <img className="reader-nav-cover" src={cover} alt="" />
          ) : (
            <div className="reader-nav-cover reader-nav-cover-fallback">
              <Icon name="book" size={20} />
            </div>
          )}
          <div className="reader-nav-book-main">
            <div className="reader-nav-book-title" title={book.meta.title}>
              {book.meta.title}
            </div>
            <div className="reader-nav-book-author">{book.meta.author || '佚名'}</div>
            <div className="reader-nav-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <div className="reader-nav-book-meta">
              <span>{formatPercent(ratio)}</span>
              <span>{formatChars(Math.round(book.meta.totalChars * ratio))}</span>
            </div>
          </div>
        </div>

        <section className="reader-nav-timer" aria-label="阅读计时">
          <div className="reader-nav-timer-head">
            <span>本次阅读</span>
            <span className="reader-nav-timer-state" data-running={running || undefined}>
              {running ? '计时中' : '已暂停'}
            </span>
          </div>
          <button
            type="button"
            className="reader-nav-clock"
            onClick={onOpenStats}
            title="打开今天的阅读小结"
          >
            {formatClock(activeSeconds)}
          </button>
          <div className="reader-nav-timer-meta">
            <span>今天 {formatShortDuration(todaySeconds)}</span>
            <span>这本书 {formatShortDuration(bookTodaySeconds)}</span>
          </div>
          <TimerControls />
        </section>

        <div className="reader-nav-modes" role="group" aria-label="翻页方式">
          <button
            type="button"
            data-active={mode === 'paged' || undefined}
            onClick={() => onPageMode('paged')}
            title="一页一页读"
          >
            <Icon name="book" size={14} />
            翻页
          </button>
          <button
            type="button"
            data-active={mode === 'scroll' || undefined}
            onClick={() => onPageMode('scroll')}
            title="连续向下滚动"
          >
            <Icon name="layers" size={14} />
            滚动
          </button>
        </div>

        <button type="button" className="reader-nav-analysis" onClick={onOpenStats}>
          <span className="reader-nav-analysis-icon">
            <Icon name="sparkles" size={15} />
          </span>
          <span className="reader-nav-analysis-copy">
            <b>阅读统计</b>
            <em>今日小结 · 统计模板</em>
          </span>
          <Icon name="chevron-right" size={14} />
        </button>

        <section className="reader-nav-toc" aria-label="目录">
          <div className="reader-nav-section-head">
            <span>目录</span>
            <button type="button" className="reader-nav-text-btn" onClick={onOpenToc}>
              全部
            </button>
          </div>
          <div className="reader-nav-toc-scroll">
            <TocTree
              tree={tree}
              active={activeToc}
              onJump={onJump}
              mode="rail"
              showSubsections={false}
              autoScroll={open}
            />
          </div>
        </section>

        <section className="reader-nav-notes" aria-label="笔记">
          <div className="reader-nav-section-head">
            <span>笔记</span>
            <span className="reader-nav-count">{notes.length}</span>
          </div>
          {latestNote ? (
            <button type="button" className="reader-nav-note" onClick={() => onJumpNote(latestNote)}>
              <span className="reader-nav-note-quote">“{latestNote.text.slice(0, 34)}”</span>
              <span className="reader-nav-note-meta">{latestNote.chapterTitle}</span>
            </button>
          ) : (
            <p className="reader-nav-empty">还没有笔记，写第一条吧</p>
          )}
          <div className="reader-nav-note-actions">
            <button type="button" className="reader-nav-action" onClick={onCompose}>
              <Icon name="pen" size={14} />
              写笔记
            </button>
            <button type="button" className="reader-nav-action reader-nav-action-ghost" onClick={onOpenNotes}>
              全部笔记
            </button>
          </div>
        </section>
      </aside>
    </>
  );
}
