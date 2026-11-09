import { memo } from 'react';
import type { Block, Chapter, HighlightColor } from '@shared/models';
import type { NoteRangeInput } from '@/lib/anchor';
import { Paragraph } from './Paragraph';

interface Props {
  chapter: Chapter;
  markedBlockId?: string | null;
  rangesByBlock: Map<string, NoteRangeInput[]>;
  onBlockClick: (block: Block, chapter: Chapter, rect: DOMRect) => void;
  onNoteClick: (noteId: string) => void;
  onImageClick: (src: string) => void;
  isLast: boolean;
  totalChars: number;
  /** 分页模式：图片必须立即加载，否则列高算不准 */
  paged?: boolean;
}

export const ChapterView = memo(function ChapterView({
  chapter,
  markedBlockId,
  rangesByBlock,
  onBlockClick,
  onNoteClick,
  onImageClick,
  isLast,
  totalChars,
  paged = false,
}: Props) {
  return (
    <section
      id={`ch-${chapter.id}`}
      data-chapter-id={chapter.id}
      data-level={chapter.level}
      className="chapter-block"
      aria-label={chapter.title}
    >
      {/* 章标题本身也是一个可定位锚点：目录点章级条目时点亮的就是它 */}
      <h2
        className="chapter-title"
        id={`${chapter.id}#title`}
        data-block-id={`${chapter.id}#title`}
      >
        {chapter.title}
      </h2>

      {chapter.blocks.map((b) => (
        <Paragraph
          key={b.id}
          block={b}
          marked={markedBlockId === b.id}
          ranges={rangesByBlock.get(b.id) ?? []}
          onClick={(block, rect) => onBlockClick(block, chapter, rect)}
          onNoteClick={onNoteClick}
          onImageClick={onImageClick}
          paged={paged}
        />
      ))}

      {isLast && !paged && (
        <div className="chapter-end">全书完 · 共 {(totalChars / 10000).toFixed(1)} 万字</div>
      )}
    </section>
  );
});

export type { HighlightColor };
