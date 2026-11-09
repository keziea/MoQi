import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book, SearchHit } from '@shared/models';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  book: Book;
  onJump: (chapterId: string, blockId: string) => void;
}

const MAX_HITS = 200;

export function SearchPanel({ open, onClose, book, onJump }: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 260);
    return () => window.clearTimeout(t);
  }, [query]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!debounced) return [];
    const q = debounced.toLowerCase();
    const out: SearchHit[] = [];
    for (const ch of book.chapters) {
      for (const b of ch.blocks) {
        if (!b.text) continue;
        const lower = b.text.toLowerCase();
        let idx = lower.indexOf(q);
        while (idx >= 0) {
          out.push({
            chapterId: ch.id,
            chapterTitle: ch.title,
            blockId: b.id,
            offset: idx,
            before: b.text.slice(Math.max(0, idx - 22), idx),
            match: b.text.slice(idx, idx + debounced.length),
            after: b.text.slice(idx + debounced.length, idx + debounced.length + 34),
          });
          if (out.length >= MAX_HITS) return out;
          idx = lower.indexOf(q, idx + Math.max(1, debounced.length));
        }
      }
    }
    return out;
  }, [debounced, book]);

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; items: SearchHit[] }>();
    for (const h of hits) {
      if (!map.has(h.chapterId)) map.set(h.chapterId, { title: h.chapterTitle, items: [] });
      map.get(h.chapterId)!.items.push(h);
    }
    return [...map.entries()];
  }, [hits]);

  return (
    <Sheet open={open} onClose={onClose} title="搜索全书" subtitle={debounced ? `找到 ${hits.length} 处` : undefined}>
      <div
        className="sticky top-0 z-10 -mx-1 mb-4 flex items-center gap-2 rounded-[10px] px-3 py-2"
        style={{ background: 'var(--surface-sunken)' }}
      >
        <Icon name="search" size={15} className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入关键词…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3"
        />
        {query && (
          <button
            className="shrink-0 text-ink-3 transition-colors hover:text-ink"
            onClick={() => setQuery('')}
            aria-label="清空"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      {!debounced && (
        <p className="py-16 text-center text-[12px] text-ink-3">输入一个词，翻遍整本书</p>
      )}

      {debounced && hits.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-[12.5px] text-ink-2">没有找到「{debounced}」</p>
          <p className="mt-2 text-[11.5px] text-ink-3">换个词试试，或者只输入两个字</p>
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([chapterId, group]) => (
          <div key={chapterId}>
            <div className="mb-1.5 text-[10.5px] tracking-wide text-ink-3">
              {group.title} · {group.items.length} 处
            </div>
            <div className="space-y-1">
              {group.items.map((h, i) => (
                <button
                  key={`${h.blockId}-${i}`}
                  onClick={() => onJump(h.chapterId, h.blockId)}
                  className="block w-full rounded-[8px] px-2.5 py-2 text-left text-[12px] leading-relaxed text-ink-2 transition-colors"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface-sunken)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="opacity-60">{h.before}</span>
                  <mark
                    className="rounded-[2px] px-[1px]"
                    style={{ background: 'var(--hl-amber)', color: 'var(--text)' }}
                  >
                    {h.match}
                  </mark>
                  <span className="opacity-60">{h.after}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
