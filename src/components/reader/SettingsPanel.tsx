import type { FontKind, Settings, ThemeName } from '@shared/models';
import { Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { ipc } from '@/lib/ipc';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const THEMES: { key: ThemeName; label: string; bg: string; fg: string }[] = [
  { key: 'paper', label: '纸白', bg: '#FAF7F0', fg: '#2B2620' },
  { key: 'sepia', label: '米黄', bg: '#F6EFDF', fg: '#332A1D' },
  { key: 'green', label: '护眼', bg: '#EDF1E9', fg: '#293026' },
  { key: 'night', label: '夜间', bg: '#1B1917', fg: '#CFC7BA' },
];

const FONTS: { key: FontKind; label: string; family: string }[] = [
  { key: 'serif', label: '宋体', family: 'var(--font-serif)' },
  { key: 'sans', label: '黑体', family: 'var(--font-sans)' },
  { key: 'kai', label: '楷体', family: 'var(--font-kai)' },
];

const LEADINGS = [
  { v: 1.6, label: '紧' },
  { v: 1.75, label: '适中' },
  { v: 1.95, label: '舒适' },
  { v: 2.15, label: '疏' },
];

const MEASURES = [
  { v: 28, label: '窄' },
  { v: 32, label: '偏窄' },
  { v: 34, label: '标准' },
  { v: 38, label: '宽' },
  { v: 44, label: '超宽' },
];

const SHORTCUTS: [string, string][] = [
  ['Ctrl + T', '目录'],
  ['Ctrl + N', '笔记'],
  ['Ctrl + D', '阅读数据'],
  ['Ctrl + F', '搜索全书'],
  ['Ctrl + O', '导入书籍'],
  ['Ctrl + B', '标记 / 取消标记'],
  ['Ctrl + = / -', '放大 / 缩小字号'],
  ['Ctrl + 0', '字号重置'],
  ['← / →', '上一页 / 下一页（翻页）'],
  ['PageUp / PageDown', '上一页 / 下一页（翻页）'],
  ['Home / End', '第一页 / 最后一页（翻页）'],
  ['Space', '下一页 / 向下翻一屏'],
  ['Esc', '返回 / 关闭面板'],
  ['F11', '全屏'],
];

export function SettingsPanel({ open, onClose, settings, update }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="阅读设置" subtitle="改动立即生效">
      {/* 字号 */}
      <Group label="字号">
        <div className="flex items-center gap-3">
          <IconBtn
            label="减小字号"
            onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
            icon="minus"
          />
          <div className="flex-1 text-center">
            <span className="tabular-nums text-[17px] font-semibold text-ink">{settings.fontSize}</span>
            <span className="ml-1 text-[11px] text-ink-3">px</span>
          </div>
          <IconBtn
            label="增大字号"
            onClick={() => update({ fontSize: Math.min(32, settings.fontSize + 1) })}
            icon="plus"
          />
        </div>
        <input
          type="range"
          min={14}
          max={32}
          step={1}
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
          className="mt-3 w-full"
          style={{
            background: `linear-gradient(to right, var(--accent) ${
              ((settings.fontSize - 14) / 18) * 100
            }%, var(--surface-sunken) ${((settings.fontSize - 14) / 18) * 100}%)`,
          }}
          aria-label="字号"
        />
        <div
          className="mt-3 mb-1 truncate text-center text-[13px] leading-relaxed text-ink-2"
          style={{ fontFamily: `var(--font-${settings.fontFamily})` }}
        >
          读书不觉已春深，一寸光阴一寸金
        </div>
      </Group>

      {/* 字体 */}
      <Group label="字体">
        <Segmented
          options={FONTS.map((f) => ({ value: f.key, label: f.label, style: { fontFamily: f.family } }))}
          value={settings.fontFamily}
          onChange={(v) => update({ fontFamily: v as FontKind })}
        />
      </Group>

      {/* 行距 */}
      <Group label="行距">
        <Segmented
          options={LEADINGS.map((l) => ({ value: l.v, label: l.label }))}
          value={settings.lineHeight}
          onChange={(v) => update({ lineHeight: Number(v) })}
        />
      </Group>

      {/* 版心 */}
      <Group label="版心宽度">
        <Segmented
          options={MEASURES.map((m) => ({ value: m.v, label: m.label }))}
          value={settings.measure}
          onChange={(v) => update({ measure: Number(v) })}
        />
      </Group>

      {/* 翻页方式 */}
      <Group label="翻页方式">
        <Segmented
          options={[
            { value: 'paged', label: '翻页' },
            { value: 'scroll', label: '滚动' },
          ]}
          value={settings.pageMode}
          onChange={(v) => update({ pageMode: v as 'paged' | 'scroll' })}
        />
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
          翻页：一页一页读，底部显示「第几页 / 共几页」；滚动：连续往下读。
        </p>
      </Group>

      {/* 主题 */}
      <Group label="主题">
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t.key}
              onClick={() => update({ theme: t.key })}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-[10px] py-2 transition-all duration-150"
              style={{
                border: `1.5px solid ${settings.theme === t.key ? 'var(--accent)' : 'var(--line)'}`,
                background: settings.theme === t.key ? 'var(--accent-tint)' : 'transparent',
              }}
              aria-label={t.label}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px]"
                style={{ background: t.bg, color: t.fg, border: '1px solid rgba(0,0,0,0.08)' }}
              >
                文
              </span>
              <span className="text-[10.5px] text-ink-3">{t.label}</span>
            </button>
          ))}
        </div>
      </Group>

      {/* 开关 */}
      <Group label="阅读行为">
        <div className="space-y-0.5">
          <SwitchRow
            label="点击段落设为「读到此处」"
            desc="单击段落即可标记，下次从这里接着读"
            checked={settings.clickToMark}
            onChange={(v) => update({ clickToMark: v })}
          />
          <SwitchRow
            label="显示阅读计时"
            desc="底栏显示今天读了多久"
            checked={settings.showTimer}
            onChange={(v) => update({ showTimer: v })}
          />
          <SwitchRow
            label="顶栏自动淡出"
            desc="鼠标静止 3.5 秒后顶栏变淡，移动即恢复"
            checked={settings.autoHideBar}
            onChange={(v) => update({ autoHideBar: v })}
          />
          <SwitchRow
            label="首行缩进"
            desc="段落首行空两格，更像纸书"
            checked={settings.indent}
            onChange={(v) => update({ indent: v })}
          />
        </div>
      </Group>

      {/* 快捷键 */}
      <Group label="快捷键">
        <div className="rounded-[10px] border border-line px-3 py-1">
          {SHORTCUTS.map(([k, v], i) => (
            <div
              key={k}
              className="flex items-center justify-between py-[7px] text-[11.5px]"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
            >
              <span className="text-ink-2">{v}</span>
              <kbd
                className="rounded-[5px] px-1.5 py-[2px] text-[10px] tracking-wide text-ink-3"
                style={{ background: 'var(--surface-sunken)' }}
              >
                {k}
              </kbd>
            </div>
          ))}
        </div>
      </Group>

      {/* 数据 */}
      <Group label="数据">
        <button
          className="flex w-full items-center justify-between rounded-[10px] border border-line px-3 py-2.5 text-[12px] text-ink-2 transition-colors hover:bg-surface"
          onClick={() => ipc.app.openDataDir()}
        >
          <span>打开数据文件夹</span>
          <Icon name="folder" size={15} />
        </button>
        <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-3">
          墨栖 v0.1.0 · 书籍、笔记、进度全部保存在本机
        </p>
      </Group>
    </Sheet>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{label}</h3>
      {children}
    </section>
  );
}

function IconBtn({ label, onClick, icon }: { label: string; onClick: () => void; icon: 'plus' | 'minus' }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 transition-colors hover:border-line-strong hover:text-accent"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; style?: React.CSSProperties }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-[10px] p-1" style={{ background: 'var(--surface-sunken)' }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className="flex-1 rounded-[7px] py-[6px] text-[12px] transition-all duration-150"
            style={{
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: active ? 500 : 400,
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              ...o.style,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SwitchRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 py-2 text-left"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{label}</span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">{desc}</span>
      </span>
      <span
        className="relative block h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? 'var(--accent)' : 'var(--line-strong)' }}
      >
        <span
          className="absolute top-[2px] block h-[16px] w-[16px] rounded-full bg-white transition-[left] duration-200"
          style={{ left: checked ? 16 : 2, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
        />
      </span>
    </button>
  );
}
