import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { Composer, ReadOnlyBar } from '@/features/chat/components/Composer';
import { MessageMenu } from '@/features/chat/components/MessageMenu';
import { MessageRow } from '@/features/chat/components/MessageRow';
import { ChatContext, type ChatContextValue } from '@/features/chat/context';
import { useChannelInfo, useThread } from '@/features/chat/hooks';
import { firstName, useMe, useProjectAccess, useUnsentCount, useUsers } from '@/features/shared';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message } from '@/types/models';

function ThreadScreen({ messageId }: { messageId: string }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const me = useMe();
  const users = useUsers();
  const { parent, replies, loading } = useThread(messageId);
  const info = useChannelInfo(parent?.channelId ?? '');
  const access = useProjectAccess(info.channel?.projectId);
  const unsent = useUnsentCount();
  const [menu, setMenu] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const noop = useCallback(() => {}, []);

  const ctx = useMemo<ChatContextValue>(
    () => ({
      me,
      users: users.byId,
      jobTitles: info.jobTitles,
      mentionNames: new Set(info.members.map((u) => firstName(u.name).toLowerCase())),
      inThread: true,
      isBotChat: false,
      onLongPress: setMenu,
      onOpenThread: noop,
    }),
    [me, users.byId, info.jobTitles, info.members, noop],
  );

  const live = replies.filter((r) => !r.deletedAt).length;

  return (
    <ChatContext.Provider value={ctx}>
      <Screen>
        <Header title={t('thread.title', 'Thread')} subtitle={info.title} />
        <OfflineBanner waiting={unsent.waiting} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {loading ? (
            <Skeleton rows={4} />
          ) : !parent ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState icon="message-square" title={t('thread.missing', 'This message is no longer available.')} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
              <MessageRow item={{ kind: 'message', key: parent.id, message: parent, grouped: false, replies: 0, lastReplyAt: null }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }}>
                <T variant="label" color="textMuted">
                  {live === 1 ? t('chat.oneReply', '1 reply') : t('chat.replies', '{{count}} replies', { count: live })}
                </T>
                <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
              </View>
              {replies.map((r) => (
                <MessageRow key={r.id} item={{ kind: 'message', key: r.id, message: r, grouped: false, replies: 0, lastReplyAt: null }} />
              ))}
            </ScrollView>
          )}
          {parent && info.canPost ? (
            <Composer
              channelId={parent.channelId}
              threadParentId={parent.id}
              projectId={null}
              canCreateTask={false}
              members={info.members}
              placeholder={t('thread.reply', 'Reply…')}
              alsoSendLabel={info.channel?.kind === 'dm' ? undefined : t('thread.alsoSend', 'Also send to {{channel}}', { channel: info.title.replace('# ', '#') })}
              editing={editing}
              onDoneEditing={() => setEditing(null)}
              onOpenForm={noop}
            />
          ) : parent && info.channel ? (
            <ReadOnlyBar text={t('chat.readOnly', 'Only admins can post here.')} />
          ) : null}
        </KeyboardAvoidingView>
        <MessageMenu
          message={menu}
          me={me}
          access={access}
          canCreateTask={false}
          inThread
          onClose={() => setMenu(null)}
          onEdit={setEditing}
          onCreateTask={noop}
        />
      </Screen>
    </ChatContext.Provider>
  );
}

export default appScreen(ThreadScreen);
