// Invites the Owner and Admins sent and that are still waiting (spec §5.11).
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { T } from '@/components/T';
import { useCan, useRoleLabels } from '@/features/shared';
import { toast } from '@/stores/ui';
import { space } from '@/theme/spacing';
import { cancelInvite, resendInvite } from '../api';
import { InviteSheet } from '../components/InviteSheet';
import { useInvites } from '../hooks';

function InvitesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const can = useCan();
  const labels = useRoleLabels();
  const { invites, loading } = useInvites(can('user.invite'));
  const [inviting, setInviting] = useState(false);

  return (
    <Screen>
      <Header title={t('invites.title', 'Invites')} subtitle={t('invites.count', '{{count}} waiting', { count: invites.length })} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}>
        <Button icon="user-plus" kind="secondary" label={t('invite.title', 'Invite person')} onPress={() => setInviting(true)} />
        {loading ? <Skeleton rows={3} /> : null}
        {!loading && invites.length === 0 ? (
          <EmptyState icon="mail" title={t('invites.none', 'No invites waiting')} hint={t('invites.noneHint', 'People you invite show here until they join.')} />
        ) : null}
        {invites.map((i) => (
          <Card key={i.id}>
            <T variant="bodyStrong">{i.name}</T>
            <T variant="meta" color="textMuted">
              {i.identifier} · {labels.company(i.role)}
            </T>
            <T variant="meta" color="textFaint" style={{ marginTop: 2 }}>
              {t('invites.expires', 'Expires {{date}}', { date: format(parseISO(i.expiresAt), 'd MMM') })}
              {i.invitedBy ? ` · ${t('invites.by', 'invited by {{name}}', { name: i.invitedBy })}` : ''}
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              <Button
                small
                kind="secondary"
                full={false}
                label={t('invites.resend', 'Resend')}
                onPress={() => {
                  void resendInvite(i);
                  toast(t('invites.resent', 'Sent again to {{who}}.', { who: i.identifier }));
                }}
              />
              <Button small kind="ghost" full={false} label={t('invites.cancel', 'Cancel invite')} onPress={() => void cancelInvite(i)} />
            </View>
          </Card>
        ))}
      </ScrollView>
      <InviteSheet visible={inviting} onClose={() => setInviting(false)} />
    </Screen>
  );
}

export default appScreen(InvitesScreen);
