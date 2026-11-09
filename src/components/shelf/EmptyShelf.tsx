import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

interface Props {
  onImport: () => void;
  scanning: boolean;
  progress: { done: number; total: number; title: string } | null;
}

export function EmptyShelf({ onImport, scanning, progress }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-220px)] flex-col items-center justify-center text-center">
      <div
        className="mb-7 flex h-[72px] w-[72px] items-center justify-center rounded-[20px]"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        <Icon name="book" size={32} strokeWidth={1.4} />
      </div>

      <h2
        className="text-[20px] font-semibold tracking-wide text-ink"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {scanning ? '正在整理你的书库' : '书架还是空的'}
      </h2>

      <p className="mt-3 max-w-[320px] text-[13px] leading-relaxed text-ink-3">
        {scanning
          ? progress
            ? `正在读取《${progress.title}》 ${progress.done}/${progress.total}`
            : '稍等片刻…'
          : '把书拖到这个窗口，或者点下面的按钮挑书。支持 EPUB、MOBI、AZW3、PDF、TXT。'}
      </p>

      {!scanning && (
        <Button
          variant="primary"
          size="lg"
          className="mt-8"
          icon={<Icon name="plus" size={17} />}
          onClick={onImport}
        >
          导入书籍
        </Button>
      )}

      {!scanning && (
        <p className="mt-5 text-[11.5px] text-ink-3 opacity-70">
          书不会离开你的电脑 · 也不会被上传
        </p>
      )}
    </div>
  );
}
