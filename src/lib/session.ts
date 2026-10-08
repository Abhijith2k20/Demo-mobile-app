// Session lifecycle: sign in, sign out, wipe. Wires the API client, socket, sync and outbox together.
import { isOnline } from '@/lib/api/transport';
import { api, setAuthLostHandler } from '@/lib/api/client';
import { wipeLocalDb } from '@/lib/db/init';
import { startOutbox, stopOutbox } from '@/lib/outbox/runner';
import { queryClient } from '@/lib/queryClient';
import { connectSocket, disconnectSocket } from '@/lib/realtime/socket';
import { catchUp } from '@/lib/sync/catchup';
import i18n from '@/lib/i18n';
import { useSession } from '@/stores/session';
import { toast, useUi } from '@/stores/ui';
import type { User } from '@/types/models';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** Starts a session and runs the first sync. Local data from another user is never reused. */
export async function startSession(res: LoginResult): Promise<void> {
  stopOutbox();
  disconnectSocket();
  wipeLocalDb();
  queryClient.clear();
  useUi.getState().set({ online: isOnline(), lastSyncAt: null, syncFailed: false });
  useSession.getState().setSession(res);
  connectSocket(res.user.id);
  startOutbox();
  await catchUp({ full: true });
}

/** Ends the session and wipes everything stored on the phone. */
export function endSession(): void {
  stopOutbox();
  disconnectSocket();
  useSession.getState().clear();
  wipeLocalDb();
  queryClient.clear();
}

/** Demo shortcut used by the login chips and the Demo panel's "Who am I". */
export async function signInWithPhone(phone: string, code = '123456'): Promise<void> {
  const res = await api<LoginResult>('POST', '/auth/otp/verify', { phone, code });
  await startSession(res);
}

setAuthLostHandler(() => {
  if (!useSession.getState().user) return;
  endSession();
  toast(i18n.t('errors.sessionEnded'), 'danger');
});
