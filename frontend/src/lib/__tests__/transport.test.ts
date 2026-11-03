// The live connection: an expired token is refreshed before reconnecting (not retried forever).
import { openEventStream } from '@/lib/api/transport';

class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onclose?: (e: { code: number }) => void;
  onmessage?: (m: { data: string }) => void;
  onerror?: () => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {}
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeSocket.all = [];
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});
afterEach(() => jest.useRealTimers());

it('gets a fresh token when the server refuses the old one, then reconnects with it', async () => {
  let token = 'old';
  const refreshed = jest.fn(async () => {
    token = 'new';
  });
  const close = openEventStream(() => token, jest.fn(), jest.fn(), refreshed);
  FakeSocket.all[0].onclose?.({ code: 4401 });
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(2000);
  expect(refreshed).toHaveBeenCalledTimes(1);
  expect(FakeSocket.all[1].url).toContain('token=new');
  close();
});

it('a dropped connection just reconnects, without a refresh', () => {
  const refreshed = jest.fn(async () => {});
  const close = openEventStream(() => 't', jest.fn(), jest.fn(), refreshed);
  FakeSocket.all[0].onclose?.({ code: 1006 });
  jest.advanceTimersByTime(2000);
  expect(refreshed).not.toHaveBeenCalled();
  expect(FakeSocket.all).toHaveLength(2);
  close();
});
