// Actions on outbox items: retry, edit, discard.
import { eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '@/lib/db/client';
import { checkins, messages, outbox, tasks } from '@/lib/db/schema';
import { kick } from '@/lib/outbox/enqueue';
import { retryItems } from '@/lib/outbox/runner';
import { readPayload } from '@/lib/outbox/types';
import { catchUp } from '@/lib/sync/catchup';
import type { ID, OutboxItem } from '@/types/models';

/** An item plus everything tied to it: its uploads, and items that wait on it. */
function family(tx: Tx | typeof db, item: OutboxItem): OutboxItem[] {
  const all = tx.select().from(outbox).all();
  const out = new Map<ID, OutboxItem>([[item.id, item]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const other of all) {
      if (out.has(other.id)) continue;
      const dependsOnFamily = !!other.dependsOn && out.has(other.dependsOn);
      const familyDependsOnIt = [...out.values()].some((f) => f.dependsOn === other.id);
      if (dependsOnFamily || familyDependsOnIt) {
        out.set(other.id, other);
        grew = true;
      }
    }
  }
  return [...out.values()];
}

/** Puts the local change back (it was rolled back when the item failed) and sends again. */
export function retryItem(item: OutboxItem): void {
  const group = family(db, item).filter((i) => i.status === 'failed');
  db.transaction((tx) => {
    for (const i of group) {
      if (i.kind === 'send_message') {
        tx.update(messages).set({ status: 'pending' }).where(eq(messages.id, i.entityId)).run();
      } else if (i.kind === 'update_task') {
        const p = readPayload<'update_task'>(i);
        tx.update(tasks).set(p.local).where(eq(tasks.id, p.taskId)).run();
      } else if (i.kind === 'checkin_answer') {
        const p = readPayload<'checkin_answer'>(i);
        tx.update(checkins).set({ answer: p.answer }).where(eq(checkins.id, p.checkinId)).run();
        tx.update(tasks).set(p.local).where(eq(tasks.id, p.taskId)).run();
      } else if (i.kind === 'edit_message') {
        const p = readPayload<'edit_message'>(i);
        if (p.body !== undefined) tx.update(messages).set({ body: p.body }).where(eq(messages.id, p.messageId)).run();
      } else if (i.kind === 'project_stage') {
        // The stage shows the server's value until the retry succeeds.
      }
    }
  });
  retryItems(group.map((i) => i.id));
}

/** Gives up on a change. An unsent message disappears; other changes were already rolled back. */
export function discardItem(item: OutboxItem): void {
  const group = family(db, item);
  db.transaction((tx) => {
    for (const i of group) {
      if (i.kind === 'send_message') tx.delete(messages).where(eq(messages.id, i.entityId)).run();
    }
    tx.delete(outbox)
      .where(
        inArray(
          outbox.id,
          group.filter((i) => i.status !== 'sending').map((i) => i.id),
        ),
      )
      .run();
  });
  kick();
  if (item.kind !== 'send_message' && item.kind !== 'upload_file') void catchUp();
}

/** Changes the text of a message that failed to send, then tries again. */
export function editFailedMessage(item: OutboxItem, body: string): void {
  const p = readPayload<'send_message'>(item);
  p.message.body = body;
  db.transaction((tx) => {
    tx.update(outbox).set({ payload: JSON.stringify(p) }).where(eq(outbox.id, item.id)).run();
    tx.update(messages).set({ body }).where(eq(messages.id, p.message.id)).run();
  });
  retryItem(item);
}

export function findMessageItem(messageId: ID): OutboxItem | null {
  return (
    db
      .select()
      .from(outbox)
      .where(eq(outbox.entityId, messageId))
      .all()
      .find((i) => i.kind === 'send_message') ?? null
  );
}

export function clearFailed(): void {
  const failed = db.select().from(outbox).where(eq(outbox.status, 'failed')).all();
  for (const item of failed) {
    if (db.select().from(outbox).where(eq(outbox.id, item.id)).get()) discardItem(item);
  }
}
