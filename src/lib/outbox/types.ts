import type { AppError } from '@/lib/api/client';
import type { MessageCreate, TaskCreate } from '@/shared/schemas';
import type { TaskChanges } from '@/shared/taskRules';
import type { CheckinAnswer, ID, JobTitle, OutboxItem, OutboxKind, ProjectRole, Stage } from '@/types/models';

export interface ProjectDetails {
  name: string;
  client: string;
  address: string;
}

export interface Payloads {
  send_message: { channelId: ID; message: MessageCreate };
  edit_message: { messageId: ID; body?: string; prevBody: string | null; pinned?: boolean };
  delete_message: { messageId: ID; prevBody: string | null; prevData: Record<string, unknown> | null };
  set_reaction: { messageId: ID; emoji: string; on: boolean };
  mark_read: { channelId: ID; upToMessageId: ID };
  create_task: { projectId: ID; task: TaskCreate };
  update_task: {
    taskId: ID;
    name: string;
    /** What the user changed: sent to the server as absolute values. */
    input: TaskChanges;
    /** What was applied locally (input + its consequences), re-applied after sync (rule 6). */
    local: TaskChanges;
    /** Values before the first unsent change, used to roll back on permanent failure. */
    prev: TaskChanges;
    confirm?: boolean;
  };
  checkin_answer: { checkinId: ID; taskId: ID; answer: CheckinAnswer; local: TaskChanges; prev: TaskChanges };
  upload_file: { clientId: ID; uri: string; messageId: ID; attachmentId: ID };
  project_stage: { projectId: ID; stage: Stage; prevStage: Stage };
  lock_baseline: { projectId: ID; reason: string | null };
  member_add: { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; channelIds: ID[] };
  member_update: { projectId: ID; userId: ID; role?: ProjectRole; jobTitle?: JobTitle; channelIds?: ID[] };
  member_remove: { projectId: ID; userId: ID };
  create_dm: { channelId: ID; userId: ID };
  create_project: { id: ID; name: string; client: string; address: string };
  update_project: { projectId: ID; changes: ProjectDetails; prev: ProjectDetails };
  create_channel: { projectId: ID; id: ID; name: string; isPrivate: boolean; memberIds: ID[] };
  update_channel: { projectId: ID; channelId: ID; name?: string; isPrivate?: boolean; memberIds?: ID[] };
  delete_channel: { projectId: ID; channelId: ID };
  join_channel: { channelId: ID; on: boolean };
  archive_project: { projectId: ID; archived: boolean };
  delete_project: { projectId: ID; name: string };
}

export interface Handler<K extends OutboxKind> {
  /** Sends the change. May return a function that applies the server's reply locally. */
  send: (payload: Payloads[K], item: OutboxItem) => Promise<(() => void) | void>;
  /** Roll back or flag the local change when the server says no for good. */
  onPermanentFailure?: (payload: Payloads[K], item: OutboxItem, error: AppError) => void;
}

export function readPayload<K extends OutboxKind>(item: OutboxItem): Payloads[K] {
  return JSON.parse(item.payload) as Payloads[K];
}
