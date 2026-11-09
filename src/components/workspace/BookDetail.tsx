import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { BookMeta, Progress } from '@shared/models';
import { coverUrl, formatChars, formatDuration, formatLabel, formatPercent } from '@/lib/format';
import { displayPercent, readStatus, STATUS_HINT, STATUS_LABEL } from '@/lib/reading';
import { ipc } from '@/lib/ipc';
import { toast } from '@/lib/toast';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { FinishedCelebration, type FinishedSummary } from './FinishedCelebration';
import { CategoryManager } from './CategoryManager';


interface Props {
  meta: BookMeta;
  progress: Progress | null;
  stats?: { seconds: number; notes: number };
  onRead: () => void;
  onClose: () => void;
}

const FORMAT_ORDER = ['epub', 'mobi', 'pdf', 'txt'] as const;

export function BookDetail({ meta, progress, stats, onRead, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishSummary, setFinishSummary] = useState<FinishedSummary | null>(null);
  const [newCat, setNewCat] = useState('');
  const [catMgr, setCatMgr] = useState(false);

  const allCategories = useSettings((s) => s.settings.categories ?? []);
  const updateSettings = useSettings((s) => s.update);

  // 本地维护选中集合：连续快速点击时不会因为 props 还没回流而丢状态
  const [selected, setSelected] = useState<string[]>(meta.categories ?? []);
  const catKey = (meta.categories ?? []).join('|');
  useEffect(() => {
    setSelected(meta.categories ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, catKey]);

  const mine = selected;

  const commit = async (next: string[]) => {
    setSelected(next);
    await ipc.library.setCategories(meta.id, next);
    useLibrary.getState().applyCategories(meta.id, next);
  };

  const toggleCategory = async (name: string) => {
    const next = selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name];
    await commit(next);
  };

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    setNewCat('');
    if (!allCategories.includes(name)) {
      updateSettings({ categories: [...allCategories, name] });
    }
    if (!selected.includes(name)) await commit([...selected, name]);
  };

  const cover = coverUrl(meta);
  const ratio = progress?.ratio ?? 0;
  const status = readStatus(progress);
  const finished = status === 'finished';
  const percent = displayPercent(progress);

  const variants = useMemo(
    () =>
      [...meta.variants].sort(
        (a, b) => FORMAT_ORDER.indexOf(a.format as (typeof FORMAT_ORDER)[number]) -
          FORMAT_ORDER.indexOf(b.format as (typeof FORMAT_ORDER)[number])
      ),
    [meta.variants]
  );

  const switchFormat = async (format: string) => {
    if (format === meta.format || busy) return;
    setBusy(true);
    try {
      const r = await ipc.library.switchVariant(meta.id, format);
      if (r.ok) {
        await useLibrary.getState().scan(true);
        toast(`已改用 ${formatLabel(format)}，阅读位置会尽量保留`);
      } else {
        toast(r.error ?? '切换失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleFinished = async () => {
    if (marking) return;
    setMarking(true);
    try {
      const base: Progress = progress ?? {
        bookId: meta.id,
        chapterId: 'c0',
        blockId: 'c0#0',
        delta: 0,
        ratio: finished ? 0 : 1,
        updatedAt: Date.now(),
      };
      // 标记读完 / 取消读完都说明这本书已经被碰过：补上 openedAt，
      // 取消读完才会回到「正在阅读」，而不是掉回「未读」。
      const touched: Progress = { ...base, openedAt: base.openedAt ?? Date.now() };
      // 移回「在读」时把进度收回到 98%，避免出现「100% 却未读完」的矛盾状态
      const next: Progress = finished
        ? {
            ...touched,
            finished: false,
            finishedAt: undefined,
            ratio: Math.min(touched.ratio || 0, 0.98),
          }
        : { ...touched, finished: true, finishedAt: Date.now() };
      await ipc.progress.save(next);
      await useLibrary.getState().refreshProgress();
      if (!finished) {
        const summary = await ipc.stats.finishedSummary(meta.id);
        setFinishSummary(summary);
        setFinishOpen(true);
      } else {
        toast('已移回「在读」，进度保留');
      }
    } finally {
      setMarking(false);
    }
  };

  return (
    <>
    <motion.section
      className="bd-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="bd-inner">
        <button className="bd-back" type="button" onClick={onClose}>
          <Icon name="arrow-left" size={16} />
          <span>我的书架</span>
        </button>

        <div className="bd-hero">
          <div className="bd-cover">
            {cover ? (
              <img src={cover} alt="" draggable={false} />
            ) : (
              <span>{meta.title}</span>
            )}
          </div>

          <div className="bd-main">
            <div className="bd-tags">
              <span className="bd-tag" data-tone="accent">
                {formatLabel(meta.format)}
              </span>
              <span className="bd-tag" data-tone={status === 'finished' ? 'done' : undefined}>
                {STATUS_LABEL[status]}
                {status === 'reading' ? ` ${formatPercent(ratio)}` : ''}
              </span>
              <span className="bd-tag bd-tag-quiet">{STATUS_HINT[status]}</span>
            </div>

            <h1 className="bd-title">{meta.title}</h1>
            <p className="bd-author">{meta.author}</p>
            <p className="bd-meta">
              {meta.publisher ? <span>{meta.publisher}</span> : null}
              <span>{formatChars(meta.totalChars)}</span>
              <span>{meta.chapterCount} 章</span>
            </p>

            <div className="bd-actions">
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="book" size={17} />}
                onClick={onRead}
              >
                {status === 'finished' ? '阅读' : status === 'reading' ? '阅读' : '阅读'}
              </Button>
              <Button
                variant={finished ? 'secondary' : 'ghost'}
                size="lg"
                icon={<Icon name={finished ? 'rotate-ccw' : 'check'} size={16} />}
                onClick={toggleFinished}
                disabled={marking}
              >
                {finished ? '取消「已读完」' : '标记为已读完'}
              </Button>
            </div>
          </div>
        </div>

        <div className="bd-stats">
          <div className="bd-stat">
            <span className="bd-stat-label">阅读进度</span>
            <span className="bd-stat-value">{percent}%</span>
            <div className="bd-bar">
              <i style={{ width: `${Math.max(finished ? 100 : 1, percent)}%` }} />
            </div>
          </div>
          <div className="bd-stat">
            <span className="bd-stat-label">累计阅读</span>
            <span className="bd-stat-value">{formatDuration(stats?.seconds ?? 0)}</span>
          </div>
          <div className="bd-stat">
            <span className="bd-stat-label">笔记</span>
            <span className="bd-stat-value">{stats?.notes ?? 0} 条</span>
          </div>
          <div className="bd-stat">
            <span className="bd-stat-label">最近打开</span>
            <span className="bd-stat-value bd-stat-small">
              {meta.lastOpenedAt
                ? new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(
                    new Date(meta.lastOpenedAt)
                  )
                : '还没开始'}
            </span>
          </div>
        </div>

        <section className="bd-section">
          <header>
            <h2>选择版本</h2>
            <p>同一本书你导入了 {variants.length} 个文件，选一个舒服的来读</p>
          </header>
          <div className="bd-formats">
            {variants.map((v) => {
              const active = v.format === meta.format;
              return (
                <button
                  key={v.format}
                  type="button"
                  className="bd-format"
                  data-active={active || undefined}
                  onClick={() => switchFormat(v.format)}
                  disabled={busy}
                >
                  <span className="bd-format-name">{formatLabel(v.format)}</span>
                  <span className="bd-format-size">{formatFileSize(v.sizeBytes)}</span>
                  {active && (
                    <span className="bd-format-check">
                      <Icon name="check" size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="bd-hint">
            {meta.format === 'epub'
              ? 'EPUB 排版最好，图文完整，一般优先选它。'
              : meta.format === 'pdf'
                ? 'PDF 保持原始版式，适合图表多的书。'
                : meta.format === 'txt'
                  ? 'TXT 最轻，只有文字，没有插图和排版。'
                  : 'MOBI 体积小、章节完整，仅次于 EPUB。'}
          </p>
        </section>

        <section className="bd-section">
          <header>
            <h2>分类</h2>
            <p>可以多选——一本书同时属于历史和经济，也没问题</p>
            <button type="button" className="bd-cat-manage" onClick={() => setCatMgr(true)}>
              管理分类
            </button>
          </header>
          <div className="bd-cats">
            {allCategories.map((c) => (
              <button
                key={c}
                type="button"
                className="bd-cat"
                data-active={mine.includes(c) || undefined}
                onClick={() => toggleCategory(c)}
              >
                {c}
                {mine.includes(c) && <Icon name="check" size={12} />}
              </button>
            ))}
            <span className="bd-cat-new">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCategory();
                  }
                }}
                placeholder="新建分类"
                aria-label="新建分类"
              />
              <button type="button" onClick={addCategory} aria-label="添加分类">
                <Icon name="plus" size={13} />
              </button>
            </span>
          </div>
          {mine.length === 0 && (
            <p className="bd-hint">还没有分类。点上面的名字就能归进去。</p>
          )}
        </section>

        {progress?.mark && (
          <section className="bd-section">
            <header>
              <h2>上次标记</h2>
            </header>
            <p className="bd-mark">「{progress.mark.excerpt}」</p>
          </section>
        )}
      </div>
    </motion.section>

    <FinishedCelebration
      open={finishOpen}
      bookTitle={meta.title}
      summary={finishSummary}
      onClose={() => setFinishOpen(false)}
      onLibrary={() => {
        setFinishOpen(false);
        onClose();
      }}
    />

    <CategoryManager
      open={catMgr}
      onClose={() => setCatMgr(false)}
      kind="book"
      onChanged={() => {}}
    />
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
