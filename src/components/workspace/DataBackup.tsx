import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import {
  ipc,
  type BackupExportResult,
  type BackupPhase,
  type BackupProgress,
  type BackupRestoreResult,
  type BackupStats,
  type DataLocationInfo,
  type RelocateProgress,
} from '@/lib/ipc';

type Status =
  | { kind: 'idle' }
  | { kind: 'exported'; result: Extract<BackupExportResult, { ok: true }> }
  | { kind: 'restored'; result: Extract<BackupRestoreResult, { ok: true }> }
  | { kind: 'failed'; action: 'export' | 'import'; reason?: string; detail?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功后通知外层刷新进度 / 笔记 / 统计 / 书架 */
  onImported?: () => void;
}

const PHASE_TEXT: Record<BackupPhase, string> = {
  collect: '正在整理书架…',
  pack: '正在打包…',
  unpack: '正在读取压缩包…',
  books: '正在放回书文件…',
  merge: '正在合并笔记与进度…',
};

const FAIL_TEXT: Record<string, string> = {
  'not-moqi-data':
    '这不是墨栖的备份。请选择墨栖导出的 zip，或者包含 library.json / progress.json 的文件夹。',
  empty: '备份里没有可恢复的内容。',
  'read-error': '文件读不出来，可能已损坏或被其他程序占用。',
  'zip-error': '这个压缩包读不了。如果是 7z / rar，请先解压成文件夹再导入。',
  unsupported: '不支持这种压缩格式，请用 ZIP 或解压后的文件夹。',
  'too-large': '备份超过 4GB 了，取消勾选「连书一起打包」再试一次。',
  'write-error': '写文件失败，可能是磁盘空间不够，或者目标文件正被占用。',
};

function num(n: number): string {
  return (n || 0).toLocaleString('zh-CN');
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function sinceText(ts?: number): string {
  if (!ts) return '还没备份过';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return '今天备份过';
  if (days === 1) return '昨天备份过';
  if (days < 30) return `${days} 天前备份过`;
  return `${Math.floor(days / 30)} 个月前备份过`;
}

function fileNameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function DataBackup({ open, onClose, onImported }: Props) {
  const [info, setInfo] = useState<BackupStats | null>(null);
  const [location, setLocation] = useState<DataLocationInfo | null>(null);
  const [includeBooks, setIncludeBooks] = useState(true);
  const [busy, setBusy] = useState<'export' | 'zip' | 'folder' | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [moving, setMoving] = useState<'pick' | 'copy' | null>(null);
  const [moveProgress, setMoveProgress] = useState<RelocateProgress | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const refreshInfo = async () => {
    try {
      setInfo(await ipc.backup.info());
    } catch {
      setInfo(null);
    }
  };

  const refreshLocation = async () => {
    try {
      setLocation(await ipc.location.info());
    } catch {
      setLocation(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    setStatus({ kind: 'idle' });
    setProgress(null);
    setMoving(null);
    setMoveProgress(null);
    setMoveError(null);
    setRestarting(false);
    void refreshInfo();
    void refreshLocation();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return ipc.on.backupProgress((p) => setProgress(p));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return ipc.on.locationProgress((p) => {
      setMoveProgress(p);
      setMoving('copy');
    });
  }, [open]);

  // 结果可能在面板下方，出来的时候带用户看一眼，别让人以为没反应
  useEffect(() => {
    if (status.kind === 'idle') return;
    const id = window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [status]);

  async function handleExport() {
    if (busy) return;
    setBusy('export');
    setProgress(null);
    try {
      const r = await ipc.backup.export({ includeBooks });
      if (r.ok) {
        setStatus({ kind: 'exported', result: r });
        void refreshInfo();
      } else if (!r.canceled) {
        setStatus({ kind: 'failed', action: 'export', reason: r.reason, detail: r.detail });
      }
    } catch (err) {
      setStatus({ kind: 'failed', action: 'export', reason: 'write-error', detail: String(err) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleImport(mode: 'zip' | 'folder') {
    if (busy) return;
    setBusy(mode);
    setProgress(null);
    try {
      const r = await ipc.backup.import(mode);
      if (r.ok) {
        setStatus({ kind: 'restored', result: r });
        void refreshInfo();
        onImported?.();
      } else if (!r.canceled) {
        setStatus({ kind: 'failed', action: 'import', reason: r.reason, detail: r.detail });
      }
    } catch (err) {
      setStatus({ kind: 'failed', action: 'import', reason: 'read-error', detail: String(err) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleChangeLocation() {
    if (moving || busy) return;
    setMoving('pick');
    setMoveError(null);
    setMoveProgress(null);
    try {
      const r = await ipc.location.change();
      if (r.ok) {
        setRestarting(true);
        void refreshLocation();
      } else if (!r.canceled && r.reason === 'io') {
        setMoveError(r.detail ?? '迁移失败，原数据没有动。');
      }
    } catch (err) {
      setMoveError(String(err));
    } finally {
      setMoving(null);
      setMoveProgress(null);
    }
  }

  async function handleResetLocation() {
    if (moving || busy) return;
    setMoving('pick');
    setMoveError(null);
    setMoveProgress(null);
    try {
      const r = await ipc.location.reset();
      if (r.ok) {
        setRestarting(true);
        void refreshLocation();
      } else if (!r.canceled && r.reason === 'io') {
        setMoveError(r.detail ?? '迁移失败，原数据没有动。');
      }
    } catch (err) {
      setMoveError(String(err));
    } finally {
      setMoving(null);
      setMoveProgress(null);
    }
  }

  const disabled = busy !== null || moving !== null;
  const percent =
    progress && progress.total > 0
      ? Math.max(3, Math.min(100, Math.round((progress.done / progress.total) * 100)))
      : 4;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={430}
      title="备份与恢复"
      subtitle="书架、笔记、进度、书文件，都收进一个压缩包"
    >
      <div className="space-y-6">
        {/* 这台电脑上有什么 */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">这台电脑上</span>
            <span className="text-[11px] text-ink-3">{sinceText(info?.lastBackupAt)}</span>
          </div>
          <div
            className="rounded-[14px] border border-line px-4 py-3.5"
            style={{ background: 'var(--surface-sunken)' }}
          >
            {info ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Figure value={info.shelf} label="本书" />
                  <Figure value={info.notes} label="条笔记" />
                  <Figure value={info.days} label="天阅读" />
                </div>
                <div className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-3">
                  书文件 {formatBytes(info.bookBytes)} · 记录 {formatBytes(info.recordBytes)}
                </div>
              </>
            ) : (
              <div className="py-1 text-[12.5px] text-ink-3">正在读取…</div>
            )}
          </div>
        </section>

        {/* 导出 */}
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-ink">导出备份</h3>
            <span className="text-[11px] text-ink-3">ZIP 压缩包</span>
          </div>

          <button
            type="button"
            onClick={() => setIncludeBooks((v) => !v)}
            disabled={disabled}
            className="flex w-full items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-left transition hover:bg-sunken disabled:opacity-50"
            style={{
              borderColor: includeBooks ? 'var(--accent-line)' : 'var(--line)',
              background: includeBooks ? 'var(--accent-tint)' : 'transparent',
            }}
            aria-pressed={includeBooks}
          >
            <span
              className="mt-0.5 grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border transition"
              style={{
                borderColor: includeBooks ? 'var(--accent)' : 'var(--line-strong)',
                background: includeBooks ? 'var(--accent)' : 'transparent',
                color: '#fff',
              }}
            >
              {includeBooks && <Icon name="check" size={11} strokeWidth={2.6} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] leading-snug text-ink">
                连书一起打包
                <span className="ml-1 text-[11px] text-ink-3">推荐</span>
              </span>
              <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-3">
                换电脑后书架、封面、正文都在，共 {num(info?.shelf ?? 0)} 本 · 约{' '}
                {formatBytes(info?.bookBytes ?? 0)}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[13.5px] font-medium transition disabled:opacity-45"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Icon name="export" size={16} />
            {busy === 'export' ? '正在导出…' : '导出为压缩包'}
          </button>

          <p className="text-[11px] leading-relaxed text-ink-3">
            不勾选则只备份笔记、阅读进度、统计与分类，不含书；换电脑后书架要重新添加。
          </p>
        </section>

        {/* 恢复 */}
        <section className="space-y-2.5 border-t border-line pt-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-ink">恢复数据</h3>
            <span className="text-[11px] text-ink-3">只补不覆盖</span>
          </div>

          <button
            type="button"
            onClick={() => handleImport('zip')}
            disabled={disabled}
            className="flex w-full items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition hover:bg-sunken disabled:opacity-45"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}
            >
              <Icon name="import" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-snug text-ink">
                {busy === 'zip' ? '正在导入压缩包…' : '以压缩包形式导入'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
                选中墨栖导出的 .zip，不用先解压
              </span>
            </span>
            <Icon name="chevron-right" size={15} className="shrink-0 text-ink-3" />
          </button>

          <button
            type="button"
            onClick={() => handleImport('folder')}
            disabled={disabled}
            className="flex w-full items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition hover:bg-sunken disabled:opacity-45"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}
            >
              <Icon name="folder" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-snug text-ink">
                {busy === 'folder' ? '正在导入文件夹…' : '以文件夹形式导入'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
                已经解压出来的备份文件夹，外面多套一层也认
              </span>
            </span>
            <Icon name="chevron-right" size={15} className="shrink-0 text-ink-3" />
          </button>

          <p className="text-[11px] leading-relaxed text-ink-3">
            导入前会自动给当前数据留一份底，重复导入也不会出现重复的笔记。
          </p>
        </section>

        {/* 进度 */}
        {busy && (
          <section
            className="rounded-[12px] border border-line px-4 py-3"
            style={{ background: 'var(--surface-sunken)' }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] text-ink-2">
                {progress ? PHASE_TEXT[progress.phase] : '准备中…'}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{percent}%</span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full"
              style={{ background: 'var(--line)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={progress ? PHASE_TEXT[progress.phase] : '准备中'}
            >
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${percent}%`, background: 'var(--accent)' }}
              />
            </div>
            {progress?.name && (
              <div className="mt-1.5 truncate text-[11px] text-ink-3">{fileNameOf(progress.name)}</div>
            )}
          </section>
        )}

        {/* 结果 */}
        <div ref={resultRef} className="space-y-3">
          {status.kind === 'exported' && (
            <ResultCard tone="success" title="备份已导出">
              <div className="break-all">{status.result.file}</div>
              <div className="mt-1.5 text-[11.5px] text-ink-3">
                {formatBytes(status.result.bytes)} · 书架 {num(status.result.counts.shelf)} 本 · 书文件{' '}
                {num(status.result.bookFiles)} 个 · 笔记 {num(status.result.counts.notes)} 条
              </div>
              {status.result.skipped.length > 0 && (
                <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--danger)' }}>
                  有 {num(status.result.skipped.length)} 个文件已不在原位置，没能打包。
                </div>
              )}
              <button
                type="button"
                onClick={() => ipc.app.openPath(status.result.file)}
                className="mt-2 text-[12px] font-medium underline decoration-dotted underline-offset-4"
                style={{ color: 'var(--accent)' }}
              >
                在文件夹中显示
              </button>
            </ResultCard>
          )}

          {status.kind === 'restored' && <RestoreCard result={status.result} />}

          {status.kind === 'failed' && (
            <ResultCard tone="danger" title={status.action === 'export' ? '导出失败' : '恢复失败'}>
              <div>{FAIL_TEXT[status.reason ?? ''] ?? '出了点问题，请再试一次。'}</div>
              {status.detail && (
                <div className="mt-1.5 break-all text-[11.5px] text-ink-3">{status.detail}</div>
              )}
            </ResultCard>
          )}
        </div>

        {/* 数据位置 */}
        <section className="space-y-2.5 border-t border-line pt-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-ink">数据位置</h3>
            <span className="text-[11px] text-ink-3">
              {location?.isCustom ? '自定义' : '默认'}
            </span>
          </div>

          <div
            className="rounded-[12px] border border-line px-3.5 py-3"
            style={{ background: 'var(--surface-sunken)' }}
          >
            <div className="break-all text-[11.5px] leading-relaxed text-ink-2">
              {location?.dataDir ?? '正在读取…'}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-ink-3">
              {location?.isCustom
                ? `数据放在你选的 ${location.folderName} 文件夹里`
                : `默认位置。更改时选一个目录，墨栖会在里面新建 ${location?.folderName ?? 'MoQiReader'} 文件夹`}
            </div>
          </div>

          {location?.unavailable && (
            <div
              className="rounded-[10px] px-3 py-2 text-[11px] leading-relaxed"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              之前设置的位置打不开（磁盘没插上或文件夹被移走）：
              <span className="break-all"> {location.unavailable}</span>
              <br />
              已临时使用默认位置。插回磁盘后重启墨栖就会回去。
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleChangeLocation}
              disabled={disabled}
              className="flex-1 rounded-[12px] border px-3 py-2.5 text-[12.5px] font-medium text-ink transition hover:bg-sunken disabled:opacity-45"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              {moving === 'pick' ? '请选择位置…' : moving === 'copy' ? '正在迁移…' : '更改位置'}
            </button>
            {location?.isCustom && (
              <button
                type="button"
                onClick={handleResetLocation}
                disabled={disabled}
                className="rounded-[12px] border px-3 py-2.5 text-[12.5px] text-ink-2 transition hover:bg-sunken disabled:opacity-45"
                style={{ borderColor: 'var(--line)' }}
              >
                改回默认
              </button>
            )}
          </div>

          {moving === 'copy' && moveProgress && (
            <div
              className="rounded-[12px] border border-line px-4 py-3"
              style={{ background: 'var(--surface-sunken)' }}
            >
              <div className="flex items-baseline justify-between text-[12px] text-ink-2">
                <span>正在搬运数据…</span>
                <span className="text-[11px] tabular-nums text-ink-3">
                  {moveProgress.total > 0
                    ? `${num(moveProgress.done)} / ${num(moveProgress.total)} 个文件`
                    : '准备中'}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${
                      moveProgress.total > 0
                        ? Math.max(3, Math.round((moveProgress.done / moveProgress.total) * 100))
                        : 4
                    }%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-ink-3">
                已搬运 {formatBytes(moveProgress.bytes)}
              </div>
            </div>
          )}

          {moveError && (
            <div
              className="rounded-[10px] px-3 py-2 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              换位置失败：{moveError}
            </div>
          )}

          {restarting && (
            <div
              className="rounded-[10px] px-3 py-2 text-[11.5px] leading-relaxed"
              style={{
                background: 'color-mix(in srgb, var(--success) 8%, transparent)',
                color: 'var(--success)',
              }}
            >
              数据已经搬好，墨栖正在重启…
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-ink-3">
            换位置是先复制、核对文件数量，再切换；旧位置的数据会在下次启动时清理。移动硬盘没插时，会自动退回默认位置。
          </p>
        </section>

        {/* 说明 */}
        <section className="space-y-2 border-t border-line pt-4 text-[11.5px] leading-relaxed text-ink-3">
          <p>
            <strong className="font-medium text-ink-2">换电脑：</strong>
            旧电脑导出 zip → 拷到 U 盘或网盘 → 新电脑装好墨栖，从压缩包恢复。
          </p>
          <p>
            <strong className="font-medium text-ink-2">书放在哪：</strong>
            恢复后书文件会复制到墨栖自己的数据目录，原文件不会被动。
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

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-[19px] font-semibold leading-none tabular-nums text-ink">{num(value)}</div>
      <div className="mt-1 text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

function ResultCard({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'danger';
  title: string;
  children: ReactNode;
}) {
  const color = tone === 'success' ? 'var(--success)' : 'var(--danger)';
  return (
    <section
      className="rounded-[12px] border px-4 py-3 text-[12px] leading-relaxed text-ink-2"
      style={{
        borderColor: `color-mix(in srgb, ${color} 36%, transparent)`,
        background:
          tone === 'success'
            ? 'color-mix(in srgb, var(--success) 8%, transparent)'
            : 'var(--danger-soft)',
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium" style={{ color }}>
        <Icon name={tone === 'success' ? 'check' : 'info'} size={15} />
        {title}
      </div>
      {children}
    </section>
  );
}

function RestoreCard({ result }: { result: Extract<BackupRestoreResult, { ok: true }> }) {
  const bookLine = result.booksAdded
    ? `新放入 ${num(result.booksAdded)} 本书`
    : result.booksUpdated
      ? `更新了 ${num(result.booksUpdated)} 本书`
      : '书架没有变化';

  return (
    <ResultCard tone="success" title="恢复完成">
      <div>
        备份里有：书架 {num(result.counts.shelf)} 本 · 笔记 {num(result.counts.notes)} 条 · 阅读记录{' '}
        {num(result.counts.days)} 天。
      </div>
      <div className="mt-1">
        {bookLine}
        {result.bookFiles > 0 && `，放回 ${num(result.bookFiles)} 个书文件`}。
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">
        现在一共 {num(result.merged.shelf)} 本书、{num(result.merged.notes)} 条笔记、
        {num(result.merged.days)} 天阅读记录。
      </div>

      {result.legacy && (
        <div className="mt-2 text-[11.5px] text-ink-3">
          这是旧版备份（只有阅读数据），书架需要重新添加书。
        </div>
      )}
      {!result.legacy && !result.includeBooks && (
        <div className="mt-2 text-[11.5px] text-ink-3">
          这份备份没带书，书架需要重新添加；笔记和阅读记录已经回来了。
        </div>
      )}
      {result.includeBooks && result.booksSkipped > 0 && (
        <div className="mt-2 text-[11.5px] text-ink-3">
          有 {num(result.booksSkipped)} 本书没在备份里找到书文件，先跳过了。
        </div>
      )}
      {result.warnings.map((w) => (
        <div key={w} className="mt-1 text-[11.5px]" style={{ color: 'var(--danger)' }}>
          {w}
        </div>
      ))}

      <div className="mt-2 text-[11px] text-ink-3">恢复前的数据已留底：{result.backupDir}</div>
    </ResultCard>
  );
}
