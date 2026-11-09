import type { DailyStat } from '@shared/models';
import { formatShortDuration } from '@/lib/format';

interface Props {
  stats: DailyStat[];
  weeks?: number;
  todaySeconds?: number;
  className?: string;
}

function keyOf(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function levelOf(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 10 * 60) return 1;
  if (seconds < 25 * 60) return 2;
  if (seconds < 50 * 60) return 3;
  return 4;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function WorkspaceHeatmap({ stats, weeks = 8, todaySeconds = 0, className = '' }: Props) {
  const byDate = new Map(stats.map((s) => [s.date, s]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = keyOf(today);
  const endDow = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(start.getDate() - endDow - (weeks - 1) * 7);

  const cells: { date: Date; key: string; seconds: number; books: string[] }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = keyOf(d);
    const stat = byDate.get(k);
    const seconds = k === todayKey ? Math.max(stat?.seconds ?? 0, todaySeconds) : stat?.seconds ?? 0;
    cells.push({ date: d, key: k, seconds, books: stat?.books.map((b) => b.title) ?? [] });
  }

  const monthLabels: string[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const d = cells[w * 7]?.date;
    if (!d) {
      monthLabels.push('');
      continue;
    }
    const month = d.getMonth();
    monthLabels.push(month !== lastMonth ? `${month + 1}月` : '');
    lastMonth = month;
  }

  return (
    <div className={`ws-heatmap ${className}`.trim()}>
      <div className="ws-heatmap-months">
        {monthLabels.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div className="ws-heatmap-body">
        <div className="ws-heatmap-weekdays">
          {WEEKDAYS.map((d, i) => (
            <span key={d} data-odd={i % 2 === 0 || undefined}>
              {i % 2 === 0 ? d : ''}
            </span>
          ))}
        </div>
        <div
          className="ws-heatmap-grid"
          role="img"
          aria-label="最近阅读热力图"
        >
          {cells.map((c) => (
            <span
              key={c.key}
              className="ws-heatmap-cell"
              data-level={levelOf(c.seconds)}
              title={`${c.key} · ${c.seconds > 0 ? formatShortDuration(c.seconds) : '没有阅读'}${
                c.books.length ? ` · ${c.books.join('、')}` : ''
              }`}
            />
          ))}
        </div>
      </div>
      <div className="ws-heatmap-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} data-level={l} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
