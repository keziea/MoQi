import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import type { LookupResult } from '@/lib/dict';
import type { VocabEntry } from '@shared/models';

export interface DictAnchor {
  /** 被点的字在屏幕上的顶部，用来让卡片贴近它 */
  charTop: number;
  /** 被点的字水平中心；窄窗口时把卡片放到字的另一侧 */
  charX: number;
  /** 当前正文栏的左右边界（已扣除页边留白） */
  column: { left: number; right: number };
}

interface Props {
  open: boolean;
  result: LookupResult | null;
  /** 查的字/词；即使词库没收录也要显示 */
  term: string;
  termKind: 'char' | 'word';
  loading: boolean;
  error: string | null;
  anchor: DictAnchor | null;
  saved: boolean;
  vocab: VocabEntry[];
  onClose: () => void;
  onToggleSave: () => void;
  onRetry: () => void;
  onLookupChar: (ch: string) => void;
  onLookupWord: (w: string) => void;
  onPickVocab: (entry: VocabEntry) => void;
  onRemoveVocab: (term: string) => void;
  onSpeak: (text: string) => void;
}

const CARD_W = 300;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

interface Place {
  layout: 'side' | 'sheet';
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function place(anchor: DictAnchor | null): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const edge = 12;
  if (anchor) {
    const right = anchor.column.right + 14;
    const left = anchor.column.left - 14 - CARD_W;
    const top = clamp(Math.round(anchor.charTop - 26), 64, Math.max(64, vh - 320));
    if (right + CARD_W <= vw - edge) {
      return { layout: 'side', left: Math.round(right), top, width: CARD_W, maxHeight: vh - top - 56 };
    }
    if (left >= edge) {
      return { layout: 'side', left: Math.round(left), top, width: CARD_W, maxHeight: vh - top - 56 };
    }
    // 窗口不够宽：贴在字的另一侧，宁可压住别的行，也不压住正在查的这个字
    if (vw >= 720) {
      const columnMid = (anchor.column.left + anchor.column.right) / 2;
      const onRight = anchor.charX <= columnMid;
      const px = onRight ? vw - CARD_W - edge : edge;
      return { layout: 'side', left: px, top, width: CARD_W, maxHeight: vh - top - 56 };
    }
  }
  const width = Math.min(560, vw - 32);
  const h = Math.min(430, Math.round(vh * 0.46));
  return {
    layout: 'sheet',
    left: Math.round((vw - width) / 2),
    top: Math.round(vh - 56 - h),
    width,
    maxHeight: h,
  };
}

/** 查字 / 查词卡片：固定在正文栏外侧，不压住正在看的那一段。 */
export function DictCard({
  open,
  result,
  term,
  termKind,
  loading,
  error,
  anchor,
  saved,
  vocab,
  onClose,
  onToggleSave,
  onRetry,
  onLookupChar,
  onLookupWord,
  onPickVocab,
  onRemoveVocab,
  onSpeak,
}: Props) {
  const [pos, setPos] = useState<Place>(() => place(anchor));
  const [view, setView] = useState<'entry' | 'vocab'>('entry');
  const cardRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setPos(place(anchor));
    const onResize = () => setPos(place(anchor));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, anchor]);

  useEffect(() => {
    if (open) setView('entry');
  }, [open, result]);

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

  const reading = useMemo(() => {
    if (!result) return '';
    if (result.kind === 'char') return result.char.readings.join(' / ');
    if (!result.word.found) return '词典暂未收录';
    if (result.word.pinyin) return result.word.pinyin;
    // 词典收录了词条但没标整词读音：不猜，请用户看下面逐字读音
    if (result.word.chars.some((c) => c.readings.length > 1)) return '含多音字 · 见下方逐字读音';
    return result.word.chars.map((c) => c.readings[0] ?? '').join(' ');
  }, [result]);

  const senses = result
    ? result.kind === 'char'
      ? result.char.senses
      : result.word.senses
    : [];

  const vocabList = useMemo(() => [...vocab].sort((a, b) => b.at - a.at), [vocab]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={cardRef}
          className="dict-card"
          data-layout={pos.layout}
          style={{
            left: pos.left,
            top: pos.top,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
          initial={{ opacity: 0, y: 8, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          role="dialog"
          aria-label="字词释义"
        >
          {view === 'vocab' ? (
            <>
              <header className="dict-head">
                <button className="dict-icon-btn" type="button" onClick={() => setView('entry')} aria-label="返回">
                  <Icon name="arrow-left" size={16} />
                </button>
                <div className="dict-title">
                  <h3>生字本</h3>
                  <p>{vocabList.length ? `共 ${vocabList.length} 条 · 点一条重新查看` : '还没有收进任何字词'}</p>
                </div>
                <button className="dict-icon-btn" type="button" onClick={onClose} aria-label="关闭">
                  <Icon name="close" size={16} />
                </button>
              </header>

              <div className="dict-body">
                {vocabList.length === 0 ? (
                  <p className="dict-empty">查字时点「收进生字本」，以后在这里复习。</p>
                ) : (
                  <ul className="vocab-list">
                    {vocabList.map((v) => (
                      <li key={v.term}>
                        <button type="button" className="vocab-item" onClick={() => onPickVocab(v)}>
                          <span className="vocab-term">{v.term}</span>
                          <span className="vocab-reading">{v.pinyin}</span>
                          <span className="vocab-brief">{v.brief || '—'}</span>
                        </button>
                        <button
                          type="button"
                          className="vocab-del"
                          onClick={() => onRemoveVocab(v.term)}
                          aria-label={`从生字本移除 ${v.term}`}
                          title="移除"
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <footer className="dict-foot dict-foot--quiet">
                <span>只存在本机，随「我的数据」一起备份</span>
              </footer>
            </>
          ) : (
            <>
              <header className="dict-head">
                <div className="dict-title">
                  <div className="dict-term-row">
                    <span className="dict-term" data-kind={termKind}>
                      {term || '…'}
                    </span>
                    {result && result.kind === 'char' && result.char.readings.length > 1 && (
                      <span className="dict-badge">多音字</span>
                    )}
                  </div>
                  <p className="dict-reading">{loading ? '正在翻字典…' : reading || '—'}</p>
                </div>
                <button className="dict-icon-btn" type="button" onClick={onClose} aria-label="关闭">
                  <Icon name="close" size={16} />
                </button>
              </header>

              <div className="dict-body">
                {loading && (
                  <div className="dict-skeleton" aria-label="加载中">
                    <span />
                    <span />
                    <span />
                  </div>
                )}

                {!loading && error && (
                  <div className="dict-error">
                    <p>{error}</p>
                    <button type="button" onClick={onRetry}>
                      再试一次
                    </button>
                  </div>
                )}

                {!loading && !error && result && (
                  <>
                    {result.kind === 'char' && (
                      <div className="dict-meta">
                        {result.char.radical && <span>部首 {result.char.radical}</span>}
                        {result.char.strokes > 0 && <span>{result.char.strokes} 画</span>}
                        {result.char.structure && <span>{result.char.structure}</span>}
                      </div>
                    )}

                    {result.kind === 'word' && result.word.chars.length > 0 && (
                      <div className="dict-breakdown">
                        <span className="dict-label">逐字</span>
                        <div className="dict-chars">
                          {result.word.chars.map((c) => (
                            <button key={c.char} type="button" onClick={() => onLookupChar(c.char)}>
                              <b>{c.char}</b>
                              <i>{c.readings.join('/') || '—'}</i>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {senses.length > 0 ? (
                      <div className="dict-senses">
                        <span className="dict-label">释义</span>
                        <ol>
                          {senses.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <p className="dict-empty">
                        {result.kind === 'word'
                          ? '词典暂未收录这个词，可以点上面的字逐字看。'
                          : '这个字暂未收录释义。'}
                      </p>
                    )}

                    {result.kind === 'char' && result.char.words.length > 0 && (
                      <div className="dict-words">
                        <span className="dict-label">组词</span>
                        <div className="dict-word-chips">
                          {result.char.words.map((w) => (
                            <button key={w} type="button" onClick={() => onLookupWord(w)}>
                              {w}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <footer className="dict-foot">
                <button
                  type="button"
                  className="dict-action"
                  data-on={saved || undefined}
                  onClick={onToggleSave}
                  disabled={!result}
                >
                  <Icon name={saved ? 'bookmark-filled' : 'bookmark'} size={14} />
                  {saved ? '已在生字本' : '收进生字本'}
                </button>
                <button
                  type="button"
                  className="dict-action"
                  onClick={() => onSpeak(term)}
                  disabled={!result}
                  title="朗读（使用系统语音）"
                >
                  <Icon name="volume" size={14} />
                  朗读
                </button>
                <button type="button" className="dict-action dict-action--right" onClick={() => setView('vocab')}>
                  <Icon name="book" size={14} />
                  生字本 {vocab.length > 0 ? vocab.length : ''}
                </button>
              </footer>
            </>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
