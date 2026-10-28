// Session lifecycle: sign in, restore on app start, sign out.
// Kept on the phone: the sign-in (SecureStore), the last screens' data and the send queue (AsyncStorage).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAuthLostHandler } from '@/lib/api/client';
import i18n from '@/lib/i18n';
import { clearOutbox, loadOutbox } from '@/lib/outbox';
import { forgetSession, loadSession, restoreCache, saveSession, startSavingCache, stopSavingCache, type SavedSession } from '@/lib/persist';
import { queryClient } from '@/lib/queryClient';
import { connectSocket, disconnectSocket } from '@/lib/realtime/socket';
import { useSession } from '@/stores/session';
import { toast, useUi } from '@/stores/ui';

export type LoginResult = SavedSession;

async function begin(s: SavedSession, restore: boolean): Promise<void> {
  disconnectSocket();
  stopSavingCache();
  queryClient.clear(); // another person's data is never reused
  if (restore) await restoreCache(s.user.id);
  useUi.getState().set({ online: true });
  useSession.getState().setSession(s);
  startSavingCache(s.user.id);
  connectSocket();
  void loadOutbox(s.user.id);
}

/** After a successful sign-in. */
export async function startSession(res: LoginResult): Promise<void> {
  await begin(res, false);
  await saveSession(res);
}

/** On app start: signed in last time? Show the saved screens at once, then refresh from the server. */
export async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (saved) await begin(saved, true);
}

/**
 * Ends the session on this phone. `discardQueue` is for a deliberate log out (after the warning);
 * when the session simply expires, unsent changes stay and go out at the next sign-in.
 */
export function endSession(opts: { discardQueue?: boolean } = {}): void {
  const userId = useSession.getState().user?.id;
  disconnectSocket();
  stopSavingCache();
  useSession.getState().clear();
  queryClient.clear();
  void forgetSession(userId);
  void clearOutbox(opts.discardQueue ? userId : undefined);
}

/** Demo reset: the server is back to the seed, so nothing saved on the phone means anything. */
export async function wipeEverything(): Promise<void> {
  endSession();
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith('siteline.'));
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

/** Demo shortcut used by the login chips and the Demo panel's "Who am I". */
export async function signInWithEmail(email: string, code = '123456'): Promise<void> {
  await startSession(await api<LoginResult>('POST', '/auth/otp/verify', { email, code }));
}

// A refreshed token or profile is saved too, so the next app start stays signed in.
useSession.subscribe((st, prev) => {
  if (!st.user || !st.accessToken || !st.refreshToken) return;
  if (st.accessToken === prev.accessToken && st.user === prev.user && st.permissions === prev.permissions && st.simpleMode === prev.simpleMode) return;
  void saveSession({ accessToken: st.accessToken, refreshToken: st.refreshToken, user: st.user, permissions: st.permissions, simpleMode: st.simpleMode });
});

setAuthLostHandler(() => {
  if (!useSession.getState().user) return;
  endSession();
  toast(i18n.t('errors.sessionEnded'), 'danger');
});
