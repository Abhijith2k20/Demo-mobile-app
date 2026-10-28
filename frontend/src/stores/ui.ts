import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  toast: Toast | null;
  demoPillHidden: boolean;
  notifications: { messages: boolean; tasks: boolean; checkins: boolean };
  setTheme: (t: ThemePref) => void;
  setLanguage: (l: Language) => void;
  toggleCollapsed: (key: string, fallback?: boolean) => void;
  setDraft: (key: string, text: string) => void;
  set: (patch: Partial<Pick<UiState, 'online' | 'socketConnected' | 'demoPillHidden'>>) => void;
  setNotification: (key: 'messages' | 'tasks' | 'checkins', value: boolean) => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  hideToast: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'en',
      collapsed: {},
      drafts: {},
      online: true,
      socketConnected: false,
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
    }),
    {
      // Device settings survive a restart; they don't depend on who is signed in.
      name: 'prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        theme: s.theme,
        language: s.language,
        notifications: s.notifications,
        demoPillHidden: s.demoPillHidden,
      }),
    },
  ),
);

/** Resolves once saved settings are loaded; the root layout waits for it before hiding the splash screen. */
export const prefsLoaded = new Promise<void>((resolve) => {
  if (useUi.persist.hasHydrated()) resolve();
  else useUi.persist.onFinishHydration(() => resolve());
});

/** Callable from non-React code (API writes, the session). */
export const toast = (text: string, tone: Toast['tone'] = 'info') => useUi.getState().showToast(text, tone);
