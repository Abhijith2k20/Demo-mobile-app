// Saved screens: each person only ever gets their own data back; old or deleted data never returns.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetSession, restoreCache, startSavingCache, stopSavingCache } from '@/lib/persist';
import { queryClient } from '@/lib/queryClient';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest's documented mock for AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(async () => {}), getItemAsync: jest.fn(async () => null), deleteItemAsync: jest.fn(async () => {}) }));

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Signs in as `userId`, loads some data, and lets the cache be saved. */
async function seeAs(userId: string, projects: string[]) {
  startSavingCache(userId);
  queryClient.setQueryData(['projects'], projects);
  jest.advanceTimersByTime(3000);
  await flush();
  stopSavingCache();
  queryClient.clear();
}

beforeEach(async () => {
  jest.useFakeTimers();
  queryClient.clear();
  await AsyncStorage.clear();
});
afterEach(() => jest.useRealTimers());

it('gives each person back only their own saved screens', async () => {
  await seeAs('arjun', ['Project A', 'Project B', 'Project C']);
  await seeAs('ravi', ['Project A']);
  await restoreCache('ravi');
  expect(queryClient.getQueryData(['projects'])).toEqual(['Project A']);
  queryClient.clear();
  await restoreCache('someone-new');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});

it('forgets saved screens on sign-out', async () => {
  await seeAs('ravi', ['Project A']);
  await forgetSession('ravi');
  await restoreCache('ravi');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});

it('does not show saved screens older than a week', async () => {
  await seeAs('ravi', ['Project A']);
  jest.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
  await restoreCache('ravi');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});
