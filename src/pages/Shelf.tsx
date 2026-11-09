import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import { useStats } from '@/store/useStats';
import { ipc } from '@/lib/ipc';
import { formatShortDuration, formatLabel } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Icon } from '@/components/ui/Icon';
import { Tip } from '@/components/ui/Tooltip';
import { BookCard } from '@/components/shelf/BookCard';
import { ContinueCard } from '@/components/shelf/ContinueCard';
import { EmptyShelf } from '@/components/shelf/EmptyShelf';
import { groupBooks, type ShelfGroup } from '@/lib/library';
import { CategoryManager } from '@/components/workspace/CategoryManager';
import { useImportDialog } from '@/store/useImportDialog';
import logoUrl from '@/assets/logo.png';
import { readStatus } from '@/lib/reading';
import type { BookFormat, BookMeta } from '@shared/models';

type Filter = 'all' | 'reading' | 'finished' | 'unread';
type Sort = 'recent' | 'title';

/** 书架只需要管理书籍分类，笔记分类的计数用不到 */
const EMPTY_COUNTS = new Map<string, number>();

interface ShelfProps {
  onOpen: (bookId: string) => void;
  /** 嵌入工作台时不再渲染自己的整页顶栏。 */
  embedded?: boolean;
}

export function Shelf({ onOpen, embedded = false }: ShelfProps) {
  const books = useLibrary((s) => s.books);
  const progressMap = useLibrary((s) => s.progressMap);
  const loading = useLibrary((s) => s.loading);
  const scanning = useLibrary((s) => s.scanning);
  const scanProgress = useLibrary((s) => s.scanProgress);
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const theme = useSettings((s) => s.settings.theme);
  const settingsCats = useSettings((s) => s.settings.categories ?? []);
  const update = useSettings((s) => s.update);
  const todaySeconds = useStats((s) => s.todaySeconds);

  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [catMgrOpen, setCatMgrOpen] = useState(false);

  const groups = useMemo(() => groupBooks(books, progressMap), [books, progressMap]);

  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    let unclassified = 0;
    for (const g of groups) {
      const cats = g.meta.categories ?? [];
      if (cats.length === 0) unclassified += 1;
      for (const c of cats) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const seen = new Set(settingsCats);
    const custom = [...counts.keys()].filter((c) => !seen.has(c));
    const all = [...settingsCats, ...custom].map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
    return { all, unclassified };
  }, [groups, settingsCats]);

  const counts = useMemo(() => {
    let reading = 0;
    let finished = 0;
    let unread = 0;
    for (const g of groups) {
      const st = readStatus(progressMap[g.meta.id]);
      if (st === 'finished') finished += 1;
      else if (st === 'reading') reading += 1;
      else unread += 1;
    }
    return { reading, finished, unread };
  }, [groups, progressMap]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = groups.filter((g) => {
      const st = readStatus(progressMap[g.meta.id]);
      if (filter === 'reading' && st !== 'reading') return false;
      if (filter === 'finished' && st !== 'finished') return false;
      if (filter === 'unread' && st !== 'unread') return false;
      if (catFilter === '__none__') {
        if ((g.meta.categories ?? []).length > 0) return false;
      } else if (catFilter !== 'all' && !(g.meta.categories ?? []).includes(catFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        g.meta.title.toLowerCase().includes(q) ||
        g.meta.author.toLowerCase().includes(q) ||
        (g.meta.publisher ?? '').toLowerCase().includes(q)
      );
    });
    if (sort === 'title') {
      return [...list].sort((a, b) => a.meta.title.localeCompare(b.meta.title, 'zh-CN'));
    }
    return list;
  }, [groups, progressMap, filter, query, sort, catFilter]);

  const recentGroup = useMemo(
    () => groups.find((g) => g.meta.lastOpenedAt || (progressMap[g.meta.id]?.ratio ?? 0) > 0),
    [groups, progressMap]
  );

  const cycleTheme = () => {
    const order: Array<typeof theme> = ['paper', 'sepia', 'green', 'night'];
    const idx = order.indexOf(theme);
    update({ theme: order[(idx + 1) % order.length] });
  };

  const switchFormat = async (group: ShelfGroup, format: BookFormat) => {
    // 合并后的卡片可能由多个重复条目组成；找到真正持有该格式的那一份。
    const target =
      group.copies.find((c) => c.variants.some((v) => v.format === format)) ??
      group.copies.find((c) => c.format === format) ??
      group.meta;
    const res = await ipc.library.switchVariant(target.id, format);
    if (!res.ok) {
      toast('这个版本暂时打不开');
      return;
    }
    await useLibrary.getState().scan(true);
    toast(`已切换为 ${formatLabel(format)}，打开时使用这个版本`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        update({ fontSize: Math.min(30, useSettings.getState().settings.fontSize + 1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update]);

  const now = new Date();
  const dateLabel = `${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(
    now,
  )} · ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)}`;

  return (
    <div className={embedded ? 'shelf-shell shelf-shell-embedded' : 'shelf-shell'}>
      {!embedded && (
        <header className="shelf-topbar">
          <div className="shelf-brand">
            <img className="shelf-brand-logo" src={logoUrl} alt="" aria-hidden="true" draggable={false} />
            <div>
              <h1 className="shelf-brand-name">墨栖</h1>
              <p className="shelf-brand-sub">我的书架</p>
            </div>
          </div>

          <div className="shelf-topbar-date">{dateLabel}</div>

          <div className="shelf-topbar-actions">
            <Tip label="导入书籍（Ctrl+O）">
              <button className="shelf-action" onClick={() => useImportDialog.getState().openDialog()} aria-label="导入书籍">
                <Icon name="plus" size={18} />
              </button>
            </Tip>
            <Tip label="切换主题">
              <button className="shelf-action" onClick={cycleTheme} aria-label="切换主题">
                <Icon name={theme === 'night' ? 'moon' : 'sun'} size={18} />
              </button>
            </Tip>
            <Tip label="打开数据文件夹">
              <button className="shelf-action" onClick={() => ipc.app.openDataDir()} aria-label="打开数据文件夹">
                <Icon name="folder" size={18} />
              </button>
            </Tip>
          </div>
        </header>
      )}

      <main className={embedded ? 'shelf-main shelf-main-embedded' : 'shelf-main'}>
        <div className="shelf-content">
          {loading ? (
            <ShelfSkeleton />
          ) : books.length === 0 ? (
            <EmptyShelf
              onImport={() => useImportDialog.getState().openDialog()}
              scanning={scanning}
              progress={scanProgress}
            />
          ) : (
            <>
              <section className="shelf-overview" aria-label="书库概览">
                <div className="shelf-overview-main">
                  <span className="shelf-eyebrow">我的书库</span>
                  <h2 className="shelf-title">今天，想读点什么？</h2>
                  <p className="shelf-subtitle">
                    {groups.length} 本书 · {counts.reading} 本在读 · {counts.finished} 本读完
                    {todaySeconds > 60 ? ` · 今天读了 ${formatShortDuration(todaySeconds)}` : ''}
                  </p>
                </div>
                <div className="shelf-overview-stats">
                  <div className="shelf-stat">
                    <span className="shelf-stat-value">{groups.length}</span>
                    <span className="shelf-stat-label">全部</span>
                  </div>
                  <div className="shelf-stat">
                    <span className="shelf-stat-value">{counts.reading}</span>
                    <span className="shelf-stat-label">在读</span>
                  </div>
                  <div className="shelf-stat">
                    <span className="shelf-stat-value">{counts.finished}</span>
                    <span className="shelf-stat-label">读完</span>
                  </div>
                  <div className="shelf-stat">
                    <span className="shelf-stat-value">{formatShortDuration(todaySeconds)}</span>
                    <span className="shelf-stat-label">今天</span>
                  </div>
                </div>
              </section>

              {recentGroup && !query && filter === 'all' && (
                <ContinueCard
                  meta={recentGroup.meta}
                  ratio={progressMap[recentGroup.meta.id]?.ratio ?? 0}
                  copies={recentGroup.copies.length}
                  onOpen={() => onOpen(recentGroup.meta.id)}
                />
              )}

              <section className="shelf-books">
                <div className="shelf-cats" role="group" aria-label="按分类筛选">
                  <span className="shelf-cats-label">分类</span>
                  <button
                    type="button"
                    data-active={catFilter === 'all' || undefined}
                    onClick={() => setCatFilter('all')}
                  >
                    全部
                    <span>{groups.length}</span>
                  </button>
                  {categoryList.all.map(({ name, count }) => (
                    <button
                      key={name}
                      type="button"
                      data-active={catFilter === name || undefined}
                      data-empty={count === 0 || undefined}
                      onClick={() => setCatFilter(name)}
                    >
                      {name}
                      <span>{count}</span>
                    </button>
                  ))}
                  {categoryList.unclassified > 0 && (
                    <button
                      type="button"
                      data-active={catFilter === '__none__' || undefined}
                      onClick={() => setCatFilter('__none__')}
                    >
                      未分类
                      <span>{categoryList.unclassified}</span>
                    </button>
                  )}
                </div>

                <CategoryManager
                  open={catMgrOpen}
                  onClose={() => setCatMgrOpen(false)}
                  tab="book"
                  noteCounts={EMPTY_COUNTS}
                  onChanged={() => {}}
                />

                <div className="shelf-toolbar">
                  <label className="shelf-search">
                    <Icon name="search" size={15} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索书名、作者或出版社"
                      aria-label="搜索书籍"
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </label>

                  <div className="shelf-filters" role="group" aria-label="筛选书籍">
                    {(
                      [
                        ['all', `全部 ${groups.length}`],
                        ['reading', `在读 ${counts.reading}`],
                        ['finished', `读完 ${counts.finished}`],
                        ['unread', `未读 ${counts.unread}`],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        data-active={filter === key || undefined}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="shelf-sort" role="group" aria-label="排序">
                    <button
                      type="button"
                      data-active={sort === 'recent' || undefined}
                      onClick={() => setSort('recent')}
                      title="最近阅读"
                    >
                      最近
                    </button>
                    <button
                      type="button"
                      data-active={sort === 'title' || undefined}
                      onClick={() => setSort('title')}
                      title="按书名排序"
                    >
                      书名
                    </button>
                  </div>

                  <div className="shelf-import">
                    <button
                      type="button"
                      className="shelf-import-secondary"
                      onClick={() => setCatMgrOpen(true)}
                      title="管理分类：改名、删除、新建"
                    >
                      <Icon name="layers" size={14} />
                      分类
                    </button>
                    <button
                      type="button"
                      className="shelf-import-main"
                      onClick={() => useImportDialog.getState().openDialog()}
                    >
                      <Icon name="plus" size={15} />
                      导入书籍
                    </button>
                  </div>
                </div>

                <div className="shelf-section-head">
                  <h3>{query ? `搜索“${query}”` : '全部书籍'}</h3>
                  <span>
                    {scanning ? '正在整理书库…' : `${visible.length} 本 · 多个文件已合并`}
                  </span>
                </div>

                {visible.length === 0 ? (
                  <div className="shelf-no-result">
                    <Icon name="search" size={22} />
                    <p>没有找到符合条件的书。</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                    >
                      清除筛选
                    </button>
                  </div>
                ) : (
                  <motion.div
                    className="shelf-grid"
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}
                  >
                    {visible.map((g) => (
                      <motion.div
                        key={g.meta.id}
                        variants={{
                          hidden: { opacity: 0, y: 9 },
                          show: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                      >
                        <BookCard
                          meta={g.meta}
                          copies={g.copies.length}
                          formats={g.formats}
                          ratio={progressMap[g.meta.id]?.ratio ?? 0}
                          onOpen={() => onOpen(g.meta.id)}
                          onSwitchFormat={(format) => switchFormat(g, format)}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <div>
      <div className="skeleton h-[120px] w-full rounded-[18px]" />
      <div className="skeleton mt-6 h-[148px] w-full rounded-[18px]" />
      <div className="mt-10 grid gap-x-8 gap-y-11" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[2/3] w-full rounded-[8px]" />
            <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
            <div className="skeleton mt-2 h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export type { BookMeta };
