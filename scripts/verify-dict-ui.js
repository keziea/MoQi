/**
 * 查字 UI 自检（手动运行，不参与 npm test）。
 *
 *   npm run build
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/verify-dict-ui.js
 *
 * 产物：docs/screenshots/_check-dock.png / _check-dict.png
 * 只读写项目内 .userData，不碰真实书库。
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const USERDATA = path.join(ROOT, '.userData');
const OUT = path.join(ROOT, 'docs', 'screenshots');

app.setPath('userData', USERDATA);
app.setPath('documents', ROOT);
fs.mkdirSync(OUT, { recursive: true });

require('../dist-electron/electron/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win) {
  const size = (process.env.MOQI_CHECK_SIZE || '1320x824').split('x').map(Number);
  win.setSize(size[0], size[1]);
  win.showInactive();
  await wait(800);
  await new Promise((res) => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', res);
    else res();
  });
  await wait(5000);

  // 进书架 → 开书 → 阅读
  await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '书架');
      if (b) b.click();
    })()
  `);
  await wait(1400);
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.book-card-main'); if (el) el.click(); })()`
  );
  await wait(2200);
  for (let i = 0; i < 12; i++) {
    const ok = await win.webContents.executeJavaScript(`
      (() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').replace(/\\s+/g, '') === '阅读');
        if (b) { b.click(); return true; }
        return false;
      })()
    `);
    console.log('点阅读：', i, ok);
    await wait(900);
    const inReader = await win.webContents.executeJavaScript(`!!document.querySelector('.reader-root')`);
    if (inReader) break;
  }
  await wait(3500);

  const state = await win.webContents.executeJavaScript(`
    (() => ({
      blocks: document.querySelectorAll('.reader-page-flow .blk-p').length,
      blkAny: document.querySelectorAll('.blk').length,
      reader: !!document.querySelector('.reader-root'),
      buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 12),
      body: (document.body.innerText || '').slice(0, 160),
    }))()
  `);
  console.log('页面状态：', JSON.stringify(state));

  const target = await win.webContents.executeJavaScript(`
    (() => {
      const cx = Math.round(window.innerWidth / 2);
      const cy = Math.round(window.innerHeight / 2);
      const r0 = document.caretRangeFromPoint(cx, cy);
      if (!r0) return null;
      const node = r0.startContainer;
      if (node.nodeType !== 3) return null;
      const text = node.data || '';
      let i = Math.min(r0.startOffset + 2, text.length - 1);
      while (i > 0 && !/\\p{Script=Han}/u.test(text[i])) i -= 1;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rect = r.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, ch: text[i] };
    })()
  `);
  console.log('点字符：', target);
  if (!target) {
    console.log('没有找到正文段落');
    app.exit(1);
    return;
  }

  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(target.x), y: Math.round(target.y) });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
  await wait(700);

  const dockInfo = await win.webContents.executeJavaScript(`
    (() => {
      const dock = document.querySelector('.para-dock');
      const blk = document.querySelector('.reader-page-flow .blk-p');
      if (!dock || !blk) return null;
      const d = dock.getBoundingClientRect();
      const b = blk.getBoundingClientRect();
      return {
        dock: { l: Math.round(d.left), t: Math.round(d.top), w: Math.round(d.width), h: Math.round(d.height) },
        block: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top) },
        overlap: d.left < b.right && d.right > b.left && d.top < b.bottom && d.bottom > b.top,
        layout: dock.dataset.layout,
        text: dock.textContent,
      };
    })()
  `);
  console.log('操作坞：', JSON.stringify(dockInfo));
  const spanInfo = await win.webContents.executeJavaScript(`
    (() => {
      const b = document.querySelectorAll(".para-dock-btn")[1];
      const s = b ? b.querySelector('span') : null;
      if (!b || !s) return null;
      const cs = getComputedStyle(b);
      const ss = getComputedStyle(s);
      return {
        btn: b.getBoundingClientRect().toJSON(),
        span: s.getBoundingClientRect().toJSON(),
        btnWidth: cs.width, padding: cs.padding, font: ss.fontSize, ws: ss.whiteSpace, display: ss.display,
        text: s.textContent, html: s.innerHTML, scrollW: s.scrollWidth,
        minW: ss.minWidth, maxW: ss.maxWidth, overflow: ss.overflow,
        wordBreak: ss.wordBreak, lineHeight: ss.lineHeight, letterSpacing: ss.letterSpacing,
      };
    })()
  `);
  console.log('按钮尺寸：', JSON.stringify(spanInfo));
  const img1 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, '_check-dock-' + (process.env.MOQI_CHECK_SIZE || '1320x824') + '.png'), img1.toPNG());

  // 点「查字」
  await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('.para-dock-btn')).find((x) => (x.textContent || '').includes('查字'));
      if (b) b.click();
    })()
  `);
  await wait(500);
  const img2 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, '_check-lens.png'), img2.toPNG());

  // 点另一个字
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
  await wait(1200);

  const cardInfo = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.dict-card');
      const ring = document.querySelector('.dict-ring');
      const blk = document.querySelector('.reader-page-flow .blk-p');
      if (!card) return null;
      const c = card.getBoundingClientRect();
      const b = blk.getBoundingClientRect();
      const rg = ring ? ring.getBoundingClientRect() : null;
      return {
        open: true,
        card: { l: Math.round(c.left), t: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) },
        block: { l: Math.round(b.left), r: Math.round(b.right) },
        overlapBlock: c.left < b.right && c.right > b.left,
        ring: rg ? { l: Math.round(rg.left), t: Math.round(rg.top), w: Math.round(rg.width), h: Math.round(rg.height) } : null,
        text: card.textContent.slice(0, 160),
      };
    })()
  `);
  console.log('字词卡：', JSON.stringify(cardInfo));
  const img3 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, `_check-dict-${process.env.MOQI_CHECK_SIZE || '1320x824'}.png`), img3.toPNG());

  // 关卡片，划词查词
  await win.webContents.executeJavaScript(`
    (() => {
      const b = document.querySelector('.dict-card [aria-label="关闭"]');
      if (b) b.click();
    })()
  `);
  await wait(400);

  const selected = await win.webContents.executeJavaScript(`
    (() => {
      const walker = document.createTreeWalker(document.querySelector('.reader-page-flow'), NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const t = node.data || '';
        const i = t.indexOf('进来');
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 2);
          const rect = r.getBoundingClientRect();
          if (rect.left > 0 && rect.left < window.innerWidth) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            document.dispatchEvent(new Event('selectionchange'));
            return { text: t.slice(i, i + 2), x: rect.left, y: rect.top };
          }
        }
        node = walker.nextNode();
      }
      return null;
    })()
  `);
  console.log('划词：', selected);
  await wait(700);

  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').replace(/\\s+/g, '') === '查词');
      if (b) { b.click(); return true; }
      return false;
    })()
  `);
  console.log('点查词：', clicked);
  await wait(1200);

  const wordInfo = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.dict-card');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { text: card.textContent.slice(0, 120), rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }, win: { w: window.innerWidth, h: window.innerHeight } };
    })()
  `);
  console.log('词语卡：', JSON.stringify(wordInfo));
  const img4 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, `_check-word-${process.env.MOQI_CHECK_SIZE || '1320x824'}.png`), img4.toPNG());

  // 收藏 → 生字本
  const savedText = await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('.dict-action')).find((x) => (x.textContent || '').includes('收进生字本'));
      if (b) { b.click(); return true; }
      return false;
    })()
  `);
  await wait(700);
  const savedState = await win.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.dict-action')).map((x) => (x.textContent || '').trim()))()
  `);
  console.log('收藏：', savedText, JSON.stringify(savedState));

  await win.webContents.executeJavaScript(`
    (() => {
      const b = document.querySelector('.dict-action--right');
      if (b) b.click();
    })()
  `);
  await wait(500);
  const vocabText = await win.webContents.executeJavaScript(`
    (() => {
      const list = document.querySelector('.vocab-list');
      return list ? list.textContent.slice(0, 80) : null;
    })()
  `);
  console.log('生字本：', JSON.stringify(vocabText));

  // Esc 关卡片，再 Esc 退出查字态
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(350);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(350);
  const afterEsc = await win.webContents.executeJavaScript(`
    (() => ({
      card: !!document.querySelector('.dict-card'),
      ring: !!document.querySelector('.dict-ring'),
      lens: !!document.querySelector('.blk-lens'),
      dock: !!document.querySelector('.para-dock'),
    }))()
  `);
  console.log('Esc 之后：', JSON.stringify(afterEsc));

  // 翻页应自动收起操作坞
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await wait(700);
  const afterTurn = await win.webContents.executeJavaScript(`
    (() => ({ dock: !!document.querySelector('.para-dock'), card: !!document.querySelector('.dict-card') }))()
  `);
  console.log('翻页之后：', JSON.stringify(afterTurn));

  // 夜间主题下再看一次
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="切换主题"]')?.click()`);
  await wait(700);
  const center = await win.webContents.executeJavaScript(`({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) })`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  await wait(500);
  await win.webContents.executeJavaScript(`
    (() => {
      const b = Array.from(document.querySelectorAll('.para-dock-btn')).find((x) => (x.textContent || '').includes('查字'));
      if (b) b.click();
    })()
  `);
  await wait(400);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  await wait(1000);
  const dark = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.dict-card');
      return { card: !!card, theme: document.documentElement.dataset.theme, text: card ? card.textContent.slice(0, 60) : '' };
    })()
  `);
  console.log('夜间：', JSON.stringify(dark));
  const img5 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, `_check-dark-${process.env.MOQI_CHECK_SIZE || '1320x824'}.png`), img5.toPNG());

  app.exit(0);
}

app.on('browser-window-created', (_e, win) => {
  run(win).catch((err) => {
    console.error('CHECK FAILED:', err);
    app.exit(1);
  });
});

setTimeout(() => {
  console.error('timeout');
  app.exit(2);
}, 90000);
