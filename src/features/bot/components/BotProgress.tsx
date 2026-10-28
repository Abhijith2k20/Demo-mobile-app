// Slim bar under the bot's header: how many check-ins are still waiting.
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { T } from '@/components/T';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { useCheckinQueue } from '../queue';

export function BotProgress() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const q = useCheckinQueue();
  if (!q || q.total === 0) return null;
  const left = q.pending.length;
  const done = left === 0;
  return (
    <View style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: space.lg, paddingVertical: space.sm + 2, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Feather name={done ? 'check-circle' : 'clipboard'} size={15} color={done ? c.success : c.textMuted} />
        <T variant="metaStrong" style={{ flex: 1 }} color={done ? 'success' : 'text'}>
          {done
            ? t('bot.allDone', 'All caught up. Thanks!')
            : left === 1
              ? t('bot.oneLeft', '1 task needs an update')
              : t('bot.left', '{{count}} tasks need an update', { count: left })}
        </T>
        <T variant="meta" color="textMuted">
          {t('bot.progress', '{{done}} of {{total}} done', { done: q.answered, total: q.total })}
        </T>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${(q.answered / q.total) * 100}%`, height: 4, borderRadius: 2, backgroundColor: done ? c.success : c.accent }} />
      </View>
    </View>
  );
}
