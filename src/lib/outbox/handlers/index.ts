import type { OutboxKind } from '@/types/models';
import type { Handler } from '../types';
import { createDm, deleteMessage, editMessage, markRead, sendMessage, setReaction, uploadFile } from './messages';
import { createProject, lockBaseline, memberAdd, memberRemove, memberUpdate, projectStage } from './projects';
import { checkinAnswer, createTask, updateTask } from './tasks';

export const handlers: { [K in OutboxKind]: Handler<K> } = {
  send_message: sendMessage,
  edit_message: editMessage,
  delete_message: deleteMessage,
  set_reaction: setReaction,
  mark_read: markRead,
  create_task: createTask,
  update_task: updateTask,
  checkin_answer: checkinAnswer,
  upload_file: uploadFile,
  project_stage: projectStage,
  lock_baseline: lockBaseline,
  member_add: memberAdd,
  member_update: memberUpdate,
  member_remove: memberRemove,
  create_dm: createDm,
  create_project: createProject,
};

/** Background housekeeping: if the server refuses these for good, just drop them. */
export const DROP_ON_FAILURE: OutboxKind[] = ['mark_read', 'set_reaction'];
