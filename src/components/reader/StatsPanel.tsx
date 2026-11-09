import { useEffect, useMemo, useState } from 'react';
import type { Book, DailyStat, Note, Progress } from '@shared/models';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { TimerControls } from '@/components/reader/TimerControls';
import { formatChars, formatClock, formatDuration, weekdayLabel } from '@/lib/format';
import { ipc } from '@/lib/ipc';
import { useStats } from '@/store/useStats';

interface Props {
  open: boolean;
  onClose: () => void;
  book: Book;
  progress: Progress | null;
  notes: Note[];
}

function emptyWeek(): DailyStat[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const pad = (x: number) => String(x).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      seconds: 0,
      books: [],
      noteCount: 0,
      pagesRead: 0,
    } as DailyStat;
  });
}

type AnalysisKey = 'today' | 'week' | 'book' | 'notes';

const TEMPLATES: {
  key: AnalysisKey;
  title: string;
  sub: string;
  icon: 'sparkles' | 'chart' | 'book' | 'quote';
}[] = [
  { key: 'today', title: '今日小结', sub: '今天读了多少', icon: 'sparkles' },
  { key: 'week', title: '本周', sub: '这周读了多少', icon: 'chart' },
  { key: 'book', title: '这本书', sub: '读到哪里了', icon: 'book' },
  { key: 'notes', title: '我的笔记', sub: '留下过什么', icon: 'quote' },
];

export function StatsPanel({ open, onClose, book, progress, notes }: Props) {
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [totals, setTotals] = useState({ seconds: 0, days: 0, notes: 0, allNotes: 0 });
  const [template, setTemplate] = useState<AnalysisKey>('today');
  const [copied, setCopied] = useState(false);
  const activeSeconds = useStats((s) => s.activeSeconds);
  const todaySeconds = useStats((s) => s.todaySeconds);
  const bookTodaySeconds = useStats((s) => s.bookTodaySeconds);
  const running = useStats((s) => s.running);
  const manualPaused = useStats((s) => s.manualPaused);

  useEffect(() => {
    if (!open) return;
    ipc.stats.get(7).then(setStats).catch(() => {});
    ipc.stats.totals().then(setTotals).catch(() => {});
  }, [open]);

  useEffect(() => {
    setCopied(false);
  }, [template, open]);

  const today = stats[stats.length - 1];
  const ratio = progress?.ratio ?? 0;
  const readChars = Math.round(book.meta.totalChars * ratio);
  const chapter = book.chapters.find((c) => c.id === progress?.chapterId);

  const booksToday = useMemo(() => {
    // 同一本书可能因为历史书库 id 不同出现多条记录；今天的“按书”按书名合并，
    // 避免面板里出现两行一模一样的《负动产时代》。
    const map = new Map<string, { bookId: string; title: string; seconds: number }>();
    for (const b of today?.books ?? []) {
      const key = b.title.trim() || b.bookId;
      const existing = map.get(key);
      if (existing) existing.seconds += b.seconds;
      else map.set(key, { bookId: b.bookId, title: b.title, seconds: b.seconds });
    }
    const currentKey = book.meta.title.trim() || book.meta.id;
    const current = map.get(currentKey) ?? {
      bookId: book.meta.id,
      title: book.meta.title,
      seconds: 0,
    };
    current.bookId = book.meta.id;
    // bookTodaySeconds 已经包含本次实时时长；today.books 只含已落盘的部分。
    // 取两者较大值，既避免重复计时，也能在首次统计尚未返回时先用本地数据。
    current.seconds = Math.max(bookTodaySeconds, current.seconds + activeSeconds);
    map.set(currentKey, current);
    return [...map.values()]
      .filter((b) => b.seconds > 0 || b.bookId === book.meta.id)
      .sort((a, b) => b.seconds - a.seconds);
  }, [today, book.meta.id, book.meta.title, activeSeconds, bookTodaySeconds]);

  const chartData = useMemo(() => {
    const base = stats.length ? stats : emptyWeek();
    return base.map((d, i) =>
      i === base.length - 1 ? { ...d, seconds: Math.max(d.seconds, todaySeconds) } : d,
    );
  }, [stats, todaySeconds]);

  const chartMax = Math.max(...chartData.map((d) => d.seconds), 600);
  const weekTotal = chartData.reduce((sum, d) => sum + d.seconds, 0);
  const todayNotes = today?.noteCount ?? 0;
  const stateLabel = running ? '计时中' : manualPaused ? '已暂停' : '未开始';
  const pct = Math.round(ratio * 100);
  const remainingChars = Math.max(0, book.meta.totalChars - readChars);

  const analysis = useMemo(() => {
    const activeDays = chartData.filter((d) => d.seconds >= 60).length;
    const bestDay = chartData.reduce((a, b) => (b.seconds > a.seconds ? b : a), chartData[0]);
    const avg = Math.round(weekTotal / 7);
    const recent = [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 2)
      .map((n) => ({
        chapter: n.chapterTitle,
        quote: (n.text || n.comment || '').replace(/\s+/g, ' ').trim().slice(0, 42),
      }));

    if (template === 'week') {
      return {
        kicker: '本周',
        title: weekTotal > 0 ? `七天里，读了 ${formatDuration(weekTotal)}` : '这一周还没有开始',
        body:
          weekTotal > 0
            ? `有 ${activeDays} 天真正翻开过书，平均每天 ${formatDuration(avg)}。读得最多的是周${weekdayLabel(
                bestDay.date,
              )}，${formatDuration(bestDay.seconds)}。${
                activeDays >= 5 ? '节奏很稳，继续保持。' : '不用追时长，明天再读一页就好。'
              }`
            : '数字还是零，但书一直在那里。今天翻开一页，这一周就有了起点。',
        foot: `7 天合计 ${formatDuration(weekTotal)} · 今天 ${formatDuration(todaySeconds)} · 累计 ${formatDuration(
          totals.seconds,
        )}`,
      };
    }

    if (template === 'book') {
      return {
        kicker: '这本书',
        title: `《${book.meta.title}》读到了 ${pct}%`,
        body:
          ratio > 0
            ? `已经读过 ${formatChars(readChars)}，还剩 ${formatChars(remainingChars)}。${
                notes.length > 0 ? `留下了 ${notes.length} 条笔记。` : '还没有留下笔记。'
              }${chapter ? `现在停在「${chapter.title}」。` : ''}`
            : '还没有开始读。第一页往往最难，但也最短。',
        foot: `${book.meta.chapterCount} 章 · ${formatChars(book.meta.totalChars)} · ${notes.length} 条笔记`,
      };
    }

    if (template === 'notes') {
      const quoteLine = recent.map((n) => `「${n.quote || '（未写笔记）'}」`).join('　');
      return {
        kicker: '我的笔记',
        title:
          notes.length > 0
            ? `这本书留下了 ${notes.length} 条笔记`
            : todayNotes > 0
              ? `今天写了 ${todayNotes} 条笔记`
              : '还没有留下笔记',
        body:
          notes.length > 0
            ? `${recent.length > 0 ? `最近写在「${recent[0].chapter}」：${quoteLine}` : ''}${
                notes.length > 2 ? ` 还有 ${notes.length - 2} 条，去笔记面板慢慢看。` : ''
              }`
            : todayNotes > 0
              ? `今天的 ${todayNotes} 条笔记不在当前这本书里。打开对应的书，或者去笔记面板回看。`
              : '选中一段文字，或者点右上角「写笔记」，就能把笔记留下来。',
        foot: `今天 ${todayNotes} 条 · 累计 ${totals.allNotes} 条 · 这本书 ${notes.length} 条`,
      };
    }

    return {
      kicker: '今日小结',
      title: todaySeconds > 0 ? `今天读了 ${formatDuration(todaySeconds)}` : '今天还没有开始读',
      body:
        todaySeconds > 0
          ? `其中《${book.meta.title}》${formatDuration(bookTodaySeconds)}。这本书读到 ${pct}%，${
              todayNotes > 0 ? `今天留下 ${todayNotes} 条笔记。` : '今天还没有留下笔记。'
            }${booksToday.length > 1 ? `今天翻开的 ${booksToday.length} 本书，都记在下面。` : ''}`
          : '翻开一页，计时就会自己走起来。读多读少都算数。',
      foot: `今天 ${formatDuration(todaySeconds)} · 这本书 ${formatDuration(
        bookTodaySeconds,
      )} · 今日笔记 ${todayNotes}`,
    };
  }, [
    template,
    chartData,
    weekTotal,
    todaySeconds,
    totals.seconds,
    totals.allNotes,
    book.meta.title,
    book.meta.totalChars,
    book.meta.chapterCount,
    bookTodaySeconds,
    booksToday.length,
    pct,
    readChars,
    remainingChars,
    notes,
    chapter,
    ratio,
    todayNotes,
  ]);

  const copyReport = async () => {
    const text = `${analysis.kicker} · ${analysis.title}\n\n${analysis.body}\n${analysis.foot}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="阅读数据"
      subtitle="把读过的，慢慢收成一页"
      width={424}
    >
      <section className="stats-live">
        <div className="stats-live-head">
          <span className="stats-live-label">正在读</span>
          <span className="stats-live-state" data-running={running || undefined}>
            {stateLabel}
          </span>
        </div>
        <div className="stats-live-clock" title="本次阅读时间，暂停后停止">
          {formatClock(activeSeconds)}
        </div>
        <div className="stats-live-sub">
          这本书今天 {formatDuration(bookTodaySeconds)} · 今天总共 {formatDuration(todaySeconds)}
        </div>
        <TimerControls className="stats-live-controls" />
        <p className="stats-live-note">重置会把这本书今天的阅读时间清零，不计入任何累计。</p>
      </section>

      <section className="mt-6">
        <div className="stats-analysis-head">
          <SectionLabel>统计模板</SectionLabel>
          <span className="stats-analysis-hint">换一个角度看自己</span>
        </div>
        <div className="stats-templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              className="stats-template"
              data-active={template === t.key || undefined}
              onClick={() => setTemplate(t.key)}
            >
              <span className="stats-template-icon">
                <Icon name={t.icon} size={15} />
              </span>
              <span className="stats-template-copy">
                <b>{t.title}</b>
                <em>{t.sub}</em>
              </span>
            </button>
          ))}
        </div>

        <div className="stats-report" data-template={template}>
          <div className="stats-report-head">
            <span className="stats-report-kicker">{analysis.kicker}</span>
            <button type="button" className="stats-report-copy" onClick={copyReport}>
              <Icon name={copied ? 'check' : 'export'} size={13} />
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <h4 className="stats-report-title">{analysis.title}</h4>
          <p className="stats-report-body">{analysis.body}</p>
          <div className="stats-report-foot">{analysis.foot}</div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Metric value={formatDuration(todaySeconds)} label="今天读了" accent />
          <Metric value={formatDuration(bookTodaySeconds)} label="这本书今天" />
          <Metric value={String(todayNotes)} label="今日笔记" />
          <Metric value={`${pct}%`} label="这本书进度" />
        </div>
      </section>

      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <SectionLabel>今天 · 按书</SectionLabel>
          <span className="stats-week-total">{booksToday.length} 本</span>
        </div>
        <div className="stats-book-list">
          {booksToday.length === 0 ? (
            <p className="stats-empty">今天还没有翻开书</p>
          ) : (
            booksToday.map((b) => (
              <div
                key={b.bookId}
                className="stats-book-row"
                data-current={b.bookId === book.meta.id || undefined}
              >
                <span className="stats-book-name" title={b.title}>
                  {b.title}
                </span>
                <span className="stats-book-time">{formatClock(b.seconds)}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <SectionLabel>最近 7 天</SectionLabel>
          <span className="stats-week-total">合计 {formatDuration(weekTotal)}</span>
        </div>
        <div className="mt-3 rounded-[12px] border border-line px-3 pb-2 pt-3">
          <svg viewBox="0 0 322 104" className="w-full" style={{ height: 104 }}>
            {chartData.map((d, i) => {
              const h = Math.max(2, (d.seconds / chartMax) * 68);
              const x = i * 44 + 9;
              const isToday = i === chartData.length - 1;
              return (
                <g key={d.date}>
                  <title>
                    {d.date} · {formatDuration(d.seconds)}
                  </title>
                  <rect
                    x={x}
                    y={80 - h}
                    width={22}
                    height={h}
                    rx={3}
                    fill="var(--accent)"
                    style={{ opacity: d.seconds === 0 ? 0.25 : isToday ? 1 : 0.3 }}
                  />
                  <text
                    x={x + 11}
                    y={97}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--text-tertiary)"
                    style={{ fontFamily: 'var(--font-sans)' }}
                  >
                    {weekdayLabel(d.date)}
                  </text>
                </g>
              );
            })}
            <line x1="6" y1="80.5" x2="316" y2="80.5" stroke="var(--line)" strokeWidth="1" />
          </svg>
        </div>
      </section>

      <section className="mt-7">
        <SectionLabel>这本书</SectionLabel>
        <div className="mt-2.5 rounded-[12px] border border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{book.meta.title}</div>
              <div className="mt-1 truncate text-[11px] text-ink-3">
                {chapter ? `正在读 · ${chapter.title}` : `${book.meta.chapterCount} 章`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular-nums text-[22px] font-semibold leading-none text-accent">
                {Math.round(ratio * 100)}
                <span className="ml-0.5 text-[11px] font-normal opacity-60">%</span>
              </div>
            </div>
          </div>

          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max(1, ratio * 100)}%` }}
            />
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-3">
            <span>
              已读 {formatChars(readChars)} / {formatChars(book.meta.totalChars)}
            </span>
            <span>{notes.length} 条笔记</span>
          </div>
        </div>
      </section>

      <section className="mt-7">
        <SectionLabel>累计</SectionLabel>
        <div className="mt-2 flex items-baseline gap-2 text-[12.5px] leading-relaxed text-ink-2">
          <span>共读</span>
          <span className="text-[16px] font-semibold text-ink">{formatDuration(totals.seconds)}</span>
          <span className="text-ink-3">
            · {totals.days} 天 · {totals.allNotes} 条笔记
          </span>
        </div>
      </section>

      <p className="mt-8 text-[10.5px] leading-relaxed text-ink-3 opacity-70">
        每 30 秒自动保存一次。所有数据只保存在本机，不会上传到任何地方。
      </p>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{children}</h3>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[12px] border border-line px-4 py-3.5">
      <div
        className="tabular-nums text-[17px] font-semibold leading-tight"
        style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}
      >
        {value}
      </div>
      <div className="mt-1 text-[10.5px] text-ink-3">{label}</div>
    </div>
  );
}
