import { contextBridge, ipcRenderer } from 'electron';

const api = {
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    scan: (opts?: { silent?: boolean }) => ipcRenderer.invoke('library:scan', opts ?? {}),
    import: (paths: string[]) => ipcRenderer.invoke('library:import', { paths }),
    remove: (bookId: string, deleteCache: boolean) =>
      ipcRenderer.invoke('library:remove', { bookId, deleteCache }),
    pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
    pickFiles: () => ipcRenderer.invoke('library:pickFiles'),
    setCategories: (bookId: string, categories: string[]) =>
      ipcRenderer.invoke('library:setCategories', { bookId, categories }),
    switchVariant: (bookId: string, format: string) =>
      ipcRenderer.invoke('library:switchVariant', { bookId, format }),
  },
  book: {
    open: (bookId: string) => ipcRenderer.invoke('book:open', { bookId }),
  },
  progress: {
    get: (bookId: string) => ipcRenderer.invoke('progress:get', { bookId }),
    all: () => ipcRenderer.invoke('progress:all'),
    save: (progress: unknown) => ipcRenderer.invoke('progress:save', progress),
  },
  note: {
    list: (bookId: string) => ipcRenderer.invoke('note:list', { bookId }),
    save: (note: unknown) => ipcRenderer.invoke('note:save', note),
    remove: (bookId: string, noteId: string) =>
      ipcRenderer.invoke('note:remove', { bookId, noteId }),
    export: (bookId: string) => ipcRenderer.invoke('note:export', { bookId }),
    exportAll: (mode: 'single' | 'folder') => ipcRenderer.invoke('note:exportAll', { mode }),
  },
  category: {
    rename: (kind: 'book' | 'note', from: string, to: string) =>
      ipcRenderer.invoke('category:rename', { kind, from, to }),
    remove: (kind: 'book' | 'note', name: string) =>
      ipcRenderer.invoke('category:remove', { kind, name }),
    setNoteColor: (name: string, color: string) =>
      ipcRenderer.invoke('category:setNoteColor', { name, color }),
  },
  session: {
    add: (session: unknown) => ipcRenderer.invoke('session:add', session),
  },
  stats: {
    get: (days: number) => ipcRenderer.invoke('stats:get', { days }),
    books: () => ipcRenderer.invoke('stats:books'),
    finishedSummary: (bookId: string) =>
      ipcRenderer.invoke('stats:finishedSummary', { bookId }),
    resetBookToday: (bookId: string) =>
      ipcRenderer.invoke('stats:resetBookToday', { bookId }),
    totals: () => ipcRenderer.invoke('stats:totals'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch: unknown) => ipcRenderer.invoke('settings:save', patch),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openPath: (p: string) => ipcRenderer.invoke('app:openPath', p),
  },
  win: {
    setFullScreen: (on: boolean) => ipcRenderer.invoke('win:setFullScreen', { on }),
    isFullScreen: () => ipcRenderer.invoke('win:isFullScreen'),
  },
  on: {
    scanProgress: (cb: (p: { done: number; total: number; title: string }) => void) => {
      const listener = (_: unknown, p: { done: number; total: number; title: string }) => cb(p);
      ipcRenderer.on('library:scanProgress', listener);
      return () => ipcRenderer.removeListener('library:scanProgress', listener);
    },
  },
};

contextBridge.exposeInMainWorld('moqi', api);

export type MoqiApi = typeof api;
