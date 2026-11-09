import { useMemo, useState } from 'react';
import type { HighlightColor, Note } from '@shared/models';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import { ipc } from '@/lib/ipc';
import { toast } from '@/lib/toast';
import { HL_COLORS } from './SelectionToolbar';

interface Props {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  bookId: string;
  bookTitle: string;
  onJump: (note: Note) => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onCompose: () => void;
}

export function NotesPanel({
  open,
  onClose,
  notes,
  bookId,
  bookTitle,
  onJump,
  onEdit,
  onDelete,
  onCompose,
}: Props) {
  const [filter, setFilter] = useState<HighlightColor | 'all'>('all');

  const list = useMemo(() => {
    const arr = filter === 'all' ? notes : notes.filter((n) => n.color === filter);
    return [...arr].sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, filter]);

  const exportMd = async () => {
    try {
      const file = await ipc.note.export(bookId);
      toast('已导出到数据文件夹');
      setTimeout(() => ipc.app.openPath(file), 400);
    } catch {
      toast('导出失败');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="笔记"
      subtitle={notes.length ? `${notes.length} 条 · 《${bookTitle}》` : `《${bookTitle}》`}
      action={
        <button type="button" className="chip" onClick={onCompose}>
          <Icon name="pen" size={12} />
          写笔记
        </button>
      }
      footer={
        notes.length > 0 ? (
          <Button block variant="secondary" size="md" icon={<Icon name="export" size={15} />} onClick={exportMd}>
            导出笔记
          </Button>
        ) : undefined
      }
    >
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-[16px]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Icon name="pen" size={24} strokeWidth={1.4} />
          </div>
          <p className="text-[13px] leading-relaxed text-ink-2">还没有笔记</p>
          <p className="mt-1.5 max-w-[220px] text-[11.5px] leading-relaxed text-ink-3">
            选中一段文字，或者点右上角「写笔记」，就能留下笔记
          </p>
          <Button
            className="mt-5"
            variant="secondary"
            size="md"
            icon={<Icon name="pen" size={14} />}
            onClick={onCompose}
          >
            写第一条笔记
          </Button>
        </div>
      ) : (
        <>
          <div className="sticky -top-0 z-10 -mx-1 mb-3 flex flex-wrap gap-1.5 bg-surface pb-2 pt-1">
            <button className="chip" data-active={filter === 'all'} onClick={() => setFilter('all')}>
              全部 {notes.length}
            </button>
            {HL_COLORS.map((c) => {
              const n = notes.filter((x) => x.color === c.key).length;
              if (!n) return null;
              return (
                <button
                  key={c.key}
                  className="chip"
                  data-active={filter === c.key}
                  onClick={() => setFilter(c.key)}
                >
                  <span
                    className="block h-2.5 w-2.5 rounded-full"
                    style={{ background: `var(${c.varName})`, border: '1px solid rgba(0,0,0,0.08)' }}
                  />
                  {n}
                </button>
              );
            })}
          </div>

          <div className="space-y-2.5">
            {list.map((n) => (
              <div
                key={n.id}
                className="group relative cursor-pointer rounded-[10px] p-3 transition-colors duration-150"
                style={{ background: 'var(--surface-sunken)' }}
                onClick={() => onJump(n)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-tint)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--surface-sunken)';
                }}
              >
                <span
                  className="absolute left-0 top-3 bottom-3 w-[2.5px] rounded-full"
                  style={{ background: `var(--hl-${n.color})` }}
                />
                <div className="pl-2.5">
                  <div className="mb-1.5 truncate text-[10.5px] text-ink-3">{n.chapterTitle}</div>
                  <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">「{n.text}」</p>
                  {n.comment && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-ink">
                      {n.comment}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-ink-3">{formatDate(n.createdAt)}</span>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="icon-btn !h-6 !w-6"
                        aria-label="编辑笔记"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(n);
                        }}
                      >
                        <Icon name="pen" size={12} />
                      </button>
                      <button
                        className="icon-btn !h-6 !w-6"
                        aria-label="删除笔记"
                        style={{ color: 'var(--danger)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(n);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
