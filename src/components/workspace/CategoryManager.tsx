import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { DEFAULT_NOTE_CATEGORIES, HIGHLIGHT_COLORS, type HighlightColor } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { COLOR_META } from '@/lib/colors';
import { useSettings } from '@/store/useSettings';
import { useLibrary } from '@/store/useLibrary';
import { ipc } from '@/lib/ipc';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 书籍分类和笔记分类是两个互不相干的弹窗，只共用这一套外观 */
  kind: 'book' | 'note';
  /** 笔记分类 -> 条数（只有笔记分类用得上） */
  noteCounts?: Map<string, number>;
  /** 改名 / 删除之后让上层重新拉一遍数据 */
  onChanged?: () => void;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function CategoryManager({ open, onClose, kind, noteCounts, onChanged }: Props) {
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const books = useLibrary((s) => s.books);

  const [adding, setAdding] = useState('');
  const [addColor, setAddColor] = useState<HighlightColor>('clay');
  const [editing, setEditing] = useState<{ name: string; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  const isBook = kind === 'book';
  const bookCats = settings.categories ?? [];
  const noteCats = settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES;

  const bookCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of books) for (const c of b.categories ?? []) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [books]);

  const usedColors = useMemo(() => new Set(noteCats.map((c) => c.color)), [noteCats]);
  const freeColors = HIGHLIGHT_COLORS.filter((c) => !usedColors.has(c));

  useEffect(() => {
    if (!open) return;
    setAdding('');
    setEditing(null);
    setConfirming(null);
    setPickingFor(null);
    setAddColor(freeColors[0] ?? HIGHLIGHT_COLORS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const reload = async () => {
    const next = await ipc.settings.get();
    useSettings.setState({ settings: next });
  };

  const commitRename = async () => {
    if (!editing) return;
    const to = editing.draft.trim();
    if (!to || to === editing.name) {
      setEditing(null);
      return;
    }
    const res = await ipc.category.rename(kind, editing.name, to);
    if (!res.ok) {
      toast(res.error ?? '改名失败');
      return;
    }
    await reload();
    if (isBook) await useLibrary.getState().load();
    onChanged?.();
    const from = editing.name;
    setEditing(null);
    toast(`「${from}」已改名为「${to}」`);
  };

  const doRemove = async (name: string) => {
    const res = await ipc.category.remove(kind, name);
    if (!res.ok) {
      toast(res.error ?? '删除失败');
      return;
    }
    await reload();
    if (isBook) await useLibrary.getState().load();
    onChanged?.();
    setConfirming(null);
    toast(`已删除「${name}」`);
  };

  const doAdd = async () => {
    const name = adding.trim();
    if (!name) return;
    const list = isBook ? bookCats : noteCats.map((c) => c.name);
    if (list.includes(name)) {
      toast('已经有同名分类了');
      return;
    }
    if (isBook) {
      await updateSettings({ categories: [...bookCats, name] });
    } else {
      if (!freeColors.length) {
        toast('颜色已经用完了，先把某个分类的颜色换掉');
        return;
      }
      const pick = freeColors.includes(addColor) ? addColor : freeColors[0];
      await updateSettings({ noteCategories: [...noteCats, { name, color: pick }] });
    }
    setAdding('');
    onChanged?.();
    toast(`已添加「${name}」`);
  };

  const changeColor = async (name: string, color: HighlightColor) => {
    const res = await ipc.category.setNoteColor(name, color);
    if (!res.ok) {
      toast(res.error ?? '这个颜色已经被占用了');
      return;
    }
    await reload();
    onChanged?.();
    setPickingFor(null);
    toast('颜色已更换');
  };

  const items = isBook
    ? bookCats.map((name) => ({ name, color: null as HighlightColor | null }))
    : noteCats.map((c) => ({ name: c.name, color: c.color }));

  const modal = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(24,19,14,0.28)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />

          <motion.div
            className="cat-modal"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease }}
            role="dialog"
            aria-label="分类管理"
          >
            <header className="cat-modal-head">
              <div className="cat-modal-head-text">
                <h2>分类管理</h2>
                <p>
                  {isBook ? '书籍分类' : '笔记分类'} · 共 {items.length} 种
                  {isBook ? ' · 改名会同步所有书' : ' · 一种颜色只给一个分类'}
                </p>
              </div>
              <button type="button" className="cat-modal-close" onClick={onClose} aria-label="关闭">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="cat-modal-list">
              {items.map((item) => {
                const count = isBook ? bookCounts.get(item.name) ?? 0 : noteCounts?.get(item.name) ?? 0;
                const isEditing = editing?.name === item.name;
                const isPicking = pickingFor === item.name;
                return (
                  <div className="cat-modal-item" key={item.name}>
                    <div className="cat-modal-row" data-editing={isEditing || undefined}>
                      {!isBook && item.color && (
                        <button
                          type="button"
                          className="cat-modal-dot"
                          style={{ background: COLOR_META[item.color].solid }}
                          onClick={() => setPickingFor(isPicking ? null : item.name)}
                          aria-label={`${item.name}的颜色，点击更换`}
                          title="更换颜色"
                        />
                      )}

                      {isEditing ? (
                        <input
                          className="cat-modal-input"
                          autoFocus
                          value={editing.draft}
                          onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRename();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          onBlur={() => void commitRename()}
                        />
                      ) : (
                        <span className="cat-modal-name">{item.name}</span>
                      )}

                      <span className="cat-modal-count">
                        {count} {isBook ? '本' : '条'}
                      </span>

                      <div className="cat-modal-actions">
                        {!isEditing && (
                          <button
                            type="button"
                            className="cat-modal-act"
                            onClick={() => setEditing({ name: item.name, draft: item.name })}
                          >
                            改名
                          </button>
                        )}
                        <button
                          type="button"
                          className="cat-modal-act"
                          data-danger={confirming === item.name || undefined}
                          onClick={() => (confirming === item.name ? void doRemove(item.name) : setConfirming(item.name))}
                          onBlur={() => setConfirming(null)}
                        >
                          {confirming === item.name ? '确认？' : '删除'}
                        </button>
                      </div>
                    </div>

                    {isPicking && !isBook && item.color && (
                      <div className="cat-modal-colors">
                        {HIGHLIGHT_COLORS.map((c) => {
                          const taken = usedColors.has(c) && item.color !== c;
                          return (
                            <button
                              key={c}
                              type="button"
                              className="cat-modal-color"
                              data-taken={taken || undefined}
                              data-active={item.color === c || undefined}
                              style={{ background: COLOR_META[c].solid }}
                              disabled={taken}
                              title={taken ? `${COLOR_META[c].label} 已被别的分类占用` : COLOR_META[c].label}
                              onClick={() => void changeColor(item.name, c)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && <p className="cat-modal-empty">还没有分类，在下面加一个。</p>}
            </div>

            <footer className="cat-modal-add">
              <input
                className="cat-modal-input cat-modal-input-add"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                placeholder={isBook ? '新分类名字，如「推理」' : '新分类名字，如「灵感」'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doAdd();
                }}
              />
              {!isBook && (
                <div className="cat-modal-pick">
                  {freeColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="cat-modal-color"
                      data-active={addColor === c || undefined}
                      style={{ background: COLOR_META[c].solid }}
                      title={COLOR_META[c].label}
                      onClick={() => setAddColor(c)}
                    />
                  ))}
                  {!freeColors.length && <span className="cat-modal-warn">颜色用完了</span>}
                </div>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => void doAdd()}
                disabled={!adding.trim() || (!isBook && !freeColors.length)}
              >
                添加
              </Button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // 挂到 body：父级有 transform 时，fixed 定位会跑偏，弹窗就会"整体有问题"
  return createPortal(modal, document.body);
}
