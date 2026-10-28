import { useLocalSearchParams } from 'expo-router';
import ChannelScreen from '@/features/chat/screens/ChannelScreen';

// Route only: reads the URL parameters and renders the screen from src/features/chat/screens/ChannelScreen.tsx
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChannelScreen channelId={id} />;
}
