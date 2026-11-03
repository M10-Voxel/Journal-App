import type { Entry } from './journal';
export function copyCalendarEntry(entry: Entry) {
  localStorage.setItem('journal.calendarClipboard', JSON.stringify(entry));
  window.dispatchEvent(new CustomEvent('calendar:copied'));
}
export function readCalendarEntry(): Entry | null {
  try { const value=JSON.parse(localStorage.getItem('journal.calendarClipboard') || 'null');return value && ['event','task','note'].includes(value.kind) && typeof value.text==='string' ? value : null; } catch { return null; }
}
