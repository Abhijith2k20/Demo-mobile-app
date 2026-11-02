import { useLocalSearchParams } from 'expo-router';
import OtpScreen from '@/features/auth/screens/OtpScreen';

// Route only: reads the URL parameters and renders the screen from src/features/auth/screens/OtpScreen.tsx
export default function Route() {
  const { identifier, channel, company } = useLocalSearchParams<{ identifier?: string; channel?: string; company?: string }>();
  return <OtpScreen identifier={identifier ?? ''} channel={channel === 'sms' ? 'sms' : 'email'} company={company || undefined} />;
}
