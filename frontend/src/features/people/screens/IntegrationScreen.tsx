// The PM app link's status for the Owner and Admins (spec §5.12). The Siteline team sets the link itself.
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { useCan } from '@/features/shared';
import { space } from '@/theme/spacing';
import { InviteSheet } from '../components/InviteSheet';
import { usePmLink } from '../hooks';

function IntegrationScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const can = useCan();
  const link = usePmLink(can('pm.status'));
  const [inviting, setInviting] = useState<string | null>(null);

  return (
    <Screen>
      <Header title={t('pm.title', 'PM app link')} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}>
        {!link ? <Skeleton rows={3} /> : null}
        {link && !link.connected ? (
          <EmptyState icon="link" title={t('pm.none', 'Not linked')} hint={t('pm.noneHint', 'Projects are made in Siteline. Ask the Siteline team to link your PM app.')} />
        ) : null}
        {link?.connected ? (
          <>
            <Card>
              <T variant="bodyStrong">{link.kind === 'mock' ? t('pm.mock', 'Test PM app (stand-in)') : t('pm.live', 'Your PM app')}</T>
              <T variant="meta" color="textMuted">
                {link.lastSyncAt
                  ? t('pm.lastSync', 'Last sync {{when}}', { when: formatDistanceToNow(parseISO(link.lastSyncAt), { addSuffix: true }) })
                  : t('pm.neverSynced', 'Not synced yet')}
              </T>
              {link.lastError ? (
                <T variant="meta" color="danger" style={{ marginTop: space.xs }}>
                  {link.lastError}
                </T>
              ) : null}
              <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
                {t('pm.hint', 'Projects, people and tasks come from the PM app. The bot asks task owners for updates and sends their answers back.')}
              </T>
            </Card>
            <View style={{ gap: space.sm }}>
              <T variant="label" color="textMuted">
                {t('pm.unmatched', "{{count}} people in the PM app aren't on Siteline yet", { count: link.unmatched?.length ?? 0 })}
              </T>
              {(link.unmatched ?? []).map((ref) => (
                <Card key={ref} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <T variant="body" style={{ flex: 1 }} numberOfLines={1}>
                    {ref}
                  </T>
                  {can('user.invite') ? <Button small full={false} kind="secondary" label={t('pm.invite', 'Invite')} onPress={() => setInviting(ref)} /> : null}
                </Card>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      <InviteSheet key={inviting ?? 'none'} visible={!!inviting} initial={inviting ?? undefined} onClose={() => setInviting(null)} />
    </Screen>
  );
}

export default appScreen(IntegrationScreen);
