import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReadMark } from '@shared/models';
import { Icon } from '@/components/ui/Icon';

interface Props {
  mark: ReadMark | null;
  chapterTitle: string;
  show: boolean;
  onJump: () => void;
}

export function ResumeChip({ mark, chapterTitle, show, onJump }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!show) return;
    setCollapsed(false);
    const t = window.setTimeout(() => setCollapsed(true), 6500);
    return () => window.clearTimeout(t);
  }, [show, mark?.blockId]);

  if (!mark) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--bottombar-h)+14px)] z-20 flex justify-center px-6">
      <AnimatePresence mode="wait">
        {show && !collapsed && (
          <motion.button
            key="chip"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            onClick={onJump}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface py-2 pl-3 pr-4 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
            style={{ boxShadow: 'var(--shadow-md)' }}
          >
            <span className="text-accent">
              <Icon name="bookmark-filled" size={13} />
            </span>
            <span className="max-w-[260px] truncate">上次标记在《{chapterTitle}》</span>
            <span className="font-medium text-accent">回到那里</span>
            <Icon name="arrow-right" size={12} />
          </motion.button>
        )}

        {show && collapsed && (
          <motion.button
            key="rail"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={onJump}
            className="pointer-events-auto flex h-6 items-center gap-1.5 rounded-full px-3"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            aria-label="回到上次标记的位置"
          >
            <Icon name="bookmark-filled" size={11} />
            <span className="text-[10.5px]">上次标记</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
