import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';

interface Props {
  open: boolean;
  count: number;
  busy: 'single' | 'folder' | null;
  onClose: () => void;
  onExport: (mode: 'single' | 'folder') => void;
}

const ease = [0.32, 0.72, 0, 1] as const;

/** 导出笔记：一个 Markdown，或每条一个文件 */
export function ExportNotesDialog({ open, count, busy, onClose, onExport }: Props) {
  return createPortal(
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
            onClick={() => (busy ? undefined : onClose())}
          />

          <motion.div
            className="import-dialog"
            initial={{ opacity: 0, y: 14, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.24, ease }}
            role="dialog"
            aria-label="导出全部笔记"
          >
            <header className="import-dialog-head">
              <h2>导出全部笔记</h2>
              <p>共 {count} 条。选一种方式带走。</p>
            </header>

            <div className="import-choices">
              <button
                type="button"
                className="import-choice"
                disabled={!!busy}
                onClick={() => onExport('single')}
              >
                <span className="import-choice-icon">
                  <Icon name="export" size={22} />
                </span>
                <strong>一个 Markdown 文件</strong>
                <span className="import-choice-sub">按书和章节分组，适合放进笔记软件</span>
                {busy === 'single' && <span className="import-choice-busy">正在导出…</span>}
              </button>

              <button
                type="button"
                className="import-choice"
                disabled={!!busy}
                onClick={() => onExport('folder')}
              >
                <span className="import-choice-icon">
                  <Icon name="folder" size={22} />
                </span>
                <strong>每条笔记一个文件</strong>
                <span className="import-choice-sub">选一个文件夹，每条存成单独的 .md</span>
                {busy === 'folder' && <span className="import-choice-busy">正在导出…</span>}
              </button>
            </div>

            <div className="import-dialog-foot">
              <span>导出后可以用任意 Markdown 软件打开</span>
              <button type="button" className="ws-text-btn" onClick={onClose} disabled={!!busy}>
                取消
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
