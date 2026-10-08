import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
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
  const pref = useUi((s) => s.theme);
  const worker = useSession((s) => s.workerMode);
  const mode: 'light' | 'dark' = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return useMemo(
    () => ({ c: mode === 'dark' ? dark : light, mode, worker, type: typography(worker) }),
    [mode, worker],
  );
}
