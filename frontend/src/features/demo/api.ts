// Demo panel controls on the server (`/internal/*`, only on the mock backend).
import { api } from '@/lib/api/client';

export type NetworkMode = 'online' | 'slow' | 'flaky';
export type Injection = '500' | '403' | '422' | 'timeout_after_save';
export interface DemoState {
  network: { mode: NetworkMode; inject: Injection | null };
  actorsPaused: boolean;
}

export const demo = {
  state: () => api<DemoState>('GET', '/internal/state'),
  setNetwork: (body: { mode?: NetworkMode; inject?: Injection | 'none' }) => api<DemoState['network']>('POST', '/internal/network', body),
  setActorsPaused: (paused: boolean) => api('POST', '/internal/actors', { paused }),
  amitShifts: () => api('POST', '/internal/actors/amit-shifts'),
  rohanPosts: () => api('POST', '/internal/actors/rohan-posts'),
  expireToken: (userId: string) => api('POST', '/internal/expire-token', { userId }),
  deactivate: (userId: string) => api('POST', '/internal/deactivate', { userId }),
  morningSummary: (userId: string) => api('POST', '/internal/bot/morning-summary', { userId }),
  eveningCheckin: (userId: string) => api('POST', '/internal/bot/evening-checkin', { userId }),
  escalate: (userId: string) => api<{ escalated: boolean }>('POST', '/internal/bot/escalate', { userId }),
  reset: () => api('POST', '/internal/reset'),
};
