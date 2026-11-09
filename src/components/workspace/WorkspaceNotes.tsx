import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_NOTE_CATEGORIES, NOTE_CATEGORY_FALLBACK } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import { COLOR_META } from '@/lib/colors';
import { useSettings } from '@/store/useSettings';
import type { WorkspaceNote } from '@/lib/workspace';
import { copyText } from '@/lib/workspace';
import { toast } from '@/lib/toast';
import { ipc } from '@/lib/ipc';

interface Props {
  notes: WorkspaceNote[];
  loading: boolean;
  onOpenNote: (note: WorkspaceNote) => void;
  onOpenLibrary: () => void;
  onManageCategories: () => void;
}

export function WorkspaceNotes({ notes, loading, onOpenNote, onOpenLibrary, onManageCategories }: Props) {
  const [query, setQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<'single' | 'folder' | null>(null);

  const noteCats = useSettings((s) => s.settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES);
  const colorOf = (name?: string) => {
    if (!name) return null;
    return noteCats.find((c) => c.name === name)?.color ?? null;
  };

  const books = useMemo(() => {
    const map = new Map<string, { id: string; title: string; author: string; count: number }>();
    for (const note of notes) {
      const prev = map.get(note.bookId);
      if (prev) prev.count += 1;
      else map.set(note.bookId, { id: note.bookId, title: note.bookTitle, author: note.bookAuthor, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [notes]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      const key = n.category?.trim() || NOTE_CATEGORY_FALLBACK;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);

  // 分类被删掉后，筛选条件可能指向一个已经不存在的分类，自动回到「全部」
  useEffect(() => {
    if (categoryFilter === 'all') return;
    if (!categories.some(([name]) => name === categoryFilter)) setCategoryFilter('all');
  }, [categories, categoryFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...notes]
      .filter((n) => {
        if (bookFilter !== 'all' && n.bookId !== bookFilter) return false;
        if (categoryFilter !== 'all') {
          const key = n.category?.trim() || NOTE_CATEGORY_FALLBACK;
          if (key !== categoryFilter) return false;
        }
        if (!q) return true;
        return (
          n.text.toLowerCase().includes(q) ||
          n.comment.toLowerCase().includes(q) ||
          n.chapterTitle.toLowerCase().includes(q) ||
          n.bookTitle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, query, bookFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; author: string; notes: WorkspaceNote[] }>();
    for (const note of filtered) {
      const prev = map.get(note.bookId);
      if (prev) prev.notes.push(note);
      else map.set(note.bookId, { title: note.bookTitle, author: note.bookAuthor, notes: [note] });
    }
    return [...map.entries()];
  }, [filtered]);

  const thisWeek = notes.filter((n) => Date.now() - n.createdAt < 7 * 86400000).length;
  const notedBooks = new Set(notes.map((n) => n.bookId)).size;

  const runExport = async (mode: 'single' | 'folder') => {
    setExportBusy(mode);
    try {
      const res = await ipc.note.exportAll(mode);
      if (res.ok) {
        toast(`已导出 ${res.count ?? 0} 条笔记`);
        setExportOpen(false);
        if (mode === 'folder' && res.path) void ipc.app.openPath(res.path);
      } else if (!res.canceled) {
        toast(res.error ?? '导出失败');
      }
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <div className="ws-view ws-notes-view">
      <header className="ws-view-head">
        <div>
          <span className="ws-eyebrow">
            <span className="ws-eyebrow-dot" /> 你划过的线、写下的笔记
          </span>
          <h1>笔记</h1>
          <p>所有书里的笔记都在这里。点一条，回到它出现的那一页。</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ws-btn ws-btn-quiet" type="button" onClick={onManageCategories}>
            <Icon name="pen" size={16} />
            管理分类
          </button>
          <button
            className="ws-btn ws-btn-quiet"
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={!notes.length}
          >
            <Icon name="export" size={16} />
            导出全部笔记
          </button>
        </div>
      </header>

      <section className="ws-notes-stats" aria-label="笔记概览">
        <div>
          <strong>{notes.length}</strong>
          <span>全部笔记</span>
        </div>
        <div>
          <strong>{notedBooks}</strong>
          <span>有笔记的书</span>
        </div>
        <div>
          <strong>{categories.length}</strong>
          <span>种分类</span>
        </div>
        <div>
          <strong>{thisWeek}</strong>
          <span>最近 7 天</span>
        </div>
        <div className="ws-notes-stats-quote">
          <span className="ws-stat-quote-mark" aria-hidden="true">“</span>
          <span>
            {notes.length
              ? '读书时停下来的地方，往往就是最值得记住的地方。'
              : '慢慢读，总会遇见想记下来的句子。'}
          </span>
        </div>
      </section>

      <section className="ws-notes-filters" aria-label="筛选笔记">
        <label className="ws-search ws-notes-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索笔记、书名或章节"
            aria-label="搜索笔记"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        {categories.length > 0 && (
          <div className="ws-cat-filter" role="group" aria-label="按分类筛选">
            <span className="ws-cat-filter-label">{categories.length} 种分类</span>
            <button
              type="button"
              data-active={categoryFilter === 'all' || undefined}
              onClick={() => setCategoryFilter('all')}
            >
              全部类型
            </button>
            {categories.map(([name, count]) => {
              const key = name === NOTE_CATEGORY_FALLBACK ? undefined : name;
              const c = colorOf(key);
              return (
                <button
                  key={name}
                  type="button"
                  data-active={categoryFilter === name || undefined}
                  onClick={() => setCategoryFilter(name)}
                >
                  {c && (
                    <i
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        marginRight: 5,
                        verticalAlign: '1px',
                        background: COLOR_META[c].solid,
                      }}
                    />
                  )}
                  {name}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {books.length > 1 && (
        <div className="ws-book-filter" role="group" aria-label="按书筛选">
          <button type="button" data-active={bookFilter === 'all' || undefined} onClick={() => setBookFilter('all')}>
            全部书
          </button>
          {books.map((b) => (
            <button
              key={b.id}
              type="button"
              data-active={bookFilter === b.id || undefined}
              onClick={() => setBookFilter(b.id)}
            >
              {b.title}
              <span>{b.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="ws-notes-loading">
          {[0, 1, 2].map((i) => (
            <div className="skeleton h-[112px] rounded-[14px]" key={i} />
          ))}
        </div>
      ) : !notes.length ? (
        <div className="ws-empty-state">
          <span className="ws-empty-mark">
            <Icon name="quote" size={30} />
          </span>
          <h2>还没有笔记</h2>
          <p>在阅读时选中一段文字，或者点顶部的「写笔记」，写下第一条笔记。</p>
          <button className="ws-btn ws-btn-primary" type="button" onClick={onOpenLibrary}>
            <Icon name="book" size={16} />
            去书架挑一本
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="ws-empty-state ws-empty-small">
          <Icon name="search" size={24} />
          <h2>没有符合条件的笔记</h2>
          <button
            className="ws-text-btn"
            type="button"
            onClick={() => {
              setQuery('');
              setBookFilter('all');
              setCategoryFilter('all');
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div className="ws-note-groups">
          {grouped.map(([bookId, group]) => (
            <section className="ws-note-group" key={bookId} aria-label={`${group.title}的笔记`}>
              <header className="ws-note-group-head">
                <div className="ws-note-book-mark">{group.title.slice(0, 1)}</div>
                <div>
                  <h2>{group.title}</h2>
                  <p>{group.author || '未知作者'}</p>
                </div>
                <span>{group.notes.length} 条</span>
              </header>
              <div className="ws-note-grid">
                {group.notes.map((note) => (
                  <button
                    className="ws-note-card"
                    key={note.id}
                    type="button"
                    data-color={note.color}
                    onClick={() => onOpenNote(note)}
                  >
                    <span className="ws-note-card-bar" />
                    {(note.title || note.category) && (
                      <span className="ws-note-card-head">
                        {note.category &&
                          (() => {
                            const c = colorOf(note.category);
                            return (
                              <span className="ws-note-tag">
                                {c && (
                                  <i
                                    style={{
                                      display: 'inline-block',
                                      width: 5,
                                      height: 5,
                                      borderRadius: '50%',
                                      marginRight: 5,
                                      verticalAlign: '1px',
                                      background: COLOR_META[c].solid,
                                    }}
                                  />
                                )}
                                {note.category}
                              </span>
                            );
                          })()}
                        {note.title && <span className="ws-note-card-title">{note.title}</span>}
                      </span>
                    )}
                    <span className="ws-note-card-quote">{note.text}</span>
                    {note.comment && <span className="ws-note-card-comment">{note.comment}</span>}
                    <span className="ws-note-card-foot">
                      <span>{note.chapterTitle || '未命名章节'}</span>
                      <span>{formatDate(note.createdAt)}</span>
                      <Icon name="arrow-up-right" size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
