import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { applyTheme, loadSettings } from '../settings';
import type { Theme } from '../settings';
import { setLanguage, useLanguage } from '../i18n';
import type { Language } from '../i18n';
import { applyColors } from '../colors';
import type { ColorSettings } from '../colors';

/** Share the device's appearance across journal, calendar and reminder windows. */
export function ThemeSync() {
  const language = useLanguage();
  useEffect(() => { void invoke('set_ui_language', { language }).catch(() => {}); }, [language]);
  useEffect(() => {
    const stop = listen<Theme>('journal:theme', event => applyTheme(event.payload));
    const languageStop = listen<Language>('journal:language', event => setLanguage(event.payload));
    const colorStop = listen<ColorSettings>('journal:colors', event => applyColors(event.payload));
    const reload = (event: StorageEvent) => { if (event.key === 'journal.settings' || event.key === null) { const settings = loadSettings(); applyTheme(settings.theme); applyColors(settings); setLanguage(settings.language); } };
    window.addEventListener('storage', reload);
    return () => { window.removeEventListener('storage', reload); void stop.then(unlisten => unlisten()); void languageStop.then(unlisten => unlisten()); void colorStop.then(unlisten => unlisten()); };
  }, []);
  return null;
}
