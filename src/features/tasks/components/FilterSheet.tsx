// All task filters in one sheet: status, owner, due date, schedule and phase.
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Chip } from '@/components/basics';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { space, touch } from '@/theme/spacing';
import type { TaskStatus } from '@/types/models';
import { firstName } from '../../shared';
import { isFiltering, NO_FILTERS, type DueFilter, type OwnerFilter, type TaskFilters } from '../filters';
import type { MemberRow } from '../hooks';
import { useStatusLabel } from './bits';

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done_pending_confirmation', 'done'];
const DUE: { value: DueFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next 30 days' },
];

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
        {label}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  members: MemberRow[];
  phases: string[];
  /** The "behind baseline" filter only makes sense once a baseline exists. */
  hasBaseline: boolean;
  /** How many tasks match right now (shown on the button). */
  shown: number;
}

export function FilterSheet({ visible, onClose, filters, onChange, members, phases, hasBaseline, shown }: Props) {
  const statusLabel = useStatusLabel();
  const toggle = <V,>(list: V[], value: V): V[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const owner = (value: OwnerFilter, label: string) => (
    <Chip key={value} label={label} selected={filters.owner === value} onPress={() => onChange({ ...filters, owner: filters.owner === value ? 'any' : value })} />
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      full
      headerRight={
        isFiltering(filters) ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChange(NO_FILTERS)} style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.sm }}>
            <T variant="metaStrong" color="accent">
              Clear all
            </T>
          </Pressable>
        ) : undefined
      }>
      <Group label="Status">
        {STATUSES.map((s) => (
          <Chip
            key={s}
            label={s === 'done_pending_confirmation' ? 'Awaiting confirmation' : statusLabel(s)}
            selected={filters.statuses.includes(s)}
            onPress={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
          />
        ))}
      </Group>

      <Group label="Owner">
        {owner('me', 'Me')}
        {owner('unassigned', 'Unassigned')}
        {members.map(({ user }) => owner(user.id, firstName(user.name)))}
      </Group>

      <Group label="Due">
        {DUE.map((d) => (
          <Chip key={d.value} label={d.label} selected={filters.due === d.value} onPress={() => onChange({ ...filters, due: d.value })} />
        ))}
      </Group>

      {hasBaseline ? (
        <Group label="Schedule">
          <Chip icon="alert-triangle" tone="danger" label="Behind baseline" selected={filters.delayed} onPress={() => onChange({ ...filters, delayed: !filters.delayed })} />
        </Group>
      ) : null}

      {phases.length > 1 ? (
        <Group label="Phase">
          {phases.map((p) => (
            <Chip key={p} label={p} selected={filters.phases.includes(p)} onPress={() => onChange({ ...filters, phases: toggle(filters.phases, p) })} />
          ))}
        </Group>
      ) : null}

      <Button label={`Show ${shown} ${shown === 1 ? 'task' : 'tasks'}`} onPress={onClose} />
    </Sheet>
  );
}
