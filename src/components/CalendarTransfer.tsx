import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CalendarDay, CalendarImport } from '../journal';
import type { CalendarPreview } from '../ical';
import { Icon } from './Icon';

export function CalendarTransfer({ onExport, onImport }: { onExport: () => Promise<CalendarDay[]>; onImport: (entries: CalendarImport[]) => Promise<void> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [preview, setPreview] = useState<CalendarPreview | null>(null);
  const ref = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !busy) { setOpen(false); setPreview(null); } };
    window.addEventListener('pointerdown', outside);
    ref.current?.querySelector<HTMLElement>('.cal-transfer-panel button')?.focus();
    return () => window.removeEventListener('pointerdown', outside);
  }, [open, busy]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  }
  return <div className="cal-transfer" ref={ref} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !busy) { event.preventDefault(); setOpen(false); setPreview(null); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" className="cal-icon-button" aria-label="Kalender importieren oder exportieren" title="Kalenderdatei (.ics)" aria-expanded={open} aria-controls="calendar-transfer" onClick={() => { if (!busy) { setOpen(value => !value); setPreview(null); setError(''); setMessage(''); } }}><Icon name="transfer" /></button>
    {open && <div className="cal-transfer-panel" id="calendar-transfer" role="dialog" aria-label="Kalenderdatei">
      <div className="cal-transfer-title"><strong>Kalenderdatei</strong><span>.ics</span></div>
      {!preview ? <>
        <p>Ereignisse und Aufgaben austauschen – auch Einträge, die nur im Kalender stehen.</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const content = await invoke<string | null>('read_calendar_file');
          if (content !== null) { const { importCalendar } = await import('../ical'); setPreview(importCalendar(content)); }
        })}><Icon name="down" /><span>Datei importieren</span></button>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const { exportCalendar } = await import('../ical');
          const days = await onExport();
          if (!days.some(day => day.entries.some(entry => !entry.plan && entry.kind !== 'note'))) { setMessage('Keine Ereignisse oder Aufgaben zum Exportieren.'); return; }
          if (await invoke<boolean>('write_calendar_file', { content: exportCalendar(days) })) setMessage('Kalender als ICS-Datei gespeichert.');
        })}><Icon name="up" /><span>Alle Einträge exportieren</span></button>
      </> : <>
        <p><strong>{preview.entries.length} {preview.entries.length === 1 ? 'Eintrag' : 'Einträge'}</strong> bereit zum Import. Bekannte Kalender-UIDs werden aktualisiert, andere Einträge bleiben erhalten.</p>
        {preview.notices.map(notice => <p className="cal-transfer-notice" key={notice}>{notice}</p>)}
        <button type="button" className="cal-transfer-confirm" disabled={busy} onClick={() => void run(async () => { await onImport(preview.entries); setMessage(`${preview.entries.length} Einträge importiert.`); setPreview(null); })}><Icon name="check" /><span>Importieren</span></button>
        <button type="button" disabled={busy} onClick={() => setPreview(null)}>Zurück</button>
      </>}
      {busy && <p role="status">Wird verarbeitet …</p>}
      {message && <p role="status">{message}</p>}
      {error && <p className="cal-transfer-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
