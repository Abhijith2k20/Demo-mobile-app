import type { OutboxItem } from '@/types/models';
import { lanes, pickNext } from '../lanes';

let n = 0;
function item(over: Partial<OutboxItem>): OutboxItem {
  n += 1;
  return {
    id: `item-${n}`,
    kind: 'send_message',
    lane: lanes.channel('a'),
    entityId: `e-${n}`,
    payload: '{}',
    dependsOn: null,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastErrorCode: null,
    createdAt: n,
    ...over,
  };
}

describe('pickNext', () => {
  it('sends a lane strictly in order: only the oldest item of a lane is eligible', () => {
    const first = item({});
    const second = item({});
    expect(pickNext([first, second], 'main', 1000)?.id).toBe(first.id);
  });

  it('does not jump the queue while the head of the lane is still in flight', () => {
    const head = item({ status: 'sending' });
    const next = item({});
    expect(pickNext([head, next], 'main', 1000)).toBeNull();
  });

  it('does not jump the queue while the head of the lane is waiting to retry', () => {
    const head = item({ nextAttemptAt: 5000 });
    const next = item({});
    expect(pickNext([head, next], 'main', 1000)).toBeNull();
  });

  it('lets other lanes go ahead when one lane is blocked', () => {
    const blocked = item({ nextAttemptAt: 5000 });
    const other = item({ lane: lanes.channel('b') });
    expect(pickNext([blocked, other], 'main', 1000)?.id).toBe(other.id);
  });

  it('parks failed items without blocking their lane', () => {
    const failed = item({ status: 'failed' });
    const next = item({});
    expect(pickNext([failed, next], 'main', 1000)?.id).toBe(next.id);
  });

  it('holds a photo message until its upload has left the outbox', () => {
    const upload = item({ kind: 'upload_file', lane: lanes.upload });
    const message = item({ dependsOn: upload.id });
    expect(pickNext([upload, message], 'main', 1000)).toBeNull();
    expect(pickNext([message], 'main', 1000)?.id).toBe(message.id);
  });

  it('lets a text in another channel overtake a photo that is still uploading', () => {
    const upload = item({ kind: 'upload_file', lane: lanes.upload });
    const photo = item({ dependsOn: upload.id });
    const text = item({ lane: lanes.channel('b') });
    expect(pickNext([upload, photo, text], 'main', 1000)?.id).toBe(text.id);
  });

  it('gives uploads to the upload slot only', () => {
    const upload = item({ kind: 'upload_file', lane: lanes.upload });
    const text = item({});
    expect(pickNext([upload, text], 'upload', 1000)?.id).toBe(upload.id);
    expect(pickNext([upload, text], 'main', 1000)?.id).toBe(text.id);
  });

  it('returns nothing for an empty outbox', () => {
    expect(pickNext([], 'main', 1000)).toBeNull();
  });
});
