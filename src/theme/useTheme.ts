import { useMemo } from 'react';
import { Platform, useColorScheme, useWindowDimensions } from 'react-native';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { dark, light, type Colors } from './colors';
import { typography, type TypeVariant } from './typography';
import type { TextStyle } from 'react-native';

export interface Theme {
  c: Colors;
  mode: 'light' | 'dark';
  worker: boolean;
  type: Record<TypeVariant, TextStyle>;
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const stored = useUi((s) => s.theme);
  // iOS apps follow the system appearance only (HIG: no app-specific appearance setting).
  const pref = Platform.OS === 'ios' ? 'system' : stored;
  const worker = useSession((s) => s.workerMode);
  const mode: 'light' | 'dark' = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return useMemo(
    () => ({ c: mode === 'dark' ? dark : light, mode, worker, type: typography(worker) }),
    [mode, worker],
  );
}

/** True at the larger text sizes, where side-by-side layouts should stack (HIG: Supporting Dynamic Type). */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= 1.3;
}
