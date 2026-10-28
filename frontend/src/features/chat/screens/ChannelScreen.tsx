import { appScreen } from '@/components/chrome';
import { Conversation } from '@/features/chat/components/Conversation';

function ChannelScreen({ channelId }: { channelId: string }) {
  return <Conversation channelId={channelId} />;
}

export default appScreen(ChannelScreen);
