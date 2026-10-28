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
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { Project, TaskView as Task } from '@/types/models';
import { useMe, useProjectAccess, useProjectMembers, useUsers } from '../../shared';
import { confirmTask, createTask, shiftTask, updateTask } from '../api';
import { NO_FILTERS, type TaskFilters } from '../filters';
import { useProjectTasks } from '../hooks';
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
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS);
  const { tasks, total, phases, phaseChoices, currentPhase, window, loading, failed } = useProjectTasks(project.id, filters);
  const [filterSheet, setFilterSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const members = useProjectMembers(project.id);
  const [shift, setShift] = useState<Task | null>(null);
  const [quick, setQuick] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [phaseSheet, setPhaseSheet] = useState(false);

  // Quick add targets the phase being worked on now (the server's pick), unless the user picked one.
  const activePhase = phase ?? currentPhase ?? phaseChoices[0] ?? '';

  // The server sends matching tasks in phase order; each phase gets a sticky header with its progress.
  const { items, sticky } = useMemo(() => {
    const out: Item[] = [];
    const stickyIdx: number[] = [];
    for (const p of phases) {
      const inPhase = tasks.filter((t) => t.phase === p.name);
      if (inPhase.length === 0) continue;
      stickyIdx.push(out.length);
      out.push({ kind: 'phase', key: `phase-${p.name}`, phase: p.name, done: p.done, total: p.total });
      for (const t of inPhase) out.push({ kind: 'task', key: t.id, task: t });
    }
    return { items: out, sticky: stickyIdx };
  }, [tasks, phases]);

  const onDone = (t: Task) => {
    if (t.status === 'done_pending_confirmation' && access.can('task.confirm')) confirmTask(t);
    else updateTask(t, { status: 'done' });
  };

  const addQuick = () => {
    const name = quick.trim();
    if (!name || !activePhase) return;
    // No dates: the server places it after the phase's last task.
    createTask({ projectId: project.id, name, phase: activePhase, ownerId: null, description: null, channelId: null });
    setQuick('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {header}
      <ScheduleToolbar
        filters={filters}
        onChange={setFilters}
        shown={tasks.length}
        total={total}
        onOpenFilters={() => setFilterSheet(true)}
        onOpenMenu={access.can('task.baseline') ? () => setMenu(true) : undefined}
      />

      <View style={{ flex: 1 }}>
        {loading ? (
          <Skeleton rows={7} avatar={false} />
        ) : failed ? (
          <EmptyState icon="cloud-off" title={t('task.loadFailed', "Couldn't load the schedule")} hint={t('chat.loadFailedHint', 'They will appear when the connection is back.')} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="check-square"
            title={total === 0 ? 'No tasks yet' : 'Nothing here'}
            hint={total === 0 ? 'Add the first task below to start the schedule.' : 'No tasks match these filters.'}
            action={total > 0 ? <Button small full={false} kind="secondary" label="Clear filters" onPress={() => setFilters(NO_FILTERS)} /> : undefined}
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
                  if (shift) shiftTask(shift, d);
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
          {phaseChoices.map((p) => (
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
        phases={phases.map((p) => p.name)}
        hasBaseline={project.baselineLocked}
        shown={tasks.length}
      />
      <ScheduleMenu project={project} visible={menu} onClose={() => setMenu(false)} />
    </KeyboardAvoidingView>
  );
}
