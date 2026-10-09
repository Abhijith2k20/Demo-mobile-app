import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Banner, Button, Card, EmptyState, IconButton, Row, Segmented, Skeleton, StagePill } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { PhotoTile } from '@/components/PhotoGrid';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { useUnreadCounts } from '@/features/home/hooks';
import { MembersManager } from '@/features/members/MembersManager';
import { BrowseChannels } from '@/features/projects/components/BrowseChannels';
import { useDelayText } from '@/features/projects/components/StageBanner';
import { useProjectChannels, useProjectFiles, useRecentUpdates } from '@/features/projects/hooks';
import { firstName, useProject, useProjectAccess, useStageLabel, useUnsentCount, useUsers } from '@/features/shared';
import { moveStage } from '@/features/tasks/api';
import { ProgressRing } from '@/features/tasks/components/bits';
import { ScheduleList } from '@/features/tasks/components/ScheduleList';
import { useProjectTasks } from '@/features/tasks/hooks';
import { stageColors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { STAGES, type CheckinAnswer, type ID, type Project } from '@/types/models';

type Tab = 'overview' | 'tasks' | 'members' | 'files';
const day = (iso: string | null) => (iso ? format(parseISO(iso), 'd MMM yyyy') : '—');

function StageStepper({ project }: { project: Project }) {
  const { c } = useTheme();
  const stageLabel = useStageLabel();
  const current = STAGES.indexOf(project.stage);
  return (
    <View style={{ flexDirection: 'row' }}>
      {STAGES.map((s, i) => {
        const tone = stageColors(c, s);
        const done = i < current;
        const on = i === current;
        return (
          <View key={s} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
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
              <View style={{ flex: 1, height: 2, backgroundColor: i === STAGES.length - 1 ? 'transparent' : i < current ? c.textMuted : c.border }} />
            </View>
            <T variant="meta" style={{ fontSize: 10, lineHeight: 13, color: on ? tone.fg : c.textMuted, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.1}>
              {stageLabel(s)}
            </T>
          </View>
        );
      })}
    </View>
  );
}

function DateRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' | 'textMuted' }) {
  return (
    <View style={{ flexDirection: 'row', minHeight: 30, alignItems: 'center' }}>
      <T variant="meta" color="textMuted" style={{ flex: 1 }}>
        {label}
      </T>
      <T variant="metaStrong" color={tone ?? 'text'}>
        {value}
      </T>
    </View>
  );
}

function Overview({ project }: { project: Project }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const stageLabel = useStageLabel();
  const access = useProjectAccess(project.id);
  const users = useUsers();
  const { tasks } = useProjectTasks(project.id);
  const channels = useProjectChannels(project.id);
  const unread = useUnreadCounts();
  const updates = useRecentUpdates(project.id);
  const delay = useDelayText()(project);
  const [confirm, setConfirm] = useState(false);
  const [browse, setBrowse] = useState(false);
  const next = STAGES[STAGES.indexOf(project.stage) + 1];
  const percent = useMemo(() => (tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 0), [tasks]);

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

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Card style={{ flex: 1 }}>
          <T variant="label" color="textMuted" style={{ marginBottom: 4 }}>
            Key dates
          </T>
          <DateRow label="Start" value={day(project.startDate)} />
          <DateRow label="Planned finish" value={day(project.plannedFinish)} />
          <DateRow label="Baseline finish" value={project.baselineLocked ? day(project.baselineFinish) : 'Not locked'} />
          <DateRow label="Against baseline" value={delay.text.replace(' baseline', '').replace(' of', '')} tone={delay.tone} />
        </Card>
        <Card style={{ alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg }}>
          <ProgressRing percent={percent} />
          <T variant="meta" color="textMuted" style={{ textAlign: 'center' }}>
            {tasks.filter((t) => t.status === 'done').length}/{tasks.length} tasks
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
                    <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                      <T variant="label" style={{ color: c.onAccent, letterSpacing: 0 }}>
                        {unread.get(ch.id)}
                      </T>
                    </View>
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
              Check-in results from the site team will show up here.
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
          <StagePill stage={project.stage} label={stageLabel(project.stage)} />
          <Feather name="arrow-right" size={16} color={c.textMuted} />
          {next ? <StagePill stage={next} label={stageLabel(next)} /> : null}
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

function Files({ projectId }: { projectId: ID }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { files, loading } = useProjectFiles(projectId);
  if (loading) return <Skeleton rows={4} avatar={false} />;
  if (files.length === 0) return <EmptyState icon="image" title="No files yet" hint="Photos and files shared in this project's channels appear here." />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }}>
        {files.map((f) => (
          <View key={f.key} style={{ width: '33.333%', padding: 3 }}>
            {f.kind === 'photo' && f.photo ? (
              <View style={{ flexDirection: 'row' }}>
                <PhotoTile photo={f.photo} />
              </View>
            ) : (
              <View style={{ aspectRatio: 1, borderRadius: radius.input, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 }}>
                <Feather name="file-text" size={22} color={c.danger} />
                <T variant="meta" numberOfLines={2} style={{ textAlign: 'center', fontSize: 11, lineHeight: 14 }}>
                  {f.name}
                </T>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ProjectScreen({ projectId: id }: { projectId: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const project = useProject(id);
  const access = useProjectAccess(id);
  const canManage = access.canArchive || access.isAdmin || access.can('channel.manage') || access.can('project.members');
  const unsent = useUnsentCount();
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <Screen>
      <Header
        title={project ? project.name.split(' – ')[0] : 'Project'}
        subtitle={project?.name.split(' – ')[1]}
        right={
          project && canManage ? (
            <IconButton icon="settings" label="Project settings" onPress={() => router.push(`/project/${project.id}/settings`)} />
          ) : undefined
        }
      />
      <OfflineBanner waiting={unsent.waiting} />
      {project?.archivedAt ? <Banner icon="archive" text="This project is archived. It is read-only." /> : null}
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'tasks', label: 'Tasks' },
            { value: 'members', label: 'Members' },
            { value: 'files', label: 'Files' },
          ]}
        />
      </View>
      {!project ? (
        <EmptyState icon="folder" title="This project isn't available" hint="You may no longer have access to it." />
      ) : tab === 'overview' ? (
        <Overview project={project} />
      ) : tab === 'tasks' ? (
        <ScheduleList project={project} />
      ) : tab === 'members' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
          <MembersManager projectId={project.id} />
        </ScrollView>
      ) : (
        <Files projectId={project.id} />
      )}
    </Screen>
  );
}

export default appScreen(ProjectScreen);
