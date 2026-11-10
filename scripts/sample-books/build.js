/**
 * 生成示例书籍 —— 用于 README 截图与开发调试。
 *
 * 用法：
 *   node scripts/sample-books/build.js [输出目录]
 *
 * 产出：EPUB / MOBI / PDF / TXT 各一本，全部原创虚构内容，零版权风险。
 *
 * 说明：
 *   - EPUB 用 jszip 手工拼标准结构（mimetype 必须第一个且不压缩）
 *   - MOBI 按 PalmDB + PalmDOC + MOBI + EXTH 规范手工构造二进制，不压缩文本
 *   - PDF 交给 Chrome 无头模式打印，中文字体由 Chrome 子集嵌入
 *   - 封面用 Chrome 截图生成，竖排书名，纯设计不涉任何第三方素材
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');

const BOOKS = require('./content');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '.sample-books'));
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

if (!CHROME) throw new Error('找不到 Chrome / Edge，无法生成封面与 PDF');
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

function chrome(args) {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', ...args], {
    stdio: 'ignore',
    timeout: 60000,
  });
}

/* ---------------------------------------------------------------- 封面 */

function coverHtml(book) {
  const [c1, c2] = book.coverTone;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:600px; height:900px; overflow:hidden; }
  body {
    background: linear-gradient(155deg, ${c1} 0%, ${c2} 100%);
    color:#f6f1e4; font-family:"Songti SC","SimSun","Noto Serif CJK SC",serif;
    padding:52px 46px; display:flex; flex-direction:column; justify-content:space-between;
    position:relative;
  }
  body::after {
    content:""; position:absolute; inset:22px; border:1px solid rgba(246,241,228,.28);
    pointer-events:none;
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start; }
  .note { font-size:19px; letter-spacing:8px; opacity:.72; }
  .mark { font-size:15px; letter-spacing:4px; opacity:.5; }
  .stage { flex:1; display:flex; align-items:center; justify-content:flex-end; padding-right:26px; }
  .title {
    writing-mode:vertical-rl; text-orientation:upright;
    font-size:82px; letter-spacing:14px; line-height:1.05; font-weight:600;
    text-shadow:0 2px 18px rgba(0,0,0,.28);
  }
  .bottom { display:flex; justify-content:space-between; align-items:flex-end; }
  .author { font-size:26px; letter-spacing:6px; opacity:.9; }
  .rule { width:70px; height:1px; background:rgba(246,241,228,.5); margin-bottom:14px; }
</style></head><body>
  <div class="top"><div class="note">${esc(book.coverNote)}</div><div class="mark">墨栖 · 示例</div></div>
  <div class="stage"><div class="title">${esc(book.title)}</div></div>
  <div class="bottom"><div><div class="rule"></div><div class="author">${esc(book.author)}</div></div></div>
</body></html>`;
}

function makeCover(book) {
  const htmlPath = path.join(OUT, `.cover-${book.id}.html`);
  const pngPath = path.join(OUT, `.cover-${book.id}.png`);
  fs.writeFileSync(htmlPath, coverHtml(book), 'utf8');
  chrome([`--screenshot=${pngPath}`, '--window-size=600,900', `--user-data-dir=${path.join(OUT, '.chrome')}`, fileUrl(htmlPath)]);
  fs.unlinkSync(htmlPath);
  return pngPath;
}

/* ---------------------------------------------------------------- EPUB */

function chapterXhtml(book, ch, idx) {
  const body = ch.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n      ');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>
<title>${esc(ch.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
      <h1 id="ch${idx + 1}">${esc(ch.title)}</h1>
      ${body}
</body></html>`;
}

async function makeEpub(book, coverPng) {
  const zip = new JSZip();
  // 规范要求：mimetype 必须是压缩包第一个条目，且不压缩
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );

  zip.file(
    'OEBPS/style.css',
    `body { font-family: serif; line-height: 1.9; margin: 0 6%; }
h1 { font-size: 1.35em; margin: 2.2em 0 1.1em; letter-spacing: .08em; }
p { text-indent: 2em; margin: 0 0 .72em; text-align: justify; }`
  );

  const manifest = [];
  const spine = [];
  const navPoints = [];

  book.chapters.forEach((ch, i) => {
    const name = `ch${i + 1}.xhtml`;
    zip.file(`OEBPS/${name}`, chapterXhtml(book, ch, i));
    manifest.push(`<item id="ch${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
    navPoints.push(
      `<navPoint id="np${i + 1}" playOrder="${i + 2}"><navLabel><text>${esc(ch.title)}</text></navLabel><content src="${name}"/></navPoint>`
    );
  });

  // 封面页（标题用「封面」，解析器会按封面页跳过，不会当成正文）
  zip.file(
    'OEBPS/cover.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>封面</title>
<style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head>
<body><img src="cover.png" alt="${esc(book.title)}"/></body></html>`
  );
  zip.file('OEBPS/cover.png', fs.readFileSync(coverPng));

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:moqi-${book.id}"/></head>
  <docTitle><text>${esc(book.title)}</text></docTitle>
  <navMap>
    <navPoint id="npCover" playOrder="1"><navLabel><text>封面</text></navLabel><content src="cover.xhtml"/></navPoint>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`
  );

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:uuid:moqi-sample-${book.id}</dc:identifier>
    <dc:publisher>墨栖示例书库</dc:publisher>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="cover-image" href="cover.png" media-type="image/png"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    ${spine.join('\n    ')}
  </spine>
</package>`
  );

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(OUT, `${book.title}.epub`), buf);
}

/* ---------------------------------------------------------------- MOBI */

/** 按 PalmDB + PalmDOC + MOBI + EXTH 规范构造 MOBI（文本不压缩） */
function makeMobi(book, coverPng) {
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(book.title)}</title></head><body>` +
    book.chapters
      .map((ch) => `<h1>${esc(ch.title)}</h1>` + ch.paragraphs.map((p) => `<p>${esc(p)}</p>`).join(''))
      .join('<mbp:pagebreak/>') +
    `</body></html>`;
  const textBuf = Buffer.from(html, 'utf8');

  // 文本按 4096 字节切成多个记录，兼容各种阅读器
  const chunks = [];
  for (let i = 0; i < textBuf.length; i += 4096) chunks.push(textBuf.subarray(i, i + 4096));

  /* --- EXTH 元数据 --- */
  const exthRecs = [];
  const addExth = (type, data) => {
    const rec = Buffer.alloc(8 + data.length);
    rec.writeUInt32BE(type, 0);
    rec.writeUInt32BE(8 + data.length, 4);
    data.copy(rec, 8);
    exthRecs.push(rec);
  };
  addExth(100, Buffer.from(book.author, 'utf8')); // 作者
  addExth(503, Buffer.from(book.title, 'utf8')); // 书名
  addExth(101, Buffer.from('墨栖示例书库', 'utf8')); // 出版方
  if (coverPng) {
    const off = Buffer.alloc(4);
    off.writeUInt32BE(0, 0); // 封面是第一个图片记录
    addExth(201, off);
    addExth(203, Buffer.from([0, 0, 0, 0])); // hasCover
  }
  const exthBody = Buffer.concat(exthRecs);
  const exth = Buffer.alloc(12 + exthBody.length);
  exth.write('EXTH', 0, 'ascii');
  exth.writeUInt32BE(12 + exthBody.length, 4);
  exth.writeUInt32BE(exthRecs.length, 8);
  exthBody.copy(exth, 12);

  /* --- 记录 0：PalmDOC 头 + MOBI 头 + EXTH --- */
  const MOBI_HEADER_LEN = 232;
  const rec0 = Buffer.alloc(16 + MOBI_HEADER_LEN + exth.length);
  rec0.writeUInt16BE(1, 0); // 压缩方式：1 = 不压缩
  rec0.writeUInt32BE(textBuf.length, 4); // 文本长度
  rec0.writeUInt16BE(chunks.length, 8); // 文本记录数
  rec0.writeUInt16BE(4096, 10); // 每记录字节数
  rec0.writeUInt16BE(0, 12); // 无加密
  rec0.write('MOBI', 16, 'ascii');
  rec0.writeUInt32BE(MOBI_HEADER_LEN, 20);
  rec0.writeUInt32BE(2, 24); // type = book
  rec0.writeUInt32BE(65001, 28); // UTF-8
  rec0.writeUInt32BE(0x4d6f7169, 32); // 唯一 id（Moqi）
  rec0.writeUInt32BE(6, 36); // 文件版本
  rec0.writeUInt32BE(0x40, 16 + 0x5c); // EXTH flags
  exth.copy(rec0, 16 + MOBI_HEADER_LEN);

  const records = [rec0, ...chunks];
  if (coverPng) records.push(fs.readFileSync(coverPng));

  /* --- PalmDB 外壳 --- */
  const numRecords = records.length;
  const headerSize = 78 + numRecords * 8 + 2;
  const offsets = [];
  let cursor = headerSize;
  for (const r of records) {
    offsets.push(cursor);
    cursor += r.length;
  }

  const out = Buffer.alloc(cursor);
  out.write('Moqi Sample Book', 0, 'ascii');
  out.writeUInt16BE(0, 32); // attributes
  out.writeUInt16BE(0, 34); // version
  out.writeUInt32BE(0, 36); // created
  out.writeUInt32BE(0, 40); // modified
  out.writeUInt32BE(0, 44); // backed up
  out.writeUInt32BE(0, 48); // mod number
  out.writeUInt32BE(0, 52); // app info
  out.writeUInt32BE(0, 56); // sort info
  out.write('BOOK', 60, 'ascii');
  out.write('MOBI', 64, 'ascii');
  out.writeUInt32BE(0, 68); // unique id seed
  out.writeUInt32BE(0, 72); // next record list
  out.writeUInt16BE(numRecords, 76);

  records.forEach((r, i) => {
    const p = 78 + i * 8;
    out.writeUInt32BE(offsets[i], p);
    out.writeUInt8(0, p + 4);
    out.writeUIntBE(i, p + 5, 3);
    r.copy(out, offsets[i]);
  });

  fs.writeFileSync(path.join(OUT, `${book.title}.mobi`), out);
}

/* ---------------------------------------------------------------- PDF */

function makePdf(book) {
  const chapters = book.chapters
    .map(
      (ch) => `<section><h1>${esc(ch.title)}</h1>${ch.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(book.title)}</title>
<meta name="author" content="${esc(book.author)}">
<style>
  @page { size: A5; margin: 18mm 16mm; }
  body { font-family:"Songti SC","SimSun","Noto Serif CJK SC",serif; color:#1f1d1a; line-height:1.95; font-size:11.5pt; }
  .cover { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
           page-break-after:always; text-align:center; }
  .cover h1 { font-size:30pt; letter-spacing:.22em; margin:0 0 .6em; font-weight:600; }
  .cover .a { font-size:13pt; letter-spacing:.16em; color:#5b5347; }
  .cover .n { margin-top:3em; font-size:9pt; letter-spacing:.3em; color:#9a9081; }
  section { page-break-before:always; }
  section:first-of-type { page-break-before:avoid; }
  h1 { font-size:15pt; letter-spacing:.1em; margin:0 0 1.2em; font-weight:600; }
  p { text-indent:2em; margin:0 0 .8em; text-align:justify; }
</style></head><body>
  <div class="cover"><h1>${esc(book.title)}</h1><div class="a">${esc(book.author)}</div>
    <div class="n">墨栖 · 示例书籍</div></div>
  ${chapters}
</body></html>`;

  const htmlPath = path.join(OUT, `.pdf-${book.id}.html`);
  const pdfPath = path.join(OUT, `${book.title}.pdf`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  chrome([`--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer', `--user-data-dir=${path.join(OUT, '.chrome')}`, fileUrl(htmlPath)]);
  fs.unlinkSync(htmlPath);
}

/* ---------------------------------------------------------------- TXT */

function makeTxt(book) {
  const lines = [book.title, `作者：${book.author}`, ''];
  for (const ch of book.chapters) {
    lines.push(ch.title, '');
    for (const p of ch.paragraphs) lines.push('\u3000\u3000' + p, '');
  }
  fs.writeFileSync(path.join(OUT, `${book.title}.txt`), lines.join('\r\n'), 'utf8');
}

/* ---------------------------------------------------------------- 主流程 */

(async () => {
  console.log('输出目录：', OUT);
  for (const book of BOOKS) {
    const cover = makeCover(book);
    if (book.format === 'epub') await makeEpub(book, cover);
    else if (book.format === 'mobi') makeMobi(book, cover);
    else if (book.format === 'pdf') makePdf(book);
    else if (book.format === 'txt') makeTxt(book);
    const f = fs.readdirSync(OUT).find((n) => n.startsWith(book.title));
    console.log(`  ✓ ${book.format.toUpperCase().padEnd(4)}  ${book.title}  ${fs.statSync(path.join(OUT, f)).size} 字节`);
  }

  // 清理中间产物
  for (const n of fs.readdirSync(OUT)) {
    if (n.startsWith('.')) fs.rmSync(path.join(OUT, n), { recursive: true, force: true });
  }
  console.log('完成');
})();
