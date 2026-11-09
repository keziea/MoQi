import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import { useStarField } from '@/lib/starfield';

interface Props {
  open: boolean;
  /** 目标分钟数（仅用于文案，可为 0） */
  minutes: number;
  todayLabel: string;
  onClose: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  decay: number;
  hue: string;
  twinkle: number;
}

/** 达成每日目标时的星光庆祝：从中心炸开，飘落，缓慢消散。 */
export function GoalCelebration({ open, minutes, todayLabel, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useStarField(canvasRef, open, { density: 70 });

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onClose, 6200);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="goal-celebrate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={onClose}
          role="dialog"
          aria-label="今日阅读目标已完成"
        >
          <canvas ref={canvasRef} className="goal-celebrate-canvas" aria-hidden="true" />

          <motion.div
            className="goal-celebrate-card"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
          >
            <span className="goal-celebrate-mark">
              <Icon name="sparkles" size={26} />
            </span>
            <h2>今天的阅读目标，完成了</h2>
            <p className="goal-celebrate-sub">{todayLabel}</p>
            <p className="goal-celebrate-note">
              一页一页攒出来的时间，比什么都踏实。
              <br />
              剩下的时间，读点闲书也好。
            </p>
            <button className="goal-celebrate-btn" type="button" onClick={onClose}>
              继续读
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
