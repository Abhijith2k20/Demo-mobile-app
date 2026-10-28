import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EmptyState, Skeleton } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { Conversation } from '@/features/chat/components/Conversation';
import { useAskOnOpen } from '@/features/bot/hooks';
import { useDmChannelId } from '@/features/chat/hooks';
import { useUi } from '@/stores/ui';

/** Direct message with a person, or with the Siteline Bot (`/dm/bot`). */
function DmScreen({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const channelId = useDmChannelId(userId);
  useAskOnOpen(userId === 'bot');
  const online = useUi((s) => s.online);
  if (channelId === undefined) {
    return (
      <Screen>
        <Header title={t('channel.dm', 'Direct message')} />
        <Skeleton rows={4} />
      </Screen>
    );
  }
  if (!channelId) {
    return (
      <Screen>
        <Header title={t('channel.dm', 'Direct message')} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {online ? (
            <EmptyState icon="message-circle" title={t('chat.dmUnavailable', "This conversation isn't available.")} />
          ) : (
            <EmptyState icon="wifi-off" title={t('offline.noServer', "Can't reach Siteline. Check your connection; changes need it to save.")} />
          )}
        </View>
      </Screen>
    );
  }
  return <Conversation channelId={channelId} />;
}

export default appScreen(DmScreen);
