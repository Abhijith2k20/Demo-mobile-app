// The PM app link's status for the Owner and Admins (spec §5.12). The Siteline team sets the link itself.
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { useCan } from '@/features/shared';
import { space } from '@/theme/spacing';
import { usePmLink } from '../hooks';

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
      </ScrollView>
    </Screen>
  );
}

export default appScreen(IntegrationScreen);
