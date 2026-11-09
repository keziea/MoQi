import { HIGHLIGHT_COLORS, type HighlightColor } from '@shared/models';

/**
 * 高亮色的显示元信息。
 * label 是给「颜色本身」用的名字，语义由分类决定（见 Settings.noteCategories）。
 */
export const COLOR_META: Record<HighlightColor, { label: string; varName: string; solid: string }> = {
  clay: { label: '陶土', varName: '--hl-clay', solid: '#c47c5c' },
  amber: { label: '琥珀', varName: '--hl-amber', solid: '#cea656' },
  moss: { label: '苔绿', varName: '--hl-moss', solid: '#7a966c' },
  indigo: { label: '靛蓝', varName: '--hl-indigo', solid: '#6a7ea6' },
  rose: { label: '绯红', varName: '--hl-rose', solid: '#be6884' },
  teal: { label: '青碧', varName: '--hl-teal', solid: '#549492' },
  plum: { label: '紫檀', varName: '--hl-plum', solid: '#8c6aa4' },
  slate: { label: '石青', varName: '--hl-slate', solid: '#6e788c' },
};

/** 选文字时工具条上的常用四色 */
export const QUICK_COLORS: HighlightColor[] = ['clay', 'moss', 'indigo', 'amber'];

export const ALL_COLORS = HIGHLIGHT_COLORS;
