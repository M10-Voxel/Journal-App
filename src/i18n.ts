import { useSyncExternalStore } from 'react';
import english from './locales/en.ts';

export type Language = 'de' | 'en';
let language: Language = 'de';
try { if (JSON.parse(localStorage.getItem('journal.settings') ?? '{}')?.language === 'en') language = 'en'; } catch { /* default for old preferences and Node tests */ }
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const locale = () => language === 'en' ? 'en-GB' : 'de-DE';
const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(options: Intl.DateTimeFormatOptions) {
  const key = `${locale()}:${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) { format = new Intl.DateTimeFormat(locale(), options); dateFormats.set(key, format); }
  return format;
}
export function setLanguage(value: Language) {
  const next = value === 'en' ? 'en' : 'de';
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (language === next) return;
  language = next;
  for (const listener of [...listeners]) listener();
}
// One subscribe function for every component (a new one each render would make React subscribe anew each time).
const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage); }

/** English texts by German key, worked out once (an interface asks for the same texts on every render). */
const englishCache = new Map<string, string>();
function toEnglish(key: string): string {
  let text = englishCache.get(key);
  if (text !== undefined) return text;
  text = key;
  const translated = (english as Record<string, string>)[key.replace(/\s+/g, ' ').trim()];
  if (translated !== undefined) text = `${/^\s*/.exec(key)![0]}${translated}${/\s*$/.exec(key)![0]}`;
  text = text.replace(/\bStrg\b/g, 'Ctrl').replace(/\bEntf\b/g, 'Del').replace(/\bBild(?=[↑↓]| [↑↓])/g, 'Page');
  if (englishCache.size > 5000) englishCache.clear();
  englishCache.set(key, text);
  return text;
}

/** Translate application-owned text only. Never apply this to journal or mail content. */
export function t(key: string, ...values: unknown[]): string {
  const text = language === 'en' ? toEnglish(key) : key;
  if (!values.length && !text.includes('{')) return text;
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? `{${index}}`));
}
