import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Divider } from '@/components/basics';
import { Sheet, SheetAction } from '@/components/Sheet';
import { T } from '@/components/T';
import { DELETE_WINDOW_MS, EDIT_WINDOW_MS } from '@/shared/permissions';
import { useNow } from '@/lib/useNow';
import { toast } from '@/stores/ui';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message, User } from '@/types/models';
import type { ProjectAccess } from '../../shared';
import { discardItem, findMessageItem, retryItem } from '../../unsent/api';
import { deleteMessage, setPinned, toggleReaction } from '../api';

const QUICK = ['👍', '🙏', '✅', '👀', '🎉', '❗'];

interface Props {
  message: Message | null;
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
  const [last, setLast] = useState<Message | null>(null);
  if (message && message !== last) setLast(message);
  const m = message ?? last;
  const now = useNow();
  const own = m?.senderId === me.id;
  const age = m ? now - Date.parse(m.createdAt) : 0;
  const failed = m?.status === 'failed';
  const sent = m?.status === 'sent';
  const canEdit = !!m && own && m.type === 'text' && age < EDIT_WINDOW_MS;
  const canDelete = !!m && ((own && age < DELETE_WINDOW_MS) || access.can('message.delete_any'));
  const canPin = !!m && sent && access.can('message.pin');
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Sheet visible={!!message} onClose={onClose}>
      {m ? (
        <View>
          {failed ? (
            <>
              <T variant="meta" color="danger" style={{ marginBottom: space.sm }}>
                {t('chat.failedHint', "Couldn't send. Tap for options.")}
              </T>
              <SheetAction
                icon="refresh-cw"
                label={t('unsent.retry', 'Retry')}
                onPress={act(() => {
                  const item = findMessageItem(m.id);
                  if (item) retryItem(item);
                })}
              />
              <SheetAction
                icon="trash-2"
                danger
                label={t('unsent.discard', 'Discard')}
                onPress={act(() => {
                  const item = findMessageItem(m.id);
                  if (item) discardItem(item);
                  else deleteMessage(m);
                })}
              />
              <SheetAction icon="inbox" label={t('unsent.open', 'See all unsent items')} onPress={act(() => router.push('/unsent'))} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md }}>
                {QUICK.map((emoji) => (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat.reactWith', 'React with {{emoji}}', { emoji })}
                    onPress={act(() => toggleReaction(m, emoji))}
                    style={{
                      width: touch.worker,
                      height: touch.worker,
                      borderRadius: radius.card,
                      backgroundColor: c.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
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
          )}
        </View>
      ) : null}
    </Sheet>
  );
}
