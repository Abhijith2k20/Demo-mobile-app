import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState } from '@/components/basics';
import { appScreen, Header, OfflineBanner, Screen } from '@/components/chrome';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { discardItem, editFailedMessage, retryItem } from '@/features/unsent/api';
import { useUnsentItems, type UnsentRow } from '@/features/unsent/hooks';
import { space } from '@/theme/spacing';
import type { OutboxItem } from '@/types/models';

function UnsentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { failed, stale, waiting } = useUnsentItems();
  const [editing, setEditing] = useState<OutboxItem | null>(null);
  const [text, setText] = useState('');

  const row = (r: UnsentRow, isFailed: boolean) => (
    <Card key={r.item.id} style={{ gap: space.sm }}>
      <T variant="bodyStrong">{r.title}</T>
      <T variant="meta" color={isFailed ? 'danger' : 'textMuted'}>
        {r.reason}
      </T>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <Button small full={false} icon="refresh-cw" label={t('unsent.retry', 'Retry')} onPress={() => retryItem(r.item)} />
        {r.edit ? (
          <Button
            small
            full={false}
            kind="secondary"
            icon="edit-2"
            label={t('chat.edit', 'Edit')}
            onPress={() => {
              if (r.edit?.kind === 'message') {
                setText(r.edit.body);
                setEditing(r.item);
              } else if (r.edit?.kind === 'task') {
                // The change was rolled back; open the task so it can be entered again.
                const taskId = r.edit.taskId;
                discardItem(r.item);
                router.push(`/task/${taskId}`);
              }
            }}
          />
        ) : null}
        <Button small full={false} kind="danger" icon="trash-2" label={t('unsent.discard', 'Discard')} onPress={() => discardItem(r.item)} />
      </View>
    </Card>
  );

  return (
    <Screen>
      <Header title={t('unsent.title', 'Unsent items')} />
      <OfflineBanner waiting={waiting} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}>
        {failed.length === 0 && stale.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title={t('unsent.emptyTitle', 'Nothing is stuck')}
            hint={
              waiting > 0
                ? t('unsent.emptyWaiting', '{{count}} changes are waiting and will send automatically.', { count: waiting })
                : t('unsent.emptyHint', 'Everything you did has reached the server.')
            }
          />
        ) : null}
        {failed.length > 0 ? (
          <>
            <T variant="label" color="textMuted">
              {t('unsent.failed', "Couldn't be sent")}
            </T>
            {failed.map((r) => row(r, true))}
          </>
        ) : null}
        {stale.length > 0 ? (
          <>
            <T variant="label" color="textMuted" style={{ marginTop: space.md }}>
              {t('unsent.stale', 'Waiting more than a day')}
            </T>
            {stale.map((r) => row(r, false))}
          </>
        ) : null}
        {(failed.length > 0 || stale.length > 0) && waiting > 0 ? (
          <T variant="meta" color="textMuted">
            {t('unsent.emptyWaiting', '{{count}} changes are waiting and will send automatically.', { count: waiting })}
          </T>
        ) : null}
      </ScrollView>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={t('unsent.editTitle', 'Edit and send again')}>
        <SheetInput value={text} onChangeText={setText} multiline style={{ minHeight: 80, textAlignVertical: 'top', marginBottom: space.lg }} />
        <Button
          label={t('chat.send', 'Send')}
          icon="send"
          disabled={!text.trim()}
          onPress={() => {
            if (editing) editFailedMessage(editing, text.trim());
            setEditing(null);
          }}
        />
      </Sheet>
    </Screen>
  );
}

export default appScreen(UnsentScreen);
