import type { BookMeta } from '@shared/models';
import { coverUrl, formatChars, formatLabel, formatPercent } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';

interface Props {
  meta: BookMeta;
  ratio: number;
  copies?: number;
  onOpen: () => void;
}

export function ContinueCard({ meta, ratio, copies = 1, onOpen }: Props) {
  const cover = coverUrl(meta);
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);

  return (
    <button
      onClick={onOpen}
      className="shelf-continue group"
      aria-label={`继续阅读《${meta.title}》`}
    >
      <div className="shelf-continue-cover">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="shelf-continue-cover-fallback">{meta.title}</div>
        )}
      </div>

      <div className="shelf-continue-copy">
        <span className="shelf-continue-kicker">继续阅读</span>
        <h3>{meta.title}</h3>
        <p>{meta.author || '佚名'}</p>
        <div className="shelf-continue-meta">
          <span className="shelf-continue-format">{formatLabel(meta.format)}</span>
          {copies > 1 && <span>{copies} 个版本</span>}
          <span>共 {meta.chapterCount} 章</span>
          <span>{formatChars(meta.totalChars)}</span>
        </div>
      </div>

      <div className="shelf-continue-progress">
        <div className="shelf-continue-number">
          {percent}
          <span>%</span>
        </div>
        <div className="shelf-continue-cta">
          <span>阅读</span>
          <Icon name="arrow-right" size={13} />
        </div>
      </div>
      <i
        className="shelf-continue-rail"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        aria-hidden="true"
      />
    </button>
  );
}

export { formatPercent };
