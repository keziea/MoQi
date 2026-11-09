import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { setToastListener } from '@/lib/toast';

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    setToastListener((m, duration) => {
      setMsg(m);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), duration);
    });
    return () => {
      setToastListener(null);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-[100] flex justify-center">
      <AnimatePresence>
        {msg && (
          <motion.div
            key={msg}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-white/95 shadow-[var(--shadow-md)]"
            style={{ background: 'color-mix(in srgb, var(--text) 92%, transparent)' }}
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
