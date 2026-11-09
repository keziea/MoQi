import { create } from 'zustand';

interface ImportDialogState {
  open: boolean;
  openDialog: () => void;
  close: () => void;
}

/** 全局只有一个导入入口：任何地方的「导入书籍」都打开这个弹窗 */
export const useImportDialog = create<ImportDialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
}));
