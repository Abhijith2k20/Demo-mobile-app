import { create } from 'zustand';
import type { User } from '@/types/models';

interface SessionState {
  user: User | null;
  /** Company-level actions the server allows this user (e.g. 'project.create', 'user.invite'). */
  permissions: string[];
  /** Big-button layout for job titles the company marked simple (decided by the server). */
  simpleMode: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (s: { user: User; permissions: string[]; simpleMode: boolean; accessToken: string; refreshToken: string }) => void;
  setMe: (s: { user: User; permissions: string[]; simpleMode: boolean }) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  permissions: [],
  simpleMode: false,
  accessToken: null,
  refreshToken: null,
  setSession: ({ user, permissions, simpleMode, accessToken, refreshToken }) => set({ user, permissions, simpleMode, accessToken, refreshToken }),
  setMe: ({ user, permissions, simpleMode }) => set({ user, permissions, simpleMode }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ user: null, permissions: [], simpleMode: false, accessToken: null, refreshToken: null }),
}));
