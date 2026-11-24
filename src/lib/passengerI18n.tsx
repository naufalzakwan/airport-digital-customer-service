import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import id from '@/locales/id.json';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import ja from '@/locales/ja.json';
import ar from '@/locales/ar.json';
import zh from '@/locales/zh-CN.json';

export type Locale = 'id' | 'en' | 'fr' | 'ja' | 'ar' | 'zh-CN';
export type TranslationKey = keyof typeof id;
const dictionaries: Record<Locale, Record<TranslationKey, string>> = { id, en, fr, ja, ar, 'zh-CN': zh };
export const languages: { locale: Locale; label: string; backend: string }[] = [
  { locale: 'fr', label: 'Français', backend: 'Francis' }, { locale: 'id', label: 'Indonesia', backend: 'Indonesia' },
  { locale: 'ja', label: '日本語', backend: '日本語' }, { locale: 'ar', label: 'العربية', backend: 'العربية' },
  { locale: 'en', label: 'English', backend: 'English' }, { locale: 'zh-CN', label: '中文', backend: '中文' },
];
export const categories: Record<string, TranslationKey> = { 'Flight Information': 'flight', 'Lost & Found': 'lost', 'General Assistance': 'general', 'Accessibility Services': 'accessibility' };
type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;
type Context = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator };
const initial = (): Locale => { try { const value = localStorage.getItem('echo-passenger-locale'); if (languages.some(item => item.locale === value)) return value as Locale; } catch { /* Default when storage is unavailable. */ } return 'id'; };
const PassengerContext = createContext<Context | null>(null);
export function PassengerI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initial);
  const value = useMemo<Context>(() => ({
    locale,
    setLocale: next => { setLocale(next); try { localStorage.setItem('echo-passenger-locale', next); } catch { /* Preference remains in memory. */ } },
    t: (key, params) => {
      const entry = dictionaries[locale][key] || id[key];
      if (!dictionaries[locale][key] && import.meta.env.DEV) console.warn(`Missing translation: ${locale}.${key}`);
      return (entry || key).replace(/\{(\w+)\}/g, (_, name: string) => { const value = params?.[name]; return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : String(value ?? `{${name}}`); });
    },
  }), [locale]);
  return <PassengerContext.Provider value={value}><div lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="passenger-i18n">{children}</div></PassengerContext.Provider>;
}
export function usePassengerI18n() {
  const context = useContext(PassengerContext);
  // Officer and legacy screens keep their original labels.
  return context;
}
export const categoryLabel = (value: string, t: Translator) => categories[value] ? t(categories[value]) : value;
