import { memo, type ReactNode } from 'react';
import type { Block } from '@shared/models';
import { buildSegments, type NoteRangeInput } from '@/lib/anchor';

interface Props {
  block: Block;
  marked: boolean;
  ranges: NoteRangeInput[];
  onClick?: (block: Block, rect: DOMRect) => void;
  onNoteClick?: (noteId: string) => void;
  onImageClick?: (src: string) => void;
  paged?: boolean;
}

const TAGS: Record<string, keyof JSX.IntrinsicElements> = {
  p: 'p',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h4',
  quote: 'p',
  caption: 'p',
  list: 'p',
};

const CLASSES: Record<string, string> = {
  p: 'blk blk-p',
  h1: 'blk blk-h2',
  h2: 'blk blk-h2',
  h3: 'blk blk-h3',
  h4: 'blk blk-h4',
  h5: 'blk blk-h4',
  quote: 'blk blk-quote',
  caption: 'blk blk-caption',
  list: 'blk blk-list',
  code: 'blk blk-quote',
};

export const Paragraph = memo(function Paragraph({
  block,
  marked,
  ranges,
  onClick,
  onNoteClick,
  onImageClick,
  paged = false,
}: Props) {
  if (block.type === 'hr') {
    return <div className="blk-hr" role="separator" />;
  }

  if (block.type === 'img') {
    return (
      <figure
        id={block.id}
        data-block-id={block.id}
        className="blk-img"
        style={{ marginBottom: 'var(--reader-para-gap)' }}
      >
        {block.src ? (
          <img
            src={block.src}
            alt={block.alt ?? ''}
            loading={paged ? 'eager' : 'lazy'}
            draggable={false}
            onClick={() => onImageClick?.(block.src!)}
          />
        ) : (
          <div className="img-placeholder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3.2" y="5" width="17.6" height="14" rx="2" />
              <circle cx="8.6" cy="10" r="1.5" />
              <path d="m4.4 17.6 4.6-4.6 3.6 3.6 3-3 4.2 4.2" />
            </svg>
            <span>插图</span>
          </div>
        )}
      </figure>
    );
  }

  const segments = buildSegments(block.html, block.text, ranges);
  const Tag = (TAGS[block.type] ?? 'p') as keyof JSX.IntrinsicElements;
  const cls = CLASSES[block.type] ?? 'blk blk-p';

  const content: ReactNode[] = segments.map((seg, i) => {
    let node: ReactNode = seg.text;
    if (seg.em) node = <em>{node}</em>;
    if (seg.strong) node = <strong>{node}</strong>;

    for (const n of seg.notes) {
      const inner = node;
      node = (
        <span
          className="hl"
          data-color={n.color}
          data-kind={n.kind ?? 'selection'}
          data-note-id={n.id}
          onClick={(e) => {
            e.stopPropagation();
            onNoteClick?.(n.id);
          }}
        >
          {inner}
        </span>
      );
    }

    if (seg.em || seg.strong || seg.notes.length > 0) {
      return <span key={i}>{node}</span>;
    }
    return <span key={i}>{node}</span>;
  });

  return (
    <Tag
      id={block.id}
      data-block-id={block.id}
      className={`${cls}${marked ? ' marked' : ''}`}
      onClick={(e: React.MouseEvent) => {
        // 高亮内部点击已 stopPropagation
        onClick?.(block, (e.currentTarget as HTMLElement).getBoundingClientRect());
      }}
    >
      {content}
      {marked && (
        <>
          <span className="mark-bar" aria-hidden />
          <svg className="mark-pin" viewBox="0 0 13 17" fill="currentColor" aria-hidden>
            <path d="M1 1.7A1.7 1.7 0 0 1 2.7 0h7.6A1.7 1.7 0 0 1 12 1.7V17L6.5 13.1 1 17V1.7Z" />
          </svg>
        </>
      )}
      {marked && <span className="sr-only">已标记为读到此处</span>}
    </Tag>
  );
});
