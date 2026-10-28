// The project Overview tab: stage, key dates, progress, channels and recent updates.
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, Card, Row, StagePill } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { BrowseChannels } from '@/features/projects/components/BrowseChannels';
import { useDelayText } from '@/features/projects/components/StageBanner';
import { useProjectChannels, useRecentUpdates } from '@/features/projects/hooks';
import { firstName, useProjectAccess, useStages, useUnreadCounts, useUsers } from '@/features/shared';
import { moveStage } from '@/features/tasks/api';
import { ProgressRing } from '@/features/tasks/components/TaskIndicators';
import { stageColors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { useLargeText, useTheme } from '@/theme/useTheme';
import type { CheckinAnswer, ID, ProjectView } from '@/types/models';

const day = (iso: string | null) => (iso ? format(parseISO(iso), 'd MMM yyyy') : '—');

function StageStepper({ project }: { project: ProjectView }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const stages = useStages();
  const current = stages.index(project.stage);
  const count = stages.list.length;
  const label = t('project.stageOf', 'Stage {{n}} of {{total}} · {{stage}}', { n: current + 1, total: count, stage: stages.label(project.stage) });
  // Every stage's name can't fit across a phone at a readable size, so the dots carry position and one line names the stage.
  return (
    <View accessible accessibilityLabel={label} style={{ gap: space.sm }}>
    <View style={{ flexDirection: 'row' }}>
      {stages.list.map((s, i) => {
        const tone = stageColors(c, i);
        const done = i < current;
        const on = i === current;
        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : i <= current ? c.textMuted : c.border }} />
              <View
                style={{
                  width: on ? 22 : 14,
                  height: on ? 22 : 14,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? tone.fg : done ? c.textMuted : c.surface,
                  borderWidth: on || done ? 0 : 2,
                  borderColor: c.border,
                }}>
                {done ? <Feather name="check" size={9} color={c.surface} /> : null}
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === count - 1 ? 'transparent' : i < current ? c.textMuted : c.border }} />
            </View>
          </View>
        );
      })}
    </View>
      <T variant="metaStrong" style={{ color: stageColors(c, current).fg, textAlign: 'center' }}>
        {label}
      </T>
    </View>
  );
}

function DateRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' | 'textMuted' }) {
  const large = useLargeText();
  return (
    <View style={{ flexDirection: large ? 'column' : 'row', minHeight: 30, alignItems: large ? 'flex-start' : 'center', paddingVertical: large ? 2 : 0 }}>
      <T variant="meta" color="textMuted" style={{ flex: 1 }}>
        {label}
      </T>
      <T variant="metaStrong" color={tone ?? 'text'}>
        {value}
      </T>
    </View>
  );
}

export function ProjectOverview({ project }: { project: ProjectView }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const stages = useStages();
  const stageLabel = stages.label;
  const access = useProjectAccess(project.id);
  const users = useUsers();
  const channels = useProjectChannels(project.id);
  const unread = useUnreadCounts();
  const updates = useRecentUpdates(project.id);
  const delay = useDelayText()(project);
  const large = useLargeText();
  const [confirm, setConfirm] = useState(false);
  const [browse, setBrowse] = useState(false);
  const next = project.nextStage; // the server knows the company's stage order

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <View>
        <T variant="title">{project.name}</T>
        <T variant="meta" color="textMuted">
          {project.client}
        </T>
        <T variant="meta" color="textMuted">
          {project.address}
        </T>
      </View>

      <Card>
        <StageStepper project={project} />
        {access.can('project.stage') && next ? (
          <Button small kind="secondary" icon="arrow-right" label={`Move to ${stageLabel(next)}`} style={{ marginTop: space.md }} onPress={() => setConfirm(true)} />
        ) : null}
      </Card>

      <View style={{ flexDirection: large ? 'column' : 'row', gap: space.md }}>
        <Card style={{ flex: large ? undefined : 1 }}>
          <T variant="label" color="textMuted" style={{ marginBottom: 4 }}>
            Key dates
          </T>
          <DateRow label="Start" value={day(project.startDate)} />
          <DateRow label="Planned finish" value={day(project.plannedFinish)} />
          <DateRow label="Baseline finish" value={project.baselineLocked ? day(project.baselineFinish) : 'Not locked'} />
          <DateRow label="Against baseline" value={delay.text.replace(' baseline', '').replace(' of', '')} tone={delay.tone} />
        </Card>
        <Card style={{ alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg }}>
          <ProgressRing percent={project.progress.percent} />
          <T variant="meta" color="textMuted" style={{ textAlign: 'center' }}>
            {project.progress.done}/{project.progress.total} tasks
          </T>
        </Card>
      </View>

      <View>
        <T variant="label" color="textMuted" style={{ marginBottom: space.xs }}>
          Channels
        </T>
        <Card style={{ padding: 0 }}>
          {channels.map((ch, i) => (
            <View key={ch.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
              <Row
                left={ch.isPrivate ? <Feather name="lock" size={15} color={c.textMuted} /> : <T color="textMuted">#</T>}
                title={ch.name}
                strong={(unread.get(ch.id) ?? 0) > 0}
                right={
                  (unread.get(ch.id) ?? 0) > 0 ? (
                    <Badge count={unread.get(ch.id) ?? 0} />
                  ) : (
                    <Feather name="chevron-right" size={18} color={c.textFaint} />
                  )
                }
                onPress={() => router.push(`/channel/${ch.id}`)}
              />
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <Row
              left={<Feather name="compass" size={15} color={c.textMuted} />}
              title="Browse channels"
              muted
              right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
              onPress={() => setBrowse(true)}
            />
          </View>
          {access.canArchive || access.isAdmin || access.can('channel.manage') ? (
            <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              <Row
                left={<Feather name="settings" size={15} color={c.textMuted} />}
                title="Project settings"
                muted
                right={<Feather name="chevron-right" size={18} color={c.textFaint} />}
                onPress={() => router.push(`/project/${project.id}/settings`)}
              />
            </View>
          ) : null}
        </Card>
      </View>
      <BrowseChannels projectId={project.id} visible={browse} onClose={() => setBrowse(false)} />
      {access.canArchive || access.isAdmin || access.can('channel.manage') ? (
        <T variant="meta" color="textFaint" style={{ marginTop: -space.sm }}>
          Project settings: edit details, add or delete channels, make them private, manage members, archive or delete the project.
        </T>
      ) : null}

      <View>
        <T variant="label" color="textMuted" style={{ marginBottom: space.xs }}>
          Recent updates
        </T>
        {updates.length === 0 ? (
          <Card>
            <T variant="meta" color="textMuted">
              Check-in results from the team will show up here.
            </T>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {updates.map((m, i) => {
              const d = m.data ?? {};
              const who = users.byId.get(d.userId as ID);
              const a = d.answer as CheckinAnswer | undefined;
              const what =
                d.kind === 'escalation'
                  ? 'no update yet'
                  : a?.kind === 'progress'
                    ? `${a.percent}%`
                    : a?.kind === 'problem'
                      ? `Problem${a.reason ? ` · ${a.reason}` : ''}`
                      : a?.kind === 'done'
                        ? 'Done'
                        : a?.kind === 'not_started'
                          ? 'Not started'
                          : 'Started';
              return (
                <Pressable
                  key={m.id}
                  onPress={() => d.taskId && router.push(`/task/${String(d.taskId)}`)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                  {who ? <Avatar id={who.id} name={who.name} size={28} /> : null}
                  <View style={{ flex: 1 }}>
                    <T variant="body" numberOfLines={2}>
                      <T variant="bodyStrong">{firstName(who?.name)}</T> · {String(d.taskName ?? '')} → <T variant="bodyStrong">{what}</T>
                      {d.hasPhoto ? ' · photo attached' : ''}
                    </T>
                    <T variant="meta" color="textMuted">
                      {format(parseISO(m.createdAt), 'EEE d MMM, h:mm a')}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title={next ? `Move to ${stageLabel(next)}?` : ''}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
          <StagePill index={stages.index(project.stage)} label={stageLabel(project.stage)} />
          <Feather name="arrow-right" size={16} color={c.textMuted} />
          {next ? <StagePill index={stages.index(next)} label={stageLabel(next)} /> : null}
        </View>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          Everyone on the project will see the new stage, and a note is posted in #general.
        </T>
        <Button
          label={next ? `Move to ${stageLabel(next)}` : 'Move'}
          onPress={() => {
            if (next) moveStage(project, next);
            setConfirm(false);
          }}
        />
      </Sheet>
    </ScrollView>
  );
}
