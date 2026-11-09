import { useRef, useState, type ReactNode } from 'react';

interface TipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  delay?: number;
}

/** 延迟出现的极简提示 */
export function Tip({ label, children, side = 'bottom', delay = 480 }: TipProps) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | null>(null);

  const open = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), delay);
  };
  const close = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setShow(false);
  };

  return (
    <span className="relative inline-flex" onMouseEnter={open} onMouseLeave={close} onMouseDown={close}>
      {children}
      {show && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 z-[120] -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11.5px] font-medium leading-none text-white/95"
          style={{
            [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
            background: 'color-mix(in srgb, var(--text) 90%, transparent)',
            boxShadow: 'var(--shadow-sm)',
            animation: 'tipIn 140ms cubic-bezier(0.32,0.72,0,1)',
          }}
        >
          {label}
        </span>
      )}
      <style>{`@keyframes tipIn{from{opacity:0;transform:translate(-50%,2px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
    </span>
  );
}
