// The worker's task home: big rows, three big buttons, no baseline or variance.
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Chip, EmptyState, SectionHeader, Skeleton, type IconName } from '@/components/basics';
import { OfflineBanner } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { ISSUE_PRESETS } from '@/shared/schemas';
import { shortDate, todayIso } from '@/shared/taskRules';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Task } from '@/types/models';
import { sendMessage } from '../../chat/api';
import { useRefresh } from '../../home/hooks';
import { firstName, shortProjectName, useMe, useProjects, useUnsentCount } from '../../shared';
import { updateTask } from '../api';
import { useMyTasks } from '../hooks';
import { StatusDot, useStatusLabel } from './bits';

function BigAction({ icon, label, onPress, tone, active }: { icon: IconName; label: string; onPress: () => void; tone: 'plain' | 'danger'; active?: boolean }) {
  const { c, type } = useTheme();
  const fg = tone === 'danger' ? c.danger : active ? c.success : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: touch.worker + 8,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: active ? c.success : tone === 'danger' ? c.dangerSoft : c.border,
        backgroundColor: pressed ? c.surfaceAlt : active ? c.successSoft : tone === 'danger' ? c.dangerSoft : c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        paddingVertical: 6,
        gap: 2,
      })}>
      <Feather name={icon} size={20} color={fg} />
      <T style={[type.metaStrong, { color: fg, textAlign: 'center' }]} numberOfLines={2}>
        {label}
      </T>
    </Pressable>
  );
}

export function MyTasks() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const my = useMyTasks();
  const projects = useProjects();
  const unsent = useUnsentCount();
  const statusLabel = useStatusLabel();
  const { refreshing, refresh } = useRefresh();
  const [percentFor, setPercentFor] = useState<Task | null>(null);
  const [problemFor, setProblemFor] = useState<Task | null>(null);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('my.morning', 'Good morning, {{name}}', { name: firstName(me.name) }) : hour < 17 ? t('my.afternoon', 'Good afternoon, {{name}}', { name: firstName(me.name) }) : t('my.evening', 'Good evening, {{name}}', { name: firstName(me.name) });
  const projectName = (task: Task) => shortProjectName(projects.byId.get(task.projectId)?.name ?? '');
  const today = todayIso();

  const reportProblem = (task: Task, reason: string) => {
    // Members may set their own task to blocked; the issue card tells the team why.
    updateTask(task, { status: 'blocked' }, false);
    if (task.channelId) {
      sendMessage({
        channelId: task.channelId,
        type: 'issue_card',
        body: null,
        data: { what: reason, note: null, urgency: 'normal', taskId: task.id, taskName: task.name, date: today },
      });
    }
  };

  const smallRow = (task: Task) => (
    <Pressable
      key={task.id}
      onPress={() => router.push(`/task/${task.id}`)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56 }}>
      <StatusDot status={task.status} size={12} />
      <View style={{ flex: 1 }}>
        <T variant="body" numberOfLines={1}>
          {task.name}
        </T>
        <T variant="meta" color="textMuted" numberOfLines={1}>
          {projectName(task)} · {shortDate(task.plannedStart)} – {shortDate(task.plannedFinish)}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={c.textFaint} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <T variant="title">{greeting}</T>
        <T variant="meta" color="textMuted">
          {format(new Date(), 'EEEE, d MMMM')}
        </T>
      </View>
      <OfflineBanner waiting={unsent.waiting} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}>
        <SectionHeader title={t('my.today', 'Today')} />
        {my.loading ? (
          <Skeleton rows={3} avatar={false} />
        ) : my.today.length === 0 ? (
          <EmptyState icon="sun" title={t('my.emptyTitle', 'Nothing due today.')} hint={t('my.emptyHint', 'Enjoy the calm.')} />
        ) : (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            {my.today.map((task) => {
              const overdue = task.plannedFinish < today;
              return (
                <Card key={task.id}>
                  <Pressable onPress={() => router.push(`/task/${task.id}`)} accessibilityRole="button">
                    <T variant="heading">{task.name}</T>
                    <T variant="meta" color="textMuted">
                      {projectName(task)} ·{' '}
                      <T variant="meta" color={overdue ? 'danger' : 'textMuted'}>
                        {t('checkin.due', 'due {{date}}', { date: format(new Date(`${task.plannedFinish}T00:00:00`), 'EEE d MMM') })}
                      </T>
                    </T>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
                      <StatusDot status={task.status} />
                      <T variant="metaStrong">{statusLabel(task.status)}</T>
                      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
                        <View style={{ width: `${task.percent}%`, height: 6, backgroundColor: task.status === 'blocked' ? c.danger : c.accent }} />
                      </View>
                      <T variant="metaStrong" color="textMuted">
                        {task.percent}%
                      </T>
                    </View>
                  </Pressable>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                    <BigAction
                      icon="play"
                      tone="plain"
                      active={task.status === 'in_progress'}
                      label={task.status === 'in_progress' ? t('my.startedDone', 'Started') : t('my.started', 'Started')}
                      onPress={() => updateTask(task, { status: 'in_progress' }, false)}
                    />
                    <BigAction icon="trending-up" tone="plain" label={t('my.updatePercent', 'Update %')} onPress={() => setPercentFor(task)} />
                    <BigAction icon="alert-octagon" tone="danger" label={t('my.problem', 'Problem')} onPress={() => setProblemFor(task)} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {my.week.length > 0 ? (
          <>
            <SectionHeader title={t('my.week', 'This week')} />
            {my.week.map(smallRow)}
          </>
        ) : null}
        {my.done.length > 0 ? (
          <>
            <SectionHeader title={t('my.doneRecently', 'Done recently')} />
            {my.done.map(smallRow)}
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={!!percentFor} onClose={() => setPercentFor(null)} title={t('checkin.howMuch', 'How much is done?')} subtitle={percentFor?.name}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[25, 50, 75, 90, 100].map((p) => (
            <Chip
              key={p}
              large
              selected={percentFor?.percent === p}
              label={p === 100 ? `✅ ${t('checkin.done', 'Done')}` : `${p}%`}
              onPress={() => {
                if (percentFor) updateTask(percentFor, { percent: p }, false);
                setPercentFor(null);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={!!problemFor} onClose={() => setProblemFor(null)} title={t('checkin.whatProblem', "What's the problem?")} subtitle={problemFor?.name}>
        <View style={{ gap: space.sm }}>
          {ISSUE_PRESETS.map((reason) => (
            <Pressable
              key={reason}
              accessibilityRole="button"
              onPress={() => {
                if (problemFor) reportProblem(problemFor, reason);
                setProblemFor(null);
              }}
              style={{ minHeight: touch.worker + 4, borderRadius: radius.input, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
              <T variant="button">{t(`issue.preset.${reason}`, reason)}</T>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}
