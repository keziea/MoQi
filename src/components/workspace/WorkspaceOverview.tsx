import { useEffect, useState } from 'react';
import type { BookMeta, DailyStat, Progress } from '@shared/models';
import { formatShortDuration, formatPercent, coverUrl } from '@/lib/format';
import { formatHistoryDate, dateKey, type WorkspaceNote } from '@/lib/workspace';
import { Icon } from '@/components/ui/Icon';
import { readStatus } from '@/lib/reading';
import type { ShelfGroup } from '@/lib/library';

interface Props {
  groups: ShelfGroup[];
  progressMap: Record<string, Progress>;
  stats: DailyStat[];
  notes: WorkspaceNote[];
  todaySeconds: number;
  goalMinutes: number;
  streak: number;
  onGoal: (minutes: number) => void;
  onOpenBook: (bookId: string) => void;
  onOpenNote: (note: WorkspaceNote) => void;
  onSection: (section: 'library' | 'notes' | 'analysis' | 'history') => void;
  onImport: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function shortDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

function dateLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${y}.${m}.${day} · 周${week}`;
}

function BookCover({ book, className = '' }: { book: BookMeta; className?: string }) {
  const src = coverUrl(book);
  return (
    <span className={`ws-cover ${className}`.trim()}>
      {src ? <img src={src} alt="" /> : <span className="ws-cover-fallback">{book.title.slice(0, 1)}</span>}
    </span>
  );
}

export function WorkspaceOverview({
  groups,
  progressMap,
  stats,
  notes,
  todaySeconds,
  goalMinutes,
  streak,
  onGoal,
  onOpenBook,
  onOpenNote,
  onSection,
  onImport,
}: Props) {
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goalMinutes);
  useEffect(() => {
    setGoalDraft(goalMinutes);
  }, [goalMinutes]);

  const now = new Date();
  // 目标可以小到 1 分钟：读三分钟也是读
  const goalSeconds = Math.max(1, goalMinutes) * 60;
  const goalPct = Math.min(100, Math.round((todaySeconds / goalSeconds) * 100));
  const ring = 2 * Math.PI * 40;
  const recent =
    [...groups].sort((a, b) => (b.meta.lastOpenedAt ?? 0) - (a.meta.lastOpenedAt ?? 0))[0] ?? groups[0];
  const recentProgress = recent ? progressMap[recent.meta.id] : undefined;
  /** 同一本书可能有多个格式副本，任何一个打开过都算这本书读过 */
  const idsOf = (g: ShelfGroup) => [g.meta.id, ...g.copies.map((c) => c.id)];
  const reading = groups.filter((g) => idsOf(g).some((id) => readStatus(progressMap[id]) === 'reading')).length;
  const finishedCount = groups.filter((g) => idsOf(g).some((id) => progressMap[id]?.finished)).length;
  const notesThisWeek = notes.filter((n) => Date.now() - n.createdAt < 7 * 86400000).length;
  const recentNotes = [...notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return dateKey(d);
  });
  const weekStats = weekDays.map((date) => {
    const stat = stats.find((s) => s.date === date);
    const seconds = date === dateKey(now) ? Math.max(stat?.seconds ?? 0, todaySeconds) : stat?.seconds ?? 0;
    return { date, seconds };
  });
  const weekMax = Math.max(1, ...weekStats.map((d) => d.seconds));
  const weekTotal = weekStats.reduce((sum, d) => sum + d.seconds, 0);

  const randomBook = () => {
    if (!groups.length) return;
    const pick = groups[Math.floor(Math.random() * groups.length)];
    onOpenBook(pick.meta.id);
  };

  return (
    <div className="ws-view ws-overview">
      <section className="ws-hero">
        <div className="ws-hero-copy">
          <span className="ws-eyebrow">
            <span className="ws-eyebrow-dot" /> {dateLabel()}
          </span>
          <h1 className="ws-hero-title">
            {greeting()}，
            <br />
            <em>今天想读点什么？</em>
          </h1>
          <p className="ws-hero-sub">
            {groups.length
              ? `书架上有 ${groups.length} 本书，${reading ? `${reading} 本正在读。` : '挑一本喜欢的，慢慢翻开。'}`
              : '把第一本书放进来，这里就会开始记录你的阅读。'}
          </p>
          <div className="ws-hero-actions">
            {recent ? (
              <button className="ws-btn ws-btn-primary" type="button" onClick={() => onOpenBook(recent.meta.id)}>
                <Icon name="play" size={16} />
                阅读《{recent.meta.title}》
              </button>
            ) : (
              <button className="ws-btn ws-btn-primary" type="button" onClick={onImport}>
                <Icon name="plus" size={16} />
                导入第一本书
              </button>
            )}
            <button className="ws-btn ws-btn-quiet" type="button" onClick={randomBook} disabled={!groups.length}>
              <Icon name="sparkles" size={16} />
              随便翻一本
            </button>
          </div>
        </div>

        <aside className="ws-goal-card" aria-label="今日阅读目标">
          <div className="ws-goal-top">
            <span className="ws-goal-kicker">今日目标</span>
            <span className="ws-goal-select-wrap">
              <button
                type="button"
                className="ws-goal-trigger"
                onClick={() => {
                  setGoalDraft(goalMinutes);
                  setGoalOpen((v) => !v);
                }}
                aria-expanded={goalOpen}
                aria-label="设置今日阅读目标"
              >
                {goalMinutes} 分钟
                <Icon name="chevron-down" size={12} />
              </button>

              {goalOpen && (
                <>
                  <span className="ws-goal-scrim" onClick={() => setGoalOpen(false)} />
                  <div className="ws-goal-pop" role="dialog" aria-label="每日阅读目标">
                    <p>每天想读多久？</p>
                    <label className="ws-goal-number">
                      <input
                        type="number"
                        min={1}
                        max={600}
                        value={goalDraft}
                        autoFocus
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setGoalDraft(Number.isFinite(n) ? Math.max(1, Math.min(600, Math.round(n))) : 1);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onGoal(goalDraft);
                            setGoalOpen(false);
                          }
                          if (e.key === 'Escape') setGoalOpen(false);
                        }}
                      />
                      <span>分钟</span>
                    </label>
                    <div className="ws-goal-presets">
                      {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          data-active={goalDraft === m || undefined}
                          onClick={() => setGoalDraft(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <div className="ws-goal-pop-foot">
                      <button type="button" className="ws-text-btn" onClick={() => setGoalOpen(false)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="ws-btn ws-btn-primary"
                        onClick={() => {
                          onGoal(goalDraft);
                          setGoalOpen(false);
                        }}
                      >
                        就这个
                      </button>
                    </div>
                  </div>
                </>
              )}
            </span>
          </div>
          <div className="ws-goal-visual">
            <svg viewBox="0 0 96 96" className="ws-goal-ring" aria-hidden="true">
              <circle cx="48" cy="48" r="40" className="ws-goal-track" />
              <circle
                cx="48"
                cy="48"
                r="40"
                className="ws-goal-value"
                strokeDasharray={`${(goalPct / 100) * ring} ${ring}`}
              />
            </svg>
            <div className="ws-goal-center">
              <strong>{goalPct}<i>%</i></strong>
            </div>
          </div>
          <p className="ws-goal-note">
            <span className="ws-goal-today">今天 {formatShortDuration(todaySeconds)}</span>
            {todaySeconds >= goalSeconds
              ? '目标已完成，剩下的时间读点闲书也好。'
              : `还差 ${formatShortDuration(Math.max(0, goalSeconds - todaySeconds))}，一页一页来。`}
          </p>
        </aside>
      </section>

      {recent && (
        <section className="ws-continue" aria-label="继续阅读">
          <div className="ws-continue-cover">
            <BookCover book={recent.meta} />
          </div>
          <div className="ws-continue-main">
            <span className="ws-continue-kicker">
              <Icon name="clock" size={13} /> 继续阅读
            </span>
            <h2>{recent.meta.title}</h2>
            <p>{recent.meta.author}</p>
            <div className="ws-continue-meta">
              <span>{recent.formats.map((f) => f.toUpperCase()).join(' · ')}</span>
              <i />
              <span>{recent.meta.chapterCount} 章</span>
              <i />
              <span>{formatPercent(recentProgress?.ratio ?? 0)}</span>
            </div>
          </div>
          <div className="ws-continue-progress">
            <div className="ws-continue-percent">
              {formatPercent(recentProgress?.ratio ?? 0)}
              <span>已读</span>
            </div>
            <button className="ws-btn ws-btn-small" type="button" onClick={() => onOpenBook(recent.meta.id)}>
              阅读
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <i
            className="ws-continue-rail"
            style={{ width: `${Math.max(0, Math.min(1, recentProgress?.ratio ?? 0)) * 100}%` }}
            aria-hidden="true"
          />
        </section>
      )}

      <section className="ws-metrics" aria-label="阅读概览">
        <div className="ws-metric">
          <span className="ws-metric-icon" data-tone="clay">
            <Icon name="clock" size={18} />
          </span>
          <div>
            <span className="ws-metric-label">今天读了</span>
            <strong>{formatShortDuration(todaySeconds)}</strong>
            <small>{notesThisWeek ? `本周留下 ${notesThisWeek} 条笔记` : '时间会替你记住'}</small>
          </div>
        </div>
        <div className="ws-metric">
          <span className="ws-metric-icon" data-tone="amber">
            <Icon name="flame" size={18} />
          </span>
          <div>
            <span className="ws-metric-label">连续阅读</span>
            <strong>{streak} 天</strong>
            <small>{streak > 0 ? '保持这个节奏' : '今天翻开一页，就算开始'}</small>
          </div>
        </div>
        <div className="ws-metric">
          <span className="ws-metric-icon" data-tone="moss">
            <Icon name="pen" size={18} />
          </span>
          <div>
            <span className="ws-metric-label">全部笔记</span>
            <strong>{notes.length} 条</strong>
            <small>{notes.length ? `来自 ${new Set(notes.map((n) => n.bookId)).size} 本书` : '还没有写下笔记'}</small>
          </div>
        </div>
        <div className="ws-metric">
          <span className="ws-metric-icon" data-tone="indigo">
            <Icon name="book" size={18} />
          </span>
          <div>
            <span className="ws-metric-label">正在读</span>
            <strong>{reading} 本</strong>
            <small>
              {groups.length ? `共 ${groups.length} 本 · 读完 ${finishedCount} 本` : '书架还空着'}
            </small>
          </div>
        </div>
      </section>

      <div className="ws-columns">
        <section className="ws-panel ws-week" aria-label="最近七天阅读">
          <div className="ws-panel-head">
            <div>
              <span className="ws-panel-kicker">最近 7 天</span>
              <h2>阅读节奏</h2>
            </div>
            <div className="ws-panel-total">
              <span>本周累计</span>
              <strong>{formatShortDuration(weekTotal)}</strong>
            </div>
          </div>
          <p className="ws-week-caption">
            {weekStats.some((d) => d.seconds > 0)
              ? `这周有 ${weekStats.filter((d) => d.seconds > 0).length} 天翻开书，${formatShortDuration(weekTotal)} 留在纸页之间。`
              : '这周还没有记录，翻开一页，节奏就会开始。'}
          </p>
          <div className="ws-bars">
            {weekStats.map((d) => {
              const height = d.seconds ? Math.max(6, Math.round((d.seconds / weekMax) * 100)) : 3;
              return (
                <div className="ws-bar-col" key={d.date}>
                  <span className="ws-bar-value">{d.seconds ? formatShortDuration(d.seconds) : ''}</span>
                  <div className="ws-bar-track">
                    <i
                      data-today={d.date === dateKey(now) || undefined}
                      data-zero={!d.seconds || undefined}
                      style={{ height: `${height}%` }}
                      title={`${formatHistoryDate(d.date)} · ${formatShortDuration(d.seconds)}`}
                    />
                  </div>
                  <span className="ws-bar-label" data-today={d.date === dateKey(now) || undefined}>
                    周{shortDay(d.date)}
                  </span>
                </div>
              );
            })}
          </div>
          <button className="ws-panel-link" type="button" onClick={() => onSection('analysis')}>
            看完整统计 <Icon name="arrow-up-right" size={14} />
          </button>
        </section>

        <section className="ws-panel ws-notes-peek" aria-label="最近笔记">
          <div className="ws-panel-head">
            <div>
              <span className="ws-panel-kicker">最近留下</span>
              <h2>笔记</h2>
            </div>
            <button className="ws-text-btn" type="button" onClick={() => onSection('notes')}>
              全部 <Icon name="arrow-right" size={13} />
            </button>
          </div>
          {recentNotes.length ? (
            <div className="ws-note-list">
              {recentNotes.map((n) => (
                <button className="ws-note-peek" key={n.id} type="button" onClick={() => onOpenNote(n)}>
                  <span className="ws-note-color" data-color={n.color} />
                  <span className="ws-note-peek-body">
                    <q>{n.text}</q>
                    <span>
                      《{n.bookTitle}》 · {n.chapterTitle}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          ) : (
            <div className="ws-empty-inline">
              <Icon name="quote" size={20} />
              <p>选中一段文字，或点顶部的「写笔记」。</p>
              <button className="ws-text-btn" type="button" onClick={() => onSection('notes')}>
                去笔记页看看
              </button>
            </div>
          )}
          <p className="ws-note-foot">在阅读页选中文字，或点顶部「写笔记」，笔记会留在这里。</p>
        </section>
      </div>

      <section className="ws-shelf-strip" aria-label="书架一角">
        <div className="ws-panel-head">
          <div>
            <span className="ws-panel-kicker">书架一角</span>
            <h2>最近在架上</h2>
          </div>
          <button className="ws-text-btn" type="button" onClick={() => onSection('library')}>
            全部书籍 <Icon name="arrow-right" size={13} />
          </button>
        </div>
        <div className="ws-strip-body">
          <div className="ws-strip-grid" data-few={groups.length < 3 ? groups.length : undefined}>
            {groups.slice(0, 5).map((g) => (
              <button className="ws-strip-book" key={g.meta.id} type="button" onClick={() => onOpenBook(g.meta.id)}>
                <BookCover book={g.meta} />
                <span>{g.meta.title}</span>
                <small>{formatPercent(progressMap[g.meta.id]?.ratio ?? 0)}</small>
              </button>
            ))}
            <button className="ws-strip-add" type="button" onClick={onImport}>
              <Icon name="plus" size={20} />
              <span>导入书籍</span>
            </button>
          </div>
          {groups.length < 3 && (
            <div className="ws-strip-quote" aria-hidden="true">
              <span>“</span>
              <p>把一本书读旧，比把一百本书翻新更难。</p>
              <small>墨栖 · 我的阅读</small>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
