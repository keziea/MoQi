import type { BlockType } from '../../shared/models';

export interface RawHtmlBlock {
  type: BlockType;
  text: string;
  html?: string;
  src?: string;
  alt?: string;
  level?: number;
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'figure', 'figcaption', 'pre', 'table', 'tr', 'ul', 'ol', 'li', 'hr', 'dd', 'dt',
]);

const HEADING: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 };

const INLINE_KEEP = new Set(['em', 'strong', 'b', 'i', 'u', 's', 'br', 'a', 'sup', 'sub', 'ruby', 'rt', 'span']);

const VOID_TAGS = new Set(['br', 'img', 'hr', 'link', 'meta', 'input', 'col', 'area', 'base', 'source', 'track', 'wbr']);

const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷',
  laquo: '«', raquo: '»', bull: '•',
};

export function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const v = ENTITY_MAP[body] ?? ENTITY_MAP[body.toLowerCase()];
    return v ?? m;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 去掉所有标签，得到纯文本 */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ''));
}

/** 取属性值 */
function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
}

/** 规范化空白：中文软换行合并，多余空格压缩 */
function normalizeText(s: string): string {
  return s
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/** 生成精简内联 HTML（保留 em/strong/br/a/sup/sub/ruby） */
function sanitizeInline(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      out.push(escapeHtml(decodeEntities(s.slice(i))));
      break;
    }
    if (lt > i) out.push(escapeHtml(decodeEntities(s.slice(i, lt))));
    const gt = s.indexOf('>', lt);
    if (gt < 0) {
      out.push(escapeHtml(s.slice(lt)));
      break;
    }
    const raw = s.slice(lt, gt + 1);
    const m = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    const name = m ? m[1].toLowerCase() : '';
    const closing = raw.startsWith('</');

    if (name === 'br') {
      out.push('<br/>');
    } else if (name === 'img') {
      // 内联图片：转为占位符，由调用方处理
      out.push('');
    } else if (INLINE_KEEP.has(name)) {
      if (name === 'a') {
        out.push(closing ? '</a>' : '<a>');
      } else if (name === 'span') {
        // span 直接剥离，保留内容
      } else {
        out.push(closing ? `</${name}>` : `<${name}>`);
      }
    }
    i = gt + 1;
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

export interface HtmlParseOptions {
  /** 相对资源根（用于把相对路径解析成 zip 内路径） */
  basePath?: string;
  /** 图片 → 目标 src 的回调；返回 null 表示丢弃 */
  resolveImage?: (src: string, basePath: string) => string | null;
}

export function htmlToBlocks(html: string, opts: HtmlParseOptions = {}): RawHtmlBlock[] {
  let src = html;

  // 1. 清理
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  src = src.replace(/<(script|style|svg|math|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '');
  src = src.replace(/<(script|style|link|meta)\b[^>]*\/?>/gi, '');

  const bodyMatch = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) src = bodyMatch[1];
  // 去掉 head
  src = src.replace(/<head\b[\s\S]*?<\/head>/gi, '');

  const basePath = opts.basePath ?? '';
  const resolveImage = opts.resolveImage;

  const blocks: RawHtmlBlock[] = [];
  let buf = '';
  let bufType: BlockType = 'p';
  let listDepth = 0;
  let quoteDepth = 0;

  const flush = () => {
    const raw = buf;
    buf = '';
    if (!raw.trim()) return;

    const text = normalizeText(stripTags(raw));
    if (!text && !/<img/i.test(raw)) return;

    // 独立图片
    const imgs = [...raw.matchAll(/<img\b[^>]*>/gi)];
    if (imgs.length > 0) {
      const before = raw.slice(0, imgs[0].index ?? 0);
      const beforeText = normalizeText(stripTags(before));
      if (beforeText) {
        blocks.push({ type: bufType, text: beforeText, html: sanitizeInline(before) });
      }
      for (const im of imgs) {
        const s = attr(im[0], 'src');
        const alt = attr(im[0], 'alt') ?? '';
        if (!s) continue;
        const resolved = resolveImage ? resolveImage(s, basePath) : s;
        if (!resolved) continue;
        blocks.push({ type: 'img', text: alt, src: resolved, alt });
      }
      return;
    }

    if (!text) return;

    const htmlOut = sanitizeInline(raw);
    const block: RawHtmlBlock = {
      type: bufType,
      text,
      html: htmlOut !== escapeHtml(text) ? htmlOut : undefined,
    };
    if (bufType === 'p' && listDepth > 0) block.type = 'list';
    if (bufType === 'p' && quoteDepth > 0) block.type = 'quote';
    if (bufType.startsWith('h')) block.level = HEADING[bufType] ?? 2;
    blocks.push(block);
  };

  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(src)) !== null) {
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    const isVoid = VOID_TAGS.has(tag) || m[0].endsWith('/>');

    // 标签前的文本
    if (m.index > last) buf += src.slice(last, m.index);
    last = tokenRe.lastIndex;

    if (tag === 'img') {
      buf += m[0];
      continue;
    }
    if (tag === 'br') {
      buf += '<br/>';
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      if (!closing) listDepth++;
      else listDepth = Math.max(0, listDepth - 1);
      flush();
      bufType = 'p';
      continue;
    }
    if (tag === 'blockquote') {
      if (!closing) quoteDepth++;
      else quoteDepth = Math.max(0, quoteDepth - 1);
      flush();
      continue;
    }
    if (tag === 'figcaption') {
      flush();
      bufType = 'caption';
      if (closing) bufType = 'p';
      continue;
    }
    if (tag === 'hr') {
      flush();
      blocks.push({ type: 'hr', text: '' });
      continue;
    }

    if (BLOCK_TAGS.has(tag) && !isVoid) {
      if (!closing) {
        flush();
        bufType = (HEADING[tag] ? tag : 'p') as BlockType;
      } else {
        flush();
        bufType = 'p';
      }
      continue;
    }

    if (INLINE_KEEP.has(tag)) {
      buf += m[0];
      continue;
    }

    // 其它标签：丢弃标签，保留内容
  }

  if (last < src.length) buf += src.slice(last);
  flush();

  // 过滤空块
  return blocks.filter((b) => b.type === 'img' || b.type === 'hr' || b.text.trim().length > 0);
}

/** 从 HTML 里抽纯文本（用于字数统计、搜索） */
export function htmlToPlainText(html: string): string {
  return normalizeText(
    decodeEntities(
      html
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]*>/g, ' ')
    )
  );
}
