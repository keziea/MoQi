import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { ipc } from '@/lib/ipc';
import { useLibrary } from '@/store/useLibrary';
import { useImportDialog } from '@/store/useImportDialog';

type Result =
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'duplicate'; scanned: number }
  | { kind: 'mixed'; added: number; titles: string[] }
  | { kind: 'done'; added: number };

const ease = [0.32, 0.72, 0, 1] as const;

export function ImportDialog() {
  const open = useImportDialog((s) => s.open);
  const close = useImportDialog((s) => s.close);
  const [busy, setBusy] = useState<'file' | 'folder' | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => {
    setResult(null);
    setBusy(null);
  };

  const finish = () => {
    // 导入成功就把人带回书架，别让他还得自己切一下才看得见新书
    if (result && 'added' in result && result.added > 0) {
      window.dispatchEvent(new Event('moqi:open-library'));
    }
    close();
    reset();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (result) finish();
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result]);

  const run = async (mode: 'file' | 'folder') => {
    if (busy) return;
    setBusy(mode);
    try {
      const paths = mode === 'file' ? await ipc.library.pickFiles() : await ipc.library.pickFolder();
      if (!paths?.length) {
        setBusy(null);
        return;
      }

      const res = await ipc.library.import(paths);
      useLibrary.setState({ books: res.books });

      if (res.scanned === 0) {
        setResult({ kind: 'empty' });
      } else if (res.added === 0) {
        setResult({ kind: 'duplicate', scanned: res.scanned });
      } else if (res.titles.length > 1) {
        setResult({ kind: 'mixed', added: res.added, titles: res.titles });
      } else {
        setResult({ kind: 'done', added: res.added });
      }
    } catch {
      setResult({ kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[92] flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(20,16,12,0.26)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => {
              if (busy) return; // 正在读文件时别让误点把弹窗关掉
              if (result) finish();
              else close();
            }}
          />

          <motion.div
            className="import-dialog"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease }}
          >
            {!result ? (
              <>
                <header className="import-dialog-head">
                  <h2>导入书籍</h2>
                  <p>从文件里挑，或者把整个文件夹交给墨栖。</p>
                </header>

                <div className="import-choices">
                  <button
                    type="button"
                    className="import-choice"
                    onClick={() => void run('file')}
                    disabled={!!busy}
                  >
                    <span className="import-choice-icon">
                      <Icon name="book" size={22} />
                    </span>
                    <strong>选择文件</strong>
                    <span className="import-choice-sub">EPUB / MOBI / AZW3 / PDF / TXT，可以一次选多本</span>
                    {busy === 'file' && <span className="import-choice-busy">正在读取…</span>}
                  </button>

                  <button
                    type="button"
                    className="import-choice"
                    onClick={() => void run('folder')}
                    disabled={!!busy}
                  >
                    <span className="import-choice-icon">
                      <Icon name="folder" size={22} />
                    </span>
                    <strong>选择文件夹</strong>
                    <span className="import-choice-sub">文件夹里的书会一起进来，同一本的多格式自动合并</span>
                    {busy === 'folder' && <span className="import-choice-busy">正在读取…</span>}
                  </button>
                </div>

                <div className="import-dialog-foot">
                  <span>书不会离开你的电脑，也不会被上传</span>
                  <Button variant="ghost" size="sm" onClick={close}>
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <div className="import-result">
                <span className="import-result-icon" data-kind={result.kind}>
                  <Icon
                    name={
                      result.kind === 'empty'
                        ? 'folder'
                        : result.kind === 'duplicate'
                          ? 'book'
                          : result.kind === 'error'
                            ? 'close'
                            : 'check'
                    }
                    size={22}
                  />
                </span>

                {result.kind === 'error' && (
                  <>
                    <h2>这次没读成功</h2>
                    <p>
                      文件可能正在被别的程序占用，或者这个位置没有读取权限。关掉可能占用它的软件，或者把书复制到「文档」里再试一次。
                    </p>
                  </>
                )}

                {result.kind === 'empty' && (
                  <>
                    <h2>这里是空的</h2>
                    <p>
                      没有找到 EPUB、MOBI、AZW3、PDF 或 TXT 文件。可能是选错了位置，也可能书放在更里层的文件夹里。
                      再检查一下路径，或者直接选到放书的那个文件夹。
                    </p>
                  </>
                )}

                {result.kind === 'duplicate' && (
                  <>
                    <h2>这些书已经在架子上了</h2>
                    <p>扫到 {result.scanned} 个文件，书架上一本都没少。想换版本的话，去书籍详情里切换格式就行。</p>
                  </>
                )}

                {result.kind === 'done' && (
                  <>
                    <h2>已导入 {result.added} 本书</h2>
                    <p>它们已经在书架上，点开就能读。</p>
                  </>
                )}

                {result.kind === 'mixed' && (
                  <>
                    <h2>导入了 {result.added} 本，但这里不止一本书</h2>
                    <p>
                      这个位置里有 {result.titles.length} 个不同的书名。如果它们本该是同一本书的几种格式，
                      多半是文件名不一致（比如多了「校对版」「最终版」），墨栖就没法把它们合成一本。
                      不影响阅读，只是会在书架上显示成几本。
                    </p>
                    <ul className="import-titles">
                      {result.titles.slice(0, 6).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                      {result.titles.length > 6 && <li>…还有 {result.titles.length - 6} 个</li>}
                    </ul>
                  </>
                )}

                <div className="import-result-foot">
                  <Button variant="primary" size="sm" onClick={finish}>
                    知道了
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
