import { Feather } from '@expo/vector-icons';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Skeleton, type IconName } from '@/components/basics';
import { appScreen, OfflineBanner, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { markActivityRead, useActivity } from '@/features/activity/hooks';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Activity, ActivityKind } from '@/types/models';
import { useRefresh } from '@/features/shared';

const ICON: Record<ActivityKind, IconName> = {
  mention: 'at-sign',
  thread_reply: 'message-square',
  task_assigned: 'user-check',
  task_changes: 'calendar',
  checkin_result: 'activity',
  escalation: 'bell',
};

function open(a: Activity): void {
  if ((a.kind === 'mention' || a.kind === 'thread_reply') && a.messageId) {
    if (a.kind === 'thread_reply') router.push(`/thread/${a.messageId}`);
    else if (a.channelId) router.push(`/channel/${a.channelId}`);
    return;
  }
  if (a.taskIds.length === 1) router.push(`/task/${a.taskIds[0]}`);
  else if (a.projectId) router.push(`/project/${a.projectId}`);
}

function ActivityScreen() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { items, loading, failed } = useActivity();
  const { refreshing, refresh } = useRefresh();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Items stay highlighted while you look at them and are marked read when you leave.
  useFocusEffect(
    useCallback(() => {
      return () => markActivityRead();
    }, []),
  );

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <T variant="title">{t('tabs.activity', 'Activity')}</T>
      </View>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        {loading ? (
          <Skeleton rows={6} />
        ) : failed ? (
          <EmptyState icon="cloud-off" title={t('activity.loadFailed', "Couldn't load activity")} hint={t('chat.loadFailedHint', 'They will appear when the connection is back.')} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="bell"
            title={t('activity.emptyTitle', 'All quiet')}
            hint={t('activity.emptyHint', 'Mentions, replies and task changes will show up here.')}
          />
        ) : (
          items.map((a) => {
            const unread = !a.read;
            const batched = a.lines.length > 1;
            const isOpen = !!expanded[a.id];
            return (
              <View key={a.id} style={{ borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: unread ? c.surface : 'transparent' }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => (batched ? setExpanded((e) => ({ ...e, [a.id]: !e[a.id] })) : open(a))}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, paddingVertical: space.md, paddingRight: space.lg, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                  {/* Accent left rule marks unread items. */}
                  <View style={{ width: 3, backgroundColor: unread ? c.accent : 'transparent', borderRadius: 2 }} />
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      marginLeft: space.sm,
                      backgroundColor: a.kind === 'escalation' ? c.warningSoft : c.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Feather name={ICON[a.kind]} size={17} color={a.kind === 'escalation' ? c.warning : c.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T variant={unread ? 'bodyStrong' : 'body'}>{a.text}</T>
                    {!batched && a.lines[0] ? (
                      <T variant="meta" color="textMuted" numberOfLines={2}>
                        {a.lines[0]}
                      </T>
                    ) : null}
                    <T variant="meta" color="textFaint">
                      {t('activity.ago', '{{time}} ago', { time: formatDistanceToNowStrict(parseISO(a.createdAt)) })}
                    </T>
                  </View>
                  {batched ? <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} style={{ marginTop: 2 }} /> : null}
                </Pressable>
                {batched && isOpen ? (
                  <View style={{ paddingLeft: 3 + space.sm + 36 + space.md, paddingRight: space.lg, paddingBottom: space.md, gap: 4 }}>
                    {a.lines.map((line, i) => (
                      <T key={i} variant="meta" color="textMuted">
                        • {line}
                      </T>
                    ))}
                    <Pressable onPress={() => open(a)} hitSlop={8} style={{ paddingTop: space.sm }}>
                      <T variant="metaStrong" color="accent">
                        {t('activity.openProject', 'Open the schedule')}
                      </T>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

export default appScreen(ActivityScreen);
