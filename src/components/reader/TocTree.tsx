import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { activeRoot as findActiveRoot, findTocPath, type TocNode, type TocTree as TocTreeData } from '@/lib/toc';

interface TocTreeProps {
  tree: TocTreeData;
  active: TocNode | null;
  onJump: (node: TocNode) => void;
  mode?: 'rail' | 'full';
  /** 目录面板里把每一级的子项都展开（默认只展开当前所在路径） */
  showSubsections?: boolean;
  autoScroll?: boolean;
  /** 目录面板的搜索词；非空时平铺显示命中项 */
  query?: string;
  className?: string;
}

/** 目录有几层就画几层。之前写死「章 → 节 → 小节」三层，第四层起直接丢失。 */
export function TocTree({
  tree,
  active,
  onJump,
  mode = 'full',
  showSubsections = false,
  autoScroll = true,
  query = '',
  className,
}: TocTreeProps) {
  const currentRoot = findActiveRoot(tree, active);
  const activeRootKey = currentRoot?.key ?? null;
  const path = useMemo(() => findTocPath(tree, active?.key), [tree, active?.key]);
  const pathKeys = useMemo(() => new Set(path.map((node) => node.key)), [path]);
  const highlightKey = active?.key ?? null;

  /** 默认展开：当前所在位置的整条路径，让人一打开目录就看见自己在第几层 */
  const defaultOpenNodes = () => {
    const keys = new Set<string>();
    path.forEach((node) => keys.add(node.key));
    if (activeRootKey) keys.add(activeRootKey);
    if (!keys.size) {
      const first = tree.roots.find((node) => node.children.length > 0) ?? tree.roots[0];
      if (first) keys.add(first.key);
    }
    return [...keys];
  };

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultOpenNodes()));

  useEffect(() => {
    if (mode !== 'full') return;
    setExpanded(
      showSubsections
        ? new Set(tree.flat.filter((node) => node.children.length > 0).map((node) => node.key))
        : new Set(defaultOpenNodes()),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubsections, mode, tree.roots, activeRootKey]);

  useEffect(() => {
    if (!activeRootKey) return;
    setExpanded((prev) => {
      if (prev.has(activeRootKey)) return prev;
      const next = new Set(prev);
      next.add(activeRootKey);
      return next;
    });
  }, [activeRootKey]);

  // 当前节点所在的每一级父级都要展开，否则深层高亮会被折叠藏起来
  useEffect(() => {
    if (!path.length) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const node of path) {
        if (!next.has(node.key)) {
          next.add(node.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [active?.key]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const id = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
      el?.scrollIntoView({ block: 'nearest' });
    }, 80);
    return () => window.clearTimeout(id);
  }, [autoScroll, highlightKey, active?.key, showSubsections, expanded]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!normalizedQuery) return [];
    const unique = new Map<string, TocNode>();
    for (const node of tree.flat) {
      if (!node.title.toLowerCase().includes(normalizedQuery)) continue;
      const key = `${node.chapterId ?? ''}|${node.title.trim()}`;
      const prev = unique.get(key);
      if (!prev || (!prev.blockId && node.blockId)) unique.set(key, node);
    }
    return [...unique.values()].slice(0, 60);
  }, [normalizedQuery, tree.flat]);

  const isRead = (node: TocNode) => !!active && node.order < active.order && node.key !== active.key;

  const levelLabel = (node: TocNode) =>
    node.depth === 0 ? '章' : node.depth === 1 ? '节' : node.depth === 2 ? '小节' : `第 ${node.depth + 1} 层`;

  if (tree.roots.length === 0) {
    return <p className="toc-empty">这本书没有目录</p>;
  }

  if (normalizedQuery) {
    return (
      <div
        ref={listRef}
        className={className ? `toc-tree toc-tree-search ${className}` : 'toc-tree toc-tree-search'}
        data-mode={mode}
      >
        <p className="toc-search-note">
          {searchHits.length ? `找到 ${searchHits.length} 个相关章节` : '没有匹配的章节'}
        </p>
        {searchHits.map((node) => {
          const parent = node.parentKey ? tree.byKey.get(node.parentKey) : null;
          return (
            <button
              type="button"
              className="toc-search-hit"
              key={node.key}
              onClick={() => onJump(node)}
              data-active={node.key === active?.key || undefined}
            >
              <span className="toc-search-copy">
                {parent && <span className="toc-search-parent">{parent.title}</span>}
                <span className="toc-search-title">{node.title}</span>
              </span>
              <span className="toc-search-level">{levelLabel(node)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const renderNode = (node: TocNode, depth: number): ReactNode => {
    // 阅读页左侧窄栏只显示当前所在路径，目录面板显示完整树
    const kids = mode === 'rail' ? node.children.filter((child) => pathKeys.has(child.key)) : node.children;
    const hasChildren = kids.length > 0;
    const isOpen = expanded.has(node.key);
    const isActive = highlightKey === node.key;
    const tier = depth === 0 ? 'toc-row-root' : depth === 1 ? 'toc-row-section' : 'toc-row-sub';

    return (
      <div className="toc-node" data-depth={Math.min(depth, 4)} key={node.key}>
        <div className="toc-line" style={{ '--toc-depth': depth } as CSSProperties}>
          {hasChildren ? (
            <button
              type="button"
              className="toc-toggle"
              onClick={() => toggle(node.key)}
              aria-expanded={isOpen}
              aria-label={isOpen ? '折叠' : '展开'}
            >
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={13} strokeWidth={1.6} />
            </button>
          ) : (
            <span className="toc-toggle-spacer" />
          )}
          <button
            type="button"
            className={`toc-row ${tier}`}
            onClick={() => onJump(node)}
            data-active={isActive || undefined}
            data-read={isRead(node) || undefined}
            aria-current={isActive ? 'location' : undefined}
          >
            {depth > 0 && <span className="toc-dot" />}
            <span className={depth >= 2 ? 'toc-subtitle' : 'toc-title'}>{node.title}</span>
          </button>
        </div>
        {isOpen && hasChildren && (
          <div className="toc-children">{kids.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={listRef}
      className={className ? `toc-tree ${className}` : 'toc-tree'}
      data-mode={mode}
      data-subsections={showSubsections || undefined}
    >
      {tree.roots.map((root) => renderNode(root, 0))}
    </div>
  );
}
