import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { applyTheme, loadSettings, pixelActive } from '../settings';
import type { Settings } from '../settings';
import { setLanguage, useLanguage } from '../i18n';
import type { Language } from '../i18n';
import { applyColors } from '../colors';
import type { ColorSettings } from '../colors';
import { applyScale, followScreen } from '../uiScale';
import type { UiScale } from '../uiScale';

/** Share the device's appearance across journal, calendar and reminder windows. */
export function ThemeSync() {
  const language = useLanguage();
  useEffect(() => { void invoke('set_ui_language', { language }).catch(() => {}); }, [language]);
  useEffect(() => {
    // The handshake also covers freshly created WebViews, before any later settings change is broadcast.
    const appearance = listen<Settings>('journal:appearance', event => {
      const settings = event.payload;
      localStorage.setItem('journal.settings', JSON.stringify(settings));
      applyTheme(settings); applyColors(settings); setLanguage(settings.language);
      void applyScale(settings.uiScale, pixelActive(settings));
    });
    const hello = listen<{ label: string }>('journal:appearance-hello', event => {
      if (getCurrentWindow().label === 'main') void emitTo(event.payload.label, 'journal:appearance', loadSettings());
    });
    if (getCurrentWindow().label !== 'main') void Promise.all([appearance, hello]).then(() => emit('journal:appearance-hello', { label: getCurrentWindow().label }));
    else void appearance.then(() => emit('journal:appearance', loadSettings()));
    const stop = listen<Pick<Settings, 'theme' | 'pixel' | 'popupStyle'>>('journal:theme', event => applyTheme(event.payload));
    const languageStop = listen<Language>('journal:language', event => setLanguage(event.payload));
    const colorStop = listen<ColorSettings>('journal:colors', event => applyColors(event.payload));
    const scaleStop = listen<{ scale: UiScale; pixel: boolean }>('journal:scale', event => void applyScale(event.payload.scale, event.payload.pixel));
    const initial = loadSettings();
    void applyScale(initial.uiScale, pixelActive(initial));
    const unfollow = followScreen();
    const reload = (event: StorageEvent) => { if (event.key === 'journal.settings' || event.key === null) { const settings = loadSettings(); applyTheme(settings); void applyScale(settings.uiScale, pixelActive(settings)); applyColors(settings); setLanguage(settings.language); } };
    window.addEventListener('storage', reload);
    return () => { window.removeEventListener('storage', reload); void appearance.then(unlisten => unlisten()); void hello.then(unlisten => unlisten()); void stop.then(unlisten => unlisten()); void languageStop.then(unlisten => unlisten()); void colorStop.then(unlisten => unlisten()); void scaleStop.then(unlisten => unlisten()); unfollow(); };
  }, []);
  return null;
}
