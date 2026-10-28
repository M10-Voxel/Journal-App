import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Day, Entry, EntryKind, formatDate, formatWeekday, journal, localDate, shiftDate, weekDates } from './journal';
import { Icon } from './components/Icon';
import { EntryChange, JournalEntry, entryLabels } from './components/JournalEntry';
import { useEntryDrag } from './components/useEntryDrag';
import { entryKindOrder, orderEntries, moveEntry, moveEntryByOffset } from './entries';
import './styles.css';

const prepareDay = (day: Day): Day => ({ ...day, entries: orderEntries(day.entries) });

// Returns a function with a stable identity that always calls the latest implementation.
function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback((...args: A) => ref.current(...args), []);
}

const WeekNav = memo(function WeekNav({ date, today, onNavigate }: { date: string; today: string; onNavigate: (date: string) => void }) {
  return <nav className="week-list" aria-label="Tage der ausgewählten Woche">
    {weekDates(date).map(value => <button key={value} type="button" className={`week-day${value === date ? ' selected' : ''}`} aria-label={formatDate(value)} aria-current={value === date ? 'date' : undefined} onClick={() => onNavigate(value)}>
      <span className="week-day-name">{formatWeekday(value)}</span>
      <span>{value.slice(8)}.{value.slice(5, 7)}.</span>
      {value === today && <span className="today-dot" title="Heute" />}
    </button>)}
  </nav>;
});

function App() {
  const [date, setDate] = useState(localDate);
  const [day, setDay] = useState<Day | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState('');
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [newEntryId, setNewEntryId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');
  const focusEntryId = useRef<string | null>(null);
  const focusMoveEntryId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const editCount = useRef(0);
  dirtyRef.current = dirty;
  busyRef.current = busy;
  const today = localDate();
  const ready = day !== null && day.date === date;

  useEffect(() => {
    let active = true;
    if (day?.date !== date) {
      setError('');
      journal.load(date).then(value => {
        if (active) { setDay(prepareDay(value)); setDirty(false); }
      }).catch(reason => { if (active) setError(String(reason)); });
    }
    // Warm the cache for the days that are one click away, once the current day is on screen.
    const idle = requestIdleCallback(() => { if (active) journal.prefetch([shiftDate(date, -1), shiftDate(date, 1), ...weekDates(date)]); }, { timeout: 500 });
    return () => { active = false; cancelIdleCallback(idle); };
  }, [date]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let allowClose = false;
    getCurrentWindow().onCloseRequested(async event => {
      if (allowClose) return;
      if (busyRef.current) { event.preventDefault(); return; }
      if (dirtyRef.current) {
        event.preventDefault();
        if (window.confirm('Es gibt ungespeicherte Änderungen. Fenster trotzdem schließen?')) {
          allowClose = true;
          await getCurrentWindow().close();
        }
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(reason => setError(`Schließschutz konnte nicht eingerichtet werden: ${String(reason)}`));
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => { disposed = true; unlisten?.(); window.removeEventListener('keydown', handleKey); };
  }, []);

  function update(change: (current: Day) => Day) {
    editCount.current += 1;
    setDay(current => current ? change(current) : current);
    setDirty(true);
    setError('');
  }
  const navigate = useStableCallback((target: string) => {
    if (busyRef.current || target === date || !target) return;
    if (dirtyRef.current && !window.confirm('Es gibt ungespeicherte Änderungen. Tag trotzdem wechseln?')) return;
    setOpenEntryId(null);
    setNewEntryId(null);
    drag.handlers.cancel();
    focusEntryId.current = null;
    focusMoveEntryId.current = null;
    setMoveAnnouncement('');
    // Cached days are swapped in within the same render, so the editor never blinks through a loading state.
    const cached = journal.cached(target);
    if (cached) setDay(prepareDay(cached));
    setDirty(false);
    setError('');
    setDate(target);
  });
  // Saving does not lock the editor: edits made while the request is running stay in place and remain unsaved.
  const save = useStableCallback(async () => {
    if (!day || !ready || busyRef.current || !dirty) return;
    const snapshot = day;
    const editsAtStart = editCount.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await journal.save(snapshot);
      setDay(current => current && current.date === saved.date ? { ...current, revision: saved.revision } : current);
      if (editCount.current === editsAtStart) setDirty(false);
      setSavedCount(count => count + 1);
    }
    catch (reason) { setError(`Speichern fehlgeschlagen: ${String(reason)}`); }
    finally { busyRef.current = false; setBusy(false); }
  });

  function addEntry(kind: EntryKind) {
    const entry: Entry = { id: crypto.randomUUID(), kind, text: '', done: false, cancelled: false };
    focusEntryId.current = entry.id;
    setNewEntryId(entry.id);
    setOpenEntryId(null);
    update(current => ({ ...current, entries: orderEntries([...current.entries, entry]) }));
  }
  const changeEntry = useStableCallback((id: string, change: EntryChange) => {
    update(current => ({ ...current, entries: current.entries.map(entry => entry.id === id ? { ...entry, ...change } : entry) }));
  });
  const removeEntry = useStableCallback((id: string) => {
    update(current => ({ ...current, entries: current.entries.filter(item => item.id !== id) }));
    setOpenEntryId(null);
  });
  const changeOpen = useCallback((id: string, open: boolean) => {
    setOpenEntryId(current => open ? id : current === id ? null : current);
  }, []);
  function applyOrder(entries: Entry[], id: string, keepTextFocus = false): boolean {
    if (!day || entries === day.entries) return false;
    const entry = entries.find(item => item.id === id)!;
    const siblings = entries.filter(item => item.kind === entry.kind);
    focusMoveEntryId.current = keepTextFocus ? null : id;
    setNewEntryId(null);
    setOpenEntryId(null);
    setMoveAnnouncement(`${entryLabels[entry.kind]} verschoben. Position ${siblings.indexOf(entry) + 1} von ${siblings.length}.`);
    update(current => ({ ...current, entries }));
    return true;
  }
  const moveByOffset = useStableCallback((id: string, offset: -1 | 1, keepTextFocus?: boolean) =>
    day ? applyOrder(moveEntryByOffset(day.entries, id, offset), id, keepTextFocus) : false);
  const drag = useEntryDrag(scrollRef, (source, target, placement) => {
    if (day) applyOrder(moveEntry(day.entries, source, target, placement), source);
  });

  const entryCount = ready ? day.entries.length : 0;
  return <div className="app">
    <aside className="sidebar" aria-label="Journal-Navigation">
      <div className="brand"><span className="brand-mark"><Icon name="journal" /></span><strong>Journal</strong></div>
      <div className="side-section-label">JOURNAL</div>
      <div className="side-active"><Icon name="calendar" /><span>Tagesnotizen</span></div>
      <div className="side-section-label week-label">WOCHE</div>
      <WeekNav date={date} today={today} onNavigate={navigate} />
      <div className="side-bottom"><Icon name="offline" /><span>Auf diesem Gerät<small>Offline verfügbar</small></span></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="document-tab"><Icon name="journal" /><span>Tagesjournal</span>{dirty && <span className="unsaved-dot" aria-label="Ungespeicherte Änderungen" />}</div>
        <nav className="navigation" aria-label="Tagesnavigation">
          <button type="button" className="icon-button" aria-label="Vorheriger Tag" title="Vorheriger Tag" onClick={() => navigate(shiftDate(date, -1))}><Icon name="left" /></button>
          <button type="button" className="today-button" disabled={date === today} onClick={() => navigate(today)}>Heute</button>
          <button type="button" className="icon-button" aria-label="Nächster Tag" title="Nächster Tag" onClick={() => navigate(shiftDate(date, 1))}><Icon name="right" /></button>
          <span className="toolbar-separator" />
          <input type="date" aria-label="Datum auswählen" value={date} onChange={event => navigate(event.target.value)} />
        </nav>
      </header>

      <div className="scroll" ref={scrollRef}>
        <div className="content">
          <div className="document-header">
            <div className="eyebrow">Tagesnotiz{date === today && <span className="today-label">Heute</span>}</div>
            <h1>{formatDate(date)}</h1>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          {!ready && !error && <p className="loading" role="status">Tagesnotiz wird geöffnet …</p>}
          {ready && <div className="editor" key={day.date}>
            <label className="visually-hidden" htmlFor="title">Titel des Tages</label>
            <input id="title" className="title-input" placeholder="Gib deinem Tag einen Namen …" value={day.title} onChange={event => { const title = event.target.value; update(current => ({ ...current, title })); }} />
            <section className="journal-section" aria-labelledby="entries-heading">
              <div className="section-heading">
                <div className="section-title"><h2 id="entries-heading">Einträge</h2><span className="entry-count">{day.entries.length}</span></div>
                <div className="kind-picker" role="group" aria-label="Eintrag hinzufügen">
                  {entryKindOrder.map(kind => <button type="button" key={kind} onClick={() => addEntry(kind)}><Icon name={kind} />{entryLabels[kind]}</button>)}
                </div>
              </div>
              <div className="entries">
                <span className="visually-hidden" id="entry-reorder-help">Innerhalb desselben Typs ziehen oder mit Alt und den Pfeiltasten nach oben und unten verschieben. Das funktioniert auch direkt im Text.</span>
                <span className="visually-hidden" role="status">{moveAnnouncement}</span>
                {day.entries.length === 0 && <div className="empty"><Icon name="journal" /><p>Ein neuer Tag. Platz für deine Gedanken.</p><span>Füge oben eine Aufgabe, Notiz oder ein Ereignis hinzu.</span></div>}
                {day.entries.map((entry, index) => <JournalEntry key={entry.id} entry={entry} isNew={entry.id === newEntryId} isOpen={entry.id === openEntryId} focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId}
                  isGroupStart={index > 0 && day.entries[index - 1].kind !== entry.kind}
                  canMoveUp={index > 0 && day.entries[index - 1].kind === entry.kind}
                  canMoveDown={index < day.entries.length - 1 && day.entries[index + 1].kind === entry.kind}
                  dragState={drag.view?.sourceId === entry.id ? 'source' : drag.view?.targetId === entry.id ? `drop-${drag.view.placement}` : null}
                  drag={drag.handlers} onMoveOffset={moveByOffset} onOpenChange={changeOpen} onChange={changeEntry} onRemove={removeEntry}
                />)}
              </div>
            </section>
          </div>}
        </div>
      </div>

      <footer className="statusbar">
        <div className={`save-status${dirty ? ' is-dirty' : ''}`} role="status"><span key={savedCount} className={`status-dot${savedCount && !dirty ? ' just-saved' : ''}`} />{busy ? 'Wird gespeichert …' : dirty ? 'Ungespeicherte Änderungen' : ready ? 'Gespeichert' : 'Wird geöffnet …'}</div>
        <div className="statusbar-actions"><span className="status-count">{entryCount} {entryCount === 1 ? 'Eintrag' : 'Einträge'}</span><span className="toolbar-separator" /><button type="button" className="save" disabled={!ready || !dirty || busy} onClick={() => { void save(); }}><Icon name="save" /><span>Speichern</span><kbd>Strg S</kbd></button></div>
      </footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
