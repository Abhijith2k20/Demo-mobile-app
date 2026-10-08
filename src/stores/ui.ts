import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';
export type Language = 'en' | 'kn' | 'hi';
export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'danger' | 'success';
}

interface UiState {
  theme: ThemePref;
  language: Language;
  /** Home sections and project rows the user has collapsed/expanded. */
  collapsed: Record<string, boolean>;
  drafts: Record<string, string>;
  online: boolean;
  socketConnected: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  syncFailed: boolean;
  toast: Toast | null;
  demoPillHidden: boolean;
  notifications: { messages: boolean; tasks: boolean; checkins: boolean };
  setTheme: (t: ThemePref) => void;
  setLanguage: (l: Language) => void;
  toggleCollapsed: (key: string, fallback?: boolean) => void;
  setDraft: (key: string, text: string) => void;
  set: (patch: Partial<Pick<UiState, 'online' | 'socketConnected' | 'syncing' | 'lastSyncAt' | 'syncFailed' | 'demoPillHidden'>>) => void;
  setNotification: (key: 'messages' | 'tasks' | 'checkins', value: boolean) => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  hideToast: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set) => ({
  theme: 'system',
  language: 'en',
  collapsed: {},
  drafts: {},
  online: true,
  socketConnected: false,
  syncing: false,
  lastSyncAt: null,
  syncFailed: false,
  toast: null,
  demoPillHidden: false,
  notifications: { messages: true, tasks: true, checkins: true },
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  toggleCollapsed: (key, fallback = false) =>
    set((s) => ({ collapsed: { ...s.collapsed, [key]: !(s.collapsed[key] ?? fallback) } })),
  setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
  set: (patch) => set(patch),
  setNotification: (key, value) => set((s) => ({ notifications: { ...s.notifications, [key]: value } })),
  showToast: (text, tone = 'info') => set({ toast: { id: ++toastSeq, text, tone } }),
  hideToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));

/** Callable from non-React code (outbox, sync). */
export const toast = (text: string, tone: Toast['tone'] = 'info') => useUi.getState().showToast(text, tone);
