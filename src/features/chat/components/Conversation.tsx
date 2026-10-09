import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';
import { Avatar, Button, Divider, EmptyState, IconButton, Row, Skeleton } from '@/components/basics';
import { Header, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import type { ID, Message } from '@/types/models';
import { BotProgress } from '../../bot/BotProgress';
import { CheckinQueueProvider } from '../../bot/queue';
import { leaveChannel } from '../../projects/api';
import { StageBanner } from '../../projects/components/StageBanner';
import { firstName, useMe, useProject, useProjectAccess, useUnsentCount, useUsers } from '../../shared';
import { ChatContext, type ChatContextValue } from '../context';
import { useChannelInfo, useChannelMessages, usePinned, type ListItem } from '../hooks';
import { Composer, ReadOnlyBar, type FormKind } from './Composer';
import { DailyReportSheet, IssueSheet, NewTaskSheet } from './forms';
import { MessageMenu } from './MessageMenu';
import { DayDivider, MessageRow, NewDivider } from './MessageRow';

function renderItem({ item }: { item: ListItem }) {
  if (item.kind === 'day') return <DayDivider label={item.label} />;
  if (item.kind === 'new') return <NewDivider />;
  // Cards with their own state must not be recycled into another message.
  return <MessageRow key={item.message.type === 'checkin' ? item.key : undefined} item={item} />;
}

export function Conversation({ channelId }: { channelId: ID }) {
  const { t } = useTranslation();
  const me = useMe();
  const users = useUsers();
  const info = useChannelInfo(channelId);
  const project = useProject(info.channel?.projectId);
  const access = useProjectAccess(info.channel?.projectId);
  const { items, loading, loadOlder, loadingOlder } = useChannelMessages(channelId);
  const unsent = useUnsentCount();
  const pinned = usePinned(channelId);
  const [menu, setMenu] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [form, setForm] = useState<FormKind | null>(null);
  const [taskName, setTaskName] = useState<string | undefined>(undefined);
  const [details, setDetails] = useState(false);
  const listRef = useRef<FlashListRef<ListItem>>(null);

  const onOpenThread = useCallback((m: Message) => router.push(`/thread/${m.id}`), []);
  const ctx = useMemo<ChatContextValue>(
    () => ({
      me,
      users: users.byId,
      jobTitles: info.jobTitles,
      mentionNames: new Set(info.members.map((u) => firstName(u.name).toLowerCase())),
      inThread: false,
      isBotChat: info.isBot,
      onLongPress: setMenu,
      onOpenThread,
    }),
    [me, users.byId, info.jobTitles, info.members, info.isBot, onOpenThread],
  );

  // The bot conversation shows one open check-in at a time.
  const Queue = info.isBot ? CheckinQueueProvider : Fragment;
  const projectId = info.channel?.projectId ?? null;
  const canCreateTask = !!projectId && access.can('task.create');
  const placeholder = info.channel?.kind === 'dm' ? t('chat.messagePerson', 'Message {{name}}', { name: firstName(info.peer?.name) }) : t('chat.messageChannel', 'Message {{name}}', { name: info.title });

  return (
    <ChatContext.Provider value={ctx}>
      <Queue>
      <Screen>
        <Header
          title={info.title}
          subtitle={info.subtitle}
          onTitlePress={project ? () => router.push(`/project/${project.id}`) : undefined}
          right={
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="search" label={t('common.search', 'Search')} onPress={() => toast(t('chat.searchStub', 'Search is not part of this demo.'))} />
              <IconButton icon="info" label={t('channel.details', 'Details')} onPress={() => setDetails(true)} />
            </View>
          }
        />
        <OfflineBanner waiting={unsent.waiting} />
        {project && info.channel?.kind === 'project' ? <StageBanner project={project} /> : null}
        {info.isBot ? <BotProgress /> : null}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={{ flex: 1 }}>
            {loading || info.loading ? (
              <Skeleton rows={7} />
            ) : !info.channel ? (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <EmptyState
                  icon="lock"
                  title={t('chat.noAccessTitle', "This channel isn't available")}
                  hint={t('chat.noAccessHint', 'You may no longer have access to it.')}
                />
              </View>
            ) : items.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <EmptyState
                  icon="message-circle"
                  title={t('chat.emptyTitle', 'No messages yet.')}
                  hint={t('chat.emptyHint', 'Share an update or a photo from site.')}
                />
              </View>
            ) : (
              <FlashList
                ref={listRef}
                onLoad={() => listRef.current?.scrollToEnd({ animated: false })}
                data={items}
                renderItem={renderItem}
                keyExtractor={(i) => i.key}
                getItemType={(i) => (i.kind === 'message' ? i.message.type : i.kind)}
                maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.25 }}
                onStartReached={() => void loadOlder()}
                onStartReachedThreshold={0.3}
                ListHeaderComponent={loadingOlder ? <Skeleton rows={2} /> : null}
                contentContainerStyle={{ paddingBottom: space.md }}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
          {info.canPost && !access.archived ? (
            <Composer
              channelId={channelId}
              projectId={projectId}
              canCreateTask={canCreateTask}
              members={info.members}
              placeholder={placeholder}
              editing={editing}
              onDoneEditing={() => setEditing(null)}
              onOpenForm={(kind) => {
                setTaskName(undefined);
                setForm(kind);
              }}
            />
          ) : info.channel ? (
            <ReadOnlyBar
              text={
                info.isBot
                  ? t('chat.botReadOnly', 'Tap a button on a card to answer.')
                  : access.archived
                    ? t('chat.archived', 'This project is archived. It is read-only.')
                    : t('chat.readOnly', 'Only admins can post here.')
              }
            />
          ) : null}
        </KeyboardAvoidingView>

        <MessageMenu
          message={menu}
          me={me}
          access={access}
          canCreateTask={canCreateTask}
          onClose={() => setMenu(null)}
          onEdit={setEditing}
          onCreateTask={(m) => {
            setTaskName((m.body ?? '').slice(0, 80));
            setForm('task');
          }}
        />
        {projectId ? (
          <>
            <NewTaskSheet visible={form === 'task'} onClose={() => setForm(null)} projectId={projectId} channelId={channelId} initialName={taskName} />
            <IssueSheet visible={form === 'issue'} onClose={() => setForm(null)} projectId={projectId} channelId={channelId} />
            <DailyReportSheet visible={form === 'report'} onClose={() => setForm(null)} projectId={projectId} channelId={channelId} />
          </>
        ) : null}

        <Sheet visible={details} onClose={() => setDetails(false)} title={info.title} subtitle={info.subtitle} full>
          {pinned.length > 0 ? (
            <View style={{ marginBottom: space.lg }}>
              <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
                {t('channel.pinned', 'Pinned')}
              </T>
              {pinned.map((m) => (
                <View key={m.id} style={{ paddingVertical: space.sm }}>
                  <T variant="metaStrong">{users.byId.get(m.senderId)?.name}</T>
                  <T variant="body" numberOfLines={3}>
                    {m.body ?? t('channel.pinnedCard', 'Card')}
                  </T>
                </View>
              ))}
              <Divider />
            </View>
          ) : null}
          {info.channel?.kind === 'project' && project ? (
            <View style={{ marginBottom: space.lg, gap: space.sm }}>
              {access.can('channel.manage') ? (
                <Button
                  kind="secondary"
                  icon="settings"
                  label={t('channel.settings', 'Channel settings')}
                  onPress={() => {
                    setDetails(false);
                    router.push(`/project/${project.id}/settings?channel=${channelId}`);
                  }}
                />
              ) : null}
              {!access.can('channel.manage') && !access.archived && info.channel.name !== 'general' && access.role ? (
                <Button
                  kind="secondary"
                  icon="log-out"
                  label={t('channel.leave', 'Leave channel')}
                  onPress={() => {
                    const ch = info.channel;
                    setDetails(false);
                    if (router.canGoBack()) router.back();
                    if (ch) leaveChannel(ch);
                  }}
                />
              ) : null}
              <T variant="meta" color="textMuted">
                {info.channel.isPrivate
                  ? t('channel.privateHint', 'Private: only the people listed here can see this channel.')
                  : t('channel.publicHint', 'Public: anyone on the project can find and join this channel.')}
              </T>
            </View>
          ) : null}
          <T variant="label" color="textMuted" style={{ marginBottom: space.xs }}>
            {t('channel.membersTitle', 'Members')}
          </T>
          <View style={{ marginHorizontal: -space.lg }}>
            {info.members.map((u) => (
              <Row
                key={u.id}
                left={<Avatar id={u.id} name={u.name} size={32} />}
                title={u.name}
                subtitle={info.jobTitles.get(u.id) ?? undefined}
                height={52}
              />
            ))}
          </View>
        </Sheet>
      </Screen>
      </Queue>
    </ChatContext.Provider>
  );
}
