import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DEFAULT_NOTE_CATEGORIES, HIGHLIGHT_COLORS, type HighlightColor } from '@shared/models';
import { Button } from '@/components/ui/Button';
import { COLOR_META } from '@/lib/colors';
import { useSettings } from '@/store/useSettings';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  quote: string;
  initialComment: string;
  initialColor: HighlightColor;
  initialCategory?: string;
  initialTitle?: string;
  isNew: boolean;
  onSave: (comment: string, color: HighlightColor, category: string, title: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteEditor({
  open,
  quote,
  initialComment,
  initialColor,
  initialCategory,
  initialTitle,
  isNew,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [comment, setComment] = useState(initialComment);
  const [color, setColor] = useState<HighlightColor>(initialColor);
  const [category, setCategory] = useState(initialCategory ?? '');
  const [title, setTitle] = useState(initialTitle ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<HighlightColor | ''>('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const noteCats = useSettings((s) => s.settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES);
  const updateSettings = useSettings((s) => s.update);
  const usedColors = new Set(noteCats.map((c) => c.color));
  const freeColors = HIGHLIGHT_COLORS.filter((c) => !usedColors.has(c));
  const currentColor = noteCats.find((c) => c.name === category)?.color ?? color;

  const createCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    if (noteCats.some((c) => c.name === name)) {
      toast('已经有同名分类了');
      return;
    }
    const pick = newColor && freeColors.includes(newColor) ? newColor : freeColors[0];
    if (!pick) {
      toast('颜色已经用完了，先去分类管理里换一个');
      return;
    }
    await updateSettings({ noteCategories: [...noteCats, { name, color: pick }] });
    setCategory(name);
    setColor(pick);
    setCreating(false);
    setNewName('');
    setNewColor('');
    toast(`已新建分类「${name}」`);
  };

  useEffect(() => {
    if (!open) return;
    setComment(initialComment);
    setColor(initialColor);
    setCategory(initialCategory ?? '');
    setTitle(initialTitle ?? '');
    const t = window.setTimeout(() => ref.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, initialComment, initialColor]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(20,16,12,0.22)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="relative w-full max-w-[460px] overflow-hidden rounded-[16px] border border-line bg-surface"
            style={{ boxShadow: 'var(--shadow-lg)' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onSave(comment.trim(), color, category, title.trim());
              }
            }}
          >
            <div className="px-5 pb-4 pt-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  <i
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: COLOR_META[currentColor].solid,
                    }}
                  />
                  {category || '未分类'}
                </div>
                <span className="text-[11px] text-ink-3">{isNew ? '新笔记' : '编辑笔记'}</span>
              </div>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给这条笔记取个名字（可不填）"
                className="mt-3 w-full rounded-[10px] px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-3"
                style={{ background: 'var(--surface-sunken)' }}
              />

              <div
                className="mt-2 max-h-[96px] overflow-y-auto rounded-[10px] px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2"
                style={{ background: 'var(--surface-sunken)' }}
              >
                {quote || '（整段）'}
              </div>

              <textarea
                ref={ref}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="写下你的笔记…"
                rows={4}
                className="mt-3 w-full resize-none rounded-[10px] px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-3"
                style={{ background: 'var(--surface-sunken)' }}
              />

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] text-ink-3">归类</span>
                <button
                  type="button"
                  className="chip !h-6 !px-2.5 !text-[11px]"
                  data-active={category === '' || undefined}
                  onClick={() => setCategory('')}
                >
                  未分类
                </button>
                {noteCats.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className="chip !h-6 !px-2.5 !text-[11px]"
                    data-active={category === c.name || undefined}
                    onClick={() => {
                      setCategory(c.name);
                      setColor(c.color);
                    }}
                  >
                    <i
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        marginRight: 5,
                        verticalAlign: '1px',
                        background: COLOR_META[c.color].solid,
                      }}
                    />
                    {c.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="chip !h-6 !px-2.5 !text-[11px]"
                  onClick={() => {
                    setCreating((v) => !v);
                    setNewColor((prev) => prev || freeColors[0] || '');
                  }}
                >
                  ＋ 新建分类
                </button>
              </div>

              {creating && (
                <div className="mt-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunken)' }}>
                  <div className="flex items-center gap-2">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="新分类名字，如「灵感」"
                      className="h-7 flex-1 rounded-[7px] px-2 text-[11.5px] text-ink placeholder:text-ink-3"
                      style={{ background: 'var(--surface)' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createCategory();
                        }
                      }}
                    />
                    <Button variant="secondary" size="sm" onClick={() => void createCategory()} disabled={!newName.trim()}>
                      添加
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10.5px] text-ink-3">选一种空着的颜色</span>
                    {freeColors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={COLOR_META[c].label}
                        onClick={() => setNewColor(c)}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: COLOR_META[c].solid,
                          boxShadow:
                            newColor === c ? '0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent)' : 'none',
                        }}
                      />
                    ))}
                    {!freeColors.length && <span className="text-[10.5px] text-ink-3">颜色用完了</span>}
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-3">
                <span>Ctrl + Enter 保存</span>
                <span className="tabular-nums">{comment.length}</span>
              </div>
            </div>

            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              {!isNew ? (
                <Button variant="danger" size="sm" onClick={onDelete}>
                  删除笔记
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onSave(comment.trim(), color, category, title.trim())}
                >
                  保存
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
