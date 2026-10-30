import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { Day, Entry, EntryKind, formatDate, journal, localDate, shiftDate, weekDates } from './journal';
import type { LinkedAction } from './journal';
import { Icon } from './components/Icon';
import { EntryChange, JournalEntry, entryLabels } from './components/JournalEntry';
import { useEntryDrag } from './components/useEntryDrag';
import { useListMotion } from './components/useListMotion';
import { ShortcutHelp } from './components/ShortcutHelp';
import { SettingsDialog } from './components/SettingsDialog';
import { Settings, loadSettings, saveSettings } from './settings';
import { adjacentText, focusText, titleInput } from './components/focus';
import type { TextField } from './components/entryEditor';
import { entryKindOrder, orderEntries, moveEntry, moveEntryByOffset } from './entries';
import { Calendar, CalendarWindow } from './components/CalendarWindow';
import type { EntryEdit, NewEntry } from './components/CalendarComposer';
import { useSidebarWidth } from './components/useSidebarWidth';
import { useWheelSwipe } from './components/useWheelSwipe';
import { MiniCalendar } from './components/MiniCalendar';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/lilex/400.css';
import '@fontsource/lilex/400-italic.css';
import '@fontsource/lilex/700.css';
import '@fontsource/lilex/700-italic.css';
import './styles.css';

// Bold and italic would otherwise load on first use, briefly rendering a fallback of a different width under the caret.
for (const face of ['400 13px Lilex', 'italic 400 13px Lilex', '700 13px Lilex', 'italic 700 13px Lilex']) void document.fonts.load(face);

// Tests stretch the wait (window.__journalAutosaveDelay) to count saves themselves.
const autosaveDelay = () => (window as { __journalAutosaveDelay?: number }).__journalAutosaveDelay ?? 700;
const prepareDay = (day: Day): Day => ({ ...day, entries: orderEntries(day.entries) });

// Returns a function with a stable identity that always calls the latest implementation.
function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback((...args: A) => ref.current(...args), []);
}

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
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const sidebar = useSidebarWidth();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const focusEntryId = useRef<string | null>(null);
  const focusMoveEntryId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);
  const captureLayout = useListMotion(entriesRef);
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
      // Pending edits are saved before the window closes; only if that fails, closing anyway is up to the user.
      if (!busyRef.current && !dirtyRef.current) return;
      event.preventDefault();
      closing.current = async () => {
        if (errorRef.current && !window.confirm(`${errorRef.current}\nFenster trotzdem schließen?`)) return;
        allowClose = true;
        await getCurrentWindow().close();
      };
      if (!busyRef.current) void save();
    }).then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(reason => setError(`Schließschutz konnte nicht eingerichtet werden: ${String(reason)}`));
    const handleKey = (event: KeyboardEvent) => onGlobalKey(event);
    window.addEventListener('keydown', handleKey);
    return () => { disposed = true; unlisten?.(); window.removeEventListener('keydown', handleKey); };
  }, []);

  // The calendar windows highlight the day shown here and send clicked days (and entries) back.
  const dateRef = useRef(date);
  dateRef.current = date;
  useEffect(() => { void emit('journal:date', date); }, [date]);
  useEffect(() => {
    const stops = [
      listen('journal:hello', () => { void emit('journal:date', dateRef.current); }),
      listen<{ date: string; entry: string | null }>('journal:navigate', event => showFromCalendar(event.payload.date, event.payload.entry)),
    ];
    return () => { for (const stop of stops) void stop.then(unlisten => unlisten()); };
  }, []);
  const openFromCalendar = useStableCallback((target: string, entryId?: string) => showFromCalendar(target, entryId ?? null));
  const showFromCalendar = useStableCallback((target: string, entryId: string | null) => {
    if (target !== date) {
      navigate(target);
      // The entry takes the focus when it mounts with the newly shown day.
      if (entryId) focusEntryId.current = entryId;
    } else if (entryId) focusText(document.querySelector<TextField>(`[data-entry-id="${entryId}"] .entry-text`));
  });

  function update(change: (current: Day) => Day) {
    editCount.current += 1;
    setDay(current => current ? change(current) : current);
    setDirty(true);
    setError('');
  }
  // Returns whether the day changes. With edits still pending, they are saved first and the day changes right after.
  const navigate = useStableCallback((target: string): boolean => {
    if (target === date || !target) return false;
    if (busyRef.current || dirtyRef.current) {
      pendingNavigation.current = target;
      if (!busyRef.current) void save();
      return true;
    }
    pendingNavigation.current = null;
    setSlide(null);
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
    return true;
  });
  // Stepping a day back or forth (buttons, Alt ←/→, swiping) slides the new day in from that side.
  const stepDay = useStableCallback((amount: 1 | -1) => { if (navigate(shiftDate(date, amount))) setSlide(amount > 0 ? 'next' : 'prev'); });
  const swipeDays = useWheelSwipe(stepDay);
  // Saving does not lock the editor: edits made while the request is running stay in place and remain unsaved.
  // The journal saves by itself shortly after the last change (like the calendar does at once); Ctrl+S saves right away.
  const save = useStableCallback(async () => {
    if (!day || !ready || busyRef.current || !dirty) return;
    const snapshot = day;
    const editsAtStart = editCount.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await journal.save(snapshot);
      const unchanged = editCount.current === editsAtStart;
      // Removing a linked entry can reach back into this very day (a chain planned back to it); then the stored state wins.
      if (unchanged && saved.touched?.includes(saved.date)) setDay(prepareDay(saved));
      else setDay(current => current && current.date === saved.date ? { ...current, revision: saved.revision } : current);
      if (unchanged) setDirty(false);
      setSavedCount(count => count + 1);
    }
    catch (reason) { setError(`Speichern fehlgeschlagen: ${String(reason)}`); pendingNavigation.current = null; }
    finally { busyRef.current = false; setBusy(false); }
  });
  const pendingNavigation = useRef<string | null>(null);
  const closing = useRef<(() => Promise<void>) | null>(null);
  const errorRef = useRef(error);
  errorRef.current = error;
  useEffect(() => {
    if (busy) return;
    if (dirty && !error) {
      // Typing goes on: each change restarts the wait. Leaving the day or the window does not wait.
      if (pendingNavigation.current || closing.current) { void save(); return; }
      const timer = window.setTimeout(() => void save(), autosaveDelay());
      return () => window.clearTimeout(timer);
    }
    if (closing.current) { const close = closing.current; closing.current = null; void close(); return; }
    if (pendingNavigation.current && !dirty) { const target = pendingNavigation.current; pendingNavigation.current = null; navigate(target); }
  }, [day, dirty, busy, error]);

  // Entries made in the calendar are saved at once. On the day shown here they join the editor (with any unsaved edits
  // of that day, which are saved along); other days are changed directly in the store.
  const pendingSave = useRef(false);
  useEffect(() => { if (pendingSave.current && !busy && ready) { pendingSave.current = false; void save(); } }, [day, busy]);
  const createFromCalendar = useStableCallback(async (target: string, made: NewEntry) => {
    const entry: Entry = { id: crypto.randomUUID(), kind: made.kind, text: made.text, done: false, cancelled: false, priority: made.priority, time: made.time, end: made.end, reminder: made.reminder, plan: null };
    if (target === date && ready) {
      captureLayout();
      update(current => ({ ...current, entries: orderEntries([...current.entries, entry]) }));
      pendingSave.current = true;
      return;
    }
    const stored = await journal.load(target);
    await journal.save({ ...stored, entries: [...stored.entries, entry] });
  });

  // Editing or removing an entry from the calendar works the same way: on the day shown here through the editor, elsewhere in the store.
  const editFromCalendar = useStableCallback(async (target: string, id: string, change: EntryEdit) => {
    if (target === date && ready) { changeEntry(id, change); pendingSave.current = true; return; }
    const stored = await journal.load(target);
    await journal.save({ ...stored, entries: stored.entries.map(entry => entry.id === id ? { ...entry, ...change } : entry) });
  });
  const removeFromCalendar = useStableCallback(async (target: string, id: string, others: { id: string; date: string }[] = []) => {
    if (target === date && ready) { removeEntry(id); pendingSave.current = true; }
    else {
      const stored = await journal.load(target);
      await journal.save({ ...stored, entries: stored.entries.filter(entry => entry.id !== id) });
    }
    if (others.length) await changeLinked(others, 'remove');
  });
  // An action chosen to reach linked entries too (ScopeChoice): those on the day shown change in the editor, all others in the store.
  const changeLinked = useStableCallback(async (others: { id: string; date: string }[], action: LinkedAction) => {
    const here = others.filter(other => other.date === date && ready);
    for (const other of here) {
      if (action === 'remove') removeEntry(other.id); else changeEntry(other.id, { done: action === 'done', cancelled: action === 'cancelled' });
    }
    const elsewhere = others.filter(other => !here.includes(other));
    try { if (elsewhere.length) await journal.changeLinked(elsewhere.map(other => ({ id: other.id, action }))); }
    catch (reason) { setError(`Ändern fehlgeschlagen: ${String(reason)}`); }
  });

  // New entries go directly below `afterId` when it is of the same kind, otherwise to the end of their group.
  const addEntry = useStableCallback((kind: EntryKind, afterId?: string) => {
    if (!ready) return;
    const entry: Entry = { id: crypto.randomUUID(), kind, text: '', done: false, cancelled: false, priority: false, time: null, reminder: false, plan: null };
    focusEntryId.current = entry.id;
    setNewEntryId(entry.id);
    setOpenEntryId(null);
    captureLayout();
    update(current => {
      const entries = [...current.entries];
      const index = entries.findIndex(item => item.id === afterId);
      if (index >= 0 && entries[index].kind === kind) entries.splice(index + 1, 0, entry); else entries.push(entry);
      return { ...current, entries: orderEntries(entries) };
    });
  });

  // Window-wide shortcuts; entry shortcuts are handled (and marked handled) by the focused entry first. See ShortcutHelp.
  const onGlobalKey = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const typing = target.matches('input, textarea, [contenteditable="true"]');
    const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const kinds: Record<string, EntryKind> = { KeyA: 'task', KeyE: 'event', KeyN: 'note' };
    if (ctrl && event.code === 'KeyS') save();
    else if (event.key === 'F1' || (event.key === '?' && !typing && !event.ctrlKey && !event.altKey)) setHelp(open => !open);
    else if (ctrl && event.key === ',') setSettingsOpen(open => !open);
    else if (help || settingsOpen) return;
    else if (alt && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) stepDay(event.key === 'ArrowLeft' ? -1 : 1);
    else if (alt && event.code === 'KeyH') navigate(today);
    else if (alt && event.code in kinds) addEntry(kinds[event.code], target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);
    else if (ctrl && event.code === 'KeyG') { dateInputRef.current?.focus(); try { dateInputRef.current?.showPicker(); } catch { /* not supported */ } }
    else if (ctrl && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) focusText(event.key === 'ArrowDown' ? adjacentText(null, 1) : titleInput());
    else return;
    event.preventDefault();
  });
  const changeEntry = useStableCallback((id: string, change: EntryChange) => {
    // Priority and kind decide the place in the list, so changing them re-sorts it.
    const resort = 'priority' in change || 'kind' in change;
    if (resort) captureLayout();
    update(current => {
      const entries = current.entries.map(entry => entry.id === id ? { ...entry, ...change } : entry);
      return { ...current, entries: resort ? orderEntries(entries) : entries };
    });
  });
  const removeEntry = useStableCallback((id: string) => {
    captureLayout();
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
    captureLayout();
    update(current => ({ ...current, entries }));
    return true;
  }
  const moveByOffset = useStableCallback((id: string, offset: -1 | 1, keepTextFocus?: boolean) =>
    day ? applyOrder(moveEntryByOffset(day.entries, id, offset), id, keepTextFocus) : false);
  const drag = useEntryDrag(scrollRef, (source, target, placement) => {
    if (day) applyOrder(moveEntry(day.entries, source, target, placement), source);
  });

  const entryCount = ready ? day.entries.length : 0;
  // A trace whose plan is already stored has created its target entries; only unsaved plans can be taken back.
  const savedTraces = new Set(ready ? journal.cached(day.date)?.entries.filter(entry => entry.plan).map(entry => entry.id) : []);
  return <div className={`app actions-${settings.actionLayout}${sidebar.dragging ? ' is-resizing' : ''}`}>
    {/* The sidebar is the calendar (its view switch in line with the toolbar next to it); dragging its edge sets the width. */}
    <aside className="sidebar" aria-label="Kalender und Navigation" style={{ width: sidebar.width }}>
      <Calendar embedded journalDate={date} onOpen={openFromCalendar} onCreate={createFromCalendar} onEdit={editFromCalendar} onRemove={removeFromCalendar} />
      <div className="sidebar-resizer" {...sidebar.handle} />
    </aside>

    {/* Swiping sideways on a trackpad, or Shift + wheel, turns the day; entries that are swiped themselves keep the gesture. */}
    <main className="main" onWheel={event => { if (!(event.target as Element).closest('.entry-dock-shell, .planner')) swipeDays(event); }}>
      <header className="topbar">
        <div className="document-tab"><Icon name="journal" /><span>Tagesjournal</span>{dirty && <span className="unsaved-dot" aria-label="Ungespeicherte Änderungen" />}</div>
        <nav className="navigation" aria-label="Tagesnavigation">
          <button type="button" className="icon-button" aria-label="Vorheriger Tag" title="Vorheriger Tag · Alt ←" onClick={() => stepDay(-1)}><Icon name="left" /></button>
          <button type="button" className="today-button" title="Heute · Alt H" disabled={date === today} onClick={() => navigate(today)}>Heute</button>
          <button type="button" className="icon-button" aria-label="Nächster Tag" title="Nächster Tag · Alt →" onClick={() => stepDay(1)}><Icon name="right" /></button>
          <span className="toolbar-separator" />
          <input ref={dateInputRef} type="date" aria-label="Datum auswählen" title="Gehe zu Datum · Strg G" value={date} onChange={event => navigate(event.target.value)} />
        </nav>
      </header>

      <div className="scroll" ref={scrollRef}>
        <div className="content">
          <div className={`document-header${slide ? ` slide-${slide}` : ''}`} key={`header-${date}`}>
            <div className="eyebrow">Tagesnotiz{date === today && <span className="today-label">Heute</span>}</div>
            <h1>{formatDate(date)}</h1>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          {!ready && !error && <p className="loading" role="status">Tagesnotiz wird geöffnet …</p>}
          {ready && <div className={`editor${slide ? ` slide-${slide}` : ''}`} key={day.date}>
            <label className="visually-hidden" htmlFor="title">Titel des Tages</label>
            <input id="title" className="title-input" placeholder="Gib deinem Tag einen Namen …" value={day.title}
              onKeyDown={event => { if ((event.key === 'Enter' || event.key === 'ArrowDown') && !event.altKey && !event.shiftKey && focusText(adjacentText(null, 1), 'end')) event.preventDefault(); }} onChange={event => { const title = event.target.value; update(current => ({ ...current, title })); }} />
            <section className="journal-section" aria-labelledby="entries-heading">
              <div className="section-heading">
                <div className="section-title"><h2 id="entries-heading">Einträge</h2><span className="entry-count">{day.entries.length}</span></div>
                <div className="kind-picker" role="group" aria-label="Eintrag hinzufügen">
                  {entryKindOrder.map(kind => <button type="button" key={kind} title={`Neu · Alt ${{ task: 'A', event: 'E', note: 'N' }[kind]}`} onClick={() => addEntry(kind)}><Icon name={kind} />{entryLabels[kind]}</button>)}
                </div>
              </div>
              <div className="entries" ref={entriesRef}>
                <span className="visually-hidden" id="entry-reorder-help">Innerhalb desselben Typs und derselben Priorität ziehen oder mit Alt und den Pfeiltasten nach oben und unten verschieben. Das funktioniert auch direkt im Text.</span>
                <span className="visually-hidden" role="status">{moveAnnouncement}</span>
                {day.entries.length === 0 && <div className="empty"><Icon name="journal" /><p>Ein neuer Tag. Platz für deine Gedanken.</p><span>Füge oben eine Aufgabe, Notiz oder ein Ereignis hinzu.</span></div>}
                {day.entries.map((entry, index) => <JournalEntry key={entry.id} layout={settings.actionLayout} entry={entry} day={day.date} onCreate={addEntry} traceSaved={savedTraces.has(entry.id)} onNavigate={navigate} isNew={entry.id === newEntryId} isOpen={entry.id === openEntryId} focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId}
                  isGroupStart={index > 0 && day.entries[index - 1].kind !== entry.kind}
                  canMoveUp={index > 0 && day.entries[index - 1].kind === entry.kind && day.entries[index - 1].priority === entry.priority}
                  canMoveDown={index < day.entries.length - 1 && day.entries[index + 1].kind === entry.kind && day.entries[index + 1].priority === entry.priority}
                  dragState={drag.view?.sourceId === entry.id ? 'source' : drag.view?.targetId === entry.id ? `drop-${drag.view.placement}` : null}
                  drag={drag.handlers} onMoveOffset={moveByOffset} onOpenChange={changeOpen} onChange={changeEntry} onRemove={removeEntry} onLinkedChange={changeLinked}
                />)}
              </div>
            </section>
          </div>}
        </div>
      </div>

      <footer className="statusbar">
        <div className={`save-status${dirty ? ' is-dirty' : ''}`} role="status"><span key={savedCount} className={`status-dot${savedCount && !dirty ? ' just-saved' : ''}`} />{busy ? 'Wird gespeichert …' : dirty ? (error ? 'Nicht gespeichert' : 'Wird gleich gespeichert …') : ready ? 'Gespeichert' : 'Wird geöffnet …'}</div>
        <div className="statusbar-actions"><button type="button" className="help-button settings-button" aria-label="Einstellungen" aria-keyshortcuts="Control+," title="Einstellungen · Strg ," onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button><button type="button" className="help-button" aria-label="Tastenkürzel" aria-keyshortcuts="F1" onClick={() => setHelp(true)}><span>?</span><kbd>F1</kbd></button><span className="toolbar-separator" /><span className="status-count">{entryCount} {entryCount === 1 ? 'Eintrag' : 'Einträge'}</span><span className="toolbar-separator" /><button type="button" className="save" disabled={!ready || !dirty || busy} onClick={() => { void save(); }}><Icon name="save" /><span>Speichern</span><kbd>Strg S</kbd></button></div>
      </footer>
    </main>
    {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onChange={next => { setOpenEntryId(null); setSettings(next); saveSettings(next); }} />}
  </div>;
}

// One bundle for all windows; the window's label decides what it shows.
const windowLabel = getCurrentWindow().label;
createRoot(document.getElementById('root')!).render(windowLabel === 'calendar' ? <CalendarWindow /> : windowLabel === 'mini' ? <MiniCalendar /> : <App />);
