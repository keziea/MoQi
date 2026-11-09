import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DailyStat, Note } from '@shared/models';
import { Shelf } from '@/pages/Shelf';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import { useStats } from '@/store/useStats';
import { useImportDialog } from '@/store/useImportDialog';
import { ipc } from '@/lib/ipc';
import { groupBooks } from '@/lib/library';
import { streakDays, type OpenTarget, type WorkspaceNote } from '@/lib/workspace';
import { Icon, type IconName } from '@/components/ui/Icon';
import { SettingsPanel } from '@/components/reader/SettingsPanel';
import { WorkspaceOverview } from '@/components/workspace/WorkspaceOverview';
import { WorkspaceNotes } from '@/components/workspace/WorkspaceNotes';
import { WorkspaceAnalysis } from '@/components/workspace/WorkspaceAnalysis';
import { WorkspaceHistory } from '@/components/workspace/WorkspaceHistory';
import { BookDetail } from '@/components/workspace/BookDetail';
import { NoteDetail } from '@/components/workspace/NoteDetail';
import { CategoryManager } from '@/components/workspace/CategoryManager';
import { NOTE_CATEGORY_FALLBACK } from '@shared/models';
import logoUrl from '@/assets/logo.png';

export type WorkspaceSection = 'overview' | 'library' | 'notes' | 'analysis' | 'history';

export type { OpenTarget } from '@/lib/workspace';

interface Props {
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => void;
  onOpen: (bookId: string, target?: OpenTarget) => void;
}

const NAV: { key: WorkspaceSection; label: string; icon: IconName; hint: string }[] = [
  { key: 'overview', label: '首页', icon: 'home', hint: '今天' },
  { key: 'library', label: '书架', icon: 'book', hint: '所有书' },
  { key: 'notes', label: '笔记', icon: 'pen', hint: '写下的' },
  { key: 'analysis', label: '阅读统计', icon: 'chart', hint: '读了多少' },
  { key: 'history', label: '阅读记录', icon: 'calendar', hint: '每一天' },
];

const SECTION_TITLE: Record<WorkspaceSection, string> = {
  overview: '首页',
  library: '书架',
  notes: '笔记',
  analysis: '阅读统计',
  history: '阅读记录',
};

export function Workspace({ section, onSection, onOpen }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [catMgr, setCatMgr] = useState<'book' | 'note' | null>(null);
  const [bookStats, setBookStats] = useState<Record<string, { seconds: number; notes: number }>>({});
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [stats, setStats] = useState<DailyStat[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const books = useLibrary((s) => s.books);
  const progressMap = useLibrary((s) => s.progressMap);
  const loading = useLibrary((s) => s.loading);
  const pickAndImport = useLibrary((s) => s.pickAndImport);

  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const todaySeconds = useStats((s) => s.todaySeconds);

  const groups = useMemo(() => groupBooks(books, progressMap), [books, progressMap]);

  useEffect(() => {
    ipc.stats.books().then(setBookStats).catch(() => {});
  }, [books.length, detailId]);

  const detailMeta = useMemo(
    () => (detailId ? books.find((b) => b.id === detailId) ?? null : null),
    [detailId, books]
  );

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const streak = useMemo(() => streakDays(stats, todaySeconds), [stats, todaySeconds]);
  const goalMinutes = settings.dailyGoalMinutes ?? 30;

  const loadNotes = useCallback(async () => {
    if (!books.length) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }
    setNotesLoading(true);
    try {
      const lists = await Promise.all(
        books.map(async (book) => ({ book, list: await ipc.note.list(book.id) }))
      );
      const merged: WorkspaceNote[] = [];
      for (const { book, list } of lists) {
        for (const note of list as Note[]) {
          merged.push({ ...note, bookTitle: book.title, bookAuthor: book.author });
        }
      }
      setNotes(merged);
    } catch {
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  }, [books]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    let alive = true;
    ipc.stats
      .get(120)
      .then((next) => {
        if (alive) setStats(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 工作台可能在应用启动后直接出现，此时还没有进过阅读页；
    // 主动把今天的累计读进来，目标环和总览才不会显示为 0。
    if (!useStats.getState().bookId) void useStats.getState().init();
  }, []);

  // 记住每个视图的滚动位置：从书籍详情返回书架时，应该回到原来那一行，而不是被甩回顶部
  const scrollMemo = useRef<Record<string, number>>({});
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const key = `${section}|${detailId ?? ''}|${noteId ?? ''}`;
    const restore = scrollMemo.current[key] ?? 0;
    el.scrollTop = restore;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = restore;
    });
    return () => {
      cancelAnimationFrame(raf);
      scrollMemo.current[key] = el.scrollTop;
    };
  }, [section, detailId, noteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= NAV.length) {
        e.preventDefault();
        onSection(NAV[idx - 1].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cycleTheme = () => {
    const order: Array<typeof settings.theme> = ['paper', 'sepia', 'green', 'night'];
    const idx = order.indexOf(settings.theme);
    update({ theme: order[(idx + 1) % order.length] });
  };

  // 导入成功后回到书架，新书立刻在眼前
  useEffect(() => {
    const goLibrary = () => {
      setDetailId(null);
      setNoteId(null);
      onSection('library');
    };
    window.addEventListener('moqi:open-library', goLibrary);
    return () => window.removeEventListener('moqi:open-library', goLibrary);
  }, [onSection]);

  const openNote = (note: WorkspaceNote) => {
    // 点笔记先进独立的笔记页面，而不是直接跳回书里
    setNoteId(note.id);
  };

  const activeNote = useMemo(
    () => (noteId ? notes.find((n) => n.id === noteId) ?? null : null),
    [noteId, notes]
  );

  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      const key = n.category?.trim() || NOTE_CATEGORY_FALLBACK;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  const title = noteId ? '笔记详情' : detailId ? '书籍详情' : SECTION_TITLE[section];

  return (
    <div className="ws-shell">
      <aside className="ws-rail" aria-label="我的阅读导航">
        <div className="ws-brand">
          <img className="ws-brand-logo" src={logoUrl} alt="" aria-hidden="true" draggable={false} />
          <div className="ws-brand-text">
            <strong>墨栖</strong>
            <small>我的阅读</small>
          </div>
        </div>

        <nav className="ws-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              className="ws-nav-item"
              type="button"
              data-active={section === item.key || undefined}
              onClick={() => {
                setDetailId(null);
                setNoteId(null);
                onSection(item.key);
              }}
              aria-current={section === item.key ? 'page' : undefined}
              title={`${item.label} · Ctrl+${NAV.findIndex((n) => n.key === item.key) + 1}`}
            >
              <span className="ws-nav-icon">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="ws-nav-label">{item.label}</span>
              <span className="ws-nav-hint">{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="ws-rail-foot">
          <button className="ws-rail-link" type="button" onClick={cycleTheme} title="切换主题">
            <Icon name={settings.theme === 'night' ? 'moon' : 'sun'} size={17} />
            <span>{settings.theme === 'night' ? '夜间' : '纸白'}</span>
          </button>
          <button className="ws-rail-link" type="button" onClick={() => setSettingsOpen(true)} title="设置">
            <Icon name="settings" size={17} />
            <span>设置</span>
          </button>
          <span className="ws-version">v0.1</span>
        </div>
      </aside>

      <div className="ws-main">
        <header className="ws-topbar">
          <div className="ws-crumb">
            {activeNote ? (
              <>
                <button type="button" onClick={() => setNoteId(null)}>
                  笔记
                </button>
                <i>/</i>
                <strong>{activeNote.bookTitle || '笔记详情'}</strong>
              </>
            ) : detailMeta ? (
              <>
                <button type="button" onClick={() => setDetailId(null)}>
                  书架
                </button>
                <i>/</i>
                <strong>{detailMeta.title}</strong>
              </>
            ) : (
              <strong>{title}</strong>
            )}
          </div>
          <div className="ws-top-actions">
            <span className="ws-local">
              <i /> 本地 · 不联网
            </span>
            <button className="ws-icon-btn" type="button" onClick={() => ipc.app.openDataDir()} aria-label="打开数据文件夹">
              <Icon name="folder" size={17} />
            </button>
          </div>
        </header>

        <div className="ws-scroll" ref={scrollRef}>
          <AnimatePresence mode="wait" initial={false}>
            {activeNote ? (
              <NoteDetail
                key="note-detail"
                note={activeNote}
                onBack={() => setNoteId(null)}
                onLocate={() =>
                  onOpen(activeNote.bookId, {
                    chapterId: activeNote.chapterId,
                    blockId: activeNote.ranges[0]?.blockId,
                  })
                }
              />
            ) : detailMeta ? (
              <BookDetail
                key="detail"
                meta={detailMeta}
                progress={progressMap[detailMeta.id] ?? null}
                stats={bookStats[detailMeta.id]}
                onRead={() => onOpen(detailMeta.id)}
                onClose={() => setDetailId(null)}
              />
            ) : (
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              {section === 'overview' && (
                <WorkspaceOverview
                  groups={groups}
                  progressMap={progressMap}
                  stats={stats}
                  notes={notes}
                  todaySeconds={todaySeconds}
                  goalMinutes={goalMinutes}
                  streak={streak}
                  onGoal={(minutes) => update({ dailyGoalMinutes: minutes })}
                  onOpenBook={openDetail}
                  onOpenNote={openNote}
                  onSection={onSection}
                  onImport={() => useImportDialog.getState().openDialog()}
                />
              )}
              {section === 'library' && (
                <div className="ws-view ws-library-view">
                  <header className="ws-view-head ws-library-head">
                    <div>
                      <span className="ws-eyebrow">
                        <span className="ws-eyebrow-dot" /> {groups.length} 本书 · 多个文件已合并
                      </span>
                      <h1>书架</h1>
                      <p>选择想读的版本，或者继续上一次停下的地方。</p>
                    </div>
                  </header>
                  <Shelf embedded onOpen={openDetail} />
                </div>
              )}
              {section === 'notes' && (
                <WorkspaceNotes
                  notes={notes}
                  loading={notesLoading || loading}
                  onOpenNote={openNote}
                  onOpenLibrary={() => onSection('library')}
                  onManageCategories={() => setCatMgr('note')}
                />
              )}
              {section === 'analysis' && (
                <WorkspaceAnalysis
                  stats={stats}
                  notes={notes}
                  books={books}
                  progressMap={progressMap}
                  todaySeconds={todaySeconds}
                />
              )}
              {section === 'history' && (
                <WorkspaceHistory stats={stats} todaySeconds={todaySeconds} onSection={onSection} />
              )}
            </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CategoryManager
        open={!!catMgr}
        onClose={() => setCatMgr(null)}
        kind={catMgr ?? 'book'}
        noteCounts={noteCounts}
        onChanged={() => void loadNotes()}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={update}
      />
    </div>
  );
}
