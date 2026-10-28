import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/T';
import { useChannels, useMe, useUsers } from '@/features/shared';
import { errorText } from '@/lib/i18n';
import { discardItem, retryItem, sendNow, useOutbox, type OutboxItem } from '@/lib/outbox';
import { space } from '@/theme/spacing';

/** Changes saved on this phone that haven't reached the server yet. */
function UnsentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const channels = useChannels();
  const users = useUsers();
  const items = useOutbox((st) => st.items).filter((i) => i.userId === me.id);
  const failed = items.filter((i) => i.state === 'failed');
  const waiting = items.filter((i) => i.state !== 'failed');
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);

  const title = (i: OutboxItem): string => {
    if (i.kind === 'checkin') return t('unsent.checkin', 'Check-in: {{task}}', { task: i.taskName });
    if (i.kind === 'task') return t('unsent.taskChange', 'Task update: {{task}}', { task: i.taskName });
    const ch = channels.byId.get(i.channelId);
    const where = ch?.kind === 'dm' ? (users.byId.get(ch.peerId ?? '')?.name ?? '') : ch?.kind === 'bot' ? 'Siteline Bot' : `#${ch?.name ?? ''}`;
    const what = i.body ? `“${i.body.slice(0, 60)}”` : i.photos.length ? t('unsent.photos', '{{count}} photos', { count: i.photos.length }) : '';
    return `${t('unsent.message', 'Message in {{where}}', { where })}${what ? `: ${what}` : ''}`;
  };

  const row = (i: OutboxItem) => (
    <Card key={i.id} style={{ gap: space.sm }}>
      <T variant="bodyStrong">{title(i)}</T>
      <T variant="meta" color={i.state === 'failed' ? 'danger' : 'textMuted'}>
        {i.state === 'failed' && i.error ? errorText(i.error) : i.state === 'sending' ? t('unsent.sendingNow', 'Sending now…') : t('unsent.waitingReason', 'Waiting for a connection.')}
      </T>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {i.state === 'failed' ? <Button small full={false} icon="refresh-cw" label={t('unsent.retry', 'Retry')} onPress={() => retryItem(i.id)} /> : null}
        <Button small full={false} kind="secondary" icon="trash-2" label={t('unsent.discard', 'Discard')} onPress={() => setDiscarding(i)} />
      </View>
    </Card>
  );

  return (
    <Screen>
      <Header title={t('unsent.title', 'Unsent items')} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}>
        {items.length === 0 ? (
          <EmptyState icon="check-circle" title={t('unsent.emptyTitle', 'Everything has been sent.')} />
        ) : null}
        {failed.length ? (
          <T variant="label" color="danger">
            {t('unsent.failed', 'Not sent')}
          </T>
        ) : null}
        {failed.map(row)}
        {waiting.length ? (
          <>
            <T variant="label" color="textMuted">
              {t('unsent.waiting', 'Waiting to send')}
            </T>
            {waiting.map(row)}
            <Button kind="secondary" icon="send" label={t('unsent.sendNow', 'Try sending now')} onPress={sendNow} />
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={!!discarding} onClose={() => setDiscarding(null)} title={t('unsent.discardTitle', 'Discard this change?')}>
        <T variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
          {t('unsent.discardBody', "It hasn't reached the server and will be lost.")}
        </T>
        <Button
          kind="danger"
          label={t('unsent.discard', 'Discard')}
          onPress={() => {
            if (discarding) discardItem(discarding.id);
            setDiscarding(null);
          }}
        />
        <Button kind="ghost" label={t('common.cancel', 'Cancel')} onPress={() => setDiscarding(null)} />
      </Sheet>
    </Screen>
  );
}

export default appScreen(UnsentScreen);
