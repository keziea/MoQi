import type { BookMeta, DailyStat, Note, Progress } from '@shared/models';
import { weekdayLabel } from '@/lib/format';

export interface OpenTarget {
  chapterId: string;
  blockId?: string;
}

export interface WorkspaceNote extends Note {
  bookTitle: string;
  bookAuthor: string;
}

export interface BookTally {
  title: string;
  author: string;
  seconds: number;
  books: number;
}

export interface InsightInput {
  days: number;
  stats: DailyStat[];
  notes: WorkspaceNote[];
  books: BookMeta[];
  progressMap: Record<string, Progress | undefined>;
  todaySeconds: number;
}

export type InsightKey = 'rhythm' | 'focus' | 'taste' | 'notes';

export const INSIGHT_TEMPLATES: { key: InsightKey; title: string; hint: string; icon: string }[] = [
  { key: 'rhythm', title: '阅读节奏', hint: '什么时候读得最多', icon: 'flame' },
  { key: 'focus', title: '专注情况', hint: '坐下来的那些天', icon: 'target' },
  { key: 'taste', title: '读得最多的书', hint: '时间都花在哪本书', icon: 'book' },
  { key: 'notes', title: '笔记习惯', hint: '留下过什么', icon: 'pen' },
];

const PAD = (n: number) => String(n).padStart(2, '0');

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function noteDate(n: Note): string {
  const d = new Date(n.createdAt);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function withinDays(dateStr: string, days: number): boolean {
  // days <= 0 表示「全部」：从开始使用到现在，不做时间裁剪
  if (days <= 0) return true;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  return d >= start && d <= end;
}

export function sumStats(stats: DailyStat[]): number {
  return stats.reduce((sum, s) => sum + s.seconds, 0);
}

/** 今天的数据以内存计时为准，避免工作台打开后统计还没有 flush。 */
export function totalWithLive(stats: DailyStat[], todaySeconds: number): number {
  const total = sumStats(stats);
  const today = stats.find((s) => s.date === todayKey());
  return total - (today?.seconds ?? 0) + Math.max(today?.seconds ?? 0, todaySeconds);
}

export function activeDays(stats: DailyStat[], todaySeconds = 0): number {
  return stats.filter((s) => (s.date === todayKey() ? Math.max(s.seconds, todaySeconds) : s.seconds) >= 60)
    .length;
}

export function streakDays(stats: DailyStat[], todaySeconds = 0): number {
  const map = new Map(stats.map((s) => [s.date, s.seconds]));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const today = dateKey(cursor);
  if ((map.get(today) ?? 0) < 60 && todaySeconds < 60) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const k = dateKey(cursor);
    const seconds = k === today ? Math.max(map.get(k) ?? 0, todaySeconds) : map.get(k) ?? 0;
    if (seconds < 60) break;
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

export function bestWeekday(stats: DailyStat[]): { label: string; seconds: number } {
  const buckets = new Array(7).fill(0) as number[];
  for (const s of stats) {
    const d = new Date(`${s.date}T00:00:00`);
    buckets[d.getDay()] += s.seconds;
  }
  const max = Math.max(...buckets);
  const idx = buckets.indexOf(max);
  return {
    label: `周${['日', '一', '二', '三', '四', '五', '六'][idx]}`,
    seconds: max,
  };
}

export function bookTallies(stats: DailyStat[]): BookTally[] {
  const map = new Map<string, BookTally>();
  for (const day of stats) {
    for (const b of day.books) {
      const key = b.title.trim() || b.bookId;
      const prev = map.get(key);
      if (prev) {
        prev.seconds += b.seconds;
        prev.books += 1;
      } else {
        map.set(key, {
          title: b.title || '未命名',
          author: '',
          seconds: b.seconds,
          books: 1,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds);
}

export function longestStreak(stats: DailyStat[]): number {
  const dates = [...new Set(stats.filter((s) => s.seconds >= 60).map((s) => s.date))].sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const date of dates) {
    const d = new Date(`${date}T00:00:00`);
    if (prev && d.getTime() - prev.getTime() === 86400000) run += 1;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface InsightReport {
  title: string;
  kicker: string;
  paragraphs: string[];
  footnote: string;
}

function duration(seconds: number): string {
  if (seconds < 60) return '不到 1 分钟';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export function buildInsight(key: InsightKey, input: InsightInput): InsightReport {
  const { stats, notes, days } = input;
  const total = totalWithLive(stats, input.todaySeconds);
  const active = activeDays(stats, input.todaySeconds);
  const range = `最近 ${days} 天`;
  const notesInRange = notes.filter((n) => {
    const d = new Date(n.createdAt);
    const date = dateKey(d);
    return withinDays(date, days);
  });
  const tally = bookTallies(stats);
  const top = tally[0];

  if (key === 'rhythm') {
    const weekday = bestWeekday(stats);
    const avg = active > 0 ? total / active : 0;
    return {
      title: `${range}，你把时间读成了自己的节奏`,
      kicker: '阅读节奏',
      paragraphs: [
        `这段时间一共读了 ${duration(total)}，其中有 ${active} 天真正翻开过书。${
          weekday.seconds > 0 ? `${weekday.label}是你最常坐下来的日子，累计 ${duration(weekday.seconds)}。` : ''
        }`,
        active > 0
          ? `平均每个读书日读 ${duration(avg)}。不用把每一天都填满，能回来就好。`
          : '还没有形成固定的节奏。挑一个不被打扰的晚上，从十页开始。',
      ],
      footnote: `${range} · ${active} 个读书日 · 最长连续 ${longestStreak(stats)} 天`,
    };
  }

  if (key === 'focus') {
    const ratio = Math.round((active / Math.max(1, days)) * 100);
    const avg = active > 0 ? total / active : 0;
    return {
      title: `你有 ${active} 天，把自己交给了阅读`,
      kicker: '专注情况',
      paragraphs: [
        `在 ${range}里，${ratio}% 的日子留下过阅读记录，平均每个读书日 ${duration(avg)}。最长的一段连续阅读是 ${longestStreak(
          stats
        )} 天。`,
        ratio >= 60
          ? '阅读已经是你生活里稳定的一部分。保持现在的频率，比偶尔读很久更重要。'
          : '不用追求每天都读。把书放在顺手的地方，想起来时翻开一页，也算数。',
      ],
      footnote: `${active}/${days} 天 · 读书天占比 ${ratio}% · 平均 ${duration(avg)}/读书日`,
    };
  }

  if (key === 'taste') {
    const second = tally[1];
    const share = top && total > 0 ? Math.round((top.seconds / total) * 100) : 0;
    return {
      title: top ? `这段时间，你最常回到《${top.title}》` : '书单还在等你翻开第一页',
      kicker: '读得最多的书',
      paragraphs: top
        ? [
            `《${top.title}》占了 ${share}% 的阅读时间，共 ${duration(top.seconds)}。${
              second ? `其次是《${second.title}》，${duration(second.seconds)}。` : ''
            }`,
            share >= 70
              ? '你更享受把一本书读深，而不是同时铺开很多本。'
              : '你在几本书之间来回走，像是在比较不同的生活。',
          ]
        : ['书架还是空的，或者还没有开始计时。去书架挑一本，读五分钟就好。'],
      footnote: top
        ? `${tally.length} 本书 · ${duration(total)} · 最多的一本占 ${share}%`
        : `${input.books.length} 本书在架上`,
    };
  }

  const recent = [...notes].sort((a, b) => b.createdAt - a.createdAt)[0];
  const noteBooks = new Set(notes.map((n) => n.bookId)).size;
  return {
    title: `你留下了 ${notes.length} 条笔记`,
    kicker: '笔记习惯',
    paragraphs: [
      notes.length
        ? `这些笔记来自 ${noteBooks} 本书。最近一条在《${recent.bookTitle}》${
            recent.chapterTitle ? ` · ${recent.chapterTitle}` : ''
          }，写于 ${noteDate(recent)}。`
        : '还没有留下笔记。选中一段让你停下来的文字，写一句当时的笔记，以后会感谢现在的自己。',
      notesInRange.length
        ? `${range}里新增了 ${notesInRange.length} 条。划线和笔记，是你和书之间的私人物件。`
        : '这段时间没有新增笔记。读得慢一点，也许就会遇见想记下来的句子。',
    ],
    footnote: `${notes.length} 条笔记 · ${noteBooks} 本书 · 本周 ${notesInRange.length} 条`,
  };
}

export function weekdayOf(date: string): string {
  return weekdayLabel(date);
}

export function formatHistoryDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekdayLabel(date)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}
