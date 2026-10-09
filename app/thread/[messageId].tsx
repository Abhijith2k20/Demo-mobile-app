import { useLocalSearchParams } from 'expo-router';
import ThreadScreen from '@/features/threads/screens/ThreadScreen';

// Route only: reads the URL parameters and renders the screen from src/features/threads/screens/ThreadScreen.tsx
export default function Route() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  return <ThreadScreen messageId={messageId} />;
}
