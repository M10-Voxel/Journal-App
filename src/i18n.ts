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
export function useLanguage() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, getLanguage); }

/** Translate application-owned text only. Never apply this to journal or mail content. */
export function t(key: string, ...values: unknown[]): string {
  let text = key;
  if (language === 'en') {
    const translated = (english as Record<string, string>)[key.replace(/\s+/g, ' ').trim()];
    if (translated !== undefined) text = `${/^\s*/.exec(key)![0]}${translated}${/\s*$/.exec(key)![0]}`;
    text = text.replace(/\bStrg\b/g, 'Ctrl').replace(/\bEntf\b/g, 'Del').replace(/\bBild(?=[↑↓]| [↑↓])/g, 'Page');
  }
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? `{${index}}`));
}
