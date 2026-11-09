import type { DailyStat } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { formatShortDuration } from '@/lib/format';
import { dateKey, formatHistoryDate, longestStreak } from '@/lib/workspace';
import { WorkspaceHeatmap } from '@/components/workspace/WorkspaceHeatmap';

interface Props {
  stats: DailyStat[];
  todaySeconds: number;
  onSection: (section: 'analysis' | 'library') => void;
}

function mergeDayBooks(books: DailyStat['books']): DailyStat['books'] {
  const map = new Map<string, DailyStat['books'][number]>();
  for (const book of books) {
    const key = book.title.trim() || book.bookId;
    const prev = map.get(key);
    if (prev) prev.seconds += book.seconds;
    else map.set(key, { ...book });
  }
  return [...map.values()];
}

export function WorkspaceHistory({ stats, todaySeconds, onSection }: Props) {
  const today = dateKey(new Date());
  const days = stats
    .map((s) => ({
      ...s,
      seconds: s.date === today ? Math.max(s.seconds, todaySeconds) : s.seconds,
    }))
    .filter((s) => s.seconds >= 60)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSeconds = days.reduce((sum, d) => sum + d.seconds, 0);
  const first = days.length ? days[days.length - 1].date : null;
  const notedDays = days.filter((d) => d.noteCount > 0).length;

  return (
    <div className="ws-view ws-history">
      <header className="ws-view-head">
        <div>
          <span className="ws-eyebrow">
            <span className="ws-eyebrow-dot" /> 读过的日子
          </span>
          <h1>阅读记录</h1>
          <p>把坐下来读书的日子，按时间放在这里。</p>
        </div>
        <button className="ws-btn ws-btn-quiet" type="button" onClick={() => onSection('analysis')}>
          <Icon name="chart" size={16} />
          看阅读统计
        </button>
      </header>

      <section className="ws-history-stats" aria-label="阅读记录概览">
        <div>
          <span>读过的天数</span>
          <strong>{days.length} 天</strong>
        </div>
        <div>
          <span>累计阅读</span>
          <strong>{formatShortDuration(totalSeconds)}</strong>
        </div>
        <div>
          <span>连续阅读</span>
          <strong>{longestStreak(stats)} 天</strong>
        </div>
        <div>
          <span>写过笔记的天数</span>
          <strong>{notedDays} 天</strong>
        </div>
      </section>

      <section className="ws-panel ws-heat-panel ws-history-heat" aria-label="阅读日历">
        <div className="ws-panel-head">
          <div>
            <span className="ws-panel-kicker">阅读日历</span>
            <h2>最近一年</h2>
          </div>
          {first && <span className="ws-panel-total-inline">从 {formatHistoryDate(first)} 开始</span>}
        </div>
        <WorkspaceHeatmap stats={stats} todaySeconds={todaySeconds} weeks={52} />
      </section>

      {days.length ? (
        <section className="ws-timeline" aria-label="最近阅读记录">
          <div className="ws-panel-head">
            <div>
              <span className="ws-panel-kicker">时间线</span>
              <h2>读过的日子</h2>
            </div>
            <span className="ws-panel-total-inline">最近 {Math.min(24, days.length)} 天</span>
          </div>
          <div className="ws-timeline-list">
            {days.slice(0, 24).map((day) => (
              <article className="ws-day-row" key={day.date}>
                <div className="ws-day-date">
                  <strong>{formatHistoryDate(day.date)}</strong>
                  <span>{day.date}</span>
                </div>
                <div className="ws-day-time">
                  <strong>{formatShortDuration(day.seconds)}</strong>
                  {day.noteCount > 0 && <span>{day.noteCount} 条笔记</span>}
                </div>
                <div className="ws-day-books">
                  {day.books.length ? (
                    mergeDayBooks(day.books)
                      .filter((b) => b.seconds > 0)
                      .sort((a, b) => b.seconds - a.seconds)
                      .slice(0, 3)
                      .map((b) => (
                        <span key={b.bookId} className="ws-day-book">
                          <Icon name="book" size={12} />
                          {b.title}
                          <em>{formatShortDuration(b.seconds)}</em>
                        </span>
                      ))
                  ) : (
                    <span className="ws-day-empty">没有分书记录</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className="ws-empty-state">
          <span className="ws-empty-mark">
            <Icon name="calendar" size={30} />
          </span>
          <h2>还没有阅读记录</h2>
          <p>打开一本书，读上几分钟，这里就会留下记录。</p>
          <button className="ws-btn ws-btn-primary" type="button" onClick={() => onSection('library')}>
            <Icon name="book" size={16} />
            去书架
          </button>
        </div>
      )}
    </div>
  );
}
