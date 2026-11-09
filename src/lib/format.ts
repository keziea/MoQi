import type { BookMeta } from '@shared/models';

const PAD = (n: number) => String(n).padStart(2, '0');

/** 秒 → "1 小时 23 分" / "42 分钟" / "不到 1 分钟" */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 30) return '不到 1 分钟';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分`;
}

/** 秒 → "42:15"（计时器显示） */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${PAD(m)}:${PAD(sec)}`;
  return `${PAD(m)}:${PAD(sec)}`;
}

/** 秒 → "1 小时 23 分" 的紧凑版（底栏用） */
export function formatShortDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} 分钟`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export function formatChars(n: number): string {
  if (!n) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`;
  return `${n.toLocaleString('zh-CN')} 字`;
}

export function formatPercent(ratio: number): string {
  const p = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return `${p}%`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `今天 ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

export function weekdayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  pdf: 'PDF',
  txt: 'TXT',
};

export function formatLabel(f: string): string {
  return FORMAT_LABEL[f] ?? f.toUpperCase();
}

export function coverUrl(meta: BookMeta | null | undefined): string | null {
  if (!meta?.cover) return null;
  return `moqi-asset://local/${encodeURIComponent(meta.id)}/${meta.cover}`;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
