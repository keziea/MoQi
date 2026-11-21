const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ROOT_CONTAINER = path.join(process.env.TEMP, 'moqi-ui-test');
const CONTAINER = path.join(ROOT_CONTAINER, 'MoQiReader');
const PROGRAM = path.join(CONTAINER, 'Program');
const DATA = path.join(CONTAINER, 'Data');
const SOURCE = path.join(DATA, 'books', 'ui-book', 'source', 'ui-book.txt');
const LIBRARY = path.join(DATA, 'library.json');
// 避免和用户其它调试端口冲突
const PORT = 9400 + (process.pid % 500);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    let isDir = e.isDirectory();
    let real = s;
    if (e.isSymbolicLink()) {
      real = fs.realpathSync(s);
      isDir = fs.statSync(real).isDirectory();
    }
    if (isDir) copyTree(real, d);
    else fs.copyFileSync(real, d);
  }
}

function seed() {
  fs.rmSync(ROOT_CONTAINER, { recursive: true, force: true });
  copyTree(path.join(ROOT, 'out-app', 'win-unpacked'), PROGRAM);
  for (const d of ['books/ui-book/source', 'user', 'backups', 'exports', 'logs']) {
    fs.mkdirSync(path.join(DATA, d), { recursive: true });
  }
  fs.writeFileSync(path.join(DATA, '.moqi-data'), JSON.stringify({ app: 'moqi-reader', kind: 'data-dir', layout: 'flat', version: 3 }, null, 2));
  fs.writeFileSync(SOURCE, '这是一本用于测试删除最后一本书的书。\n\n第二章 测试\n\n内容。\n', 'utf8');
  const meta = {
    id: 'ui-book',
    title: '最后一本书',
    author: '测试作者',
    format: 'txt',
    variants: [{ format: 'txt', path: SOURCE, sizeBytes: fs.statSync(SOURCE).size, quality: 60 }],
    totalChars: 30,
    chapterCount: 2,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
  fs.writeFileSync(LIBRARY, JSON.stringify([meta], null, 2), 'utf8');
  fs.writeFileSync(path.join(CONTAINER, '启动墨栖.cmd'), '@echo off\r\nfor %%f in ("%~dp0Program\\*.exe") do start "" "%%~f"\r\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(300);
  }
  throw last || new Error('timeout');
}

async function main() {
  seed();
  const exe = fs
    .readdirSync(PROGRAM)
    .filter((n) => n.endsWith('.exe') && n.startsWith('墨栖'))
    .map((n) => path.join(PROGRAM, n))[0];
  if (!exe) throw new Error('exe not found');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
    cwd: PROGRAM,
    stdio: 'ignore',
    env,
    windowsHide: false,
  });

  try {
    const target = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      return list.find((t) => t.type === 'page' && t.url && t.url.includes('index.html'));
    }, 30000);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (r.result?.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.text || 'evaluate failed');
      }
      return r.result?.result?.value;
    };

    const body = () => evaluate('document.body.innerText');
    await waitFor(async () => (await body())?.includes('书架'), 20000);
    console.log('✓ 应用已启动');

    // 切到书架：左栏按钮的 textContent 同时包含 label 和 hint，不能用全等
    const navClicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('书架') && (x.className || '').includes('nav'));
      if (!b) {
        const fallback = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('书架'));
        if (!fallback) return 'none';
        fallback.click();
        return 'fallback:' + fallback.className;
      }
      b.click();
      return 'ok:' + b.className;
    })()`);
    console.log('  nav click =', navClicked);
    await waitFor(async () => (await body())?.includes('选择想读的版本'), 12000);
    console.log('✓ 已进入书架页面');
    await waitFor(async () => (await body())?.includes('最后一本书'), 12000);
    console.log('✓ 书架显示《最后一本书》');

    const buttons = await evaluate(`[...document.querySelectorAll('button')].map(b => ({ t: (b.textContent||'').trim().slice(0,24), a: b.getAttribute('aria-label'), c: (b.className||'').toString().slice(0,40) })).filter(x => x.a || x.c.includes('book'))`);
    console.log('  buttons =', JSON.stringify(buttons).slice(0, 2000));

    // 打开更多操作
    const opened = await evaluate(`(() => {
      const b = document.querySelector('button[aria-label="更多操作"]') || document.querySelector('button.book-more');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!opened) throw new Error('更多操作按钮未找到');
    await waitFor(async () => (await body())?.includes('从书架移除'), 5000);

    // 两次点击确认移除
    const clickRemove = () =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('从书架移除') || x.textContent.includes('再点一次确认移除'));
        if (!b) return false;
        b.click();
        return true;
      })()`);
    await clickRemove();
    await sleep(200);
    await clickRemove();

    const finalText = await waitFor(async () => {
      const t = await body();
      return t && t.includes('书架还是空的') ? t : null;
    }, 10000);

    console.log('✓ 删除后回到空书架');
    console.log('  contains 导入书籍 =', finalText.includes('导入书籍'));
    console.log('  contains 正在整理 =', finalText.includes('正在整理'));
    console.log('  contains 最后一本书 =', finalText.includes('最后一本书'));
    if (finalText.includes('正在整理')) throw new Error('仍然卡在正在整理');
    if (!finalText.includes('导入书籍')) throw new Error('空书架没有导入按钮');

    // 再导入按钮是否可点（只检查存在和 disabled）
    const importState = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '导入书籍');
      return b ? { found: true, disabled: b.disabled } : { found: false };
    })()`);
    console.log('  导入按钮 =', JSON.stringify(importState));
    if (!importState.found || importState.disabled) throw new Error('导入按钮不可用');

    console.log('\nUI 测试通过');
    ws.close();
  } finally {
    if (child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  }
}

main().catch((e) => {
  console.error('UI 测试失败：', e.message);
  process.exit(1);
});
