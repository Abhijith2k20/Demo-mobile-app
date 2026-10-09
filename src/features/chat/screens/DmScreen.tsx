import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EmptyState } from '@/components/basics';
import { appScreen, Header, Screen } from '@/components/chrome';
import { Conversation } from '@/features/chat/components/Conversation';
import { useAskOnOpen } from '@/features/bot/hooks';
import { useDmChannelId } from '@/features/chat/hooks';

/** Direct message with a person, or with the Siteline Bot (`/dm/bot`). */
function DmScreen({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const channelId = useDmChannelId(userId);
  useAskOnOpen(userId === 'bot');
  if (!channelId) {
    return (
      <Screen>
        <Header title={t('channel.dm', 'Direct message')} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState icon="message-circle" title={t('chat.dmUnavailable', "This conversation isn't available.")} />
        </View>
      </Screen>
    );
  }
  return <Conversation channelId={channelId} />;
}

export default appScreen(DmScreen);
