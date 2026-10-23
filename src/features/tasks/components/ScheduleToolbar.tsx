// The bar above the task list: two quick filters, a Filters button, and the schedule menu.
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Chip, IconButton } from '@/components/basics';
import { T } from '@/components/T';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { advancedCount, isFiltering, isPendingOnly, NO_FILTERS, PENDING, type TaskFilters } from '../filters';

interface Props {
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  shown: number;
  total: number;
  onOpenFilters: () => void;
  /** Omit to hide the three-dot menu (nothing in it for this user). */
  onOpenMenu?: () => void;
}

export function ScheduleToolbar({ filters, onChange, shown, total, onOpenFilters, onOpenMenu }: Props) {
  const { c } = useTheme();
  const mine = filters.owner === 'me';
  const pending = isPendingOnly(filters);
  const more = advancedCount(filters);

  return (
    <View style={{ backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: onOpenMenu ? space.xs : space.lg, minHeight: 52 }}>
        <Chip label="Mine" selected={mine} onPress={() => onChange({ ...filters, owner: mine ? 'any' : 'me' })} />
        <Chip label="Pending" selected={pending} onPress={() => onChange({ ...filters, statuses: pending ? [] : PENDING })} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={more > 0 ? `Filters, ${more} active` : 'Filters'}
          onPress={onOpenFilters}
          hitSlop={{ top: 5, bottom: 5 }}
          style={({ pressed }) => ({
            minHeight: 34,
            paddingHorizontal: space.md,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: more > 0 ? c.accent : c.border,
            backgroundColor: more > 0 ? c.accentSoft : c.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: pressed ? 0.7 : 1,
          })}>
          <Feather name="sliders" size={14} color={more > 0 ? c.accent : c.text} />
          <T variant="metaStrong" color={more > 0 ? 'accent' : 'text'}>
            Filters
          </T>
          {more > 0 ? (
            <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <T variant="label" style={{ color: c.onAccent, letterSpacing: 0, fontSize: 11, lineHeight: 14 }} maxFontSizeMultiplier={1}>
                {more}
              </T>
            </View>
          ) : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        {onOpenMenu ? <IconButton icon="more-vertical" label="Schedule options" color="textMuted" size={20} onPress={onOpenMenu} /> : null}
      </View>
      {isFiltering(filters) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <T variant="meta" color="textMuted" style={{ flex: 1 }}>
            Showing {shown} of {total} {total === 1 ? 'task' : 'tasks'}
          </T>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear filters" hitSlop={14} onPress={() => onChange(NO_FILTERS)}>
            <T variant="metaStrong" color="accent">
              Clear
            </T>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
