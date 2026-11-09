import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import type { Sentence } from '@/lib/sentences';

interface Props {
  open: boolean;
  blockText: string;
  sentences: Sentence[];
  onConfirm: (mode: 'whole' | 'sentences', picked: Sentence[]) => void;
  onClose: () => void;
}

/** 记笔记之前先定范围：整段，还是其中的某一句 / 某几句。 */
export function NoteScopeDialog({ open, blockText, sentences, onConfirm, onClose }: Props) {
  const [mode, setMode] = useState<'whole' | 'sentences'>('whole');
  const [multi, setMulti] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setMode('whole');
    setMulti(true);
    setPicked([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickedSentences = useMemo(
    () => picked.map((i) => sentences[i]).filter(Boolean),
    [picked, sentences]
  );

  const toggle = (i: number) => {
    if (!multi) {
      setPicked([i]);
      return;
    }
    setPicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort((a, b) => a - b)));
  };

  const confirm = () => {
    if (mode === 'whole') {
      onConfirm('whole', []);
    } else if (pickedSentences.length > 0) {
      onConfirm('sentences', pickedSentences);
    }
  };

  const canConfirm = mode === 'whole' || pickedSentences.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <div className="scope-root" onClick={onClose}>
          <motion.div
            className="scope-card"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="选择笔记范围"
          >
            <header className="scope-head">
              <div>
                <h3>记笔记</h3>
                <p>先选范围：整段，还是其中的某几句</p>
              </div>
              <button className="scope-close" type="button" onClick={onClose} aria-label="关闭">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="scope-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'whole'}
                data-active={mode === 'whole' || undefined}
                onClick={() => setMode('whole')}
              >
                整段
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'sentences'}
                data-active={mode === 'sentences' || undefined}
                onClick={() => setMode('sentences')}
              >
                选句子
                {sentences.length > 0 && <span>{sentences.length}</span>}
              </button>
            </div>

            <div className="scope-body">
              {mode === 'whole' ? (
                <p className="scope-whole">{blockText}</p>
              ) : (
                <>
                  <div className="scope-switch">
                    <button
                      type="button"
                      data-active={!multi || undefined}
                      onClick={() => {
                        setMulti(false);
                        setPicked((prev) => (prev.length > 1 ? [prev[0]] : prev));
                      }}
                    >
                      单选一句
                    </button>
                    <button
                      type="button"
                      data-active={multi || undefined}
                      onClick={() => setMulti(true)}
                    >
                      多选几句
                    </button>
                  </div>

                  <div className="scope-list">
                    {sentences.map((s, i) => {
                      const on = picked.includes(i);
                      return (
                        <button
                          key={`${s.start}-${i}`}
                          type="button"
                          className="scope-item"
                          data-on={on || undefined}
                          onClick={() => toggle(i)}
                        >
                          <span className="scope-check" data-on={on || undefined}>
                            {on && <Icon name="check" size={11} strokeWidth={2.6} />}
                          </span>
                          <span className="scope-sent">{s.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <footer className="scope-foot">
              <span className="scope-count">
                {mode === 'whole'
                  ? '整段都会被高亮'
                  : pickedSentences.length
                    ? `已选 ${pickedSentences.length} 句`
                    : '还没选句子'}
              </span>
              <div className="scope-actions">
                <button className="scope-cancel" type="button" onClick={onClose}>
                  取消
                </button>
                <button className="scope-ok" type="button" onClick={confirm} disabled={!canConfirm}>
                  写笔记
                </button>
              </div>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
