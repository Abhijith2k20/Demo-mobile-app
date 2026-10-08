import { useLocalSearchParams } from 'expo-router';
import { appScreen } from '@/components/chrome';
import { Conversation } from '@/features/chat/components/Conversation';

function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Conversation channelId={id} />;
}

export default appScreen(ChannelScreen);
