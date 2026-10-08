import { create } from 'zustand';
import type { User } from '@/types/models';

interface SessionState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** True when every project membership of the user has the job title Worker. */
  workerMode: boolean;
  /** False until the first sync after login has finished (or failed). */
  ready: boolean;
  setSession: (s: { user: User; accessToken: string; refreshToken: string }) => void;
  setAccessToken: (token: string) => void;
  setWorkerMode: (v: boolean) => void;
  setReady: (v: boolean) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  workerMode: false,
  ready: false,
  setSession: ({ user, accessToken, refreshToken }) => set({ user, accessToken, refreshToken, ready: false }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setWorkerMode: (workerMode) => set((s) => (s.workerMode === workerMode ? s : { workerMode })),
  setReady: (ready) => set({ ready }),
  clear: () => set({ user: null, accessToken: null, refreshToken: null, workerMode: false, ready: false }),
}));
