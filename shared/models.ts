/**
 * 墨栖 · 共享数据模型
 *
 * ⚠️ 这是主进程与渲染进程唯一的契约。改动规则见 docs/03-数据模型与存储.md：
 *   · 只能新增可选字段
 *   · 不能改字段含义、不能删字段
 *   · 破坏性变更必须写迁移函数并升 dataVersion
 */

// ─────────────────────────────── 书籍 ───────────────────────────────

export type BookFormat = 'epub' | 'mobi' | 'pdf' | 'txt';

export interface BookVariant {
  format: BookFormat;
  path: string;
  sizeBytes: number;
  /** 解析质量分：EPUB 100 / MOBI 90 / TXT 80 / PDF 70 */
  quality: number;
}

/** 书库索引中的一条（轻量，用于书架渲染） */
export interface BookMeta {
  id: string;
  title: string;
  author: string;
  publisher?: string;
  /** 封面文件名，位于 data/books/{id}/ 下 */
  cover?: string;
  /** 当前选用的格式 */
  format: BookFormat;
  /** 同一本书拥有的全部格式 */
  variants: BookVariant[];
  totalChars: number;
  chapterCount: number;
  addedAt: number;
  lastOpenedAt?: number;
  /** 最近解析出的目录摘要，用于书架显示章节名 */
  currentChapterTitle?: string;
  /** 所属分类，可多选；空数组 = 未分类 */
  categories?: string[];
}

export type BlockType =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'quote'
  | 'img'
  | 'caption'
  | 'list'
  | 'hr'
  | 'code';

export interface Block {
  /** 铁律：`${chapterId}#${indexInChapter}`，永不可变 */
  id: string;
  type: BlockType;
  /** 纯文本（搜索 / 笔记匹配 / 摘录） */
  text: string;
  /** 精简内联 HTML（em/strong/br/a/sup/sub/ruby），优先于 text 渲染 */
  html?: string;
  /** img：moqi-asset://{bookId}/{name} */
  src?: string;
  alt?: string;
  /** list 条目 */
  items?: string[];
  level?: number;
}

export interface Chapter {
  id: string;
  title: string;
  level: number;
  charCount: number;
  blocks: Block[];
}

export interface TocItem {
  title: string;
  chapterId: string;
  blockId?: string;
  level: number;
}

export interface Book {
  meta: BookMeta;
  chapters: Chapter[];
  toc: TocItem[];
}

// ─────────────────────────────── 用户数据 ───────────────────────────────

export type HighlightColor =
  | 'clay'
  | 'moss'
  | 'indigo'
  | 'amber'
  | 'rose'
  | 'teal'
  | 'plum'
  | 'slate';

/** 可选的高亮色池。一个笔记分类占一种颜色，颜色不能重复。 */
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  'clay',
  'amber',
  'moss',
  'indigo',
  'rose',
  'teal',
  'plum',
  'slate',
];

/** 笔记分类 = 名字 + 颜色。颜色唯一，选了别人的颜色就要先释放。 */
export interface NoteCategoryDef {
  name: string;
  color: HighlightColor;
}

export const DEFAULT_NOTE_CATEGORIES: NoteCategoryDef[] = [
  { name: '想法', color: 'clay' },
  { name: '金句', color: 'amber' },
  { name: '疑问', color: 'moss' },
  { name: '资料', color: 'indigo' },
  { name: '感想', color: 'rose' },
];

/** 笔记分类（用户可另建自定义分类） */
export const NOTE_CATEGORIES = ['金句', '疑问', '资料', '感想'] as const;
export const NOTE_CATEGORY_FALLBACK = '未分类';

export interface TextRange {
  blockId: string;
  start: number;
  end: number;
}

export interface ReadMark {
  chapterId: string;
  blockId: string;
  /** 该段前 40 字，用于展示与容错定位 */
  excerpt: string;
  createdAt: number;
  /** 标记时的全书进度 */
  ratio: number;
}

export interface Progress {
  bookId: string;
  chapterId: string;
  blockId: string;
  /** 段落顶部相对视口顶部的偏移（≤ 0） */
  delta: number;
  /** 全书进度 0–1（按字数加权） */
  ratio: number;
  updatedAt: number;
  mark?: ReadMark;
  /** 分页模式页码 */
  pageIndex?: number;
  /** 第一次在软件里翻开这本书的时间：「打开过」即算在读，不必真的读到正文 */
  openedAt?: number;
  /** 已读完（可手动标记，不必真在软件里读完） */
  finished?: boolean;
  finishedAt?: number;
}

export interface Note {
  id: string;
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  /** 支持跨段落 */
  ranges: TextRange[];
  text: string;
  comment: string;
  color: HighlightColor;
  kind: 'selection' | 'paragraph';
  /** 笔记分类；空/缺省视为「未分类」 */
  category?: string;
  /** 笔记标题（可选，便于检索） */
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  bookTitle: string;
  /** YYYY-MM-DD（本地时区） */
  date: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
}

export interface DailyStat {
  date: string;
  seconds: number;
  books: { bookId: string; title: string; seconds: number }[];
  noteCount: number;
  pagesRead: number;
}

// ─────────────────────────────── 设置 ───────────────────────────────

export type ThemeName = 'paper' | 'sepia' | 'green' | 'night';
export type FontKind = 'serif' | 'sans' | 'kai';
export type PageMode = 'scroll' | 'paged';

export interface Settings {
  theme: ThemeName;
  fontSize: number;
  lineHeight: number;
  fontFamily: FontKind;
  letterSpacing: number;
  paraGap: number;
  indent: boolean;
  measure: number;

  pageMode: PageMode;
  showTimer: boolean;
  autoHideBar: boolean;
  clickToMark: boolean;
  /** 工作台每日阅读目标（分钟），只用于展示，不参与计时结算 */
  dailyGoalMinutes?: number;

  libraryDirs: string[];
  /** 可用分类清单（预置 + 用户自定义） */
  categories: string[];
  /** 笔记分类：名字 + 颜色，颜色全局唯一 */
  noteCategories?: NoteCategoryDef[];
  lastBookId?: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
  dataVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'paper',
  fontSize: 19,
  lineHeight: 1.95,
  fontFamily: 'serif',
  letterSpacing: 0.01,
  paraGap: 0.8,
  indent: true,
  measure: 34,
  pageMode: 'paged',
  showTimer: true,
  autoHideBar: true,
  clickToMark: true,
  dailyGoalMinutes: 30,
  libraryDirs: [],
  categories: [
    '文学', '历史', '哲学', '政治', '经济', '社科',
    '科技', '心理', '艺术', '传记', '科普', '生活',
  ],
  noteCategories: DEFAULT_NOTE_CATEGORIES,
  dataVersion: 3,
};

// ─────────────────────────────── 查询结果 ───────────────────────────────

export interface SearchHit {
  chapterId: string;
  chapterTitle: string;
  blockId: string;
  /** 命中位置在 block.text 中的偏移 */
  offset: number;
  /** 命中前 28 字 */
  before: string;
  /** 命中词 */
  match: string;
  /** 命中后 28 字 */
  after: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  libraryDir: string;
}

export interface OpenBookResult {
  ok: boolean;
  book?: Book;
  error?: string;
  /** 是否从缓存读取 */
  cached?: boolean;
}

export interface ImportResult {
  ok: boolean;
  added: number;
  books: BookMeta[];
  error?: string;
}
