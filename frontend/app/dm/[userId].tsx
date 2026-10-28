import { useLocalSearchParams } from 'expo-router';
import DmScreen from '@/features/chat/screens/DmScreen';

// Route only: reads the URL parameters and renders the screen from src/features/chat/screens/DmScreen.tsx
export default function Route() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <DmScreen userId={userId} />;
}
