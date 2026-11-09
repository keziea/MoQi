import { useMemo, useState } from 'react';
import type { BookMeta, DailyStat, Progress } from '@shared/models';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatShortDuration, formatDuration } from '@/lib/format';
import {
  INSIGHT_TEMPLATES,
  buildInsight,
  bookTallies,
  copyText,
  dateKey,
  longestStreak,
  totalWithLive,
  withinDays,
  type InsightKey,
  type WorkspaceNote,
} from '@/lib/workspace';
import { WorkspaceHeatmap } from '@/components/workspace/WorkspaceHeatmap';
import { toast } from '@/lib/toast';

interface Props {
  stats: DailyStat[];
  notes: WorkspaceNote[];
  books: BookMeta[];
  progressMap: Record<string, Progress>;
  todaySeconds: number;
}

type Range = 7 | 30 | 0;

const RANGE_LABEL = (r: Range) => (r === 0 ? '全部' : `最近 ${r} 天`);
const RANGE_KICKER = (r: Range) => (r === 0 ? '从开始用到现在' : `最近 ${r} 天`);

export function WorkspaceAnalysis({ stats, notes, books, progressMap, todaySeconds }: Props) {
  const [range, setRange] = useState<Range>(30);
  const [insight, setInsight] = useState<InsightKey>('rhythm');
  const [copied, setCopied] = useState(false);

  /** 从第一条记录到今天一共跨了多少天 —— 「全部」区间用它算读书天占比 */
  const spanDays = useMemo(() => {
    if (!stats.length) return 1;
    let first = stats[0].date;
    for (const s of stats) if (s.date < first) first = s.date;
    const start = new Date(`${first}T00:00:00`).getTime();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(1, Math.round((today.getTime() - start) / 86400000) + 1);
  }, [stats]);

  const effectiveDays = range === 0 ? spanDays : range;

  const rangeStats = useMemo(
    () => stats.filter((s) => withinDays(s.date, range)),
    [stats, range]
  );
  const total = totalWithLive(rangeStats, todaySeconds);
  /** 从开始用到现在，一共读了多少时间（不受区间影响） */
  const allTotal = totalWithLive(stats, todaySeconds);
  const active = rangeStats.filter((s) => {
    const seconds = s.date === dateKey(new Date()) ? Math.max(s.seconds, todaySeconds) : s.seconds;
    return seconds >= 60;
  }).length;
  const avg = active > 0 ? total / active : 0;
  const tallies = useMemo(() => bookTallies(rangeStats), [rangeStats]);
  const top = tallies[0];
  const shelfCount = useMemo(
    () => new Set(books.map((b) => `${b.title.trim()}|${(b.author ?? '').trim()}`)).size,
    [books]
  );

  /** 打开过就算读过；标记读完的单独计数 */
  const shelfBooks = useMemo(() => {
    const seen = new Set<string>();
    const unique: BookMeta[] = [];
    for (const b of books) {
      const key = `${b.title.trim()}|${(b.author ?? '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(b);
    }
    return unique;
  }, [books]);

  const readBooks = shelfBooks.filter((b) => {
    const p = progressMap[b.id];
    return !!p && (!!p.finished || !!p.openedAt || p.ratio > 0.001);
  }).length;
  const finishedBooks = shelfBooks.filter((b) => progressMap[b.id]?.finished).length;

  const chartDays = useMemo(() => {
    const n = range === 7 ? 7 : 14;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (n - 1 - i));
      const key = dateKey(d);
      const stat = stats.find((s) => s.date === key);
      const seconds = key === dateKey(new Date()) ? Math.max(stat?.seconds ?? 0, todaySeconds) : stat?.seconds ?? 0;
      return { key, seconds, date: d };
    });
  }, [stats, range, todaySeconds]);
  const max = Math.max(1, ...chartDays.map((d) => d.seconds));

  const report = useMemo(
    () =>
      buildInsight(insight, {
        days: effectiveDays,
        stats: rangeStats,
        notes,
        books,
        progressMap,
        todaySeconds,
      }),
    [insight, effectiveDays, rangeStats, notes, books, progressMap, todaySeconds]
  );

  const copyReport = async () => {
    const text = `${report.kicker}\n\n${report.title}\n\n${report.paragraphs.join('\n\n')}\n\n${report.footnote}`;
    const ok = await copyText(text);
    if (!ok) {
      toast('复制失败，请稍后再试');
      return;
    }
    setCopied(true);
    toast('分析已复制');
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="ws-view ws-analysis">
      <header className="ws-view-head">
        <div>
          <span className="ws-eyebrow">
            <span className="ws-eyebrow-dot" /> 只关于你，不跟别人比
          </span>
          <h1>阅读统计</h1>
          <p>把阅读时间、书单和笔记放在一起看，找到自己的节奏。</p>
        </div>
        <div className="ws-range" role="group" aria-label="分析时间范围">
          {([7, 30, 0] as const).map((r) => (
            <button key={r} type="button" data-active={range === r || undefined} onClick={() => setRange(r)}>
              {RANGE_LABEL(r)}
            </button>
          ))}
        </div>
      </header>

      <section className="ws-portrait" aria-label="阅读总览">
        <div className="ws-portrait-copy">
          <span className="ws-panel-kicker">{RANGE_KICKER(range)}</span>
          <h2>
            {range === 0 ? '你一共读了 ' : '你读了 '}
            <em>{formatShortDuration(total)}</em>
          </h2>
          <p>
            {active > 0
              ? `有 ${active} 天真正坐下来读过书，平均每个读书日 ${formatDuration(avg)}。${
                  top ? `最常回到《${top.title}》。` : ''
                }`
              : '还没有足够的阅读记录。翻开一本书，哪怕只读五分钟，这里就会开始有内容。'}
          </p>
          <div className="ws-portrait-tags">
            <span>
              <Icon name="flame" size={14} /> 最长连续 {longestStreak(stats)} 天
            </span>
            <span>
              <Icon name="book" size={14} /> 读过 {readBooks} 本 · 读完 {finishedBooks} 本
            </span>
            <span>
              <Icon name="pen" size={14} /> {notes.length} 条笔记
            </span>
            <span>累计 {formatShortDuration(allTotal)} · 在架 {shelfCount} 本</span>
          </div>
        </div>
        <div className="ws-portrait-nums">
          <div>
            <strong>{active}</strong>
            <span>读书日</span>
          </div>
          <div>
            <strong>{Math.round((active / Math.max(1, effectiveDays)) * 100)}%</strong>
            <span>读书天占比</span>
          </div>
          <div>
            <strong>{formatShortDuration(avg)}</strong>
            <span>平均每天</span>
          </div>
        </div>
      </section>

      <div className="ws-analysis-grid">
        <section className="ws-panel ws-trend" aria-label="阅读趋势">
          <div className="ws-panel-head">
            <div>
              <span className="ws-panel-kicker">阅读趋势</span>
              <h2>每天的阅读时长</h2>
            </div>
            <span className="ws-panel-total-inline">{formatShortDuration(total)} 累计</span>
          </div>
          <div className="ws-trend-bars">
            {chartDays.map((d) => (
              <div className="ws-trend-col" key={d.key}>
                <span>{d.seconds ? formatShortDuration(d.seconds) : ''}</span>
                <div>
                  <i
                    style={{ height: `${d.seconds ? Math.max(4, (d.seconds / max) * 100) : 2}%` }}
                    data-today={d.key === dateKey(new Date()) || undefined}
                    data-zero={!d.seconds || undefined}
                  />
                </div>
                <small>
                  {d.date.getMonth() + 1}/{d.date.getDate()}
                </small>
              </div>
            ))}
          </div>
        </section>

        <section className="ws-panel ws-ranking" aria-label="书单排行">
          <div className="ws-panel-head">
            <div>
              <span className="ws-panel-kicker">时间去向</span>
              <h2>读得最多的书</h2>
            </div>
          </div>
          {tallies.length ? (
            <>
              <div className="ws-rank-list">
                {tallies.slice(0, 5).map((b, i) => (
                  <div className="ws-rank-row" key={b.title}>
                    <span className="ws-rank-no">{String(i + 1).padStart(2, '0')}</span>
                    <div className="ws-rank-main">
                      <div>
                        <strong>{b.title}</strong>
                        <span>{formatShortDuration(b.seconds)}</span>
                      </div>
                      <div className="ws-rank-bar">
                        <i style={{ width: `${Math.max(3, (b.seconds / Math.max(1, tallies[0].seconds)) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="ws-rank-note">按{range === 0 ? '全部时间' : `最近 ${range} 天`}的实际阅读时长统计，同一本书的副本已合并。</p>
            </>
          ) : (
            <p className="ws-panel-empty">开始阅读后，这里会告诉你时间都去了哪本书。</p>
          )}
        </section>
      </div>

      <section className="ws-insight" aria-label="阅读统计模板">
        <div className="ws-panel-head">
          <div>
            <span className="ws-panel-kicker">换一个角度看</span>
            <h2>统计模板</h2>
          </div>
          <button className="ws-text-btn" type="button" onClick={copyReport}>
            <Icon name={copied ? 'check' : 'export'} size={14} />
            {copied ? '已复制' : '复制这段分析'}
          </button>
        </div>
        <div className="ws-template-row">
          {INSIGHT_TEMPLATES.map((t) => (
            <button
              key={t.key}
              className="ws-template"
              type="button"
              data-active={insight === t.key || undefined}
              onClick={() => setInsight(t.key as InsightKey)}
            >
              <span className="ws-template-icon">
                <Icon name={t.icon as IconName} size={17} />
              </span>
              <span>
                <strong>{t.title}</strong>
                <small>{t.hint}</small>
              </span>
              <Icon name={insight === t.key ? 'check' : 'chevron-right'} size={14} />
            </button>
          ))}
        </div>
        <article className="ws-report">
          <span className="ws-report-kicker">{report.kicker}</span>
          <h3>{report.title}</h3>
          {report.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <footer>{report.footnote}</footer>
        </article>
      </section>

      <section className="ws-panel ws-heat-panel" aria-label="阅读热力图">
        <div className="ws-panel-head">
          <div>
            <span className="ws-panel-kicker">阅读记录</span>
            <h2>最近 9 个月</h2>
          </div>
          <span className="ws-panel-total-inline">颜色越深，读得越久</span>
        </div>
        <WorkspaceHeatmap stats={stats} todaySeconds={todaySeconds} weeks={36} />
      </section>
    </div>
  );
}
