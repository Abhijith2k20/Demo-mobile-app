// Dev panel controls on the server (`/internal/*`, refused in production). Bot and account actions apply to
// the signed-in person in their current company.
import { api } from '@/lib/api/client';

export type NetworkMode = 'online' | 'slow' | 'flaky';
export type Injection = '500' | '403' | '422' | 'timeout_after_save';
export interface DemoState {
  network: { mode: NetworkMode; inject: Injection | null };
}

export const demo = {
  state: () => api<DemoState>('GET', '/internal/state'),
  setNetwork: (body: { mode?: NetworkMode; inject?: Injection | 'none' }) => api<DemoState['network']>('POST', '/internal/network', body),
  expireToken: () => api('POST', '/internal/expire-token'),
  deactivate: () => api('POST', '/internal/deactivate'),
  morningSummary: () => api('POST', '/internal/bot/morning-summary'),
  eveningCheckin: () => api('POST', '/internal/bot/evening-checkin'),
  pmDown: (down: boolean) => api('POST', '/internal/pm/down', { down }),
  reset: () => api('POST', '/internal/reset'),
};
