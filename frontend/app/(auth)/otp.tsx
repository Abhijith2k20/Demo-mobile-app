import { useLocalSearchParams } from 'expo-router';
import OtpScreen from '@/features/auth/screens/OtpScreen';

// Route only: reads the URL parameters and renders the screen from src/features/auth/screens/OtpScreen.tsx
export default function Route() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return <OtpScreen email={email ?? ''} />;
}
