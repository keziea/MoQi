import { useEffect, useRef } from 'react';
import type { PageMode } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { formatClock, formatShortDuration } from '@/lib/format';
import { useStats } from '@/store/useStats';
import { TimerControls } from '@/components/reader/TimerControls';

interface Props {
  mode: PageMode;
  percent: number;
  page: number;
  totalPages: number;
  chapterLabel: string;
  scrolled: boolean;
  showTimer: boolean;
  onSeek: (ratio: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onOpenStats: () => void;
  /** 分页模式下，标记不在当前页时，把「回到标记」放进底栏，避免浮层遮字 */
  markChip?: { label: string; onClick: () => void } | null;
}

export function BottomBar({
  mode,
  percent,
  page,
  totalPages,
  chapterLabel,
  scrolled,
  showTimer,
  onSeek,
  onPrevPage,
  onNextPage,
  onOpenStats,
  markChip,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const activeSeconds = useStats((s) => s.activeSeconds);
  const todaySeconds = useStats((s) => s.todaySeconds);
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);
  const paged = mode === 'paged';
  const pct = Math.round(Math.max(0, Math.min(1, percent)) * 100);
  const ready = totalPages > 0;
  const first = !ready || page <= 0;
  const last = !ready || page >= totalPages - 1;

  const stopHold = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdInterval.current) {
      window.clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
  };

  const startHold = (fn: () => void) => {
    stopHold();
    fn();
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(fn, 240);
    }, 380);
  };

  useEffect(() => stopHold, []);

  const seek = (e: React.MouseEvent) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio);
  };

  const seekKey = (e: React.KeyboardEvent) => {
    const step = 0.01;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      onSeek(Math.max(0, percent - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      onSeek(Math.min(1, percent + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      onSeek(1);
    }
  };

  return (
    <footer className="reader-footer" data-mode={mode} data-bordered={scrolled || paged}>
      <div className="reader-footer-row">
        {paged ? (
          <div className="reader-pager">
            <button
              className="reader-page-btn"
              onClick={(e) => {
                if (e.detail === 0) onPrevPage();
              }}
              onPointerDown={(e) => {
                if (e.button === 0) startHold(onPrevPage);
              }}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              disabled={first}
              aria-label="上一页"
              title="上一页（←，长按连续翻页）"
            >
              <Icon name="arrow-left" size={17} />
            </button>

            <div
              className="reader-page-label"
              aria-live="polite"
              aria-atomic="true"
              aria-label={ready ? `第 ${page + 1} 页，共 ${totalPages} 页` : '正在分页'}
            >
              <span className="reader-page-lbl">第</span>
              <span className="reader-page-num">{ready ? page + 1 : '—'}</span>
              <span className="reader-page-sep">/</span>
              <span className="reader-page-total">{ready ? totalPages : '—'}</span>
              <span className="reader-page-lbl">页</span>
            </div>

            <button
              className="reader-page-btn"
              onClick={(e) => {
                if (e.detail === 0) onNextPage();
              }}
              onPointerDown={(e) => {
                if (e.button === 0) startHold(onNextPage);
              }}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              disabled={last}
              aria-label="下一页"
              title="下一页（→，长按连续翻页）"
            >
              <Icon name="arrow-right" size={17} />
            </button>
          </div>
        ) : (
          <div className="reader-progress-text" aria-label={`已读 ${pct}%`}>
            <span className="reader-progress-num">{pct}</span>
            <span className="reader-progress-unit">%</span>
          </div>
        )}

        <div className="reader-center">
          {markChip ? (
            <button className="reader-mark-chip" onClick={markChip.onClick} title={markChip.label}>
              <Icon name="bookmark-filled" size={11} />
              <span className="reader-mark-chip-text">{markChip.label}</span>
              <span className="reader-mark-chip-action">回到那里</span>
              <Icon name="arrow-right" size={11} />
            </button>
          ) : (
            <div className="reader-chapter" title={chapterLabel}>
              {chapterLabel}
            </div>
          )}
        </div>

        <div className="reader-meta">
          {paged && <span className="reader-meta-pct">{pct}%</span>}
          <div className="reader-timer-group">
            <button
              className="reader-timer"
              onClick={onOpenStats}
              aria-label="查看阅读数据"
              title="查看阅读数据（Ctrl+D）"
            >
              {showTimer ? (
                <>
                  <Icon name="clock" size={12} />
                  <span className="reader-timer-clock">{formatClock(activeSeconds)}</span>
                  <span className="reader-timer-today">今天 {formatShortDuration(todaySeconds)}</span>
                </>
              ) : (
                <span>阅读数据</span>
              )}
            </button>
            {showTimer && <TimerControls compact showReset={false} />}
          </div>
        </div>
      </div>

      {/* 3px 进度条贴底；10px 的命中区让点击更容易 */}
      <div
        ref={barRef}
        className="reader-seek"
        onClick={seek}
        onKeyDown={seekKey}
        role="slider"
        aria-label="阅读进度"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        tabIndex={0}
      >
        <div className="reader-seek-track">
          <div
            className="reader-seek-fill"
            style={{ width: `${Math.max(0.6, percent * 100)}%` }}
          />
        </div>
      </div>
    </footer>
  );
}
