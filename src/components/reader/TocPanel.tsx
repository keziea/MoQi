import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { TocTree } from '@/components/reader/TocTree';
import { formatPercent } from '@/lib/format';
import type { TocNode, TocTree as TocTreeData } from '@/lib/toc';

interface Props {
  open: boolean;
  onClose: () => void;
  tree: TocTreeData;
  active: TocNode | null;
  ratio: number;
  onJump: (node: TocNode) => void;
}

export function TocPanel({ open, onClose, tree, active, ratio, onJump }: Props) {
  // 默认展开全部层级：目录一打开就能看见「章 → 节 → 小节 → 更深」的完整结构，
  // 不用先点一次「展开」才发现原来下面还有几阶。
  const [showSubsections, setShowSubsections] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      setShowSubsections(true);
      setQuery('');
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="目录"
      subtitle={`${tree.roots.length} 章 · ${tree.flat.length - tree.roots.length} 节 · 已读 ${formatPercent(ratio)}`}
      action={
        <button
          type="button"
          className="chip"
          data-active={showSubsections || undefined}
          onClick={() => setShowSubsections((v) => !v)}
          title={showSubsections ? '只展开当前所在路径' : '展开全部层级'}
        >
          <Icon name="layers" size={12} />
          {showSubsections ? '收起层级' : `展开全部 ${tree.flat.length} 项`}
        </button>
      }
      width={360}
      footer={
        <Button
          block
          variant="secondary"
          size="md"
          disabled={!active}
          onClick={() => active && onJump(active)}
        >
          回到正在读
        </Button>
      }
    >
      {tree.roots.length === 0 ? (
        <p className="toc-empty">这本书没有目录</p>
      ) : (
        <>
          <div className="toc-now">
            <div className="toc-now-head">
              <span>正在读</span>
              <span>{formatPercent(ratio)}</span>
            </div>
            <div className="toc-now-title" title={active?.title}>
              {active?.title ?? '还没开始读'}
            </div>
            <div className="toc-now-track">
              <div style={{ width: `${Math.max(1, ratio * 100)}%` }} />
            </div>
          </div>

          <label className="toc-panel-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索目录"
              aria-label="搜索目录"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空目录搜索">
                <Icon name="close" size={12} />
              </button>
            )}
          </label>

          <TocTree
            tree={tree}
            active={active}
            onJump={onJump}
            mode="full"
            showSubsections={showSubsections}
            autoScroll={open}
            query={query}
          />
        </>
      )}
    </Sheet>
  );
}
