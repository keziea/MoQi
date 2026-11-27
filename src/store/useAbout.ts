import { create } from 'zustand';

interface AboutState {
  open: boolean;
  openAbout: () => void;
  closeAbout: () => void;
}

/** 「关于墨栖」是一个全局弹层：工作台版本胶囊、侧栏版本号、阅读设置都能打开它 */
export const useAbout = create<AboutState>((set) => ({
  open: false,
  openAbout: () => set({ open: true }),
  closeAbout: () => set({ open: false }),
}));
