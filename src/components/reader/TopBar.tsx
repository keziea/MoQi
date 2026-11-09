import { useEffect, useState } from 'react';
import type { Book } from '@shared/models';
import { Icon } from '@/components/ui/Icon';
import { Tip } from '@/components/ui/Tooltip';
import type { PanelKind } from '@/store/useReader';

interface Props {
  book: Book;
  panel: PanelKind;
  onBack: () => void;
  onPanel: (p: PanelKind) => void;
  onToggleTheme: () => void;
  isNight: boolean;
  scrolled: boolean;
  autoHide: boolean;
  navOpen: boolean;
  onToggleNav: () => void;
  onCompose: () => void;
}

export function TopBar({
  book,
  panel,
  onBack,
  onPanel,
  onToggleTheme,
  isNight,
  scrolled,
  autoHide,
  navOpen,
  onToggleNav,
  onCompose,
}: Props) {
  const [dim, setDim] = useState(false);

  // 鼠标静止 3.5s → 淡到 0.62（仍可点）；移动 → 恢复。设置里可关闭。
  useEffect(() => {
    if (!autoHide) {
      setDim(false);
      return;
    }
    let timer: number | null = null;
    const wake = () => {
      setDim(false);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setDim(true), 3500);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      if (timer) window.clearTimeout(timer);
    };
  }, [autoHide]);

  return (
    <header
      className="app-bar absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-3 transition-[opacity,border-color] duration-300"
      style={{
        height: 'var(--topbar-h)',
        opacity: dim ? 0.62 : 1,
        borderBottom: `1px solid ${scrolled ? 'var(--line)' : 'transparent'}`,
      }}
    >
      <Tip label="返回首页 (Esc)">
        <button className="icon-btn" onClick={onBack} aria-label="返回首页">
          <Icon name="arrow-left" size={20} />
        </button>
      </Tip>

      <Tip label="导航栏">
        <button
          className="icon-btn"
          data-active={navOpen}
          onClick={onToggleNav}
          aria-label="导航栏"
          aria-expanded={navOpen}
        >
          <Icon name="panel-left" size={19} />
        </button>
      </Tip>

      <div className="min-w-0 flex-1 px-1">
        <div className="truncate text-[13.5px] font-medium leading-tight text-ink">{book.meta.title}</div>
        <div className="mt-0.5 truncate text-[10.5px] leading-tight text-ink-3">{book.meta.author}</div>
      </div>

      <div className="flex items-center gap-0.5">
        <Tip label="目录 (Ctrl+T)">
          <button
            className="icon-btn"
            data-active={panel === 'toc'}
            onClick={() => onPanel(panel === 'toc' ? null : 'toc')}
            aria-label="目录"
          >
            <Icon name="toc" size={19} />
          </button>
        </Tip>
        <Tip label="全部笔记 (Ctrl+N)">
          <button
            className="icon-btn"
            data-active={panel === 'notes'}
            onClick={() => onPanel(panel === 'notes' ? null : 'notes')}
            aria-label="全部笔记"
          >
            <Icon name="note" size={19} />
          </button>
        </Tip>
        <Tip label="给当前这一段写笔记">
          <button className="reader-compose-btn" onClick={onCompose} aria-label="写笔记">
            <Icon name="note-plus" size={16} />
            <span>写笔记</span>
          </button>
        </Tip>
        <Tip label="阅读数据 (Ctrl+D)">
          <button
            className="icon-btn"
            data-active={panel === 'stats'}
            onClick={() => onPanel(panel === 'stats' ? null : 'stats')}
            aria-label="阅读数据"
          >
            <Icon name="chart" size={19} />
          </button>
        </Tip>
        <Tip label="搜索全书 (Ctrl+F)">
          <button
            className="icon-btn"
            data-active={panel === 'search'}
            onClick={() => onPanel(panel === 'search' ? null : 'search')}
            aria-label="搜索全书"
          >
            <Icon name="search" size={18} />
          </button>
        </Tip>
        <div className="mx-1 h-4 w-[1px]" style={{ background: 'var(--line)' }} />
        <Tip label="阅读设置">
          <button
            className="icon-btn"
            data-active={panel === 'settings'}
            onClick={() => onPanel(panel === 'settings' ? null : 'settings')}
            aria-label="阅读设置"
          >
            <Icon name="type" size={19} />
          </button>
        </Tip>
        <Tip label={isNight ? '切换到纸质主题' : '切换到夜间主题'}>
          <button className="icon-btn" onClick={onToggleTheme} aria-label="切换主题">
            <Icon name={isNight ? 'sun' : 'moon'} size={18} />
          </button>
        </Tip>
      </div>
    </header>
  );
}
