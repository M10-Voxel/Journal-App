import { t } from './i18n.ts';
import ICAL from 'ical.js';
import type { CalendarDay, CalendarImport } from './journal';
import { localDate, shiftDate } from './dates.ts';

export interface CalendarPreview { entries: CalendarImport[]; notices: string[] }
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const nativeUid = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@journal\.local$/i;

/** Fold at 75 UTF-8 octets, without splitting a Unicode character (RFC 5545). */
function fold(content: string): string {
  const encoder = new TextEncoder();
  return content.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).map(line => {
    let result = '', bytes = 0;
    for (const char of line) {
      const length = encoder.encode(char).length;
      if (bytes + length > 75) { result += '\r\n '; bytes = 1; }
      result += char; bytes += length;
    }
    return result;
  }).join('\r\n').replace(/(?:\r\n)*$/, '\r\n');
}

/** SQLite remains authoritative. ICS is the portable interchange representation. */
export function exportCalendar(days: readonly CalendarDay[], now = new Date()): string {
  const calendar = new ICAL.Component('vcalendar');
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Journal//Calendar//DE');
  calendar.updatePropertyWithValue('calscale', 'GREGORIAN');
  for (const day of days) for (const entry of day.entries) {
    if (entry.kind === 'note' || entry.plan) continue;
    const component = new ICAL.Component('vevent');
    component.updatePropertyWithValue('uid', entry.calendarUid || `${entry.id}@journal.local`);
    component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true));
    component.updatePropertyWithValue('summary', entry.text.split('\n')[0] || t("Ohne Titel"));
    component.updatePropertyWithValue('description', entry.description ?? '');
    component.updatePropertyWithValue('x-journal-description-version', '1');
    const originalText = new ICAL.Property('x-journal-text');
    originalText.resetType('text');
    originalText.setValue(entry.text);
    component.addProperty(originalText);
    component.updatePropertyWithValue('x-journal-kind', entry.kind);
    component.updatePropertyWithValue('x-journal-show-in-journal', entry.showInJournal === false ? 'FALSE' : 'TRUE');
    component.updatePropertyWithValue('x-journal-done', entry.done ? 'TRUE' : 'FALSE');
    component.updatePropertyWithValue('x-journal-cancelled', entry.cancelled ? 'TRUE' : 'FALSE');
    component.updatePropertyWithValue('x-journal-reminder', entry.reminder ? 'TRUE' : 'FALSE');
    if (entry.priority) component.updatePropertyWithValue('priority', 1);
    if (entry.cancelled) component.updatePropertyWithValue('status', 'CANCELLED');
    if (entry.time) {
      component.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(`${day.date}T${entry.time}:00`), true));
      if (entry.end) {
        // "24:00" and later lie on the next day ("26:00" is 02:00 there).
        const hours = Number(entry.end.slice(0, 2));
        const end = hours >= 24 ? `${shiftDate(day.date, 1)}T${String(hours - 24).padStart(2, '0')}${entry.end.slice(2)}:00` : `${day.date}T${entry.end}:00`;
        component.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(end), true));
      }
    } else {
      component.updatePropertyWithValue('dtstart', ICAL.Time.fromDateString(day.date));
      component.updatePropertyWithValue('dtend', ICAL.Time.fromDateString(shiftDate(day.date, 1)));
    }
    calendar.addSubcomponent(component);
  }
  return fold(calendar.toString());
}

/** Embedded VTIMEZONE is resolved by ICAL; IANA TZIDs without a definition use the platform's timezone database. */
function localTime(time: InstanceType<typeof ICAL.Time>, component: InstanceType<typeof ICAL.Component>, property: string): Date {
  const tzid = (component.getFirstProperty(property) ?? component.getFirstProperty('dtstart'))?.getParameter('tzid');
  if (time.zone !== ICAL.Timezone.localTimezone || !tzid || tzid === 'floating') return time.toJSDate();
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: String(tzid), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const desired = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  let instant = desired;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const actual = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    if (actual === desired) return new Date(instant);
    instant += desired - actual;
  }
  throw new Error(`Ungültige Uhrzeit in Zeitzone ${tzid}.`);
}

/** Preview first: series and multi-day events become individual, editable day entries. */
export function importCalendar(content: string, year = new Date().getFullYear()): CalendarPreview {
  if (new TextEncoder().encode(content).length > 5_000_000) throw new Error('Die ICS-Datei ist zu groß (höchstens 5 MB).');
  const calendar = new ICAL.Component(ICAL.parse(content.replace(/^\uFEFF/, '')));
  if (calendar.name !== 'vcalendar' || calendar.getFirstPropertyValue('version') !== '2.0') throw new Error('Keine gültige iCalendar-2.0-Datei.');
  const entries: CalendarImport[] = [], notices = new Set<string>(), identities = new Set<string>();
  const components = [...calendar.getAllSubcomponents('vevent'), ...calendar.getAllSubcomponents('vtodo')];
  if (!components.length) throw new Error('Die Datei enthält keine Ereignisse oder Aufgaben.');
  const from = `${year - 1}-01-01`, until = `${year + 3}-01-01`;
  let steps = 0;
  for (const component of components) {
    if (component.hasProperty('recurrence-id') && components.some(c => c !== component && !c.hasProperty('recurrence-id') && c.getFirstPropertyValue('uid') === component.getFirstPropertyValue('uid'))) continue;
    const task = component.name === 'vtodo' || component.getFirstPropertyValue('x-journal-kind') === 'task';
    if (!component.hasProperty('dtstart') && component.hasProperty('due')) component.updatePropertyWithValue('dtstart', component.getFirstPropertyValue('due'));
    if (!component.hasProperty('dtstart')) throw new Error('Ein Eintrag hat kein Datum. Es wurde nichts importiert.');
    const uid = String(component.getFirstPropertyValue('uid') || '');
    if (!uid) throw new Error('Ein Eintrag hat keine UID. Es wurde nichts importiert.');
    const event = new ICAL.Event(component);
    const recurring = event.isRecurring();
    if (recurring) {
      for (const rule of component.getAllProperties('rrule')) {
        const value = rule.getFirstValue() as InstanceType<typeof ICAL.Recur>;
        if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value.freq)) throw new Error('Serien mit stündlichen oder kürzeren Abständen werden nicht unterstützt.');
      }
      notices.add(`Serien werden von ${year - 1} bis ${year + 2} als einzelne Termine importiert, nicht als wiederholende Serie.`);
    }
    const iterator = recurring ? event.iterator() : null;
    let occurrence: InstanceType<typeof ICAL.Time> | null = iterator ? iterator.next() : event.startDate;
    while (occurrence) {
      if (++steps > 20000) throw new Error('Die Serie ist zu groß für den Import. Bitte einen kürzeren Kalenderzeitraum exportieren.');
      const details = recurring ? event.getOccurrenceDetails(occurrence) : { item: event, startDate: event.startDate, endDate: event.endDate };
      const source = details.item.component;
      if (!task && source.getFirstPropertyValue('status') === 'CANCELLED') { notices.add('Abgesagte Ereignisse werden nicht importiert.'); occurrence = iterator?.next() ?? null; continue; }
      const allDay = details.startDate.isDate;
      const start = allDay ? new Date(`${details.startDate.toString()}T00:00:00`) : localTime(details.startDate, source, 'dtstart');
      const end = allDay ? new Date(`${details.endDate.toString()}T00:00:00`) : localTime(details.endDate, source, 'dtend');
      const first = allDay ? details.startDate.toString() : localDate(start);
      if (recurring && first >= until) break;
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || !/^\d{4}-\d{2}-\d{2}$/.test(first)) throw new Error('Ein Termin enthält ein ungültiges Datum oder Ende.');
      const last = end > start ? localDate(new Date(end.getTime() - 1)) : first;
      if (first !== last) notices.add('Mehrtägige Termine werden in einzelne Tageseinträge aufgeteilt.');
      const summary = String(source.getFirstPropertyValue('summary') || t("Ohne Titel"));
      const description = String(source.getFirstPropertyValue('description') || '');
      const location = String(source.getFirstPropertyValue('location') || '');
      const originalText = source.getFirstPropertyValue('x-journal-text');
      const text = String(originalText ?? summary);
      // Older Journal exports duplicated their entire title into DESCRIPTION.
      const entryDescription = [originalText != null && !source.hasProperty('x-journal-description-version') && description === text ? '' : description, location ? `Ort: ${location}` : ''].filter(Boolean).join('\n\n');
      for (let date = first; date <= last; date = shiftDate(date, 1)) {
        if (recurring && (date < from || date >= until)) continue;
        if (entries.length >= 5000) throw new Error('Zu viele Kalendereinträge (höchstens 5000 pro Import).');
        const identity = `${uid}${recurring ? `#${occurrence.toString()}` : ''}${first !== last ? `#${date}` : ''}`;
        if (identities.has(identity)) throw new Error('Die Datei enthält doppelte Kalender-UIDs.');
        identities.add(identity);
        const time = allDay ? null : date === first ? clock(start) : '00:00';
        const finish = allDay || end.getTime() === start.getTime() ? null : date === localDate(end) ? clock(end) : '24:00';
        if (!allDay && (start.getSeconds() || end.getSeconds())) notices.add('Sekunden werden auf volle Minuten gerundet.');
        entries.push({ date, entry: {
          id: nativeUid.exec(identity)?.[1] ?? crypto.randomUUID(), calendarUid: identity, kind: task ? 'task' : 'event', text, description: entryDescription,
          done: task && (source.getFirstPropertyValue('x-journal-done') === 'TRUE' || source.getFirstPropertyValue('status') === 'COMPLETED'),
          cancelled: task && (source.getFirstPropertyValue('x-journal-cancelled') === 'TRUE' || source.getFirstPropertyValue('status') === 'CANCELLED'),
          priority: Number(source.getFirstPropertyValue('priority') || 0) > 0 && Number(source.getFirstPropertyValue('priority')) <= 4,
          time, end: finish && time && finish > time ? finish : null,
          reminder: source.getFirstPropertyValue('x-journal-reminder') === 'TRUE' || source.getAllSubcomponents('valarm').length > 0,
          showInJournal: source.getFirstPropertyValue('x-journal-show-in-journal') !== 'FALSE', plan: null,
        } });
      }
      occurrence = iterator?.next() ?? null;
    }
  }
  if (!entries.length) throw new Error('Keine Termine im unterstützten Serienzeitraum gefunden.');
  return { entries, notices: [...notices] };
}
