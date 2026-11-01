import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Reminder } from '../journal';
import { formatShortDate, localDate } from '../dates';
import { formatSpan } from '../planning';
import { plainText } from '../markdown';
import { Icon } from './Icon';

/** "14:15–15:00", "Sa., 31.10. · 09:00", "verpasst · 07:30". */
export function reminderWhen(reminder: Reminder, today: string): string {
  const parts = [reminder.snoozed ? 'Erneut' : reminder.late ? 'Verpasst' : 'Erinnerung'];
  if (reminder.date !== today) parts.push(formatShortDate(reminder.date));
  parts.push(reminder.time ? formatSpan(reminder.time, reminder.end) : 'ganztägig');
  return parts.join(' · ');
}

// Reminders while the journal is in front pop up here, bottom right above the status bar, instead of as a Windows
// notification: a card like the app's other floating parts, the bell ringing over the entry's symbol, the text in the
// writing font, and the choices: finish or cancel (tasks), later, open the day, close.
// Several stack; they stay until answered, like the notification does.
export function ReminderToasts({ reminders, today, snoozeMinutes, onStatus, onSnooze, onOpen, onDismiss, onQuit }: {
  reminders: Reminder[]; today: string; snoozeMinutes: number;
  onStatus: (reminder: Reminder, status: 'done' | 'cancelled') => void; onSnooze: (reminder: Reminder) => void; onOpen: (reminder: Reminder) => void; onDismiss: (reminder: Reminder) => void; onQuit?: () => void;
}) {
  // A snoozed card says until when for a moment before it goes, so "later" visibly took effect.
  const [snoozing, setSnoozing] = useState<Record<string, string>>({});
  const snooze = (reminder: Reminder) => {
    const key = `${reminder.id}-${reminder.due}`;
    if (snoozing[key]) return;
    const until = new Date(Date.now() + snoozeMinutes * 60_000);
    setSnoozing(current => ({ ...current, [key]: `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}` }));
    setTimeout(() => { onSnooze(reminder); setSnoozing(({ [key]: _, ...rest }) => rest); }, 1300);
  };
  if (!reminders.length) return null;
  return <div className="reminders" role="region" aria-label="Erinnerungen">
    {reminders.map(reminder => {
      // Notes from the app itself: that it keeps running in the background (after closing the window the first time), or
      // that more reminders were missed than fit here.
      if (reminder.kind === 'info') return <div key={reminder.id} className="reminder is-info" role="status">
        <span className="reminder-icon" aria-hidden="true"><Icon name={reminder.id === 'missed' ? 'bell' : 'journal'} /></span>
        <div className="reminder-body">
          <span className="reminder-when">{reminder.id === 'missed' ? 'Verpasst' : 'Im Hintergrund'}</span>
          <span className="reminder-text is-info">{reminder.text}</span>
          <div className="reminder-actions">
            <button type="button" className="reminder-done" onClick={() => onDismiss(reminder)}><Icon name="check" /><span>Verstanden</span></button>
            {reminder.id === 'missed' && <button type="button" className="reminder-open" onClick={() => onOpen(reminder)}><Icon name="jump" /><span>Öffnen</span></button>}
            {reminder.id === 'background' && onQuit && <button type="button" className="reminder-quit" onClick={onQuit}><Icon name="done" /><span>Beenden</span></button>}
          </div>
        </div>
      </div>;
      const text = plainText(reminder.text.split('\n')[0] ?? '').trim() || 'Ohne Text';
      const later = snoozing[`${reminder.id}-${reminder.due}`];
      return <div key={`${reminder.id}-${reminder.due}`} className={`reminder is-${reminder.kind}${reminder.late ? ' is-late' : ''}${later ? ' is-snoozed' : ''}`} role="alertdialog" aria-label={`${reminderWhen(reminder, today)}: ${text}`}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(reminder); } }}>
        <span className="reminder-icon" aria-hidden="true"><Icon name="bell" /><i className="reminder-kind"><Icon name={reminder.kind === 'task' ? 'task' : 'event'} /></i></span>
        <div className="reminder-body">
          <span className="reminder-when">{reminderWhen(reminder, today)}</span>
          <span className="reminder-text" title={text}>{text}</span>
          {later ? <div className="reminder-later" role="status"><Icon name="clock" /><span>Wieder um {later}</span></div> : <div className="reminder-actions">
            {reminder.kind === 'task' && <>
              <button type="button" className="reminder-done" onClick={() => onStatus(reminder, 'done')}><Icon name="check" /><span>Erledigt</span></button>
              <button type="button" className="reminder-cancel" aria-label="Abbrechen" title="Abbrechen" onClick={() => onStatus(reminder, 'cancelled')}><Icon name="cancel" /></button>
            </>}
            <button type="button" className="reminder-snooze" onClick={() => snooze(reminder)}><Icon name="clock" /><span>{snoozeMinutes} Min.</span></button>
            <button type="button" className="reminder-open" onClick={() => onOpen(reminder)}><Icon name="jump" /><span>Öffnen</span></button>
          </div>}
        </div>
        <button type="button" className="reminder-close" aria-label="Erinnerung schließen" onClick={() => onDismiss(reminder)}><Icon name="done" /></button>
      </div>;
    })}
  </div>;
}

/** A soft two-note chime, so a reminder in the app is noticed without the Windows sound. */
export function chime() {
  try {
    const audio = new AudioContext();
    for (const [index, frequency] of [880, 1318.5].entries()) {
      const tone = audio.createOscillator(), gain = audio.createGain();
      const start = audio.currentTime + index * 0.16;
      tone.type = 'sine'; tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      tone.connect(gain).connect(audio.destination);
      tone.start(start); tone.stop(start + 0.62);
    }
    setTimeout(() => void audio.close(), 1200);
  } catch { /* without audio the card still shows */ }
}

/**
 * The popup window outside the app (label "reminder", see reminders.rs): the same cards, on a transparent background.
 * The store sends the whole list on every change; the window is sized to it, and new reminders chime.
 */
export function ReminderPopup() {
  const [items, setItems] = useState<Reminder[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const known = useRef(new Set<string>());
  useEffect(() => {
    void invoke<Reminder[]>('popup_reminders').then(setItems);
    const stop = listen<Reminder[]>('journal:popup', event => setItems(event.payload));
    return () => { void stop.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    const fresh = items.filter(item => item.kind !== 'info' && !known.current.has(`${item.id}-${item.due}`));
    for (const item of items) known.current.add(`${item.id}-${item.due}`);
    if (fresh.length) chime();
  }, [items]);
  useLayoutEffect(() => {
    const height = rootRef.current?.offsetHeight;
    if (height) void invoke('fit_popup', { height });
  }, [items]);
  const answer = (reminder: Reminder, action: string) => invoke('reminder_action', { id: reminder.id, due: reminder.due, action });
  return <div className="reminder-popup" ref={rootRef}>
    <ReminderToasts reminders={items} today={localDate()} snoozeMinutes={10} onStatus={(item, status) => void answer(item, status)} onSnooze={item => void answer(item, 'snooze')}
      onOpen={item => void answer(item, 'open')} onDismiss={item => void answer(item, 'dismiss')} onQuit={() => { const hint = items.find(item => item.kind === 'info'); if (hint) void answer(hint, 'quit'); }} />
  </div>;
}
