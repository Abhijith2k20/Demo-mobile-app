import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';
import kn from './kn.json';

// eslint-disable-next-line import/no-named-as-default-member -- the default export is the shared instance
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, kn: { translation: kn }, hi: { translation: hi } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Friendly, translated text for an error code. Codes themselves are never shown to users. */
export function errorText(error: { code: string } | string): string {
  const code = typeof error === 'string' ? error : error.code;
  // eslint-disable-next-line import/no-named-as-default-member -- the default export is the shared instance
  return i18n.t(`errors.${code}`, { defaultValue: i18n.t('errors.UNKNOWN') });
}

export default i18n;
