// Manager schedule: filters, tasks grouped by phase, quick add and the shift-dates sheet.
import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, EmptyState, Skeleton } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { isDone, todayIso } from '@/shared/taskRules';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { PHASES, type Project, type Task } from '@/types/models';
import { useMe, useProjectAccess, useUsers } from '../../shared';
import { confirmTask, createTask, quickAddDefaults, shiftTask, updateTask } from '../api';
import { matchesFilters, NO_FILTERS, type TaskFilters } from '../filters';
import { orderedPhases, useProjectMembers, useProjectTasks } from '../hooks';
import { ScheduleMenu } from './Baseline';
import { FilterSheet } from './FilterSheet';
import { ScheduleToolbar } from './ScheduleToolbar';
import { dateRange, TaskRow } from './TaskRow';

type Item = { kind: 'phase'; key: string; phase: string; done: number; total: number } | { kind: 'task'; key: string; task: Task };

export function ScheduleList({ project, header }: { project: Project; header?: React.ReactNode }) {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const users = useUsers();
  const access = useProjectAccess(project.id);
  const { tasks, loading } = useProjectTasks(project.id);
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS);
  const [filterSheet, setFilterSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const members = useProjectMembers(project.id);
  const [shift, setShift] = useState<Task | null>(null);
  const [quick, setQuick] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [phaseSheet, setPhaseSheet] = useState(false);

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

  const { items, sticky, shown } = useMemo(() => {
    const today = todayIso();
    const match = (t: Task) => matchesFilters(t, filters, me.id, today);
    let count = 0;
    const out: Item[] = [];
    const stickyIdx: number[] = [];
    for (const p of phases) {
      const all = tasks.filter((t) => t.phase === p);
      const shown = all.filter(match);
      if (shown.length === 0) continue;
      stickyIdx.push(out.length);
      out.push({ kind: 'phase', key: `phase-${p}`, phase: p, done: all.filter((t) => t.status === 'done').length, total: all.length });
      for (const t of shown) out.push({ kind: 'task', key: t.id, task: t });
      count += shown.length;
    }
    return { items: out, sticky: stickyIdx, shown: count };
  }, [tasks, phases, filters, me.id]);

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
      <ScheduleToolbar
        filters={filters}
        onChange={setFilters}
        shown={shown}
        total={tasks.length}
        onOpenFilters={() => setFilterSheet(true)}
        onOpenMenu={access.can('task.baseline') ? () => setMenu(true) : undefined}
      />

      <View style={{ flex: 1 }}>
        {loading ? (
          <Skeleton rows={7} avatar={false} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="check-square"
            title={tasks.length === 0 ? 'No tasks yet' : 'Nothing here'}
            hint={tasks.length === 0 ? 'Add the first task below to start the schedule.' : 'No tasks match these filters.'}
            action={tasks.length > 0 ? <Button small full={false} kind="secondary" label="Clear filters" onPress={() => setFilters(NO_FILTERS)} /> : undefined}
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
                    minHeight: 32,
                    borderBottomWidth: 1,
                    borderBottomColor: c.border,
                  }}>
                  <T variant="label" color="textMuted" style={{ flex: 1 }}>
                    {item.phase}
                  </T>
                  <T variant="label" color={item.done === item.total ? 'success' : 'textMuted'}>
                    {t('task.phaseDone', '{{done}}/{{total}} done', { done: item.done, total: item.total })}
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
            accessibilityRole="button"
            accessibilityLabel={`Phase: ${activePhase}. Change`}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => setPhaseSheet(true)}
            style={{ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, justifyContent: 'center', maxWidth: 120 }}>
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
            <Pressable accessibilityRole="button" accessibilityLabel="Add task" onPress={addQuick} style={{ width: touch.min, height: touch.min, borderRadius: touch.min / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
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

      <FilterSheet
        visible={filterSheet}
        onClose={() => setFilterSheet(false)}
        filters={filters}
        onChange={setFilters}
        members={members}
        phases={phases}
        hasBaseline={project.baselineLocked}
        shown={shown}
      />
      <ScheduleMenu project={project} visible={menu} onClose={() => setMenu(false)} />
    </KeyboardAvoidingView>
  );
}
