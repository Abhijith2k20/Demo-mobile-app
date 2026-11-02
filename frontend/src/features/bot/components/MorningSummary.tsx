import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { T } from '@/components/T';
import { shortDate } from '@/lib/format';
import { radius, space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Message } from '@/types/models';
import { firstName, useMe } from '../../shared';

/** One row as the server wrote it when it sent the summary. */
interface Row {
  id: ID;
  name: string;
  plannedFinish: string;
  percent: number;
}

/** "Good morning Ravi" with today's tasks as a small table: name, due date, progress. */
export function MorningSummary({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const me = useMe();
  const rows = (message.data?.tasks as Row[] | undefined) ?? [];
  const frame = { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.border } as const;

  if (message.data?.kind === 'checkin_intro') return null;
  if (message.data?.kind === 'no_open_tasks' || rows.length === 0) {
    return (
      <View style={[frame, { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }]}>
        <Feather name="check-circle" size={16} color={c.textMuted} />
        <T variant="meta" color="textMuted" style={{ flex: 1 }}>
          {t('bot.noTasks', 'You have no open tasks at the moment.')}
        </T>
      </View>
    );
  }
  return (
    <View style={frame}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm }}>
        <Feather name="sun" size={15} color={c.textMuted} />
        <T variant="metaStrong" style={{ flex: 1 }}>
          {t('bot.morningTitle', 'Good morning, {{name}}', { name: firstName(me.name) })}
        </T>
        <T variant="meta" color="textFaint">
          {t('bot.todayCount', '{{count}} today', { count: rows.length })}
        </T>
      </View>
      {rows.map((task) => {
        return (
          <View
            key={task.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.md,
              minHeight: 44,
              borderTopWidth: 1,
              borderTopColor: c.border,
            }}>
            <T variant="meta" style={{ flex: 1, fontSize: 14, color: c.text }} numberOfLines={1}>
              {task.name}
            </T>
            <T variant="meta" color="textMuted" style={{ width: 52, textAlign: 'right' }}>
              {shortDate(task.plannedFinish)}
            </T>
            <T variant="metaStrong" style={{ width: 38, textAlign: 'right' }}>
              {task.percent}%
            </T>
          </View>
        );
      })}
    </View>
  );
}
