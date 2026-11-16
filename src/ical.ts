import { invoke } from '@tauri-apps/api/core';
import { decodeMailContent } from './mailContent.ts';
import { t } from './i18n.ts';
import type { CalendarDay, CalendarImport } from './journal';
export interface CalendarPreview { entries: CalendarImport[]; notices: string[] }
export function importCalendar(content: string, year = new Date().getFullYear()): Promise<CalendarPreview> {
  return invoke<CalendarPreview>('calendar_import', {content, year, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, labels:{untitled:t('Ohne Titel')}}).catch(error => { throw new Error(t(String(error))); });
}
export function exportCalendar(days: readonly CalendarDay[], now = new Date()): Promise<string> {
  return invoke('calendar_export', {days: days.map(day => ({...day, entries:day.entries.map(entry => ({...entry, description:decodeMailContent(entry.description)?.text ?? entry.description}))})), now:now.toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, untitled:t('Ohne Titel')});
}
