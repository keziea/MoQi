import { DEFAULT_NOTE_CATEGORIES } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import { COLOR_META } from '@/lib/colors';
import { useSettings } from '@/store/useSettings';
import type { WorkspaceNote } from '@/lib/workspace';

interface Props {
  note: WorkspaceNote;
  onBack: () => void;
  /** 回到这本书里这条笔记出现的位置 */
  onLocate: () => void;
}

/** 单条笔记的独立页面：只讲这一条，不再挤在列表里 */
export function NoteDetail({ note, onBack, onLocate }: Props) {
  const noteCats = useSettings((s) => s.settings.noteCategories ?? DEFAULT_NOTE_CATEGORIES);
  const color = noteCats.find((c) => c.name === note.category)?.color ?? note.color;

  return (
    <div className="ws-view note-detail">
      <header className="note-detail-head">
        <button type="button" className="note-detail-back" onClick={onBack}>
          <Icon name="chevron-right" size={14} />
          返回笔记列表
        </button>
        <div className="note-detail-crumb">
          <span>{note.bookTitle || '未知书名'}</span>
          <em>·</em>
          <span>{note.chapterTitle || '未命名章节'}</span>
          <em>·</em>
          <span>{formatDate(note.createdAt)}</span>
        </div>
      </header>

      <article className="note-detail-paper">
        <span className="note-detail-mark" aria-hidden="true">“</span>
        <blockquote className="note-detail-quote">{note.text}</blockquote>

        {note.title && <h1 className="note-detail-title">{note.title}</h1>}

        <div className="note-detail-comment">
          {note.comment ? (
            note.comment.split('\n').map((line, i) => <p key={i}>{line || '\u00a0'}</p>)
          ) : (
            <p className="note-detail-blank">这条只做了标记，没有写下文字。</p>
          )}
        </div>

        <footer className="note-detail-foot">
          {note.category && (
            <span className="note-detail-tag">
              <i style={{ background: COLOR_META[color].solid }} />
              {note.category}
            </span>
          )}
          <button type="button" className="ws-btn ws-btn-primary" onClick={onLocate}>
            <Icon name="book" size={15} />
            回到原文位置
          </button>
        </footer>
      </article>
    </div>
  );
}
