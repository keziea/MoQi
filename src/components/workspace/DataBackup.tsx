import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { ipc, type DataCounts } from '@/lib/ipc';

type Status =
  | { kind: 'idle' }
  | { kind: 'exported'; dir: string; counts: DataCounts }
  | { kind: 'imported'; counts: DataCounts; merged: DataCounts; backupDir: string }
  | { kind: 'failed'; reason?: string; detail?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功后通知外层刷新进度 / 笔记 / 统计 */
  onImported?: () => void;
}

const FAIL_TEXT: Record<string, string> = {
  'not-moqi-data':
    '对不起，你的导入数据有误，不是「墨栖」需要的数据。请选择包含 progress.json / notes.json / sessions.json 的文件夹。',
  empty: '这个文件夹里没有可导入的阅读数据。',
  'read-error': '文件读不出来，可能已损坏或被其他程序占用。',
};

function num(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function DataBackup({ open, onClose, onImported }: Props) {
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    setStatus({ kind: 'idle' });
    let alive = true;
    ipc.data
      .counts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        if (alive) setCounts(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  async function handleExport() {
    setBusy('export');
    try {
      const r = await ipc.data.export();
      if (r.ok) setStatus({ kind: 'exported', dir: r.dir, counts: r.counts });
      else if (!r.canceled) setStatus({ kind: 'failed', reason: 'export', detail: r.detail });
    } catch (err) {
      setStatus({ kind: 'failed', reason: 'export', detail: String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy('import');
    try {
      const r = await ipc.data.import();
      if (r.ok) {
        setStatus({ kind: 'imported', counts: r.counts, merged: r.merged, backupDir: r.backupDir });
        setCounts(r.merged);
        onImported?.();
      } else if (!r.canceled) {
        setStatus({ kind: 'failed', reason: r.reason, detail: r.detail });
      }
    } catch (err) {
      setStatus({ kind: 'failed', reason: 'read-error', detail: String(err) });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="数据备份"
      subtitle="进度、笔记、阅读时长，都只在这台电脑上"
    >
      <div className="space-y-5">
        {/* 当前数据 */}
        <section>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            这台电脑上现在有
          </div>
          <div className="rounded-[14px] border border-line px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            {counts ? (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px] text-ink-2">
                <strong className="text-[19px] font-semibold tabular-nums text-ink">{num(counts.books)}</strong>
                <span>本书的进度</span>
                <span className="px-0.5 text-ink-3">·</span>
                <strong className="text-[19px] font-semibold tabular-nums text-ink">{num(counts.notes)}</strong>
                <span>条笔记</span>
                <span className="px-0.5 text-ink-3">·</span>
                <strong className="text-[19px] font-semibold tabular-nums text-ink">{num(counts.days)}</strong>
                <span>天阅读记录</span>
              </div>
            ) : (
              <div className="text-[12.5px] text-ink-3">正在读取…</div>
            )}
          </div>
        </section>

        {/* 两个动作 */}
        <section className="space-y-2.5">
          <button
            type="button"
            onClick={handleExport}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[13.5px] font-medium transition disabled:opacity-45"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Icon name="export" size={16} />
            {busy === 'export' ? '正在导出…' : '导出我的数据'}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] border px-4 py-2.5 text-[13.5px] font-medium text-ink transition hover:bg-surface-sunken disabled:opacity-45"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <Icon name="import" size={16} />
            {busy === 'import' ? '正在导入…' : '导入我的数据'}
          </button>
        </section>

        {/* 结果 */}
        {status.kind === 'exported' && (
          <div
            className="rounded-[12px] border px-4 py-3"
            style={{
              borderColor: 'color-mix(in srgb, var(--success) 36%, transparent)',
              background: 'color-mix(in srgb, var(--success) 8%, transparent)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--success)' }}>
              <Icon name="check" size={15} />
              已导出
            </div>
            <div className="mt-1.5 break-all text-[12px] leading-relaxed text-ink-2">{status.dir}</div>
            <button
              type="button"
              onClick={() => ipc.app.openPath(status.dir)}
              className="mt-2 text-[12px] font-medium underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              打开文件夹
            </button>
          </div>
        )}

        {status.kind === 'imported' && (
          <div
            className="rounded-[12px] border px-4 py-3"
            style={{
              borderColor: 'color-mix(in srgb, var(--success) 36%, transparent)',
              background: 'color-mix(in srgb, var(--success) 8%, transparent)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--success)' }}>
              <Icon name="check" size={15} />
              个人数据导入成功
            </div>
            <div className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
              这次带进来 {num(status.counts.books)} 本书的进度、{num(status.counts.notes)} 条笔记、
              {num(status.counts.days)} 天阅读记录。
              <br />
              现在一共 {num(status.merged.books)} 本书、{num(status.merged.notes)} 条笔记、
              {num(status.merged.days)} 天记录。
            </div>
            <div className="mt-1.5 text-[11.5px] text-ink-3">
              导入前的数据已备份到 data/user/{status.backupDir}
            </div>
          </div>
        )}

        {status.kind === 'failed' && (
          <div
            className="rounded-[12px] border px-4 py-3"
            style={{
              borderColor: 'color-mix(in srgb, var(--danger) 34%, transparent)',
              background: 'var(--danger-soft)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--danger)' }}>
              <Icon name="info" size={15} />
              {status.reason === 'export' ? '导出失败' : '导入失败'}
            </div>
            <div className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
              {FAIL_TEXT[status.reason ?? ''] ?? '出了点问题，请再试一次。'}
              {status.detail && status.reason !== 'not-moqi-data' && (
                <span className="mt-1 block text-[11.5px] text-ink-3">{status.detail}</span>
              )}
            </div>
          </div>
        )}

        {/* 说明 */}
        <section className="space-y-2 border-t border-line pt-4 text-[11.5px] leading-relaxed text-ink-3">
          <p>
            <strong className="font-medium text-ink-2">换电脑：</strong>
            旧电脑点「导出我的数据」，把文件夹拷到 U 盘；新电脑装好墨栖，点「导入我的数据」选中它。
          </p>
          <p>
            <strong className="font-medium text-ink-2">不会覆盖：</strong>
            导入只补充缺的、更新新的，重复导入也不会出现重复笔记。
          </p>
          <button
            type="button"
            onClick={() => ipc.app.openDataDir()}
            className="pt-1 text-[11.5px] font-medium underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            打开数据文件夹
          </button>
        </section>
      </div>
    </Sheet>
  );
}
