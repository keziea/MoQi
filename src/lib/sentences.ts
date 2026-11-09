export interface Sentence {
  start: number;
  end: number;
  text: string;
}

const ENDERS = '。！？；!?;';
const TRAILERS = '”"』」）)】》…';

/**
 * 按中文句末标点切句，保留句末标点与紧随的引号/括号。
 * 偏移量直接对应 block.text，可直接用于笔记 ranges。
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (ENDERS.includes(text[i])) {
      let end = i + 1;
      while (end < text.length && TRAILERS.includes(text[end])) end++;
      const piece = text.slice(start, end);
      if (piece.trim()) out.push({ start, end, text: piece });
      start = end;
      i = end;
      continue;
    }
    i += 1;
  }
  if (start < text.length) {
    const piece = text.slice(start);
    if (piece.trim()) out.push({ start, end: text.length, text: piece });
  }
  return out;
}
