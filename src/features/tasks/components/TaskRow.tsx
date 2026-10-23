// One task in the schedule: status, owner, dates, mini timeline, and swipe actions.
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Avatar, Pill } from '@/components/basics';
import { T } from '@/components/T';
import { isDone, shortDate, taskVarianceDays } from '@/shared/taskRules';
import { space } from '@/theme/spacing';
import { useLargeText, useTheme } from '@/theme/useTheme';
import type { Task, User } from '@/types/models';
import { MiniTimeline, StatusDot, useStatusLabel } from './bits';

// Width of a revealed swipe action; pulling half of it is enough to trigger.
const ACTION_WIDTH = 132;

export function dateRange(task: Task): string {
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

export const TaskRow = memo(function TaskRow({ task, owner, window, canDone, canShift, onDone, onShift }: RowProps) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const large = useLargeText();
  const ref = useRef<SwipeableMethods>(null);
  const late = (taskVarianceDays(task) ?? 0) > 0 && !isDone(task.status);
  const showDone = canDone && task.status !== 'done';
  const doneLabel = task.status === 'done_pending_confirmation' ? t('task.confirmDone', 'Confirm done') : t('task.markDone', 'Mark done');
  const shiftLabel = t('task.shiftDates', 'Shift dates');
  const lateLabel = t('task.late', 'Late');
  // Screen readers get the whole row in one sentence, and the swipe actions as named actions.
  const a11yLabel = [task.name, statusLabel(task.status), `${task.percent}%`, owner?.name, dateRange(task), late ? lateLabel : null].filter(Boolean).join(', ');
  const a11yActions = [...(showDone ? [{ name: 'done', label: doneLabel }] : []), ...(canShift ? [{ name: 'shift', label: shiftLabel }] : [])];
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
      accessibilityLabel={a11yLabel}
      accessibilityActions={a11yActions}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'done' ? onDone(task) : e.nativeEvent.actionName === 'shift' ? onShift(task) : undefined)}
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? c.surfaceAlt : c.bg,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm + 2,
        gap: 6,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <StatusDot status={task.status} />
        <T variant="body" numberOfLines={large ? 3 : 1} style={{ flex: 1, textDecorationLine: task.status === 'done' ? 'line-through' : 'none' }} color={task.status === 'done' ? 'textMuted' : 'text'}>
          {task.name}
        </T>
        {task.status === 'done_pending_confirmation' ? <Pill label={t('task.confirm', 'Confirm')} bg={c.warningSoft} fg={c.warning} /> : null}
        {owner ? <Avatar id={owner.id} name={owner.name} size={20} /> : null}
        <T variant="metaStrong" color={task.percent === 100 ? 'success' : 'textMuted'} style={{ minWidth: 38, textAlign: 'right' }}>
          {task.percent}%
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 108, flexShrink: 1 }}>
          {late ? <Feather name="alert-triangle" size={12} color={c.danger} accessibilityLabel={lateLabel} /> : null}
          <T variant="meta" color={late ? 'danger' : 'textMuted'} numberOfLines={1} style={{ flexShrink: 1 }}>
            {dateRange(task)}
          </T>
        </View>
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
      renderLeftActions={showDone ? () => action(doneLabel, 'check', c.successSoft, c.success, 'flex-start') : undefined}
      renderRightActions={canShift ? () => action(shiftLabel, 'calendar', c.infoSoft, c.info, 'flex-end') : undefined}
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
