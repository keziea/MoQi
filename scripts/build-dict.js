/**
 * 生成内置字词库。
 *
 * 数据源（均为 MIT 许可的开源仓库）：
 *   - 单字：chinese-xinhua / data / word.json（新华字典）
 *   - 词语/单字释义：CNMan/XDHYCD7th（《现代汉语词典》第 7 版全文，社区校对）
 *           没有该文件时退回 chinese-xinhua / data / ci.json（古汉语词语，无拼音）
 *   - 词频：jieba / jieba / dict.txt（用于只保留常用词，控制体积）
 *
 * 用法：
 *   node scripts/build-dict.js
 * 可用环境变量指定源文件：
 *   MOQI_DICT_WORD=... MOQI_DICT_MODERN=... MOQI_DICT_CI=... MOQI_DICT_FREQ=...
 *
 * 输出：src/assets/dict/dict.json
 * 结构（紧凑，减小体积）：
 *   chars[字] = [读音用|分隔, 部首, 笔画, 结构, 释义用\n分隔]
 *   words[词] = [词典拼音, 释义用\n分隔]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMP = os.tmpdir();
const WORD_SRC = process.env.MOQI_DICT_WORD || path.join(TEMP, 'word.json');
const MODERN_SRC = process.env.MOQI_DICT_MODERN || path.join(TEMP, 'XDHYCD7th.txt');
const CI_SRC = process.env.MOQI_DICT_CI || path.join(TEMP, 'ci.json');
const FREQ_SRC = process.env.MOQI_DICT_FREQ || path.join(TEMP, 'jieba.txt');
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'dict');
const OUT = path.join(OUT_DIR, 'dict.json');

const MAX_SENSES = 6;
const MAX_CHAR_CHARS = Number(process.env.MOQI_DICT_CHAR_MAX || 320);
const MAX_WORD_CHARS = Number(process.env.MOQI_DICT_WORD_MAX || 120);
const MAX_WORDS = Number(process.env.MOQI_DICT_WORDS || 25000);

const HAN = /^[\u3400-\u9fff\uf900-\ufaff]$/;

function fail(msg) {
  console.error(`\n[build-dict] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(WORD_SRC)) fail(`找不到单字数据：${WORD_SRC}`);

const t0 = Date.now();
console.log('[build-dict] 读取数据…');
const wordData = JSON.parse(fs.readFileSync(WORD_SRC, 'utf8'));

let modernData = null;
if (fs.existsSync(MODERN_SRC)) {
  if (/\.txt$/i.test(MODERN_SRC)) {
    modernData = parseXdhYcd(fs.readFileSync(MODERN_SRC, 'utf8'));
    console.log(`[build-dict] 现代汉语词典 ${modernData.length} 条`);
  } else {
    modernData = JSON.parse(fs.readFileSync(MODERN_SRC, 'utf8'));
    console.log(`[build-dict] 现代词语 ${modernData.length} 条`);
  }
} else if (fs.existsSync(CI_SRC)) {
  console.log('[build-dict] 没有现代词语库，退回古汉语词语（无拼音）');
} else {
  fail(`找不到词语数据：${MODERN_SRC} / ${CI_SRC}`);
}
const ciData = modernData ? null : JSON.parse(fs.readFileSync(CI_SRC, 'utf8'));

// 现代汉语词典里的单字条目：释义更干净，读音也更全
const modernChars = new Map();
if (modernData) {
  for (const e of modernData) {
    if (e.word && e.word.length === 1) {
      modernChars.set(e.word, {
        pinyin: e.pinyin,
        senses: String(e.explanation || '').split('\n').filter(Boolean),
      });
    }
  }
}

let freq = new Map();
if (fs.existsSync(FREQ_SRC)) {
  const lines = fs.readFileSync(FREQ_SRC, 'utf8').split('\n');
  for (const line of lines) {
    const [w, f] = line.trim().split(/\s+/);
    if (w && f) freq.set(w, Number(f) || 0);
  }
  console.log(`[build-dict] 词频表 ${freq.size} 条`);
} else {
  console.warn('[build-dict] 没有词频表，词语将按长度与释义长度挑选');
}

// ── 文本清理 ──────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 解析《现代汉语词典》第 7 版全文 TXT（CNMan/XDHYCD7th）。
 * 每条以【词头】开头，后面紧跟拼音与释义，可能跨行；同词头不同读音会出现多次。
 */
function parseXdhYcd(text) {
  const map = new Map();
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const w = cur.head.trim();
    if (w) {
      let pinyin = cur.pinyin
        .replace(/ɡ/g, 'g')
        .replace(/[•·]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      let body = cur.text
        .replace(/〈[^〉]{1,10}〉/g, ' ')
        .replace(/＜[^＞]{1,6}＞/g, ' ')
        .replace(/另见[^。]*[。]?/g, ' ')
        .replace(/见\d+页[^。\n]*[。]?/g, ' ')
        .replace(/（[－—–-]{1,3}）/g, ' ')
        .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, ' ')
        .replace(/[❶❷❸❹❺❻❼❽❾❿⓫⓬⓭⓮⓯⓰⓱⓲⓳⓴]/g, '\n')
        .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, '\n')
        .replace(/～/g, w)
        .replace(/[｜◇]/g, '；')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n');
      const senses = body
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const prev = map.get(w);
      if (prev) {
        if (pinyin && !prev.pinyin.includes(pinyin)) {
          prev.pinyin = prev.pinyin ? `${prev.pinyin} / ${pinyin}` : pinyin;
        }
        prev.senses.push(...senses);
      } else {
        map.set(w, { w, pinyin, senses });
      }
    }
    cur = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^【([^】]{1,16})】(.*)$/);
    if (m) {
      flush();
      const head = m[1].trim();
      let rest = m[2].trim();
      // 词条开头可能是上标序号 + 繁体形 + 拼音，例如「¹（龢）hé」
      rest = rest.replace(/^[¹²³⁴⁵⁶⁷⁸⁹⁰\s]+/, '');
      const tm = rest.match(/^（[^）]{1,10}）/);
      if (tm) rest = rest.slice(tm[0].length).trim();
      const pm = rest.match(/^([a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêɡ•·\s]+)/);
      const pinyin = pm ? pm[1].trim() : '';
      if (pm) rest = rest.slice(pm[1].length).trim();
      cur = { head, pinyin, text: rest };
    } else if (cur) {
      cur.text += ` ${line}`;
    }
  }
  flush();
  return [...map.values()].map((x) => ({
    word: x.w,
    pinyin: x.pinyin,
    explanation: x.senses.join('\n'),
  }));
}

/** 把各种序号统一成换行，交给前端按条渲染 */
function normalizeMarks(s) {
  return s
    .replace(/[⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛]/g, '\n')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, '\n')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n');
}

function isNoise(line) {
  if (!line) return true;
  if (/--《|。--|——《/.test(line)) return true;
  if (/^【(引证|出处|详细解释|更多)】/.test(line)) return true;
  if (/^[（(]?(象形|指事|会意|形声|转注|假借)[。，,）)]/.test(line)) return true;
  return false;
}

function cleanLine(line) {
  return line
    .replace(/^\s*\d+[.、．]\s*/, '')
    .replace(/^\s*[·・]\s*/, '')
    .replace(/（图[^）]*$/g, '')
    .replace(/（[^）]{0,3}$/g, '')
    .replace(/[；，、,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉行首的「字 + 读音」，例如「的 ·de放在…」→「放在…」 */
function stripHead(line, ch) {
  const re = new RegExp(
    `^\\s*${escapeRe(ch)}(?:[（(][^）)]{1,8}[）)])?\\s*[·・]?[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê]+\\s*`
  );
  return line.replace(re, '').trim();
}

/** 从整段解释里找出「现代释义」的起点：第一个 ⒈/① 之前最近的一个「字+读音」行 */
function modernStart(text, ch) {
  const head = new RegExp(
    `^\\s*${escapeRe(ch)}(?:[（(][^）)]{1,8}[）)])?\\s*[·a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê]+`,
    'i'
  );
  const idx = text.search(/[⒈①]/);
  const lines = text.split('\n');
  if (idx >= 0) {
    let pos = 0;
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
      if (pos >= idx) break;
      if (head.test(lines[i])) last = pos;
      pos += lines[i].length + 1;
    }
    if (last >= 0) return last;
    return Math.max(0, text.lastIndexOf('\n', idx) + 1);
  }
  let pos = 0;
  for (const line of lines) {
    if (head.test(line)) return pos;
    pos += line.length + 1;
  }
  return 0;
}

/** 从整段解释里提取所有读音（靠「字+拼音」行首匹配，比查表准） */
function extractReadings(text, ch, fallback) {
  const re = new RegExp(
    `(?:^|\\n)\\s*${escapeRe(ch)}(?:[（(][^）)]{1,8}[）)])?\\s*[·・]?([a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê]+)`,
    'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    let r = m[1].toLowerCase().replace(/ɡ/g, 'g').replace(/·/g, '');
    if (!r || r.length > 12) continue;
    if (!out.includes(r)) out.push(r);
  }
  if (fallback) {
    const f = String(fallback).toLowerCase().replace(/ɡ/g, 'g').trim();
    const i = out.indexOf(f);
    if (i > 0) {
      out.splice(i, 1);
      out.unshift(f);
    } else if (i < 0 && f) {
      out.unshift(f);
    }
  }
  return out.slice(0, 5);
}

/** 现代释义太短时（生僻字常常只有一条成语），补上前面简洁的古义 */
function classicSenses(text, ch, start) {
  const head = new RegExp(`^\\s*${escapeRe(ch)}\\s*$`);
  const out = [];
  for (const raw of text.slice(0, start).split('\n')) {
    const line = cleanLine(raw);
    if (!line || head.test(line)) continue;
    if (isNoise(line)) continue;
    if (/^[（(]/.test(line)) continue;
    if (/^又如/.test(line)) continue;
    if (line.length < 2 || line.length > 60) continue;
    if (/^见/.test(line)) continue;
    out.push(line);
  }
  return out.slice(-2);
}

function extractSenses(text, ch) {
  const start = modernStart(text, ch);
  const body = normalizeMarks(text.slice(start));
  const head = new RegExp(
    `^\\s*${escapeRe(ch)}(?:[（(][^）)]{1,8}[）)])?\\s*[·a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê]+\\s*$`,
    'i'
  );
  const lines = body
    .split('\n')
    .map(cleanLine)
    .filter((l) => !isNoise(l))
    // 丢掉只有「字 + 读音」的标题行
    .filter((l) => l && !head.test(l) && l !== ch)
    // 行首的「字 + 读音」去掉，只留释义
    .map((l) => stripHead(l, ch))
    .filter(Boolean)
    // 丢掉「见 xxx」这种纯跳转
    .filter((l) => !/^见[^，。]{1,8}[。;；]?$/.test(l));

  const senses = [];
  let used = 0;
  for (const line of lines) {
    if (senses.length >= MAX_SENSES) break;
    if (used + line.length > MAX_CHAR_CHARS && senses.length > 0) break;
    senses.push(line.length > 120 ? `${line.slice(0, 120)}…` : line);
    used += line.length;
  }
  if (used < 50) {
    const extra = classicSenses(text, ch, start).filter((l) => !senses.includes(l));
    if (extra.length) senses.unshift(...extra);
  }
  if (senses.length === 0) {
    const fallback = cleanLine(text).slice(0, 90);
    if (fallback) senses.push(fallback);
  }
  return senses.slice(0, MAX_SENSES);
}

// ── 单字 ──────────────────────────────────────────────────

const chars = {};
let charCount = 0;
for (const item of wordData) {
  const ch = item.word;
  if (!ch || !HAN.test(ch)) continue;
  const text = String(item.explanation || '');
  if (!text.trim()) continue;

  const modern = modernChars.get(ch);
  let readings = [];
  let senses = [];
  const hasModern = !!(modern && modern.senses.length);
  if (hasModern) {
    readings = modern.pinyin
      .split(' / ')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    senses = modern.senses
      .map(cleanLine)
      .filter(Boolean)
      .slice(0, MAX_SENSES)
      .map((s) => (s.length > 180 ? `${s.slice(0, 180)}…` : s));
  }
  if (readings.length === 0) {
    readings = extractReadings(text, ch, item.pinyin);
    // 新华字典的正文顺序不一定把常用音放前面，用字条 pinyin 提到最前
    const primary = String(item.pinyin || '').toLowerCase().replace(/ɡ/g, 'g').trim();
    if (primary) {
      const i = readings.indexOf(primary);
      if (i > 0) {
        readings.splice(i, 1);
        readings.unshift(primary);
      } else if (i < 0) {
        readings.unshift(primary);
      }
    }
  }
  if (senses.length === 0) senses = extractSenses(text, ch);
  if (senses.length === 0) continue;

  chars[ch] = [
    [...new Set(readings)].slice(0, 5).join('|'),
    String(item.radicals || ''),
    Number(item.strokes) || 0,
    '',
    senses.join('\n'),
  ];
  charCount += 1;
}

// ── 词语 ──────────────────────────────────────────────────

const candidates = [];
if (modernData) {
  for (const item of modernData) {
    const w = item.word;
    if (!w || w.length < 2 || w.length > 8) continue;
    if (![...w].every((c) => HAN.test(c))) continue;
    const def = String(item.explanation || '').trim();
    if (!def) continue;
    const f = freq.get(w) ?? 0;
    if (freq.size > 0 && f <= 0) continue;
    candidates.push({ w, def, pinyin: String(item.pinyin || ''), f });
  }
} else {
  for (const item of ciData) {
    const w = item.ci;
    if (!w || w.length < 2 || w.length > 4) continue;
    if (![...w].every((c) => HAN.test(c))) continue;
    const def = String(item.explanation || '').trim();
    if (!def) continue;
    const f = freq.get(w) ?? 0;
    if (freq.size > 0 && f <= 0) continue;
    candidates.push({ w, def, pinyin: '', f });
  }
}

candidates.sort((a, b) => {
  if (b.f - a.f) return b.f - a.f;
  if (a.w.length - b.w.length) return a.w.length - b.w.length;
  return a.def.length - b.def.length;
});

const words = {};
let wordCount = 0;
for (const item of candidates) {
  if (wordCount >= MAX_WORDS) break;
  const lines = normalizeMarks(item.def)
    .split('\n')
    .map(cleanLine)
    .filter((l) => l && !isNoise(l))
    .slice(0, 3);
  if (!lines.length) continue;
  let text = lines.join('\n');
  if (text.length > MAX_WORD_CHARS) {
    text = `${text.slice(0, MAX_WORD_CHARS)}…`;
  }
  words[item.w] = [item.pinyin, text];
  wordCount += 1;
}

// ── 输出 ──────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const payload = { v: 1, chars, words };
const json = JSON.stringify(payload);
fs.writeFileSync(OUT, json, 'utf8');

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`[build-dict] 单字 ${charCount} 个，词语 ${wordCount} 条`);
console.log(`[build-dict] 输出 ${path.relative(ROOT, OUT)} · ${mb(Buffer.byteLength(json))}`);
console.log(`[build-dict] 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

for (const sample of ['和', '的', '爨', '龟', '行', '魑']) {
  if (chars[sample]) console.log(`  ${sample} [${chars[sample][0]}] ${chars[sample][4].slice(0, 60)}…`);
}
if (words['认真']) console.log(`  认真 [${words['认真'][0]}] ${words['认真'][1].slice(0, 50)}`);
