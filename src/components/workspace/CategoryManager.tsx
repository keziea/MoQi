import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_NOTE_CATEGORIES, HIGHLIGHT_COLORS, type HighlightColor } from '@shared/models';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { COLOR_META } from '@/lib/colors';
import { useSettings } from '@/store/useSettings';
import { useLibrary } from '@/store/useLibrary';
import { ipc } from '@/lib/ipc';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 打开时默认停在哪个页签 */
  tab: 'book' | 'note';
  /** 笔记分类 -> 条数 */
  noteCounts: Map<string, number>;
  /** 分类改名 / 删除之后，让上层重新拉一遍笔记 */
  onChanged: () => void;
}

export function CategoryManager({ open, onClose, tab, noteCounts, onChanged }: Props) {
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const books = useLibrary((s) => s.books);

  const [mode, setMode] = useState<'book' | 'note'>(tab);
  const [adding, setAdding] = useState('');
  const [addColor, setAddColor] = useState<HighlightColor>('clay');
  const [editing, setEditing] = useState<{ name: string; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  const bookCats = useMemo(() => settings.categories ?? [], [settings.categories]);
  const noteCats = useMemo(() => settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES, [settings.noteCategories]);

  const bookCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of books) for (const c of b.categories ?? []) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [books]);

  const usedColors = useMemo(() => new Set(noteCats.map((c) => c.color)), [noteCats]);
  const freeColors = HIGHLIGHT_COLORS.filter((c) => !usedColors.has(c));

  useEffect(() => {
    if (!open) return;
    setMode(tab);
    setAdding('');
    setEditing(null);
    setConfirming(null);
    setPickingFor(null);
    setAddColor(HIGHLIGHT_COLORS.find((c) => !(settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES).some((n) => n.color === c)) ?? 'clay');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

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
    const res = await ipc.category.rename(mode, editing.name, to);
    if (!res.ok) {
      toast(res.error ?? '改名失败');
      return;
    }
    await reload();
    if (mode === 'book') await useLibrary.getState().load();
    onChanged();
    setEditing(null);
    toast(`「${editing.name}」已改名为「${to}」`);
  };

  const doRemove = async (name: string) => {
    const res = await ipc.category.remove(mode, name);
    if (!res.ok) {
      toast(res.error ?? '删除失败');
      return;
    }
    await reload();
    if (mode === 'book') await useLibrary.getState().load();
    onChanged();
    setConfirming(null);
    toast(`已删除「${name}」，相关内容退回未分类`);
  };

  const doAdd = async () => {
    const name = adding.trim();
    if (!name) return;
    const list = mode === 'book' ? bookCats : noteCats.map((c) => c.name);
    if (list.includes(name)) {
      toast('已经有同名分类了');
      return;
    }
    if (mode === 'book') {
      await updateSettings({ categories: [...bookCats, name] });
    } else {
      if (!freeColors.length) {
        toast('颜色已经用完了，先把某个分类的颜色换掉');
        return;
      }
      // addColor 可能是旧值（比如刚删了一个分类），落到仍空闲的颜色上
      const pick = freeColors.includes(addColor) ? addColor : freeColors[0];
      await updateSettings({ noteCategories: [...noteCats, { name, color: pick }] });
    }
    setAdding('');
    onChanged();
    toast(`已添加「${name}」`);
  };

  const changeColor = async (name: string, color: HighlightColor) => {
    const res = await ipc.category.setNoteColor(name, color);
    if (!res.ok) {
      toast(res.error ?? '这个颜色已经被占用了');
      return;
    }
    await reload();
    onChanged();
    setPickingFor(null);
    toast('颜色已更换');
  };

  const items = mode === 'book' ? bookCats.map((name) => ({ name, color: null as HighlightColor | null })) : noteCats.map((c) => ({ name: c.name, color: c.color }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="分类管理"
      subtitle={mode === 'book' ? `书籍分类 · ${bookCats.length} 种` : `笔记分类 · ${noteCats.length} 种`}
      width={420}
    >
      <div className="catmgr">
        <div className="catmgr-tabs" role="tablist">
          <button type="button" data-active={mode === 'book' || undefined} onClick={() => { setMode('book'); setEditing(null); setConfirming(null); }}>
            书籍分类
          </button>
          <button type="button" data-active={mode === 'note' || undefined} onClick={() => { setMode('note'); setEditing(null); setConfirming(null); }}>
            笔记分类
          </button>
        </div>

        <p className="catmgr-hint">
          {mode === 'book'
            ? '改名会同步所有书；删除只去掉这个分类，书还在书架上。'
            : '一个分类占一种颜色，颜色不能重复。改名会同步到已有笔记。'}
        </p>

        <div className="catmgr-list">
          {items.map((item) => {
            const count = mode === 'book' ? bookCounts.get(item.name) ?? 0 : noteCounts.get(item.name) ?? 0;
            const isEditing = editing?.name === item.name;
            return (
              <div className="catmgr-item" key={item.name}>
                <div className="catmgr-row">
                  {mode === 'note' && item.color && (
                    <button
                      type="button"
                      className="catmgr-dot"
                      style={{ background: COLOR_META[item.color].solid }}
                      onClick={() => setPickingFor(pickingFor === item.name ? null : item.name)}
                      aria-label="更换颜色"
                      title="更换颜色"
                    />
                  )}
                  {isEditing ? (
                    <input
                      className="catmgr-input"
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
                    <span className="catmgr-name">{item.name}</span>
                  )}
                  <span className="catmgr-count">{count} {mode === 'book' ? '本' : '条'}</span>
                  {!isEditing && (
                    <button type="button" className="catmgr-act" onClick={() => setEditing({ name: item.name, draft: item.name })}>
                      改名
                    </button>
                  )}
                  <button
                    type="button"
                    className="catmgr-act"
                    data-danger={confirming === item.name || undefined}
                    onClick={() => (confirming === item.name ? void doRemove(item.name) : setConfirming(item.name))}
                    onBlur={() => setConfirming(null)}
                  >
                    {confirming === item.name ? '确认删除' : '删除'}
                  </button>
                </div>

                {pickingFor === item.name && mode === 'note' && (
                  <div className="catmgr-colors">
                    {HIGHLIGHT_COLORS.map((c) => {
                      const taken = usedColors.has(c) && item.color !== c;
                      return (
                        <button
                          key={c}
                          type="button"
                          className="catmgr-color"
                          data-taken={taken || undefined}
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
          {items.length === 0 && <p className="catmgr-empty">还没有分类，先在下面添加一个。</p>}
        </div>

        <div className="catmgr-add">
          <input
            className="catmgr-input"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder={mode === 'book' ? '新分类名字，如「推理」' : '新分类名字，如「灵感」'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doAdd();
            }}
          />
          {mode === 'note' && (
            <div className="catmgr-pick">
              {freeColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="catmgr-color"
                  data-active={addColor === c || undefined}
                  style={{ background: COLOR_META[c].solid }}
                  title={COLOR_META[c].label}
                  onClick={() => setAddColor(c)}
                />
              ))}
              {!freeColors.length && <span className="catmgr-warn">颜色用完了</span>}
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={() => void doAdd()} disabled={!adding.trim() || (mode === 'note' && !freeColors.length)}>
            添加
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
