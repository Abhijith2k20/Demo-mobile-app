import { useLocalSearchParams } from 'expo-router';
import MembersScreen from '@/features/members/screens/MembersScreen';

// Route only: reads the URL parameters and renders the screen from src/features/members/screens/MembersScreen.tsx
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MembersScreen projectId={id} />;
}
