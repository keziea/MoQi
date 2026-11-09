import { Icon } from '@/components/ui/Icon';
import { useStats } from '@/store/useStats';
import { toast } from '@/lib/toast';

interface TimerControlsProps {
  showReset?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * 计时控制：暂停/继续 + 重置。
 * 重置点一下就生效，不做二次确认 —— 计时本来就是随时可以重来的东西。
 * 时钟本身由调用方渲染，这样底栏、侧栏、数据面板可以各自决定字号。
 */
export function TimerControls({ showReset = true, compact = false, className }: TimerControlsProps) {
  const running = useStats((s) => s.running);
  const toggle = useStats((s) => s.toggle);
  const reset = useStats((s) => s.reset);

  const onReset = () => {
    void reset();
    toast('已重置这本书今天的阅读时间');
  };

  return (
    <div className={className ? `timer-controls ${className}` : 'timer-controls'}>
      <button
        type="button"
        className="timer-btn timer-btn-main"
        onClick={toggle}
        title={running ? '暂停计时' : '继续计时'}
        aria-label={running ? '暂停计时' : '继续计时'}
      >
        <Icon name={running ? 'pause' : 'play'} size={compact ? 14 : 16} strokeWidth={1.7} />
        {!compact && <span>{running ? '暂停' : '继续'}</span>}
      </button>

      {showReset && (
        <button
          type="button"
          className="timer-btn timer-btn-ghost"
          onClick={onReset}
          title="重置这本书今天的阅读时间"
          aria-label="重置这本书今天的阅读时间"
        >
          <Icon name="rotate-ccw" size={compact ? 13 : 15} strokeWidth={1.7} />
          {!compact && <span>重置</span>}
        </button>
      )}
    </div>
  );
}
