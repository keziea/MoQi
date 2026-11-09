import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import { useStarField } from '@/lib/starfield';
import { formatDuration } from '@/lib/format';

export interface FinishedSummary {
  notes: number;
  seconds: number;
  days: number;
  yearIndex: number;
  yearTotal: number;
}

interface Props {
  open: boolean;
  bookTitle: string;
  summary: FinishedSummary | null;
  onClose: () => void;
  onLibrary: () => void;
}

/** 读完一本书时的庆祝：金色粒子 + 战绩总结。 */
export function FinishedCelebration({ open, bookTitle, summary, onClose, onLibrary }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useStarField(canvasRef, open, { density: 90 });

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onClose, 12000);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="goal-celebrate finish-celebrate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={onClose}
          role="dialog"
          aria-label="已读完这本书"
        >
          <canvas ref={canvasRef} className="goal-celebrate-canvas" aria-hidden="true" />

          <motion.div
            className="finish-card"
            initial={{ opacity: 0, y: 20, scale: 0.955 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.55, delay: 0.18, ease: [0.32, 0.72, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="finish-mark">
              <Icon name="book" size={26} strokeWidth={1.4} />
            </span>

            <p className="finish-eyebrow">读完了</p>
            <h2 className="finish-title">{bookTitle}</h2>

            <div className="finish-stats">
              <div>
                <strong>{summary?.notes ?? 0}</strong>
                <span>条笔记</span>
              </div>
              <div>
                <strong>{formatDuration(summary?.seconds ?? 0)}</strong>
                <span>陪伴你的时间</span>
              </div>
              <div>
                <strong>{summary?.days ?? 0}</strong>
                <span>天翻开过</span>
              </div>
            </div>

            {summary && summary.yearTotal > 0 && (
              <p className="finish-year">
                这是你今年读完的
                <b> 第 {summary.yearIndex} 本 </b>
                书
              </p>
            )}

            <p className="finish-note">
              一本书读完，不是结束，是你身上多了一层别人拿不走的东西。
              <br />
              下一本还在架上等你。
            </p>

            <div className="finish-actions">
              <button className="finish-btn-ghost" type="button" onClick={onClose}>
                再看看
              </button>
              <button className="finish-btn" type="button" onClick={onLibrary}>
                去书架挑下一本
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
