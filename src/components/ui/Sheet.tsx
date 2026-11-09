import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from './Icon';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  /** 顶部标题栏右侧额外元素 */
  action?: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = 380,
  children,
  footer,
  action,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(20, 16, 12, 0.12)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            onClick={onClose}
          />
          <motion.aside
            key="sheet"
            role="dialog"
            aria-label={title}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col border-l border-line bg-surface"
            style={{ width, boxShadow: 'var(--shadow-lg)' }}
            initial={{ x: width + 20 }}
            animate={{ x: 0 }}
            exit={{ x: width + 20 }}
            transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-6">
              <div className="min-w-0">
                <h2 className="truncate text-[17px] font-semibold leading-tight text-ink">{title}</h2>
                {subtitle && (
                  <div className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{subtitle}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {action}
                <button className="icon-btn" onClick={onClose} aria-label="关闭">
                  <Icon name="close" size={18} />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">{children}</div>
            {footer && <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
