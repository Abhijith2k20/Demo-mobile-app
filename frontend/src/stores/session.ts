import { create } from 'zustand';
import type { CompanyChoice, CompanyRef, User } from '@/types/models';

/** What the server sends with a company session (sign-in, picking or switching company, GET /me). */
export interface Me {
  user: User;
  /** Company-level actions the server allows this user (e.g. 'project.create', 'user.invite'). */
  permissions: string[];
  /** Big-button layout for job titles the company marked simple (decided by the server). */
  simpleMode: boolean;
  /** The company this session is for. */
  company: CompanyRef;
  /** Every company the person can open (for the switcher). */
  companies: CompanyChoice[];
}

interface SessionState {
  user: User | null;
  company?: Me['company'];
  companies?: Me['companies'];
  permissions: string[];
  simpleMode: boolean;
  /** A company session's token, or (signed in, company not picked yet) the account token for /auth routes. */
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (s: Me & { accessToken: string; refreshToken: string }) => void;
  setMe: (s: Me) => void;
  setTokens: (accessToken: string, refreshToken?: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  permissions: [],
  simpleMode: false,
  accessToken: null,
  refreshToken: null,
  setSession: (s) => set(s),
  setMe: ({ user, permissions, simpleMode, company, companies }) => set({ user, permissions, simpleMode, company, companies }),
  setTokens: (accessToken, refreshToken) => set(refreshToken ? { accessToken, refreshToken } : { accessToken }),
  clear: () => set({ user: null, permissions: [], simpleMode: false, accessToken: null, refreshToken: null, company: undefined, companies: undefined }),
}));
