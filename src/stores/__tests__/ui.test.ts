// Device settings come back after the app restarts; screen-only state does not.
import AsyncStorage from '@react-native-async-storage/async-storage';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest's documented mock for AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

/** A fresh copy of the store, as after an app restart. */
async function startApp(): Promise<typeof import('@/stores/ui')> {
  let mod!: typeof import('@/stores/ui');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a new module instance per "app start"
    mod = require('@/stores/ui');
  });
  await mod.prefsLoaded;
  return mod;
}

it('keeps language and theme, not drafts, across a restart', async () => {
  const first = await startApp();
  first.useUi.getState().setLanguage('kn');
  first.useUi.getState().setTheme('dark');
  first.useUi.getState().setDraft('ch1', 'half typed');
  await new Promise((r) => setTimeout(r, 0)); // let the save finish

  const second = await startApp();
  expect(second.useUi.getState().language).toBe('kn');
  expect(second.useUi.getState().theme).toBe('dark');
  expect(second.useUi.getState().drafts).toEqual({});
  expect(await AsyncStorage.getItem('prefs')).toContain('"language":"kn"');
});
