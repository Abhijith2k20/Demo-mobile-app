import { api } from '@/lib/api/client';
import { attempt } from '@/lib/mutations';
import { keys } from '@/lib/queries';
import { endSession } from '@/lib/session';
import { forgetPushToken } from '@/lib/push';
import type { Language } from '@/stores/ui';

export interface NotifyPrefs {
  /** all: every push; important: DMs, mentions, check-ins and escalations; off: none. */
  level: 'all' | 'important' | 'off';
  /** Check-ins wait until this quiet time ends (company time zone). Null: no quiet hours. */
  quietFrom: string | null;
  quietTo: string | null;
}

/** Signs out on the server (this session) and clears this phone. */
export async function logOut(): Promise<void> {
  await forgetPushToken();
  api('POST', '/auth/logout').catch(() => {});
  endSession({ discardQueue: true });
}

/** The server writes the bot's cards and pushes in this language. */
export function saveLanguage(language: Language): Promise<unknown> {
  return attempt(() => api('PATCH', '/me', { language }), [keys.me]);
}

export function saveNotifyPrefs(notify: NotifyPrefs): Promise<unknown> {
  return attempt(() => api('PATCH', '/me', { notify }), [keys.me]);
}

/** Spec §9.8: details removed everywhere; messages stay as "Former member". */
export async function deleteAccount(): Promise<void> {
  await api('DELETE', '/me');
  endSession({ discardQueue: true });
}
