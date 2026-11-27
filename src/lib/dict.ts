/**
 * 离线字词库。
 *
 * 数据来自 scripts/build-dict.js 生成的内置词表（新华字典 + 现代汉语词典，
 * 均为 MIT 开源仓库 chinese-xinhua 的数据），不联网、不上传任何查询。
 * 体积较大，所以用动态 import：只有第一次查字时才加载这一块。
 */

export interface DictChar {
  char: string;
  /** 全部读音；第一个是最常用读音 */
  readings: string[];
  radical: string;
  strokes: number;
  structure: string;
  /** 分条释义 */
  senses: string[];
  /** 组词（最多 8 个） */
  words: string[];
}

export interface DictWord {
  word: string;
  /** 词典标注的整词读音；没收录时为空 */
  pinyin: string;
  senses: string[];
  chars: DictChar[];
  /** 词典是否收录 */
  found: boolean;
}

export type LookupResult =
  | { kind: 'char'; char: DictChar }
  | { kind: 'word'; word: DictWord };

/** 紧凑存储：减少 JSON 体积，加载后在内存里展开 */
interface RawDict {
  v: number;
  chars: Record<string, [string, string, number, string, string]>;
  words: Record<string, [string, string]>;
}

let cache: RawDict | null = null;
let pending: Promise<RawDict> | null = null;
let wordIndex: Map<string, string[]> | null = null;

export function preloadDict(): void {
  void getDict().catch(() => {});
}

export function getDict(): Promise<RawDict> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = import('@/assets/dict/dict.json')
      .then((mod) => {
        cache = (mod.default ?? mod) as unknown as RawDict;
        return cache;
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

function splitSenses(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\d+[.、．]\s*/, ''))
    .filter(Boolean);
}

function charOf(raw: RawDict, ch: string): DictChar | null {
  const t = raw.chars[ch];
  if (!t) return null;
  return {
    char: ch,
    readings: String(t[0] ?? '').split('|').filter(Boolean),
    radical: String(t[1] ?? ''),
    strokes: Number(t[2]) || 0,
    structure: String(t[3] ?? ''),
    senses: splitSenses(String(t[4] ?? '')),
    words: [],
  };
}

function buildWordIndex(raw: RawDict): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const w of Object.keys(raw.words)) {
    if (w.length < 2 || w.length > 4) continue;
    for (const ch of new Set(w)) {
      if (!raw.chars[ch]) continue;
      const arr = index.get(ch);
      if (!arr) index.set(ch, [w]);
      else if (arr.length < 120) arr.push(w);
    }
  }
  return index;
}

/** 组词：优先以该字开头，其次短的、常用的 */
function wordsFor(raw: RawDict, ch: string): string[] {
  if (!wordIndex) wordIndex = buildWordIndex(raw);
  const list = wordIndex.get(ch) ?? [];
  const scored = list
    .map((w) => {
      let score = 0;
      if (w.startsWith(ch)) score -= 4;
      if (w.length === 2) score -= 2;
      else if (w.length === 3) score -= 1;
      return { w, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((x) => x.w);
  return scored;
}

export async function lookupChar(ch: string): Promise<DictChar | null> {
  const raw = await getDict();
  const entry = charOf(raw, ch);
  if (!entry) return null;
  entry.words = wordsFor(raw, ch);
  return entry;
}

export async function lookupWord(word: string): Promise<DictWord> {
  const raw = await getDict();
  const chars = [...word]
    .map((ch) => charOf(raw, ch))
    .filter((c): c is DictChar => !!c);
  for (const c of chars) c.words = wordsFor(raw, c.char);
  const def = raw.words[word];
  return {
    word,
    pinyin: def?.[0] ?? '',
    senses: def ? splitSenses(def[1]) : [],
    chars,
    found: !!def,
  };
}

/** 一行摘要，给生字本用 */
export function briefOf(result: LookupResult): string {
  const senses = result.kind === 'char' ? result.char.senses : result.word.senses;
  const first = senses[0] ?? '';
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

export function readingOf(result: LookupResult): string {
  if (result.kind === 'char') return result.char.readings.join(' / ');
  if (result.word.pinyin) return result.word.pinyin;
  if (result.word.chars.some((c) => c.readings.length > 1)) return '多音字';
  return result.word.chars.map((c) => c.readings[0] ?? '').join(' ');
}
