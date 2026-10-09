import { Feather } from '@expo/vector-icons';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Chip, Divider, EmptyState, IconButton, Row, Skeleton } from '@/components/basics';
import { appScreen } from '@/components/chrome';
import { DateField } from '@/components/form';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { firstName, shortProjectName, useChannels, useMe, useProject, useProjectAccess, useUsers } from '@/features/shared';
import { confirmTask, updateTask } from '@/features/tasks/api';
import { statusColor, useStatusLabel, VarianceChip } from '@/features/tasks/components/bits';
import { useProjectMembers, useTask, useTaskHistory } from '@/features/tasks/hooks';
import { PERCENT_STEPS, shortDate } from '@/shared/taskRules';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Task, TaskHistory, TaskStatus, User } from '@/types/models';

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done'];

/** Progress slider that snaps to 0/25/50/75/90/100 and saves when the finger lifts. */
function PercentSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const snap = (x: number) => {
    const raw = Math.max(0, Math.min(100, (x / Math.max(1, width)) * 100));
    return PERCENT_STEPS.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 0);
  };
  const commit = (x: number) => {
    const v = snap(x);
    setDrag(null);
    if (v !== value) onCommit(v);
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(4)
    .onStart((e) => setDrag(snap(e.x)))
    .onUpdate((e) => setDrag(snap(e.x)))
    .onEnd((e) => commit(e.x))
    .onFinalize(() => setDrag(null));
  // A plain tap on the track jumps straight to the nearest stop.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => commit(e.x));
  const gesture = Gesture.Exclusive(pan, tap);
  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityValue={{ min: 0, max: 100, now: shown }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: 44, justifyContent: 'center' }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt }} />
          <View style={{ position: 'absolute', left: 0, width: `${shown}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
          {PERCENT_STEPS.map((s) => (
            <View
              key={s}
              style={{ position: 'absolute', left: `${s}%`, marginLeft: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: s <= shown ? c.onAccent : c.textFaint, opacity: 0.8 }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              left: `${shown}%`,
              marginLeft: -13,
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: c.surface,
              borderWidth: 2,
              borderColor: c.accent,
            }}
          />
        </View>
      </GestureDetector>
      <View style={{ height: 18 }}>
        {PERCENT_STEPS.map((s) => (
          <T
            key={s}
            variant="meta"
            color={s === shown ? 'accent' : 'textFaint'}
            style={{ position: 'absolute', left: `${s}%`, width: 36, marginLeft: s === 0 ? 0 : s === 100 ? -36 : -18, textAlign: s === 0 ? 'left' : s === 100 ? 'right' : 'center' }}>
            {s}
          </T>
        ))}
      </View>
    </View>
  );
}

function describeHistory(h: TaskHistory, users: Map<ID, User>, statusLabel: (s: TaskStatus) => string): string {
  const who = firstName(users.get(h.userId)?.name) || 'Someone';
  const d = (v: string | null) => (v ? shortDate(v) : '—');
  switch (h.field) {
    case 'created':
      return `${who} created the task`;
    case 'plannedStart':
      return `${who} changed start ${d(h.from)} → ${d(h.to)}`;
    case 'plannedFinish':
      return `${who} changed finish ${d(h.from)} → ${d(h.to)}`;
    case 'percent':
      return `${who} set progress to ${h.to}%`;
    case 'status':
      return `${who} set status to ${statusLabel((h.to ?? 'not_started') as TaskStatus)}`;
    case 'ownerId':
      return h.to ? `${who} assigned this to ${firstName(users.get(h.to)?.name) || 'someone'}` : `${who} removed the owner`;
    case 'name':
      return `${who} renamed the task`;
    case 'phase':
      return `${who} moved it to ${h.to}`;
    default:
      return `${who} updated ${h.field}`;
  }
}

function ReadOnly({ label, value, icon }: { label: string; value: string; icon?: 'lock' }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
      <T variant="meta" color="textMuted" style={{ width: 120 }}>
        {label}
      </T>
      {icon ? <Feather name={icon} size={13} color={c.textFaint} style={{ marginRight: 6 }} /> : null}
      <T variant="body" style={{ flex: 1 }}>
        {value}
      </T>
    </View>
  );
}

function TaskDetail({ taskId: id }: { taskId: string }) {
  const { c, type } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const users = useUsers();
  const channels = useChannels();
  const statusLabel = useStatusLabel();
  const { task, loading } = useTask(id);
  const project = useProject(task?.projectId);
  const access = useProjectAccess(task?.projectId);
  const members = useProjectMembers(task?.projectId);
  const history = useTaskHistory(id);
  // null = not editing: show the saved name.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [ownerSheet, setOwnerSheet] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const isManager = access.isManager;
  // Members update progress on their own tasks only.
  const canProgress = !!task && (isManager || (task.ownerId === me.id && access.can('task.update_own')));
  const owner = task?.ownerId ? users.byId.get(task.ownerId) : undefined;
  const channel = task?.channelId ? channels.byId.get(task.channelId) : undefined;
  const save = (t: Task, input: Parameters<typeof updateTask>[1]) => updateTask(t, input, isManager);
  const range = (a: string | null, b: string | null) => (a && b ? `${shortDate(a)} – ${shortDate(b)}` : a ? `${shortDate(a)} – …` : 'Not yet');

  return (
    <View style={{ flex: 1, backgroundColor: c.scrim }}>
      <Pressable accessibilityLabel="Close" onPress={close} style={{ height: insets.top + space.xl }} />
      <View
        style={{
          flex: 1,
          backgroundColor: c.surface,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          overflow: 'hidden',
          shadowColor: c.shadow,
          shadowOpacity: 0.2,
          shadowRadius: 16,
          elevation: 12,
        }}>
        <View style={{ alignItems: 'center', paddingTop: space.sm }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs }}>
          <T variant="meta" color="textMuted" style={{ flex: 1 }} numberOfLines={1}>
            {project ? `${shortProjectName(project.name)} › ${task?.phase ?? ''}` : ' '}
          </T>
          <IconButton icon="x" label="Close" onPress={close} />
        </View>

        {loading ? (
          <Skeleton rows={6} avatar={false} />
        ) : !task ? (
          <EmptyState icon="check-square" title="This task is no longer available." />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}>
            {isManager ? (
              <TextInput
                value={nameDraft ?? task.name}
                onChangeText={setNameDraft}
                onBlur={() => {
                  const next = (nameDraft ?? task.name).trim();
                  if (next && next !== task.name) save(task, { name: next });
                  setNameDraft(null);
                }}
                multiline
                accessibilityLabel="Task name"
                style={[type.title, { color: c.text, paddingVertical: 4 }]}
              />
            ) : (
              <T variant="title">{task.name}</T>
            )}

            {task.status === 'done_pending_confirmation' ? (
              <View style={{ backgroundColor: c.warningSoft, borderRadius: radius.input, padding: space.md, marginTop: space.md, gap: space.sm }}>
                <T variant="meta">
                  {owner ? `${firstName(owner.name)} marked this done.` : 'Marked done.'} It is waiting for a manager to confirm.
                </T>
                {access.can('task.confirm') ? <Button small full={false} icon="check" label="Confirm done" onPress={() => confirmTask(task)} /> : null}
              </View>
            ) : null}

            <T variant="label" color="textMuted" style={{ marginTop: space.lg, marginBottom: space.sm }}>
              Status
            </T>
            {canProgress ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {STATUSES.map((s) => (
                  <Chip
                    key={s}
                    label={statusLabel(s)}
                    selected={task.status === s || (s === 'done' && task.status === 'done_pending_confirmation')}
                    onPress={() => save(task, { status: s })}
                  />
                ))}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(c, task.status) }} />
                <T variant="body">{statusLabel(task.status)}</T>
              </View>
            )}

            <T variant="label" color="textMuted" style={{ marginTop: space.lg, marginBottom: space.xs }}>
              Progress · {task.percent}%
            </T>
            {canProgress ? (
              <PercentSlider value={task.percent} onCommit={(v) => save(task, { percent: v })} />
            ) : (
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: 'hidden', marginTop: space.xs }}>
                <View style={{ width: `${task.percent}%`, height: 6, backgroundColor: c.accent }} />
              </View>
            )}

            <T variant="label" color="textMuted" style={{ marginTop: space.lg, marginBottom: space.xs }}>
              Owner
            </T>
            <Pressable
              disabled={!isManager}
              onPress={() => setOwnerSheet(true)}
              accessibilityRole={isManager ? 'button' : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
              {owner ? <Avatar id={owner.id} name={owner.name} size={28} /> : <Feather name="user" size={20} color={c.textFaint} />}
              <T variant="body" color={owner ? 'text' : 'textMuted'} style={{ flex: 1 }}>
                {owner?.name ?? 'Unassigned'}
              </T>
              {isManager ? <Feather name="chevron-right" size={18} color={c.textFaint} /> : null}
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.lg, marginBottom: space.xs }}>
              <T variant="label" color="textMuted" style={{ flex: 1 }}>
                Dates
              </T>
              {isManager ? <VarianceChip task={task} /> : null}
            </View>
            {isManager ? (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <T variant="meta" color="textMuted" style={{ width: 108 }}>
                    Planned start
                  </T>
                  <View style={{ flex: 1 }}>
                    <DateField
                      value={task.plannedStart}
                      onChange={(d) => save(task, d > task.plannedFinish ? { plannedStart: d, plannedFinish: d } : { plannedStart: d })}
                    />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <T variant="meta" color="textMuted" style={{ width: 108 }}>
                    Planned finish
                  </T>
                  <View style={{ flex: 1 }}>
                    <DateField value={task.plannedFinish} min={task.plannedStart} onChange={(d) => save(task, { plannedFinish: d })} />
                  </View>
                </View>
                <ReadOnly label="Baseline" icon="lock" value={task.baselineStart ? range(task.baselineStart, task.baselineFinish) : 'Not set'} />
                <ReadOnly label="Actual" value={range(task.actualStart, task.actualFinish)} />
              </View>
            ) : (
              <View>
                <ReadOnly label="Planned" value={range(task.plannedStart, task.plannedFinish)} />
                <ReadOnly label="Actual" value={range(task.actualStart, task.actualFinish)} />
              </View>
            )}

            {task.description ? (
              <>
                <T variant="label" color="textMuted" style={{ marginTop: space.lg, marginBottom: space.xs }}>
                  Description
                </T>
                <T variant="body">{task.description}</T>
              </>
            ) : null}

            {channel ? (
              <Button
                kind="secondary"
                icon="message-circle"
                label={`Discuss in #${channel.name}`}
                style={{ marginTop: space.xl }}
                onPress={() => router.push(`/channel/${channel.id}`)}
              />
            ) : null}

            <T variant="label" color="textMuted" style={{ marginTop: space.xl, marginBottom: space.sm }}>
              History
            </T>
            {history.length === 0 ? (
              <T variant="meta" color="textMuted">
                No changes yet.
              </T>
            ) : (
              history.map((h, i) => (
                <View key={h.id} style={{ flexDirection: 'row', gap: space.md }}>
                  <View style={{ alignItems: 'center', width: 12 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: h.via === 'checkin' ? c.accent : c.textFaint }} />
                    {i < history.length - 1 ? <View style={{ flex: 1, width: 1, backgroundColor: c.border }} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: space.md }}>
                    <T variant="body">{describeHistory(h, users.byId, statusLabel)}</T>
                    <T variant="meta" color="textMuted">
                      {formatDistanceToNowStrict(parseISO(h.createdAt))} ago{h.via === 'checkin' ? ' · via check-in' : ''}
                    </T>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>

      <Sheet visible={ownerSheet} onClose={() => setOwnerSheet(false)} title="Owner" subtitle="People on this project" full>
        <View style={{ marginHorizontal: -space.lg }}>
          <Row
            left={<Feather name="user-x" size={20} color={c.textMuted} />}
            title="Unassigned"
            height={52}
            onPress={() => {
              if (task) save(task, { ownerId: null });
              setOwnerSheet(false);
            }}
          />
          <Divider inset={space.lg} />
          {members.map(({ user, member }) => (
            <Row
              key={user.id}
              left={<Avatar id={user.id} name={user.name} size={32} />}
              title={user.name}
              subtitle={member.jobTitle}
              height={56}
              right={task?.ownerId === user.id ? <Feather name="check" size={18} color={c.accent} /> : undefined}
              onPress={() => {
                if (task) save(task, { ownerId: user.id });
                setOwnerSheet(false);
              }}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

export default appScreen(TaskDetail);
