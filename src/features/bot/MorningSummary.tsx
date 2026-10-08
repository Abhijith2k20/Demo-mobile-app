import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/basics';
import { T } from '@/components/T';
import { shortDate } from '@/shared/taskRules';
import { space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ID, Message } from '@/types/models';
import { firstName, useMe } from '../shared';
import { StatusDot } from '../tasks/components/bits';
import { useTasksByIds } from '../tasks/hooks';

/** "Good morning Ravi. Your tasks today: …" with links to each task. */
export function MorningSummary({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const me = useMe();
  const ids = (message.data?.taskIds as ID[] | undefined) ?? [];
  const tasks = useTasksByIds(ids);
  if (message.data?.kind === 'no_open_tasks' || ids.length === 0) {
    return <T variant="body">{t('bot.noTasks', 'You have no open tasks right now. Enjoy the calm.')}</T>;
  }
  return (
    <Card accent={c.info} style={{ maxWidth: 360, marginTop: 2 }}>
      <T variant="bodyStrong">{t('bot.morning', 'Good morning {{name}}. Your tasks today:', { name: firstName(me.name) })}</T>
      <View style={{ marginTop: space.xs }}>
        {ids.map((id) => {
          const task = tasks.find((x) => x.id === id);
          if (!task) return null;
          return (
            <Pressable
              key={id}
              accessibilityRole="link"
              onPress={() => router.push(`/task/${id}`)}
              style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <StatusDot status={task.status} />
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ color: c.accent }} numberOfLines={1}>
                  {task.name}
                </T>
                <T variant="meta" color="textMuted">
                  {t('checkin.due', 'due {{date}}', { date: shortDate(task.plannedFinish) })} · {task.percent}%
                </T>
              </View>
              <Feather name="chevron-right" size={16} color={c.textFaint} />
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
