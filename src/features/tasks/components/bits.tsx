import { Feather } from '@expo/vector-icons';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import { Pill } from '@/components/basics';
import { T } from '@/components/T';
import { taskVarianceDays } from '@/shared/taskRules';
import type { Colors } from '@/theme/colors';
import { useTheme } from '@/theme/useTheme';
import type { Task, TaskStatus } from '@/types/models';

export function statusColor(c: Colors, status: TaskStatus): string {
  switch (status) {
    case 'done':
      return c.success;
    case 'done_pending_confirmation':
      return c.warning;
    case 'in_progress':
      return c.info;
    case 'blocked':
      return c.danger;
    case 'not_started':
      return c.textFaint;
  }
}

export function StatusDot({ status, size: base = 10 }: { status: TaskStatus; size?: number }) {
  const { c } = useTheme();
  // Meaningful icons grow with the text (HIG: Supporting Dynamic Type).
  const size = Math.round(base * Math.min(2, Math.max(1, useWindowDimensions().fontScale)));
  const color = statusColor(c, status);
  const hollow = status === 'not_started';
  // Shape as well as colour: blocked and done must read without colour vision.
  const icon = status === 'blocked' ? 'alert-circle' : status === 'done' || status === 'done_pending_confirmation' ? 'check-circle' : null;
  if (icon) return <Feather name={icon} size={size + 4} color={color} style={{ marginHorizontal: -2 }} />;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hollow ? 'transparent' : color,
        borderWidth: hollow ? 1.5 : 0,
        borderColor: color,
      }}
    />
  );
}

export function useStatusLabel(): (s: TaskStatus) => string {
  const { t } = useTranslation();
  return useCallback(
    (s: TaskStatus) =>
      ({
        not_started: t('status.not_started', 'Not started'),
        in_progress: t('status.in_progress', 'In progress'),
        blocked: t('status.blocked', 'Blocked'),
        done: t('status.done', 'Done'),
        done_pending_confirmation: t('status.done_pending', 'Done — awaiting confirmation'),
      })[s],
    [t],
  );
}

export function VarianceChip({ task }: { task: Pick<Task, 'plannedFinish' | 'baselineFinish'> }) {
  const { c } = useTheme();
  const v = taskVarianceDays(task);
  if (v === null) return null;
  if (v === 0) return <Pill label="On baseline" bg={c.successSoft} fg={c.success} />;
  return v > 0 ? (
    <Pill label={`+${v} ${v === 1 ? 'day' : 'days'}`} bg={c.dangerSoft} fg={c.danger} />
  ) : (
    <Pill label={`${v} ${v === -1 ? 'day' : 'days'}`} bg={c.successSoft} fg={c.success} />
  );
}

/**
 * Thin bar that places a task inside its project window: baseline as a faint outline, planned
 * as a solid bar (red when it finishes after the baseline).
 */
export function MiniTimeline({ task, from, to }: { task: Task; from: string; to: string }) {
  const { c } = useTheme();
  const total = Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)) + 1);
  const pos = (start: string, finish: string) => {
    const left = Math.max(0, differenceInCalendarDays(parseISO(start), parseISO(from)));
    const len = Math.max(1, differenceInCalendarDays(parseISO(finish), parseISO(start)) + 1);
    return { left: `${(left / total) * 100}%` as const, width: `${Math.min(100, (len / total) * 100)}%` as const };
  };
  const late = (taskVarianceDays(task) ?? 0) > 0;
  const solid = task.status === 'done' ? c.success : late ? c.danger : c.info;
  return (
    <View style={{ height: 8, justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: c.border }} />
      {task.baselineStart && task.baselineFinish ? (
        <View
          style={{
            position: 'absolute',
            height: 8,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: c.textFaint,
            ...pos(task.baselineStart, task.baselineFinish),
          }}
        />
      ) : null}
      <View
        style={{ position: 'absolute', height: 4, borderRadius: 2, backgroundColor: solid, minWidth: 3, ...pos(task.plannedStart, task.plannedFinish) }}
      />
    </View>
  );
}

/** Progress ring drawn with plain views (two rotating half discs), so no SVG library is needed. */
export function ProgressRing({ percent, size: base = 72 }: { percent: number; size?: number }) {
  const { c } = useTheme();
  // Grow with the text size so the number inside still fits on one line.
  const size = Math.round(base * Math.min(2, Math.max(1, useWindowDimensions().fontScale)));
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const deg = (p / 100) * 360;
  const half = size / 2;
  // Each side clips a full-size square that carries a coloured half disc on its far side;
  // rotating the square clockwise sweeps the colour into view, starting from 12 o'clock.
  const side = (which: 'right' | 'left', rotation: number) => (
    <View style={{ position: 'absolute', top: 0, left: which === 'right' ? half : 0, width: half, height: size, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: which === 'right' ? -half : 0,
          width: size,
          height: size,
          transform: [{ rotate: `${rotation}deg` }],
          alignItems: which === 'right' ? 'flex-start' : 'flex-end',
        }}>
        <View
          style={{
            width: half,
            height: size,
            backgroundColor: c.accent,
            borderTopLeftRadius: which === 'right' ? half : 0,
            borderBottomLeftRadius: which === 'right' ? half : 0,
            borderTopRightRadius: which === 'left' ? half : 0,
            borderBottomRightRadius: which === 'left' ? half : 0,
          }}
        />
      </View>
    </View>
  );
  return (
    <View
      accessibilityLabel={`${p}%`}
      style={{ width: size, height: size, borderRadius: half, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {side('right', Math.min(deg, 180))}
      {side('left', Math.max(0, deg - 180))}
      <View
        style={{
          width: size - 14,
          height: size - 14,
          borderRadius: half,
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <T variant="heading">{p}%</T>
      </View>
    </View>
  );
}
