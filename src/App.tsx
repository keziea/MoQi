import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Workspace } from '@/pages/Workspace';
import type { WorkspaceSection } from '@/pages/Workspace';
import type { OpenTarget } from '@/lib/workspace';
import { Reader } from '@/pages/Reader';
import { ToastHost } from '@/components/ui/Toast';
import { ImportDialog } from '@/components/shelf/ImportDialog';
import { GoalCelebration } from '@/components/workspace/GoalCelebration';
import { formatShortDuration, todayStr } from '@/lib/format';
import { useSettings } from '@/store/useSettings';
import { useLibrary } from '@/store/useLibrary';
import { useImportDialog } from '@/store/useImportDialog';
import { useStats } from '@/store/useStats';
import { ipc } from '@/lib/ipc';

export default function App() {
  const [bookId, setBookId] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>('overview');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    loadSettings();
    useStats.getState().init();
    useLibrary.getState().load();
    const off = ipc.on.scanProgress((p) => {
      useLibrary.setState({ scanProgress: p, scanning: true });
    });
    return off;
  }, [loadSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // 每天达成阅读目标时，放一次星光庆祝；同一天只放一次，
  // 用户手动「重置」后清掉记录，可以重新触发。
  const todaySeconds = useStats((s) => s.todaySeconds);
  const goalMinutes = settings.dailyGoalMinutes ?? 0;
  useEffect(() => {
    if (!goalMinutes || goalMinutes <= 0) return;
    const key = `moqi:goal-fired:${todayStr()}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    if (todaySeconds >= goalMinutes * 60) {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
      setCelebrate(true);
    }
  }, [todaySeconds, goalMinutes]);

  // 全局拖拽导入
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const paths: string[] = [];
      for (const f of files) {
        const p = (f as File & { path?: string }).path;
        if (p) paths.push(p);
      }
      if (paths.length) await useLibrary.getState().importPaths(paths);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Ctrl+O 打开统一的导入弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        useImportDialog.getState().openDialog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openBook = useCallback((id: string, target?: OpenTarget) => {
    setOpenTarget(target ?? null);
    setBookId(id);
  }, []);

  // 深链：#reader 自动打开最近在读的一本（用于预览与调试）
  const books = useLibrary((s) => s.books);
  const autoOpenRef = useRef(false);
  useEffect(() => {
    if (autoOpenRef.current) return;
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (h.has('reader')) {
      if (!books.length) return;
      const recent = books.find((b) => b.lastOpenedAt) ?? books[0];
      autoOpenRef.current = true;
      setBookId(recent.id);
    }
  }, [books]);

  const closeBook = useCallback(() => {
    setBookId(null);
    setOpenTarget(null);
    if (bookId) useLibrary.getState().touch(bookId, { lastOpenedAt: Date.now() });
  }, [bookId]);

  if (!loaded) {
    return <div className="h-full" style={{ background: 'var(--bg)' }} />;
  }

  return (
    <div className="h-full overflow-hidden bg-bg text-ink">
      <AnimatePresence mode="wait" initial={false}>
        {bookId ? (
          <motion.div
            key="reader"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            <Reader bookId={bookId} onBack={closeBook} openTarget={openTarget} />
          </motion.div>
        ) : (
          <motion.div
            key="workspace"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          >
            <Workspace
              section={workspaceSection}
              onSection={setWorkspaceSection}
              onOpen={openBook}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div
              className="absolute inset-4 rounded-[20px] border-2 border-dashed"
              style={{ borderColor: 'var(--accent)', background: 'var(--accent-tint)' }}
            />
            <div className="relative rounded-2xl bg-surface px-7 py-5 text-center shadow-[var(--shadow-md)]">
              <div className="text-[15px] font-medium text-ink">松手即可加入书架</div>
              <div className="mt-1.5 text-[12px] text-ink-3">支持 EPUB · MOBI · PDF · TXT</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <GoalCelebration
        open={celebrate}
        minutes={goalMinutes}
        todayLabel={`今天已读 ${formatShortDuration(todaySeconds)}`}
        onClose={() => setCelebrate(false)}
      />

      <ImportDialog />
      <ToastHost />
    </div>
  );
}
