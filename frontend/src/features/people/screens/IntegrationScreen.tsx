// The PM app link's status for the Owner and Admins (spec §5.12). The Siteline team sets the link itself.
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { useCan } from '@/features/shared';
import { space } from '@/theme/spacing';
import { retryDelivery } from '../api';
import { usePmLink, type PmDelivery } from '../hooks';

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'danger' }) {
  return (
    <View style={{ flex: 1, minWidth: 120 }}>
      <T variant="title" color={tone && value > 0 ? tone : 'text'}>
        {value}
      </T>
      <T variant="meta" color="textMuted">
        {label}
      </T>
    </View>
  );
}

function DeliveryRow({ d }: { d: PmDelivery }) {
  const { t } = useTranslation();
  const status = d.refused
    ? t('pm.refused', 'Refused by the PM app')
    : d.status === 'done'
      ? t('pm.delivered', 'Delivered')
      : d.status === 'failed'
        ? t('pm.failed', "Couldn't deliver")
        : d.attempts
          ? t('pm.retrying', 'Retrying ({{n}} tries)', { n: d.attempts })
          : t('pm.waiting', 'Waiting to send');
  return (
    <View style={{ gap: 2, paddingVertical: space.sm }}>
      <T variant="bodyStrong" numberOfLines={1}>
        {d.cardTitle ?? d.event ?? t('pm.event', 'Event')}
      </T>
      <T variant="meta" color={d.status === 'failed' || d.refused ? 'danger' : d.status === 'done' ? 'success' : 'textMuted'}>
        {status} · {formatDistanceToNow(parseISO(d.updatedAt), { addSuffix: true })}
      </T>
      {d.error ? (
        <T variant="meta" color="textMuted" numberOfLines={2}>
          {d.error}
        </T>
      ) : null}
      {d.canRetry ? <Button kind="secondary" small full={false} icon="refresh-cw" label={t('pm.retry', 'Send again')} onPress={() => void retryDelivery(d.id)} style={{ marginTop: space.xs }} /> : null}
    </View>
  );
}

function IntegrationScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const link = usePmLink(useCan()('pm.status'));

  return (
    <Screen>
      <Header title={t('pm.title', 'PM app link')} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}>
        {!link ? <Skeleton rows={3} /> : null}
        {link && !link.connected ? (
          <EmptyState icon="link" title={t('pm.none', 'Not linked')} hint={t('pm.noneHint', 'Without a PM app the bot sends no cards. Ask the Siteline team to link it.')} />
        ) : null}
        {link?.connected ? (
          <Card>
            <T variant="bodyStrong">{link.kind === 'mock' ? t('pm.mock', 'Test PM app (stand-in)') : t('pm.live', 'Your PM app')}</T>
            <T variant="meta" color="textMuted">
              {link.lastCallAt
                ? t('pm.lastCall', 'Last heard from {{when}}', { when: formatDistanceToNow(parseISO(link.lastCallAt), { addSuffix: true }) })
                : t('pm.neverCalled', 'Not heard from yet')}
            </T>
            {link.lastError ? (
              <T variant="meta" color="danger" style={{ marginTop: space.xs }}>
                {link.lastError}
              </T>
            ) : null}
            <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
              {t('pm.hint', 'The PM app sends cards to anyone in the company, any time, through the Siteline Bot, and gets the answers back. Each card goes to one person. It has no access to projects, channels or messages.')}
            </T>
          </Card>
        ) : null}
        {link?.connected && link.stats ? (
          <Card>
            <T variant="label" color="textMuted" style={{ marginBottom: space.sm }}>
              {t('pm.week', 'Last 7 days')}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
              <Stat value={link.stats.cardsSent} label={t('pm.sent', 'Cards sent')} />
              <Stat value={link.stats.cardsAnswered} label={t('pm.answered', 'Answered')} />
              <Stat value={link.stats.pending} label={t('pm.pending', 'Answers waiting to send')} />
              <Stat value={link.stats.failed} label={t('pm.failedCount', "Answers that couldn't be delivered")} tone="danger" />
            </View>
          </Card>
        ) : null}
        {link?.connected && link.deliveries?.length ? (
          <Card>
            <T variant="label" color="textMuted">
              {t('pm.recent', 'Recent deliveries to the PM app')}
            </T>
            {link.deliveries.map((d) => (
              <DeliveryRow key={d.id} d={d} />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default appScreen(IntegrationScreen);
