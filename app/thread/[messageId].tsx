import { useLocalSearchParams } from 'expo-router';
import ThreadScreen from '@/features/chat/screens/ThreadScreen';

// Route only: reads the URL parameters and renders the screen from src/features/chat/screens/ThreadScreen.tsx
export default function Route() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  return <ThreadScreen messageId={messageId} />;
}
