// What survives closing the app: the sign-in (SecureStore) and the last data the screens showed
// (AsyncStorage), so someone who reopens the app with no signal still sees projects, chats and
// tasks, marked as offline. Only server replies are saved; nothing is worked out on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, hydrate, type DehydratedState } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { queryClient } from '@/lib/queryClient';
import type { User } from '@/types/models';

const SESSION_KEY = 'siteline.session';
const cacheKey = (userId: string) => `siteline.cache.${userId}`;
/** Saved data older than this is not shown: better an empty screen than a misleading one. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SavedSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  permissions: string[];
  simpleMode: boolean;
}

export async function saveSession(s: SavedSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s)).catch((e) => console.warn('[persist] session not saved', e));
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export async function forgetSession(userId?: string): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
  if (userId) await AsyncStorage.removeItem(cacheKey(userId)).catch(() => {});
}

/** Puts the saved screens back into the cache; the screens then refresh them from the server. */
export async function restoreCache(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (!raw) return;
    const saved = JSON.parse(raw) as { at: number; state: DehydratedState };
    if (Date.now() - saved.at > MAX_AGE_MS) return;
    hydrate(queryClient, saved.state);
  } catch (e) {
    console.warn('[persist] cache not restored', e);
  }
}

let stopSaving: (() => void) | null = null;

/** Saves successful replies a few seconds after the cache changes, for this user only. */
export function startSavingCache(userId: string): void {
  stopSavingCache();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] !== 'demo-state' });
    AsyncStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), state })).catch((e) => console.warn('[persist] cache not saved', e));
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && !timer) timer = setTimeout(flush, 3000);
  });
  stopSaving = () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

export function stopSavingCache(): void {
  stopSaving?.();
  stopSaving = null;
}
