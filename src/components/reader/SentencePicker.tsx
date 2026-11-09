import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Sentence } from '@/lib/sentences';
import { Icon } from '@/components/ui/Icon';

interface Props {
  open: boolean;
  list: Sentence[];
  onPick: (sentence: Sentence) => void;
  onWhole: () => void;
  onClose: () => void;
}

/** 把段落拆成句子，让用户点其中一句做笔记 */
export function SentencePicker({ open, list, onPick, onWhole, onClose }: Props) {
  const [hover, setHover] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="sent-picker-root" onClick={onClose}>
          <motion.div
            className="sent-picker"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3>选一句做笔记</h3>
                <p>点下面任意一句，就能单独高亮它</p>
              </div>
              <button className="sent-picker-close" type="button" onClick={onClose} aria-label="关闭">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="sent-list">
              {list.map((s, i) => (
                <button
                  key={`${s.start}-${i}`}
                  type="button"
                  className="sent-item"
                  data-hover={hover === i || undefined}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(-1)}
                  onClick={() => onPick(s)}
                >
                  <span className="sent-index">{i + 1}</span>
                  <span className="sent-text">{s.text}</span>
                </button>
              ))}
            </div>

            <footer>
              <button className="sent-whole" type="button" onClick={onWhole}>
                <Icon name="pen" size={14} />
                还是整段记下来
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
