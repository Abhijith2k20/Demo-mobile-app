// Saved screens: each person, in each company, only ever gets their own data back; old or deleted data never returns.
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
async function seeAs(userId: string, projects: string[], companyId = 'paliath') {
  startSavingCache(userId, companyId);
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
  await restoreCache('ravi', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toEqual(['Project A']);
  queryClient.clear();
  await restoreCache('someone-new', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});

it('forgets saved screens on sign-out', async () => {
  await seeAs('ravi', ['Project A']);
  await forgetSession('ravi', 'paliath');
  await restoreCache('ravi', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});

it('does not show saved screens older than a week', async () => {
  await seeAs('ravi', ['Project A']);
  jest.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
  await restoreCache('ravi', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toBeUndefined();
});

it('keeps each company apart for a person in two companies', async () => {
  await seeAs('suresh', ['Villa 99'], 'paliath');
  await seeAs('suresh', ['Sharma Wedding'], 'brightline');
  await restoreCache('suresh', 'brightline');
  expect(queryClient.getQueryData(['projects'])).toEqual(['Sharma Wedding']);
  queryClient.clear();
  await restoreCache('suresh', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toEqual(['Villa 99']);
});

it('saves Home and the newest 20 chats, not everything ever opened', async () => {
  startSavingCache('ravi', 'paliath');
  queryClient.setQueryData(['projects'], ['Project A']);
  queryClient.setQueryData(['files', 'p1'], ['big list']);
  for (let i = 0; i < 25; i++) {
    jest.setSystemTime(1_000_000 + i * 1000); // chat 24 is the newest
    queryClient.setQueryData(['messages', `ch${i}`], [`message ${i}`]);
  }
  jest.advanceTimersByTime(3000);
  await flush();
  stopSavingCache();
  queryClient.clear();
  await restoreCache('ravi', 'paliath');
  expect(queryClient.getQueryData(['projects'])).toEqual(['Project A']);
  expect(queryClient.getQueryData(['files', 'p1'])).toBeUndefined();
  expect(queryClient.getQueryData(['messages', 'ch24'])).toEqual(['message 24']);
  expect(queryClient.getQueryData(['messages', 'ch4'])).toBeUndefined(); // one of the 5 oldest
});
