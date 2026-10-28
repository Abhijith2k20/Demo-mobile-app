// The send queue: order, retries, refusals, merging, and surviving an app restart.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppError } from '@/lib/api/client';
import { enqueue, loadOutbox, MAX_SERVER_ERRORS, retryItem, runOutbox, storageKey, useOutbox, type NewItem, type OutboxItem } from '@/lib/outbox';
import { useSession } from '@/stores/session';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest's documented mock for AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/lib/api/client', () => ({ ...jest.requireActual('@/lib/api/client'), api: jest.fn() }));
jest.mock('@/lib/api/transport', () => ({ photoForm: (uri: string) => ({ uri }) }));
jest.mock('@/lib/queries', () => ({ keys: new Proxy({}, { get: () => () => [] }), refresh: jest.fn() }));
jest.mock('@/stores/ui', () => ({ toast: jest.fn() }));
const mockMissing = new Set<string>();
jest.mock('@/lib/queuedFiles', () => ({
  keepPhoto: (uri: string, id: string) => `kept://${id}`,
  photoExists: (uri: string) => !mockMissing.has(uri),
  dropPhoto: jest.fn(),
}));

const api = jest.requireMock('@/lib/api/client').api as jest.Mock;
const offline = () => new AppError('offline', 'OFFLINE', 'offline', {}, 'r');
const refused = () => new AppError('forbidden', 'FORBIDDEN', 'no', {}, 'r');
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const text = (body: string): Extract<NewItem, { kind: 'message' }> => ({
  kind: 'message',
  channelId: 'ch1',
  type: 'text',
  body,
  data: null,
  threadParentId: null,
  photos: [],
});
const items = () => useOutbox.getState().items;

beforeEach(async () => {
  jest.useFakeTimers();
  api.mockReset();
  mockMissing.clear();
  useOutbox.getState().set([]);
  await AsyncStorage.clear();
  useSession.getState().setSession({ user: { id: 'u1' } as never, permissions: [], simpleMode: false, accessToken: 'a', refreshToken: 'r' });
});
afterEach(() => jest.useRealTimers());

it('sends with the id made on the phone and removes the item', async () => {
  api.mockResolvedValue({});
  const id = enqueue(text('hello'));
  await flush();
  expect(api).toHaveBeenCalledWith('POST', '/channels/ch1/messages', expect.objectContaining({ id, body: 'hello' }));
  expect(items()).toHaveLength(0);
});

it('keeps order: a network problem pauses the queue and retries later', async () => {
  api.mockRejectedValueOnce(offline());
  enqueue(text('first'));
  await flush();
  enqueue(text('second'));
  await flush();
  expect(api).toHaveBeenCalledTimes(1); // "second" must not overtake "first"
  expect(items().map((i) => [i.state, i.attempts, i.error])).toEqual([
    ['waiting', 1, 'OFFLINE'],
    ['waiting', 0, null],
  ]);
  api.mockResolvedValue({});
  jest.advanceTimersByTime(2000);
  await flush();
  expect(api.mock.calls.map((c) => c[2].body)).toEqual(['first', 'first', 'second']);
  expect(items()).toHaveLength(0);
});

it('a refusal marks the item failed and the queue moves on; Retry sends it again', async () => {
  api.mockRejectedValueOnce(refused()).mockResolvedValue({});
  const id = enqueue(text('nope'));
  enqueue(text('fine'));
  await flush();
  expect(items()).toEqual([expect.objectContaining({ id, state: 'failed', error: 'FORBIDDEN' })]);
  retryItem(id);
  await flush();
  expect(items()).toHaveLength(0);
});

it('merges waiting updates to the same task into one request', async () => {
  api.mockRejectedValueOnce(offline()); // hold the queue
  enqueue(text('hold'));
  await flush();
  enqueue({ kind: 'task', taskId: 't1', projectId: 'p1', taskName: 'Order supplies', changes: { percent: 25 } });
  enqueue({ kind: 'task', taskId: 't1', projectId: 'p1', taskName: 'Order supplies', changes: { percent: 50, status: 'in_progress' } });
  expect(items().filter((i) => i.kind === 'task')).toEqual([expect.objectContaining({ changes: { percent: 50, status: 'in_progress' } })]);
});

it('uploads each photo once, even when the message itself has to be retried', async () => {
  api.mockImplementation(async (_m: string, path: string) => {
    if (path === '/uploads') return { uploadId: 'up1', url: 'http://server/files/up1' };
    throw offline();
  });
  enqueue({ ...text('photo'), type: 'image', photos: [{ attachmentId: 'a1', uri: 'file:///p.jpg' }] });
  await flush();
  api.mockResolvedValue({});
  jest.advanceTimersByTime(2000);
  await flush();
  expect(api.mock.calls.filter((c) => c[1] === '/uploads')).toHaveLength(1);
  const sent = api.mock.calls.at(-1)?.[2];
  expect(sent.data.attachments).toEqual([{ id: 'a1', kind: 'image', uri: 'http://server/files/up1', uploadId: 'up1' }]);
  expect(api.mock.calls[0][3]).toEqual({ uri: 'kept://a1' }); // uploaded from the app's own copy
});

it('survives an app restart: saved per person, and "sending" items are tried again', async () => {
  const saved: OutboxItem[] = [
    { ...text('was sending'), id: 'm1', userId: 'u1', createdAt: '', state: 'sending', attempts: 0, nextAt: 0, error: null },
  ];
  await AsyncStorage.setItem(storageKey('u1'), JSON.stringify(saved));
  api.mockResolvedValue({});
  await loadOutbox('u1');
  await runOutbox();
  await flush();
  expect(api).toHaveBeenCalledWith('POST', '/channels/ch1/messages', expect.objectContaining({ id: 'm1' }));
  expect(JSON.parse((await AsyncStorage.getItem(storageKey('u1'))) ?? '[]')).toEqual([]);
});

it('a repeated server error stops blocking the queue after a few tries', async () => {
  const server = () => new AppError('server', 'INTERNAL_ERROR', 'boom', {}, 'r');
  api.mockImplementation(async (_m: string, _p: string, body: { body?: string }) => {
    if (body?.body === 'breaks the server') throw server();
    return {};
  });
  const bad = enqueue(text('breaks the server'));
  enqueue(text('behind it'));
  for (let n = 0; n < MAX_SERVER_ERRORS; n++) {
    await flush();
    jest.advanceTimersByTime(20000);
  }
  await flush();
  expect(items()).toEqual([expect.objectContaining({ id: bad, state: 'failed', error: 'INTERNAL_ERROR' })]);
  expect(api.mock.calls.some((c) => c[2]?.body === 'behind it')).toBe(true);
});

it('a photo that disappeared from the phone fails its message instead of blocking the queue', async () => {
  api.mockResolvedValue({});
  mockMissing.add('kept://gone');
  const id = enqueue({ ...text('with photo'), type: 'image', photos: [{ attachmentId: 'gone', uri: 'file:///cache/p.jpg' }] });
  enqueue(text('next'));
  await flush();
  expect(items()).toEqual([expect.objectContaining({ id, state: 'failed', error: 'DEPENDENCY_FAILED' })]);
  expect(api).toHaveBeenCalledWith('POST', '/channels/ch1/messages', expect.objectContaining({ body: 'next' }));
});
