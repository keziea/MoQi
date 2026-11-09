import { create } from 'zustand';
import type { Settings } from '@shared/models';
import { DEFAULT_SETTINGS } from '@shared/models';
import { ipc } from '@/lib/ipc';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

let saveTimer: number | null = null;
let pending: Partial<Settings> = {};

function scheduleSave(patch: Partial<Settings>) {
  pending = { ...pending, ...patch };
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const payload = pending;
    pending = {};
    ipc.settings.save(payload).catch(() => {});
  }, 260);
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const s = await ipc.settings.get();
      set({ settings: { ...DEFAULT_SETTINGS, ...s }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    scheduleSave(patch);
  },
}));
