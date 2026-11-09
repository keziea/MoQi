import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';

interface Props {
  rect: DOMRect;
  marked: boolean;
  onMark: () => void;
  onNote: () => void;
  onClose: () => void;
}

/** 点段落之后浮出的三选一：标记 / 整段笔记 / 选一句 */
export function ParaActionMenu({ rect, marked, onMark, onNote, onClose }: Props) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('.para-menu')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const W = 210;
  const above = rect.top > 150;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 12);
  const top = above ? rect.top - 50 : rect.bottom + 10;

  return (
    <motion.div
      className="para-menu"
      style={{ left, top, width: W }}
      initial={{ opacity: 0, y: above ? 6 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={onMark} data-active={marked || undefined}>
        <Icon name={marked ? 'bookmark-filled' : 'bookmark'} size={15} />
        <span>{marked ? '取消标记' : '读到这'}</span>
      </button>
      <span className="para-menu-sep" />
      <button type="button" onClick={onNote}>
        <Icon name="pen" size={15} />
        <span>写笔记</span>
      </button>
    </motion.div>
  );
}
