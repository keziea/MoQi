import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';

interface Props {
  blockId: string;
  lens: boolean;
  marked: boolean;
  onLookup: () => void;
  onMark: () => void;
  onNote: () => void;
  onClose: () => void;
}

const RAIL_W = 66;
const RAIL_H = 226;

interface Pos {
  layout: 'rail' | 'dock';
  left: number;
  top: number;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/**
 * 段落操作坞。
 *
 * 位置永远是「正文栏右侧留白 + 视口垂直居中」：
 * 不跟着点击点上下翻，不压住任何一行正文。窗口太窄、右侧放不下时，
 * 退化为底部居中的横条，仍然是固定位置。
 */
export function ParaDock({ blockId, lens, marked, onLookup, onMark, onNote, onClose }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);

  const measure = useCallback(() => {
    const el = document.getElementById(blockId);
    if (!el) {
      setPos(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const topbar = parseFloat(cs.getPropertyValue('--topbar-h')) || 52;
    const bottombar = parseFloat(cs.getPropertyValue('--bottombar-h')) || 44;

    const rect = el.getBoundingClientRect();
    const blockW = el.offsetWidth || rect.width;
    const clip = document.querySelector<HTMLElement>('.reader-page-clip');

    let colLeft = rect.left;
    let colRight = rect.right;
    if (clip && blockW > 0) {
      const cr = clip.getBoundingClientRect();
      colLeft = cr.left + (cr.width - blockW) / 2;
      colRight = colLeft + blockW;
    }

    const rightGap = vw - colRight;
    if (rightGap >= RAIL_W + 18) {
      setPos({
        layout: 'rail',
        left: Math.round(colRight + 14),
        top: Math.round(topbar + (vh - topbar - bottombar - RAIL_H) / 2),
      });
      return;
    }
    if (colLeft >= RAIL_W + 18) {
      setPos({
        layout: 'rail',
        left: Math.round(colLeft - RAIL_W - 14),
        top: Math.round(topbar + (vh - topbar - bottombar - RAIL_H) / 2),
      });
      return;
    }
    setPos({
      layout: 'dock',
      left: Math.round((vw - 336) / 2),
      top: Math.round(vh - bottombar - 60),
    });
  }, [blockId]);

  useLayoutEffect(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  // 分页重排后段落可能换列，重新量一次
  useEffect(() => {
    const t = window.setTimeout(measure, 120);
    return () => window.clearTimeout(t);
  }, [measure]);

  if (!pos) return null;

  const actions = [
    {
      key: 'lookup',
      icon: 'search' as const,
      label: lens ? '退出' : '查字',
      active: lens,
      onClick: onLookup,
      title: lens ? '退出查字模式' : '查这一段里的字',
    },
    {
      key: 'mark',
      icon: (marked ? 'bookmark-filled' : 'bookmark') as 'bookmark' | 'bookmark-filled',
      label: marked ? '取消标记' : '读到这',
      active: marked,
      onClick: onMark,
      title: marked ? '取消「读到此处」' : '标记为读到此处',
    },
    {
      key: 'note',
      icon: 'pen' as const,
      label: '写笔记',
      active: false,
      onClick: onNote,
      title: '给这一段写笔记',
    },
  ];

  return (
    <motion.div
      className="para-dock"
      data-layout={pos.layout}
      style={
        pos.layout === 'rail'
          ? { left: pos.left, top: pos.top, width: RAIL_W }
          : { left: pos.left, top: pos.top, width: 336 }
      }
      initial={{ opacity: 0, x: pos.layout === 'rail' ? 6 : 0, y: pos.layout === 'rail' ? 0 : 6 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      role="toolbar"
      aria-label="段落操作"
      aria-orientation={pos.layout === 'rail' ? 'vertical' : 'horizontal'}
    >
      <div className="para-dock-head" data-on={lens || undefined}>
        {lens ? '查字中' : '本段'}
      </div>

      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          className="para-dock-btn"
          data-active={a.active || undefined}
          onClick={a.onClick}
          title={a.title}
          aria-pressed={a.active}
        >
          <Icon name={a.icon} size={16} />
          <span>{a.label}</span>
        </button>
      ))}

      <span className="para-dock-sep" aria-hidden />

      <button type="button" className="para-dock-close" onClick={onClose} aria-label="关闭" title="关闭">
        <Icon name="close" size={14} />
      </button>
    </motion.div>
  );
}
