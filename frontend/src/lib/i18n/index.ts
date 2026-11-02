import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

// English only for now. Every text in the code goes through t('key', 'English'), so adding a language later
// means adding its file here and a picker on You (removed 2026-11-02, see DECISIONS.md).

// eslint-disable-next-line import/no-named-as-default-member -- the default export is the shared instance
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Friendly text for an error code. Codes themselves are never shown to users. */
export function errorText(error: { code: string } | string): string {
  const code = typeof error === 'string' ? error : error.code;
  // eslint-disable-next-line import/no-named-as-default-member -- the default export is the shared instance
  return i18n.t(`errors.${code}`, { defaultValue: i18n.t('errors.UNKNOWN') });
}

export default i18n;
