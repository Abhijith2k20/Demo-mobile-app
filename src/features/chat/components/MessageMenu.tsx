import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Divider } from '@/components/basics';
import { Sheet, SheetAction } from '@/components/Sheet';
import { T } from '@/components/T';
import { discardItem, retryItem } from '@/lib/outbox';
import { toast } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message, MessageView, User } from '@/types/models';
import type { ProjectAccess } from '../../shared';
import { deleteMessage, setPinned, toggleReaction } from '../api';

const QUICK = ['👍', '🙏', '✅', '👀', '🎉', '❗'];

interface Props {
  message: MessageView | null;
  me: User;
  access: ProjectAccess;
  canCreateTask: boolean;
  inThread?: boolean;
  onClose: () => void;
  onEdit: (m: Message) => void;
  onCreateTask: (m: Message) => void;
}

/** Long-press menu. Controls the user may not use are hidden, not disabled. */
export function MessageMenu({ message, me, access, canCreateTask, inThread, onClose, onEdit, onCreateTask }: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  // Keep showing the last message while the sheet animates out.
  const [last, setLast] = useState<MessageView | null>(null);
  if (message && message !== last) setLast(message);
  const m = message ?? last;
  // The server decides what this viewer may do with each message.
  const canEdit = !!m?.canEdit;
  const canDelete = !!m?.canDelete;
  const canPin = !!m?.canPin;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Sheet visible={!!message} onClose={onClose}>
      {m && m.status !== 'sent' ? (
        // Still in the send queue: it can only be sent again or thrown away.
        <View>
          <T variant="meta" color={m.status === 'failed' ? 'danger' : 'textMuted'} style={{ marginBottom: space.sm }}>
            {m.status === 'failed' ? t('chat.notSentHint', "The server didn't accept this message.") : t('chat.sendingHint', 'Waiting for a connection to send.')}
          </T>
          {m.status === 'failed' ? <SheetAction icon="refresh-cw" label={t('unsent.retry', 'Retry')} onPress={act(() => retryItem(m.id))} /> : null}
          <SheetAction icon="trash-2" danger label={t('unsent.discard', 'Discard')} onPress={act(() => discardItem(m.id))} />
        </View>
      ) : m ? (
        <View>
          <>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: space.md,
              }}
            >
              {QUICK.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.reactWith', 'React with {{emoji}}', { emoji })}
                  onPress={act(() => toggleReaction(m, emoji))}
                  style={{
                    width: touch.large,
                    height: touch.large,
                    borderRadius: radius.card,
                    backgroundColor: c.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <T style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</T>
                </Pressable>
              ))}
            </View>
            <Divider />
            {!inThread && !m.threadParentId ? (
              <SheetAction
                icon="message-square"
                label={t('chat.replyInThread', 'Reply in thread')}
                onPress={act(() => router.push(`/thread/${m.id}`))}
              />
            ) : null}
            {m.body ? (
              <SheetAction
                icon="copy"
                label={t('chat.copy', 'Copy text')}
                onPress={act(() => {
                  void Clipboard.setStringAsync(m.body ?? '');
                  toast(t('chat.copied', 'Copied'), 'success');
                })}
              />
            ) : null}
            {canCreateTask && m.body ? (
              <SheetAction icon="check-square" label={t('chat.createTask', 'Create task from message')} onPress={act(() => onCreateTask(m))} />
            ) : null}
            {canEdit ? <SheetAction icon="edit-2" label={t('chat.edit', 'Edit')} onPress={act(() => onEdit(m))} /> : null}
            {canPin ? (
              <SheetAction
                icon="bookmark"
                label={m.data?.pinned ? t('chat.unpin', 'Unpin') : t('chat.pin', 'Pin')}
                onPress={act(() => setPinned(m, !m.data?.pinned))}
              />
            ) : null}
            {canDelete ? <SheetAction icon="trash-2" danger label={t('chat.delete', 'Delete')} onPress={act(() => deleteMessage(m))} /> : null}
          </>
        </View>
      ) : null}
    </Sheet>
  );
}
