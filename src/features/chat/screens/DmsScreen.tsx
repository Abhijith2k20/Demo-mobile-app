// DMs tab: every direct message, most recent first, with a preview of the last message.
import { Feather } from '@expo/vector-icons';
import { format, isThisWeek, isToday, isYesterday, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { NewMessageSheet } from '@/features/chat/components/NewMessageSheet';
import { useDmList, type DmRow } from '@/features/home/hooks';
import { useMe, useRefresh } from '@/features/shared';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Message } from '@/types/models';

function when(iso: string, yesterday: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return yesterday;
  return isThisWeek(d) ? format(d, 'EEE') : format(d, 'd MMM');
}

function DmsScreen() {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const { rows, loading } = useDmList();
  const { refreshing, refresh } = useRefresh();
  const [query, setQuery] = useState('');
  const [compose, setCompose] = useState(false);

  /** One line that says what the last message was, whatever its type. */
  const preview = (m: Message | null): string => {
    if (!m) return t('dms.noMessages', 'No messages yet');
    const body = (() => {
      switch (m.type) {
        case 'text':
          if (m.data?.kind === 'morning_summary') return t('dms.previewSummary', 'Your tasks for today');
          if (m.data?.kind === 'checkin_intro') return t('dms.previewIntro', 'Please update your open tasks');
          if (m.data?.kind === 'no_open_tasks') return t('bot.noTasks', 'You have no open tasks at the moment.');
          return m.body ?? '';
        case 'image':
          return m.body || t('dms.previewPhoto', 'Photo');
        case 'voice':
          return t('chat.voiceNote', 'Voice note');
        case 'file':
          return String(m.data?.name ?? t('plus.file', 'File'));
        case 'checkin':
          return t('dms.previewCheckin', 'Check-in: tap to update a task');
        case 'task_card':
          return t('task.card', 'Task');
        case 'issue_card':
          return t('issue.card', 'Issue');
        case 'daily_report':
          return t('report.card', 'Daily report');
        default:
          return m.body ?? '';
      }
    })();
    return m.senderId === me.id ? `${t('checkin.you', 'You')}: ${body}` : body;
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.peer?.name ?? 'siteline bot').toLowerCase().includes(q));
  }, [rows, query]);

  const row = (r: DmRow) => {
    const name = r.peer?.name ?? 'Siteline Bot';
    const strong = r.unread > 0;
    return (
      <Pressable
        key={r.channel.id}
        accessibilityRole="button"
        accessibilityLabel={`${name}${strong ? `, ${r.unread} unread` : ''}`}
        onPress={() => router.push(r.peer ? `/dm/${r.peer.id}` : '/dm/bot')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          minHeight: 68,
          backgroundColor: pressed ? c.surfaceAlt : 'transparent',
        })}>
        <View>
          <Avatar id={r.peer?.id ?? 'bot'} name={name} size={44} bot={!r.peer} />
          {r.peer ? (
            <View
              style={{
                position: 'absolute',
                right: -3,
                bottom: -3,
                width: 13,
                height: 13,
                borderRadius: 7,
                borderWidth: 2,
                borderColor: c.bg,
                backgroundColor: r.peer.online ? c.success : c.textFaint,
              }}
            />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {name}
            </T>
            {r.last ? (
              <T variant="meta" color={strong ? 'accent' : 'textFaint'}>
                {when(r.last.createdAt, t('common.yesterday', 'Yesterday'))}
              </T>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <T variant="meta" color={strong ? 'text' : 'textMuted'} numberOfLines={1} style={{ flex: 1 }}>
              {preview(r.last)}
            </T>
            <Badge count={r.unread} />
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={{ backgroundColor: c.surface, paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: c.border, gap: space.md }}>
        <T variant="title">{t('dms.title', 'Direct messages')}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceAlt, borderRadius: radius.input, paddingHorizontal: space.md, minHeight: 40, gap: space.sm }}>
          <Feather name="search" size={16} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('dms.search', 'Find a conversation')}
            placeholderTextColor={c.textFaint}
            accessibilityLabel={t('dms.search', 'Find a conversation')}
            style={[type.body, { flex: 1, color: c.text, paddingVertical: 8 }]}
          />
          {query ? (
            <Pressable hitSlop={10} onPress={() => setQuery('')} accessibilityLabel={t('common.clear', 'Clear')}>
              <Feather name="x" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <OfflineBanner />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: space.sm, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="message-circle"
            title={query ? t('home.noResults', 'Nothing matches') : t('dms.emptyTitle', 'No direct messages yet')}
            hint={query ? undefined : t('dms.emptyHint', 'Message someone on your team to get started.')}
          />
        ) : (
          shown.map(row)
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.newMessage', 'New message')}
        onPress={() => setCompose(true)}
        style={({ pressed }) => ({
          position: 'absolute',
          right: space.lg,
          bottom: space.lg,
          width: 56,
          height: 56,
          borderRadius: radius.card + 4,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          shadowColor: c.shadow,
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 5,
        })}>
        <Feather name="edit" size={22} color={c.onAccent} />
      </Pressable>
      <NewMessageSheet visible={compose} onClose={() => setCompose(false)} />
    </Screen>
  );
}

export default appScreen(DmsScreen);
