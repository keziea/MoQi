import { AnimatePresence, motion } from 'framer-motion';
import type { HighlightColor } from '@shared/models';
import { Icon } from '@/components/ui/Icon';

export const HL_COLORS: { key: HighlightColor; label: string; varName: string }[] = [
  { key: 'clay', label: '陶土', varName: '--hl-clay' },
  { key: 'moss', label: '苔绿', varName: '--hl-moss' },
  { key: 'indigo', label: '靛青', varName: '--hl-indigo' },
  { key: 'amber', label: '姜黄', varName: '--hl-amber' },
];

interface Props {
  open: boolean;
  rect: DOMRect | null;
  onPick: (color: HighlightColor) => void;
  onComment: () => void;
  onCopy: () => void;
}

export function SelectionToolbar({ open, rect, onPick, onComment, onCopy }: Props) {
  if (!rect) return null;

  const width = 268;
  const centerX = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, centerX - width / 2));
  const top = Math.max(12, rect.top - 48);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 3, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          className="fixed z-[70] flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-1.5"
          style={{ left, top, width, boxShadow: 'var(--shadow-md)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {HL_COLORS.map((c) => (
            <button
              key={c.key}
              title={c.label}
              aria-label={`用${c.label}标记`}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-100 hover:scale-110"
              onClick={() => onPick(c.key)}
            >
              <span
                className="block h-[17px] w-[17px] rounded-full"
                style={{
                  background: `var(${c.varName})`,
                  border: '1px solid rgba(0,0,0,0.06)',
                }}
              />
            </button>
          ))}

          <div className="mx-1 h-4 w-[1px]" style={{ background: 'var(--line)' }} />

          <button
            className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-[var(--accent-soft)] hover:text-accent"
            onClick={onComment}
          >
            <Icon name="pen" size={13} />
            写笔记
          </button>

          <button
            className="icon-btn !h-7 !w-7"
            onClick={onCopy}
            aria-label="复制原文"
            title="复制原文"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
