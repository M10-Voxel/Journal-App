import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { formatShortDate } from '../dates';
import { formatSpan } from '../planning';
import { Icon } from './Icon';

interface Imported { id: string; text: string; date: string; time?: string | null; end?: string | null }

/** A confirmation after the calendar write succeeds, in journal and calendar windows. */
export function MailImportToast() {
  const [items, setItems] = useState<Imported[]>([]);
  useEffect(() => {
    const stop = listen<Imported[]>('journal:mail-imported', event => setItems(current => [...current, ...event.payload]));
    return () => { void stop.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    if (!items.length) return;
    const timer = window.setTimeout(() => setItems([]), 12_000);
    return () => clearTimeout(timer);
  }, [items]);
  if (!items.length) return null;
  return <aside className="mail-import-toast" role="status" aria-live="polite" aria-label="Kalendereinträge aus E-Mails">
    <Icon name="calendar" />
    <div><strong>{items.length === 1 ? 'Termin aus E-Mail eingetragen' : `${items.length} Termine aus E-Mails eingetragen`}</strong>
      {items.slice(-3).map((item, index) => <p key={`${item.id}-${index}`}><span>{item.text}</span><small>{formatShortDate(item.date)} · {item.time ? formatSpan(item.time, item.end) : 'ganztägig'}</small></p>)}
      {items.length > 3 && <small>und {items.length - 3} weitere</small>}
    </div>
    <button type="button" aria-label="Hinweis schließen" onClick={() => setItems([])}><Icon name="done" /></button>
  </aside>;
}
