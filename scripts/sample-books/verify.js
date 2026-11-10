/**
 * 验证示例书籍能否被项目的解析器正确读取。
 * 用法：node scripts/sample-books/verify.js [书库目录]
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '.sample-books'));

const { parseEpub } = require('../../dist-electron/electron/parsers/epub');
const { parseMobi } = require('../../dist-electron/electron/parsers/mobi');
const { parsePdf } = require('../../dist-electron/electron/parsers/pdf');
const { parseTxt } = require('../../dist-electron/electron/parsers/txt');

const ctx = (id) => ({ bookId: id, saveAsset: () => '', warnings: [] });

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.(epub|mobi|pdf|txt)$/i.test(f));
  if (!files.length) {
    console.error('目录里没有书：', DIR);
    process.exit(1);
  }

  let failed = 0;
  for (const f of files) {
    const full = path.join(DIR, f);
    const buf = fs.readFileSync(full);
    const ext = path.extname(f).toLowerCase();
    try {
      const book =
        ext === '.epub'
          ? await parseEpub(buf, ctx(f))
          : ext === '.mobi'
            ? await parseMobi(buf, ctx(f))
            : ext === '.pdf'
              ? await parsePdf(buf, ctx(f))
              : await parseTxt(buf, full);

      const chars = book.chapters.reduce(
        (n, c) => n + c.blocks.reduce((m, b) => m + (b.text ? b.text.length : 0), 0),
        0
      );
      const firstText =
        book.chapters[0]?.blocks.find((b) => b.text)?.text?.slice(0, 46).replace(/\s+/g, ' ') ?? '(空)';

      console.log(`\n✓ ${f}`);
      console.log(`  书名：${book.title}   作者：${book.author}`);
      console.log(`  章节：${book.chapters.length} 章   正文：约 ${chars} 字`);
      console.log(`  首章：${book.chapters[0]?.title ?? '(无)'}`);
      console.log(`  正文：${firstText}…`);
      if (book.cover) console.log(`  封面：有（${book.cover.length} 字节）`);
      if (chars < 200) {
        console.log('  ⚠ 正文字数偏少，可能解析异常');
        failed++;
      }
    } catch (err) {
      failed++;
      console.log(`\n✗ ${f}  解析失败：${err.message}`);
    }
  }

  console.log(failed ? `\n有 ${failed} 本存在问题` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
