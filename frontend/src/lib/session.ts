// Session lifecycle: sign in, pick or switch company, restore on app start, sign out.
// Kept on the phone: the sign-in (SecureStore), and per person and company the last screens' data and the
// send queue (AsyncStorage).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAuthLostHandler } from '@/lib/api/client';
import i18n from '@/lib/i18n';
import { clearOutbox, loadOutbox } from '@/lib/outbox';
import { forgetSession, loadSession, restoreCache, saveSession, startSavingCache, stopSavingCache, type SavedSession } from '@/lib/persist';
import { queryClient } from '@/lib/queryClient';
import { connectSocket, disconnectSocket } from '@/lib/realtime/socket';
import { useSession } from '@/stores/session';
import { toast, useUi } from '@/stores/ui';
import type { CompanyChoice, PendingInvite } from '@/types/models';

export type CompanySession = SavedSession;

/** What /auth/otp/verify answers: the person's companies and invites, and a session when there's only one company. */
export interface SignedIn {
  accessToken: string;
  companies: CompanyChoice[];
  invites: PendingInvite[];
  session?: CompanySession;
}

async function begin(s: CompanySession, restore: boolean): Promise<void> {
  disconnectSocket();
  stopSavingCache();
  queryClient.clear(); // another person's or company's data is never reused
  if (restore) await restoreCache(s.user.id, s.company.id);
  useUi.getState().set({ online: true });
  useSession.getState().setSession(s);
  startSavingCache(s.user.id, s.company.id);
  connectSocket();
  void loadOutbox(s.user.id, s.company.id);
}

/** After signing in to a company (or switching to one). */
export async function startSession(s: CompanySession): Promise<void> {
  await begin(s, false);
  await saveSession(s);
}

/** Signed in, company not picked yet: the account token only opens the /auth routes (picker, invites). */
export function holdAccountToken(accessToken: string): void {
  useSession.getState().clear();
  useSession.getState().setTokens(accessToken);
}

/** Opens one of the person's companies with the account token. */
export async function pickCompany(companyId: string): Promise<void> {
  await startSession(await api<CompanySession>('POST', '/auth/session', { companyId }));
}

/** Switches to another company: a new session; the one for this company ends. Saved data stays per company. */
export async function switchCompany(companyId: string): Promise<void> {
  const next = await api<CompanySession>('POST', '/auth/switch', { companyId });
  stopSavingCache();
  await startSession(next);
}

/** On app start: signed in last time? Show the saved screens at once, then refresh from the server. */
export async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (saved?.company) await begin(saved, true);
}

/**
 * Ends the session on this phone. `discardQueue` is for a deliberate log out (after the warning);
 * when the session simply expires, unsent changes stay and go out at the next sign-in.
 */
export function endSession(opts: { discardQueue?: boolean } = {}): void {
  const { user, company } = useSession.getState();
  disconnectSocket();
  stopSavingCache();
  useSession.getState().clear();
  queryClient.clear();
  void forgetSession(user?.id, company?.id);
  void clearOutbox(opts.discardQueue ? user?.id : undefined, company?.id);
}

/** Dev reset: the server is back to the seed, so nothing saved on the phone means anything. */
export async function wipeEverything(): Promise<void> {
  endSession();
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith('siteline.'));
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

/** Dev shortcut (sign-in sheet, dev panel "Who am I"): seeded accounts use a fixed code outside production. */
export async function signInDemo(identifier: string, company: string, code = '123456'): Promise<void> {
  await api('POST', '/auth/otp/request', { identifier });
  const res = await api<SignedIn>('POST', '/auth/otp/verify', { identifier, code });
  if (res.session && res.session.company.name === company) return startSession(res.session);
  holdAccountToken(res.accessToken);
  const pick = res.companies.find((c) => c.name === company) ?? res.companies[0];
  if (pick) await pickCompany(pick.id);
}

// A refreshed token or profile is saved too, so the next app start stays signed in.
useSession.subscribe((st, prev) => {
  if (!st.user || !st.accessToken || !st.refreshToken || !st.company || !st.companies) return;
  if (st.accessToken === prev.accessToken && st.user === prev.user && st.permissions === prev.permissions &&
      st.simpleMode === prev.simpleMode && st.companies === prev.companies) return;
  void saveSession({ accessToken: st.accessToken, refreshToken: st.refreshToken, user: st.user, permissions: st.permissions,
    simpleMode: st.simpleMode, company: st.company, companies: st.companies });
});

setAuthLostHandler(() => {
  if (!useSession.getState().user) return;
  endSession();
  toast(i18n.t('errors.sessionEnded'), 'danger');
});
