// Manager schedule: tasks grouped by phase, with swipe actions, quick add and baseline lock.
import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Chip, EmptyState, Pill, Skeleton } from '@/components/basics';
import { Field } from '@/components/form';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { rebaselineSchema } from '@/shared/schemas';
import { isDone, shortDate, taskVarianceDays } from '@/shared/taskRules';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { PHASES, type ID, type Project, type Task, type User } from '@/types/models';
import { useMe, useProjectAccess, useUsers, type ProjectAccess } from '../../shared';
import { confirmTask, createTask, lockBaseline, quickAddDefaults, shiftTask, updateTask } from '../api';
import { orderedPhases, useProjectTasks } from '../hooks';
import { MiniTimeline, StatusDot } from './bits';

// Width of a revealed swipe action; pulling half of it is enough to trigger.
const ACTION_WIDTH = 132;

type Filter = 'all' | 'mine' | 'delayed' | 'blocked' | 'done';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

type Item = { kind: 'phase'; key: string; phase: string; done: number; total: number } | { kind: 'task'; key: string; task: Task };

function dateRange(task: Task): string {
  const a = shortDate(task.plannedStart);
  const b = shortDate(task.plannedFinish);
  if (task.plannedStart === task.plannedFinish) return a;
  // "18–21 Oct" when both dates share a month.
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]}–${b}` : `${a}–${b}`;
}

interface RowProps {
  task: Task;
  owner: User | undefined;
  window: { from: string; to: string };
  canDone: boolean;
  canShift: boolean;
  onDone: (t: Task) => void;
  onShift: (t: Task) => void;
}

const TaskRow = memo(function TaskRow({ task, owner, window, canDone, canShift, onDone, onShift }: RowProps) {
  const { c } = useTheme();
  const ref = useRef<SwipeableMethods>(null);
  const late = (taskVarianceDays(task) ?? 0) > 0 && !isDone(task.status);
  const action = (label: string, icon: 'check' | 'calendar', bg: string, fg: string, align: 'flex-start' | 'flex-end') => (
    <View style={{ width: ACTION_WIDTH, backgroundColor: bg, justifyContent: 'center', alignItems: align, paddingHorizontal: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Feather name={icon} size={18} color={fg} />
        <T variant="metaStrong" style={{ color: fg }}>
          {label}
        </T>
      </View>
    </View>
  );
  const body = (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? c.surfaceAlt : c.bg,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm + 2,
        gap: 6,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <StatusDot status={task.status} />
        <T variant="body" numberOfLines={1} style={{ flex: 1, textDecorationLine: task.status === 'done' ? 'line-through' : 'none' }} color={task.status === 'done' ? 'textMuted' : 'text'}>
          {task.name}
        </T>
        {task.status === 'done_pending_confirmation' ? <Pill label="Confirm" bg={c.warningSoft} fg={c.warning} /> : null}
        {owner ? <Avatar id={owner.id} name={owner.name} size={20} /> : null}
        <T variant="metaStrong" color={task.percent === 100 ? 'success' : 'textMuted'} style={{ minWidth: 38, textAlign: 'right' }}>
          {task.percent}%
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: 18 }}>
        <T variant="meta" color={late ? 'danger' : 'textMuted'} style={{ width: 108 }} numberOfLines={1}>
          {dateRange(task)}
        </T>
        <View style={{ flex: 1 }}>
          <MiniTimeline task={task} from={window.from} to={window.to} />
        </View>
      </View>
    </Pressable>
  );
  if (!canDone && !canShift) return body;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.2}
      leftThreshold={ACTION_WIDTH / 2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={canDone && task.status !== 'done' ? () => action(task.status === 'done_pending_confirmation' ? 'Confirm done' : 'Mark done', 'check', c.successSoft, c.success, 'flex-start') : undefined}
      renderRightActions={canShift ? () => action('Shift dates', 'calendar', c.infoSoft, c.info, 'flex-end') : undefined}
      onSwipeableWillOpen={(direction) => {
        ref.current?.close();
        // Swiping right reveals the left action.
        if (direction === 'right') onDone(task);
        else onShift(task);
      }}>
      {body}
    </ReanimatedSwipeable>
  );
});

export function ScheduleList({ project, header }: { project: Project; header?: React.ReactNode }) {
  const { c, type } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const users = useUsers();
  const access = useProjectAccess(project.id);
  const { tasks, loading } = useProjectTasks(project.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [shift, setShift] = useState<Task | null>(null);
  const [quick, setQuick] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [phaseSheet, setPhaseSheet] = useState(false);
  const [rebaseline, setRebaseline] = useState(false);

  const phases = useMemo(() => orderedPhases(tasks), [tasks]);
  // Quick add targets the phase that is being worked on now, unless the user picked one.
  const activePhase = phase ?? tasks.find((t) => t.status === 'in_progress' || t.status === 'blocked')?.phase ?? phases.find((p) => tasks.some((t) => t.phase === p && !isDone(t.status))) ?? phases[0] ?? PHASES[0];

  const window = useMemo(() => {
    let to = project.plannedFinish;
    for (const t of tasks) {
      if (t.plannedFinish > to) to = t.plannedFinish;
      if (t.baselineFinish && t.baselineFinish > to) to = t.baselineFinish;
    }
    let from = project.startDate;
    for (const t of tasks) if (t.plannedStart < from) from = t.plannedStart;
    return { from, to };
  }, [tasks, project.plannedFinish, project.startDate]);

  const { items, sticky } = useMemo(() => {
    const match = (t: Task) =>
      filter === 'all' ||
      (filter === 'mine' && t.ownerId === me.id) ||
      (filter === 'delayed' && (taskVarianceDays(t) ?? 0) > 0 && !isDone(t.status)) ||
      (filter === 'blocked' && t.status === 'blocked') ||
      (filter === 'done' && isDone(t.status));
    const out: Item[] = [];
    const stickyIdx: number[] = [];
    for (const p of phases) {
      const all = tasks.filter((t) => t.phase === p);
      const shown = all.filter(match);
      if (shown.length === 0) continue;
      stickyIdx.push(out.length);
      out.push({ kind: 'phase', key: `phase-${p}`, phase: p, done: all.filter((t) => t.status === 'done').length, total: all.length });
      for (const t of shown) out.push({ kind: 'task', key: t.id, task: t });
    }
    return { items: out, sticky: stickyIdx };
  }, [tasks, phases, filter, me.id]);

  const onDone = (t: Task) => {
    if (t.status === 'done_pending_confirmation' && access.can('task.confirm')) confirmTask(t);
    else updateTask(t, { status: 'done' }, access.isManager);
  };

  const addQuick = () => {
    const name = quick.trim();
    if (!name) return;
    createTask({
      projectId: project.id,
      name,
      phase: activePhase,
      ownerId: null,
      description: null,
      channelId: null,
      ...quickAddDefaults(tasks, activePhase),
    });
    setQuick('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {header}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }} style={{ flex: 1 }}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ScrollView>
        <BaselineControl project={project} access={access} onRebaseline={() => setRebaseline(true)} />
      </View>

      <View style={{ flex: 1 }}>
        {loading ? (
          <Skeleton rows={7} avatar={false} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="check-square"
            title={tasks.length === 0 ? 'No tasks yet' : 'Nothing here'}
            hint={tasks.length === 0 ? 'Add the first task below to start the schedule.' : 'No tasks match this filter.'}
          />
        ) : (
          <FlashList
            data={items}
            keyExtractor={(i) => i.key}
            getItemType={(i) => i.kind}
            stickyHeaderIndices={sticky}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: space.lg }}
            renderItem={({ item }) =>
              item.kind === 'phase' ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: c.surfaceAlt,
                    paddingHorizontal: space.lg,
                    height: 32,
                    borderBottomWidth: 1,
                    borderBottomColor: c.border,
                  }}>
                  <T variant="label" color="textMuted" style={{ flex: 1 }}>
                    {item.phase}
                  </T>
                  <T variant="label" color={item.done === item.total ? 'success' : 'textMuted'}>
                    {item.done}/{item.total} done
                  </T>
                </View>
              ) : (
                <TaskRow
                  task={item.task}
                  owner={item.task.ownerId ? users.byId.get(item.task.ownerId) : undefined}
                  window={window}
                  canDone={access.isManager || (item.task.ownerId === me.id && access.can('task.update_own'))}
                  canShift={access.isManager}
                  onDone={onDone}
                  onShift={setShift}
                />
              )
            }
          />
        )}
      </View>

      {access.can('task.create') ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderTopColor: c.border,
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            // Inside the tab the tab bar sits below; on the project page we reach the screen edge.
            paddingBottom: header ? space.sm : Math.max(space.sm, insets.bottom),
          }}>
          <Pressable
            accessibilityLabel={`Phase: ${activePhase}. Change`}
            onPress={() => setPhaseSheet(true)}
            style={{ height: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, justifyContent: 'center', maxWidth: 120 }}>
            <T variant="metaStrong" color="textMuted" numberOfLines={1}>
              {activePhase}
            </T>
          </Pressable>
          <TextInput
            value={quick}
            onChangeText={setQuick}
            placeholder="Add a task…"
            placeholderTextColor={c.textFaint}
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={addQuick}
            accessibilityLabel="Add a task"
            style={[type.body, { flex: 1, color: c.text, minHeight: touch.min, paddingVertical: 8 }]}
          />
          {quick.trim() ? (
            <Pressable accessibilityLabel="Add task" onPress={addQuick} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={20} color={c.onAccent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Sheet visible={!!shift} onClose={() => setShift(null)} title="Shift dates" subtitle={shift ? `${shift.name} · ${dateRange(shift)}` : undefined}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[-1, 1, 3, 7].map((d) => (
            <View key={d} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <Button
                kind="secondary"
                label={`${d > 0 ? '+' : '−'}${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'}`}
                onPress={() => {
                  if (shift) shiftTask(shift, d, access.isManager);
                  setShift(null);
                }}
              />
            </View>
          ))}
        </View>
        <T variant="meta" color="textMuted" style={{ marginTop: space.md }}>
          Start and finish move together. The baseline stays where it is.
        </T>
      </Sheet>

      <Sheet visible={phaseSheet} onClose={() => setPhaseSheet(false)} title="Add new tasks to">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[...new Set([...phases, ...PHASES])].map((p) => (
            <Chip
              key={p}
              large
              label={p}
              selected={p === activePhase}
              onPress={() => {
                setPhase(p);
                setPhaseSheet(false);
              }}
            />
          ))}
        </View>
      </Sheet>

      <RebaselineSheet project={project} visible={rebaseline} onClose={() => setRebaseline(false)} />
    </KeyboardAvoidingView>
  );
}

/** Lock baseline (Managers) when it isn't locked; a lock icon + Re-baseline once it is. */
export function BaselineControl({ project, access, onRebaseline }: { project: Project; access: ProjectAccess; onRebaseline: () => void }) {
  const { c } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const canBaseline = access.can('task.baseline');
  if (!project.baselineLocked) {
    if (!canBaseline) return null;
    return (
      <>
        <Button small full={false} kind="secondary" icon="lock" label="Lock baseline" onPress={() => setConfirm(true)} />
        <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Lock baseline?">
          <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
            Today&apos;s planned dates become the baseline. Later date changes will show as variance against it.
          </T>
          <Button
            label="Lock baseline"
            icon="lock"
            onPress={() => {
              lockBaseline(project, null);
              setConfirm(false);
            }}
          />
        </Sheet>
      </>
    );
  }
  return (
    <Pressable
      disabled={!canBaseline}
      onPress={onRebaseline}
      accessibilityLabel={canBaseline ? 'Baseline locked. Re-baseline' : 'Baseline locked'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.sm }}>
      <Feather name="lock" size={14} color={c.textMuted} />
      {canBaseline ? (
        <T variant="metaStrong" color="accent">
          Re-baseline
        </T>
      ) : (
        <T variant="meta" color="textMuted">
          Baseline locked
        </T>
      )}
    </Pressable>
  );
}

function RebaselineSheet({ project, visible, onClose }: { project: Project; visible: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <Sheet visible={visible} onClose={onClose} title="Re-baseline the schedule">
      <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
        The current planned dates replace the old baseline and variance goes back to zero. The reason is logged in #general.
      </T>
      <Field label="Reason" error={error}>
        <SheetInput value={reason} onChangeText={setReason} placeholder="e.g. Client added the study room" />
      </Field>
      <Button
        label="Re-baseline"
        icon="refresh-cw"
        onPress={() => {
          const parsed = rebaselineSchema.safeParse({ reason });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message);
            return;
          }
          lockBaseline(project, parsed.data.reason);
          setReason('');
          setError(undefined);
          onClose();
        }}
      />
    </Sheet>
  );
}

export function ProjectSwitcher({ projects, current, onPick }: { projects: Project[]; current: Project; onPick: (id: ID) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project: ${current.name}. Change`}
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: touch.min }}>
        <T variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
          {current.name.split(' – ')[0]}
        </T>
        <Feather name="chevron-down" size={18} color={c.textMuted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch project">
        {projects.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => {
              onPick(p.id);
              setOpen(false);
            }}
            style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Feather name={p.id === current.id ? 'check-circle' : 'circle'} size={18} color={p.id === current.id ? c.accent : c.textFaint} />
            <T variant={p.id === current.id ? 'bodyStrong' : 'body'} style={{ flex: 1 }} numberOfLines={1}>
              {p.name}
            </T>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}
