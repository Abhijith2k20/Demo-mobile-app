import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost } from '@/components/chrome';
import { DemoPill } from '@/features/demo/DemoPill';
import { initDb } from '@/lib/db/init';
import i18n from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';
import '@/lib/session';
import { catchUp } from '@/lib/sync/catchup';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/theme/useTheme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
// Tables must exist before the first live query runs.
initDb();

/** Sends signed-out users to login and signed-in users away from it. */
function useAuthGate(ready: boolean): void {
  const user = useSession((s) => s.user);
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/login');
    else if (user && inAuth) router.replace('/');
  }, [user, segments, router, ready]);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const ready = fontsLoaded || !!fontError;
  const { c, mode } = useTheme();
  const language = useUi((s) => s.language);
  useAuthGate(ready);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  // Catch up whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useSession.getState().user) void catchUp();
    });
    return () => sub.remove();
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: c.bg },
              animation: 'slide_from_right',
              animationDuration: 200,
            }}>
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="task/[id]"
              options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
            />
            <Stack.Screen name="demo" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          <DemoPill />
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
