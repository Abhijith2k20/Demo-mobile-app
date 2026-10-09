import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/lib/i18n';
import { readPayload } from '@/lib/outbox/types';
import type { ID, OutboxItem } from '@/types/models';
import { useChannels, useOutbox } from '../shared';

export interface UnsentRow {
  item: OutboxItem;
  title: string;
  reason: string;
  /** What "Edit" does for this item, if anything. */
  edit: { kind: 'message'; body: string } | { kind: 'task'; taskId: ID } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function useUnsentItems(): { failed: UnsentRow[]; stale: UnsentRow[]; waiting: number } {
  const items = useOutbox();
  const channels = useChannels();
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());

  return useMemo(() => {
    const where = (channelId: ID) => {
      const ch = channels.byId.get(channelId);
      return !ch ? t('unsent.aChat', 'a chat') : ch.kind === 'dm' || ch.kind === 'bot' ? t('unsent.aDm', 'a direct message') : `#${ch.name}`;
    };
    const short = (s: string | null | undefined) => {
      const text = (s ?? '').trim();
      return text.length > 28 ? `${text.slice(0, 28)}…` : text;
    };

    const describe = (item: OutboxItem): UnsentRow => {
      let title = t('unsent.change', 'A change');
      let edit: UnsentRow['edit'] = null;
      switch (item.kind) {
        case 'send_message': {
          const p = readPayload<'send_message'>(item);
          const place = where(p.channelId);
          const kind = p.message.type;
          if (kind === 'text') {
            title = t('unsent.message', "Message in {{place}}: '{{text}}'", { place, text: short(p.message.body) });
            edit = { kind: 'message', body: p.message.body ?? '' };
          } else if (kind === 'image') title = t('unsent.photo', 'Photo in {{place}}', { place });
          else if (kind === 'issue_card') title = t('unsent.issue', 'Issue report in {{place}}', { place });
          else if (kind === 'daily_report') title = t('unsent.report', 'Daily report in {{place}}', { place });
          else if (kind === 'task_card') title = t('unsent.taskCard', 'Task card in {{place}}', { place });
          else title = t('unsent.messageOther', 'Message in {{place}}', { place });
          break;
        }
        case 'upload_file':
          title = t('unsent.upload', 'Photo upload');
          break;
        case 'edit_message':
          title = t('unsent.edit', 'Edit to a message');
          break;
        case 'delete_message':
          title = t('unsent.delete', 'Deleting a message');
          break;
        case 'create_task': {
          const p = readPayload<'create_task'>(item);
          title = t('unsent.newTask', 'New task: {{name}}', { name: p.task.name });
          break;
        }
        case 'update_task': {
          const p = readPayload<'update_task'>(item);
          title = t('unsent.taskChange', 'Change to task: {{name}}', { name: p.name });
          edit = { kind: 'task', taskId: p.taskId };
          break;
        }
        case 'checkin_answer':
          title = t('unsent.checkin', 'Check-in answer');
          break;
        case 'project_stage':
          title = t('unsent.stage', 'Project stage change');
          break;
        case 'lock_baseline':
          title = t('unsent.baseline', 'Baseline lock');
          break;
        case 'member_add':
        case 'member_update':
        case 'member_remove':
          title = t('unsent.member', 'Member change');
          break;
        case 'create_dm':
          title = t('unsent.dm', 'New conversation');
          break;
        case 'create_project':
          title = t('unsent.project', 'New project');
          break;
        case 'update_project':
        case 'archive_project':
          title = t('unsent.projectDetails', 'Project details change');
          break;
        case 'delete_project':
          title = t('unsent.deleteProject', 'Deleting project: {{name}}', { name: readPayload<'delete_project'>(item).name });
          break;
        case 'create_channel':
          title = t('unsent.newChannel', 'New channel: #{{name}}', { name: readPayload<'create_channel'>(item).name });
          break;
        case 'update_channel':
        case 'delete_channel':
        case 'join_channel':
          title = t('unsent.channelChange', 'Channel change');
          break;
        default:
          break;
      }
      const reason = item.lastErrorCode ? errorText(item.lastErrorCode) : t('unsent.waitingReason', 'Waiting for a connection.');
      return { item, title, reason, edit };
    };

    const real = items.filter((i) => i.kind !== 'mark_read');
    return {
      failed: real.filter((i) => i.status === 'failed').map(describe),
      stale: real.filter((i) => i.status !== 'failed' && now - i.createdAt > DAY_MS).map(describe),
      waiting: real.filter((i) => i.status !== 'failed').length,
    };
  }, [items, channels.byId, t, now]);
}
