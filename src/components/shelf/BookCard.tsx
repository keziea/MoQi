import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { BookFormat, BookMeta } from '@shared/models';
import { coverUrl, formatLabel, formatPercent } from '@/lib/format';
import type { ReadStatus } from '@/lib/reading';
import { ipc } from '@/lib/ipc';
import { useLibrary } from '@/store/useLibrary';
import { Icon } from '@/components/ui/Icon';

interface Props {
  meta: BookMeta;
  ratio: number;
  status?: ReadStatus;
  copies?: number;
  formats?: BookFormat[];
  onOpen: () => void;
  onSwitchFormat: (format: BookFormat) => void;
}

export function BookCard({ meta, ratio, status, copies = 1, formats: formatsProp, onOpen, onSwitchFormat }: Props) {
  const cover = coverUrl(meta);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      setConfirming(false);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const percent = status === 'finished' ? 100 : Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  // 父组件没传 status 时自己兜底，别让书卡永远显示「未读」
  const fallbackStatus: ReadStatus = ratio > 0 ? 'reading' : 'unread';
  const resolvedStatus: ReadStatus = status ?? fallbackStatus;
  const finished = resolvedStatus === 'finished';
  const cats = meta.categories ?? [];
  const formats =
    formatsProp && formatsProp.length
      ? formatsProp
      : meta.variants.length
        ? meta.variants.map((v) => v.format)
        : [meta.format];
  const others = formats.filter((f) => f !== meta.format);

  return (
    <div ref={rootRef} className="book-card group">
      <button
        onClick={onOpen}
        className="book-card-main focus-visible:outline-none"
        aria-label={`打开《${meta.title}》`}
      >
        <div className="book-cover">
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="book-cover-fallback">
              <span className="book-cover-line" />
              <span className="book-cover-title">{meta.title}</span>
            </div>
          )}

          {finished && (
            <div className="book-finished">
              <Icon name="check" size={11} strokeWidth={2.4} />
            </div>
          )}

          {ratio > 0 && !finished && (
            <div className="book-cover-progress">
              <div style={{ width: `${percent}%` }} />
            </div>
          )}

          {copies > 1 && (
            <span className="book-copies" title={`同一本书有 ${copies} 个文件版本，已合并显示`}>
              {copies} 个版本
            </span>
          )}
        </div>

        <div className="book-card-copy">
          <div className="book-card-title">{meta.title}</div>
          <div className="book-card-author-row">
            <div className="book-card-author">{meta.author || '佚名'}</div>
            <span className="book-percent">
              {resolvedStatus === 'finished'
                ? '已读完'
                : resolvedStatus === 'reading'
                  ? percent > 0
                    ? formatPercent(percent / 100)
                    : '在读'
                  : '未读'}
            </span>
          </div>
          {cats.length > 0 && (
            <div className="book-card-cats">
              {cats.slice(0, 2).map((c) => (
                <span key={c}>{c}</span>
              ))}
              {cats.length > 2 && <span>+{cats.length - 2}</span>}
            </div>
          )}
        </div>
      </button>

      <div className="book-formats" role="group" aria-label={`《${meta.title}》的文件格式`}>
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            className="book-format"
            data-active={format === meta.format || undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (format !== meta.format) onSwitchFormat(format);
            }}
            title={
              format === meta.format
                ? `当前使用 ${formatLabel(format)}`
                : `切换到 ${formatLabel(format)} 阅读`
            }
          >
            {formatLabel(format)}
          </button>
        ))}
      </div>

      {/* 更多操作 */}
      <button
        className="book-more"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label="更多操作"
      >
        <Icon name="more" size={14} strokeWidth={2} />
      </button>

      {menuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          className="book-menu"
          onClick={(e) => e.stopPropagation()}
        >
          {others.map((format) => (
            <MenuItem
              key={format}
              icon="layers"
              label={`改用 ${formatLabel(format)} 打开`}
              onClick={() => {
                setMenuOpen(false);
                onSwitchFormat(format);
              }}
            />
          ))}
          <MenuItem
            icon="folder"
            label="在文件夹中显示"
            onClick={() => {
              setMenuOpen(false);
              ipc.app.openPath(meta.variants[0]?.path ?? '');
            }}
          />
          <div className="my-1 h-[1px] bg-line" />
          <MenuItem
            icon="trash"
            label={confirming ? '再点一次确认移除' : '从书架移除'}
            danger
            onClick={async () => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              setMenuOpen(false);
              await useLibrary.getState().remove(meta.id, false);
            }}
          />
        </motion.div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: 'layers' | 'folder' | 'trash';
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors duration-100"
      style={{ color: danger ? 'var(--danger)' : 'var(--text-secondary)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--accent-soft)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      <span className="flex-1">{label}</span>
    </button>
  );
}
