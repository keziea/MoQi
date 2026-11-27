import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import logoUrl from '@/assets/logo.png';
import { Icon } from '@/components/ui/Icon';
import { ipc, type AppInfoLite } from '@/lib/ipc';
import { copyText } from '@/lib/workspace';
import { useAbout } from '@/store/useAbout';

const GITHUB = 'https://github.com/keziea/MoQi/releases';
const GITEE = 'https://gitee.com/azs_A/MoQi/releases';

function osLabel(info: AppInfoLite | null): string {
  if (!info) return '—';
  if (info.platform === 'win32') {
    return `Windows 10 / 11 · ${info.arch === 'x64' ? '64 位' : info.arch}`;
  }
  if (info.platform === 'darwin') return `macOS · ${info.arch}`;
  return `${info.platform} · ${info.arch}`;
}

/**
 * 关于墨栖：版本、运行环境、数据目录、发行版入口。
 * 版本号只来自 package.json（主进程 readAppVersion()），这里不写死任何版本。
 */
export function AboutDialog() {
  const open = useAbout((s) => s.open);
  const close = useAbout((s) => s.closeAbout);
  const [info, setInfo] = useState<AppInfoLite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    ipc.app
      .info()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const copyInfo = async () => {
    if (!info) return;
    const text = [
      `墨栖 v${info.version}`,
      `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
      osLabel(info),
      `数据目录：${info.dataRoot || info.dataDir}`,
      GITHUB,
    ].join('\n');
    const ok = await copyText(text);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="about-scrim"
          onMouseDown={close}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="about-card"
            role="dialog"
            aria-modal="true"
            aria-label="关于墨栖"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <button className="about-close" type="button" onClick={close} aria-label="关闭">
              <Icon name="close" size={15} />
            </button>

            <div className="about-brand">
              <img src={logoUrl} alt="" aria-hidden="true" draggable={false} />
              <div>
                <div className="about-name">
                  墨栖
                  <span className="about-version">v{info?.version ?? '…'}</span>
                </div>
                <div className="about-tagline">给文字一个可以久留的地方</div>
              </div>
            </div>

            <div className="about-grid">
              <span>版本</span>
              <b>{info?.version ?? '…'}</b>
              <span>运行环境</span>
              <b>Electron {info?.electron || '—'}</b>
              <span>浏览器内核</span>
              <b>Chromium {info?.chrome || '—'}</b>
              <span>Node</span>
              <b>{info?.node || '—'}</b>
              <span>系统</span>
              <b>{osLabel(info)}</b>
            </div>

            <button
              className="about-path"
              type="button"
              onClick={() => ipc.app.openDataDir()}
              title={`打开数据文件夹：${info?.dataRoot || info?.dataDir || '—'}`}
            >
              <span>
                <i>数据目录</i>
                <b>
                  {info?.dataRoot
                    ? info.dataRoot.split(/[\\/]/).filter(Boolean).pop() || info.dataRoot
                    : '—'}
                </b>
              </span>
              <Icon name="folder" size={15} />
            </button>

            <div className="about-actions">
              <button type="button" onClick={() => ipc.app.openExternal(GITHUB)}>
                <Icon name="arrow-up-right" size={14} />
                GitHub 发行版
              </button>
              <button type="button" onClick={() => ipc.app.openExternal(GITEE)}>
                <Icon name="arrow-up-right" size={14} />
                Gitee 发行版
              </button>
            </div>

            <div className="about-foot">
              <button type="button" onClick={copyInfo}>
                {copied ? '已复制' : '复制版本信息'}
              </button>
              <span>离线软件，不会自动检查更新；新版请到发行版页面下载。</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
