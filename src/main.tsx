import { UndoShortcuts, flushHistoryWindows } from './components/UndoShortcuts';
import { t, useLanguage, setLanguage } from './i18n.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { Day, Entry, EntryKind, formatDate, journal, localDate, shiftDate, weekDates } from './journal';
import type { CalendarImport, LinkedAction, LinkedEdit, Reminder } from './journal';
import type { ScopeOption } from './planning';
import { ReminderPopup, ReminderToasts, chime } from './components/ReminderToasts';
import { Icon } from './components/Icon';
import { EntryChange, JournalEntry, entryLabels } from './components/JournalEntry';
import { useEntryDrag } from './components/useEntryDrag';
import { useListMotion } from './components/useListMotion';
import { ShortcutHelp } from './components/ShortcutHelp';
import { SettingsDialog } from './components/SettingsDialog';
import type { SettingsTab } from './components/SettingsDialog';
import { TagFilter } from './components/TagFilter';
import { manageTags, saveTags, useHiddenTags, useTags } from './tagStore';
import { ensureMailTags } from './mailTags';
import { filterKey, isShown, tagOf, tagRank } from './tags';

import { useMailImport } from './components/useMailImport';
import { MailImportToast } from './components/MailImportToast';
import { PeriodNotes } from './components/PeriodNotes';
import { BulletinBoard, FloatingNote } from './components/BulletinBoard';
import type { Mode } from './components/PeriodNotes';
import { Settings, applyTheme, loadSettings, saveSettings } from './settings';
import { ThemeSync } from './components/ThemeSync';
import { adjacentText, focusText, titleInput } from './components/focus';
import type { TextField } from './components/entryEditor';
import { entryKindOrder, orderEntries, moveEntry, moveEntryByOffset, mergeCalendarImport, sameGroup } from './entries';
import { Calendar, CalendarWindow } from './components/CalendarWindow';
import type { EntryEdit, NewEntry } from './components/CalendarComposer';
import { useSidebarWidth } from './components/useSidebarWidth';
import { useWheelSwipe } from './components/useWheelSwipe';
import { MiniCalendar } from './components/MiniCalendar';
import { MiniCalendarPicker } from './components/MiniCalendarPicker';
import { WindowControls } from './components/WindowControls';
import { NavCluster } from './components/NavCluster';
import { BookViewSwitch, JournalBook, useBookView } from './components/JournalBook';
import type { BookControl } from './components/JournalBook';
import { CalendarDrawer, CalendarRibbon, useCalendarDrawer } from './components/CalendarDrawer';
import type { BookPage } from './book';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/lilex/400.css';
import '@fontsource/lilex/400-italic.css';
import '@fontsource/lilex/700.css';
import '@fontsource/lilex/700-italic.css';
import './styles.css';
import './mail.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/vt323/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/source-serif-4/700-italic.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/400-italic.css';
import './pixel-sizes.css';
import './pixel.css';
import './colors.css';
import './tags.css';
import './journal-theme.css';
import { applyColors } from './colors';

applyTheme(loadSettings().theme);
applyColors(loadSettings());
setLanguage(loadSettings().language);

// Bold and italic would otherwise load on first use, briefly rendering a fallback of a different width under the caret.
// A single document.fonts.load is not enough: the built page links the stylesheet after this script, and the browser
// rebuilds its font faces when styles are added later (CodeMirror), loading again only faces in use. A hidden line in
// each face keeps all four in use.
const fontWarmup = document.createElement('div');
fontWarmup.className = 'font-warmup';
fontWarmup.setAttribute('aria-hidden', 'true');
fontWarmup.innerHTML = '<span>a</span><i>a</i><b>a</b><b><i>a</i></b>';
document.body.append(fontWarmup);

const periodModes: Mode[] = ['day', 'week', 'month', 'quarter', 'year'];
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
  const language = useLanguage();
  const [periodMode, setPeriodMode] = useState<Mode>('day');
  // Mail tags follow the language; they are created by the first mail import that needs them.
  useEffect(() => { void saveTags(current => ensureMailTags(current, language, false)).catch(() => {}); }, [language]);
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
  const driveWorking = useRef(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const openSettings = (tab: SettingsTab = 'appearance') => { setSettingsTab(tab); setSettingsOpen(true); };
  useEffect(() => manageTags.register(() => openSettings('tags')), []);
  const tags = useTags();
  const [hiddenTags, setHiddenTags] = useHiddenTags('journal');
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const sidebar = useSidebarWidth();
  // The journal style shows the app as a book; its calendar comes down from a ribbon instead of the sidebar.
  const bookMode = settings.theme === 'journal';
  const [bookView, setBookView] = useBookView();
  const [bookWide, setBookWide] = useState(true);
  const bookRef = useRef<BookControl>(null);
  const drawer = useCalendarDrawer();
  const toggleDrawer = (focus = false) => {
    const opening = !drawer.open;
    drawer.setOpen(opening);
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(opening ? '.calendar-drawer .cal' : '.calendar-ribbon')?.focus({ preventScroll: true }));
  };
  const datePickerButtonRef = useRef<HTMLButtonElement>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
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
    // Closing (×, Alt+F4) keeps Journal running in the background, so reminders keep coming; the icon in the notification
    // area opens it again or ends it ("Beenden" sends journal:quit). Either way pending edits are saved first; only if that
    // fails, going on anyway is up to the user.
    const whenSaved = (then: () => Promise<void>, question: string) => {
      closing.current = async () => {
        if (errorRef.current) { await getCurrentWindow().show(); if (!window.confirm(`${errorRef.current}\n${question}`)) return; }
        await then();
      };
      if (!busyRef.current && !dirtyRef.current) { const run = closing.current; closing.current = null; void run(); }
      else if (!busyRef.current) void save();
    };
    const toBackground = async () => {
      await getCurrentWindow().hide();
      if (!localStorage.getItem('journal.backgroundHint')) { localStorage.setItem('journal.backgroundHint', '1'); void invoke('background_hint').catch(() => {}); }
    };
    getCurrentWindow().onCloseRequested(event => {
      event.preventDefault();
      whenSaved(toBackground, t("Fenster trotzdem schließen?"));
    }).then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(reason => setError(t("Schließschutz konnte nicht eingerichtet werden: {0}", String(reason))));
    const quit = listen('journal:quit', () => whenSaved(() => invoke('quit_app'), t("Journal trotzdem beenden?")));
    const handleKey = (event: KeyboardEvent) => onGlobalKey(event);
    window.addEventListener('keydown', handleKey);
    return () => { disposed = true; unlisten?.(); void quit.then(stop => stop()); window.removeEventListener('keydown', handleKey); };
  }, []);

  // Entries are grouped in the order of their tags; a changed list (or the tags arriving) groups them anew.
  const tagOrder = tags.map(tag => tag.id).join();
  useEffect(() => { setDay(current => current ? { ...current, entries: orderEntries(current.entries) } : current); }, [tagOrder]);

  // The calendar windows highlight the day shown here and send clicked days (and entries) back.
  const dateRef = useRef(date);
  dateRef.current = date;
  useEffect(() => { void emit('journal:date', date); }, [date]);
  useEffect(() => {
    const stop = listen('history:restored', async () => {
      journal.invalidate();
      const target = dateRef.current;
      try {
        const value = await journal.load(target);
        if (dateRef.current === target) { setDay(prepareDay(value)); setDirty(false); setOpenEntryId(null); setNewEntryId(null); }
      } catch (reason) { setError(String(reason)); }
    });
    return () => { void stop.then(fn => fn()); };
  }, []);
  useEffect(() => {
    const stops = [
      listen('journal:hello', () => { void emit('journal:date', dateRef.current); }),
      listen<{ date: string; entry: string | null }>('journal:navigate', event => showFromCalendar(event.payload.date, event.payload.entry)),
      // Reminders while this window is in front (otherwise the popup shows them, see reminders.rs), and "Erledigt" from there.
      listen<Reminder>('journal:reminder', event => {
        const reminder = event.payload;
        setReminders(current => [...current.filter(item => item.id !== reminder.id), reminder].slice(-4));
        chime();
      }),
      listen<{ id: string; date: string; action: string }>('journal:reminder-action', event => {
        const { action } = event.payload;
        if (action === 'done' || action === 'cancelled') void changeLinked([event.payload], action);
      }),
    ];
    return () => { for (const stop of stops) void stop.then(unlisten => unlisten()); };
  }, []);
  // The calendar sheet over the book covers the left page; opening a day there folds it away so the day can be seen.
  const openFromCalendar = useStableCallback((target: string, entryId?: string) => {
    if (bookMode && settings.calendarDock === 'overlay' && drawer.open && settings.bookPaging !== 'spread') drawer.setOpen(false);
    showFromCalendar(target, entryId ?? null);
  });
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
  const stepPeriod = (amount: 1 | -1) => {
    if (periodMode === 'day') { stepDay(amount); return; }
    if (periodMode === 'week') { navigate(shiftDate(date, amount * 7)); return; }
    const [year, month, day] = date.split('-').map(Number);
    const count = periodMode === 'month' ? 1 : periodMode === 'quarter' ? 3 : 12;
    const first = new Date(year, month - 1 + amount * count, 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
    navigate(localDate(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last), 12)));
  };
  const mainRef = useRef<HTMLElement>(null);
  // In the book, swiping turns pages (JournalBook) instead of whole days.
  useWheelSwipe(stepPeriod, { root: bookMode ? undefined : mainRef, ignore:'.entry-dock-shell, .planner' });
  // Saving does not lock the editor: edits made while the request is running stay in place and remain unsaved.
  // The journal saves by itself shortly after the last change (like the calendar does at once); Ctrl+S saves right away.
  const save = useStableCallback(async () => {
    if (!day || !ready || busyRef.current) return false;
    if (!dirty) return true;
    // Edits chosen for "only this one" in the calendar stay with their entries in this save.
    const alone = [...keepAlone.current];
    keepAlone.current.clear();
    const snapshot = alone.length ? { ...day, keepAlone: alone } : day;
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
      return unchanged;
    }
    catch (reason) { setError(t("Speichern fehlgeschlagen: {0}", String(reason))); pendingNavigation.current = null; return false; }
    finally { busyRef.current = false; setBusy(false); }
  });
  // Saving is automatic; the UI checks ask for an immediate save (to count saves) with this event.
  useEffect(() => {
    const now = () => { void save(); };
    window.addEventListener('journal:save-now', now);
    return () => window.removeEventListener('journal:save-now', now);
  }, []);
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
  const keepAlone = useRef(new Set<string>());
  useEffect(() => { if (pendingSave.current && !busy && ready) { pendingSave.current = false; void save(); } }, [day, busy]);
  const createFromCalendar = useStableCallback(async (target: string, made: NewEntry) => {
    const entry: Entry = { id: crypto.randomUUID(), kind: made.kind, text: made.text, description: made.description, tag: made.tag ?? null, done: false, cancelled: false, priority: made.priority, time: made.time, end: made.end, reminder: made.reminder, showInJournal: made.showInJournal, plan: null, repeat: made.repeat ?? null };
    if (target === date && ready) {
      captureLayout();
      update(current => ({ ...current, entries: orderEntries([...current.entries, entry]) }));
      pendingSave.current = true;
      return;
    }
    const stored = await journal.load(target);
    await journal.save({ ...stored, entries: [...stored.entries, entry] });
  });

  const exportFromCalendar = useStableCallback(async () => {
    if (!await save()) throw new Error(t("Bitte laufende Änderungen zuerst speichern und erneut versuchen."));
    return journal.exportCalendar();
  });
  const importFromCalendar = useStableCallback(async (entries: CalendarImport[]) => {
    if (!await save()) throw new Error(t("Bitte laufende Änderungen zuerst speichern und erneut versuchen."));
    const target = date;
    const before = journal.cached(target);
    busyRef.current = true; setBusy(true);
    try {
      const touched = await journal.importCalendar(entries);
      if (touched.includes(target)) {
        const refreshed = await journal.load(target);
        // Keep typing done during the import, and merge only the imported fields into untouched entries.
        setDay(current => {
          if (!current || current.date !== target) return current;
          return mergeCalendarImport(current, before, refreshed);
        });
      }
    } finally { busyRef.current = false; setBusy(false); }
  });

  const mailStatus = useMailImport(importFromCalendar);

  // Editing or removing an entry from the calendar works the same way: on the day shown here through the editor, elsewhere in the store.
  // With a scope (ScopeChoice "only this / every Tuesday / all"), the edit stays with this entry when saved and reaches
  // exactly the chosen others; without one (an entry with no linked ones), saving passes text and kind on as usual.
  const editFromCalendar = useStableCallback(async (target: string, id: string, change: EntryEdit, scope?: ScopeOption) => {
    const alone = scope ? [id] : [];
    if (target === date && ready) { changeEntry(id, change); for (const one of alone) keepAlone.current.add(one); pendingSave.current = true; }
    else {
      const stored = await journal.load(target);
      await journal.save({ ...stored, entries: stored.entries.map(entry => entry.id === id ? { ...entry, ...change } : entry), keepAlone: alone });
    }
    if (!scope?.others.length || !change.kind) return;
    const edit: LinkedEdit = { kind: change.kind, text: change.text ?? '', description: change.description ?? '', tag: change.tag ?? null, priority: Boolean(change.priority),
      reminder: Boolean(change.reminder), showInJournal: change.showInJournal !== false, ...'time' in change ? { times: { time: change.time ?? null, end: change.end ?? null } } : {} };
    const here = scope.others.filter(other => other.date === date && ready);
    const same: EntryEdit = { kind: edit.kind, text: edit.text, description: edit.description, tag: edit.tag, priority: edit.priority, reminder: edit.reminder, showInJournal: edit.showInJournal,
      ...edit.times ? { time: edit.times.time, end: edit.times.end } : {}, ...edit.kind === 'task' ? {} : { done: false, cancelled: false } };
    for (const other of here) changeEntry(other.id, same);
    if (here.length) { for (const other of here) keepAlone.current.add(other.id); pendingSave.current = true; }
    const elsewhere = scope.others.filter(other => !here.includes(other)).map(other => other.id);
    if (elsewhere.length) await journal.editLinked(elsewhere, edit);
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
    catch (reason) { setError(t("Ändern fehlgeschlagen: {0}", String(reason))); }
  });

  const dismissReminder = (reminder: Reminder) => setReminders(current => current.filter(item => !(item.id === reminder.id && item.due === reminder.due)));

  // New entries go directly below `afterId` when it is of the same kind and tag, otherwise to the end of their group.
  // They take the tag of that entry; without one, while entries without a tag are hidden, the first tag shown.
  const addEntry = useStableCallback((kind: EntryKind, afterId?: string) => {
    if (!ready) return;
    const after = day.entries.find(item => item.id === afterId);
    const tag = after ? tagOf(tags, after.tag)?.id ?? null : isShown(hiddenTags, null) ? null : tags.find(item => !hiddenTags.has(item.id))?.id ?? null;
    const entry: Entry = { id: crypto.randomUUID(), kind, text: '', done: false, cancelled: false, priority: false, time: null, reminder: false, plan: null, tag };
    focusEntryId.current = entry.id;
    setNewEntryId(entry.id);
    setOpenEntryId(null);
    captureLayout();
    update(current => {
      const entries = [...current.entries];
      const index = entries.findIndex(item => item.id === afterId);
      if (index >= 0 && entries[index].kind === kind && tagRank(entries[index].tag) === tagRank(tag)) entries.splice(index + 1, 0, entry); else entries.push(entry);
      return { ...current, entries: orderEntries(entries) };
    });
  });

  // Window-wide shortcuts; entry shortcuts are handled (and marked handled) by the focused entry first. See ShortcutHelp.
  useEffect(()=>{let working=false;const stop=listen<{redo:boolean;emptyEntry?:string}>('history:request',async e=>{
    if(working || driveWorking.current)return;working=true;
    try {if(!await save())return;await flushHistoryWindows();await invoke('history_step',{redo:e.payload.redo,emptyEntry:e.payload.emptyEntry ?? null});}catch(reason){setError(String(reason));}finally{working=false;}
  });return()=>{void stop.then(fn=>fn());};},[]);
  const onGlobalKey = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || driveWorking.current) return;
    const target = event.target as HTMLElement;
    const typing = target.matches('input, textarea, [contenteditable="true"]');
    const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const kinds: Record<string, EntryKind> = { KeyA: 'task', KeyE: 'event', KeyN: 'note' };
    if (event.key === 'F1' || (event.key === '?' && !typing && !event.ctrlKey && !event.altKey)) setHelp(open => !open);
    else if (ctrl && event.key === ',') { setSettingsTab('appearance'); setSettingsOpen(open => !open); }
    else if (ctrl && event.code === 'KeyG') setDatePickerOpen(open => !open);
    // Ctrl+1–5: day, week, month, quarter, year (the tabs in the title bar, or the book's register tabs).
    else if (ctrl && /^Digit[1-5]$/.test(event.code)) setPeriodMode(periodModes[Number(event.code.slice(5)) - 1]);
    // Ctrl + / − / 0: the interface larger, smaller, or by the screen again (see Settings → Größe).
    else if (event.ctrlKey && !event.altKey && (event.key === '+' || event.key === '=' || event.key === '-' || event.code === 'Digit0' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract' || event.code === 'Numpad0')) {
      const larger = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const current = settings.uiScale === 'auto' ? Math.round(Number(document.documentElement.dataset.scale || 1) * 100) : Number(settings.uiScale);
      const uiScale: Settings['uiScale'] = event.code === 'Digit0' || event.code === 'Numpad0' ? 'auto' : `${Math.max(75, Math.min(200, current + (larger ? 5 : -5)))}`;
      const next = { ...settings, uiScale };
      setSettings(next); saveSettings(next);
    }
    else if (help || settingsOpen || datePickerOpen) return;
    else if (alt && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) stepDay(event.key === 'ArrowLeft' ? -1 : 1);
    else if (alt && event.code === 'KeyH') navigate(today);
    else if (alt && event.code in kinds) addEntry(kinds[event.code], target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);
    else if (ctrl && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) focusText(event.key === 'ArrowDown' ? adjacentText(null, 1) : titleInput());
    // The book: Ctrl+PageDown/PageUp turn a page, Ctrl+K brings the calendar down (Esc on the page takes it back up).
    else if (bookMode && ctrl && (event.key === 'PageDown' || event.key === 'PageUp')) bookRef.current?.turn(event.key === 'PageDown' ? 1 : -1);
    else if (bookMode && ctrl && event.code === 'KeyK') toggleDrawer(true);
    else if (bookMode && drawer.open && event.key === 'Escape' && target === document.body) toggleDrawer(true);
    else return;
    event.preventDefault();
  });
  const changeEntry = useStableCallback((id: string, change: EntryChange) => {
    // Priority, kind and tag decide the place in the list, so changing them re-sorts it.
    const resort = 'priority' in change || 'kind' in change || 'tag' in change;
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
  // Entries of hidden tags stay out of the list (a new one stays until it is left).
  function shownHere(entry: Entry) { return entry.showInJournal !== false && (isShown(hiddenTags, entry.tag) || entry.id === newEntryId); }
  function applyOrder(entries: Entry[], id: string, keepTextFocus = false): boolean {
    if (!day || entries === day.entries) return false;
    const entry = entries.find(item => item.id === id)!;
    const siblings = entries.filter(item => sameGroup(item, entry) && shownHere(item));
    focusMoveEntryId.current = keepTextFocus ? null : id;
    setNewEntryId(null);
    setOpenEntryId(null);
    setMoveAnnouncement(t("{0} verschoben. Position {1} von {2}.", entryLabels()[entry.kind], siblings.indexOf(entry) + 1, siblings.length));
    captureLayout();
    update(current => ({ ...current, entries }));
    return true;
  }
  const moveByOffset = useStableCallback((id: string, offset: -1 | 1, keepTextFocus?: boolean) =>
    day ? applyOrder(moveEntryByOffset(day.entries, id, offset, shownHere), id, keepTextFocus) : false);
  const drag = useEntryDrag(scrollRef, (source, target, placement) => {
    if (day) applyOrder(moveEntry(day.entries, source, target, placement), source);
  });

  const visibleEntries = ready ? day.entries.filter(shownHere) : [];
  const entryCount = visibleEntries.length;
  const hiddenByTag = ready ? day.entries.filter(entry => entry.showInJournal !== false && !shownHere(entry)).length : 0;
  // A trace whose plan is already stored has created its target entries; only unsaved plans can be taken back.
  const savedTraces = new Set(ready ? journal.cached(day.date)?.entries.filter(entry => entry.plan).map(entry => entry.id) : []);
  // The day's entries: the date, the title and the list. The classic view shows it above the checklist; the book on
  // its entries page (only for the day the app has loaded, `date`).
  const entriesPage = (pageDate = date) => {
    const here = ready && pageDate === date;
    const slideClass = slide && !bookMode ? ` slide-${slide}` : '';
    return <><div className={`document-header${slideClass}`}>
        <div className="eyebrow">{t("Tagesnotiz")}{pageDate === today && <span className="today-label">{t("Heute")}</span>}</div>
        <h1>{formatDate(pageDate)}</h1>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!here && !error && <p className="loading" role="status">{t("Tagesnotiz wird geöffnet …")}</p>}
      {here && <div className={`editor${slideClass}`}>
        <label className="visually-hidden" htmlFor="title">{t("Titel des Tages")}</label>
        <input id="title" className="title-input" placeholder={t("Gib deinem Tag einen Namen …")} value={day.title}
          onKeyDown={event => { if ((event.key === 'Enter' || event.key === 'ArrowDown') && !event.altKey && !event.shiftKey && focusText(adjacentText(null, 1), 'end')) event.preventDefault(); }} onChange={event => { const title = event.target.value; update(current => ({ ...current, title })); }} />
        <section className="journal-section" aria-labelledby="entries-heading">
          <div className="section-heading">
            <div className="section-title"><h2 id="entries-heading">{t("Einträge")}</h2><span className="entry-count">{entryCount}</span>
              {hiddenByTag > 0 && <button type="button" className="entry-hidden-count" data-tip={t("Alle Tags zeigen")} onClick={() => setHiddenTags(new Set())}><Icon name="tag" />{t("{0} ausgeblendet", hiddenByTag)}</button>}</div>
            <div className="kind-picker" role="group" aria-label={t("Eintrag hinzufügen")}>
              {entryKindOrder.map(kind => <button type="button" key={kind} title={t("Neu · Alt {0}", { task: 'A', event: 'E', note: 'N' }[kind])} onClick={() => addEntry(kind)}><Icon name={kind} />{entryLabels()[kind]}</button>)}
            </div>
          </div>
          <div className="entries" ref={entriesRef}>
            <span className="visually-hidden" id="entry-reorder-help">{t("Innerhalb desselben Typs und derselben Priorität ziehen oder mit Alt und den Pfeiltasten nach oben und unten verschieben. Das funktioniert auch direkt im Text.")}</span>
            <span className="visually-hidden" role="status">{moveAnnouncement}</span>
            {visibleEntries.length === 0 && <div className="empty"><Icon name="journal" /><p>{t("Ein neuer Tag. Platz für deine Gedanken.")}</p><span>{t("Füge oben eine Aufgabe, Notiz oder ein Ereignis hinzu.")}</span></div>}
            {visibleEntries.map((entry, index) => <JournalEntry key={entry.id} layout={settings.actionLayout} entry={entry} day={day.date} tag={tagOf(tags, entry.tag)}
              tagFirst={index === 0 || visibleEntries[index - 1].kind !== entry.kind || filterKey(visibleEntries[index - 1].tag) !== filterKey(entry.tag)}
              tagLast={index === visibleEntries.length - 1 || visibleEntries[index + 1].kind !== entry.kind || filterKey(visibleEntries[index + 1].tag) !== filterKey(entry.tag)} onCreate={addEntry} traceSaved={savedTraces.has(entry.id)} onNavigate={navigate} isNew={entry.id === newEntryId} isOpen={entry.id === openEntryId} focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId}
              isGroupStart={index > 0 && visibleEntries[index - 1].kind !== entry.kind}
              canMoveUp={index > 0 && sameGroup(visibleEntries[index - 1], entry)}
              canMoveDown={index < visibleEntries.length - 1 && sameGroup(visibleEntries[index + 1], entry)}
              dragState={drag.view?.sourceId === entry.id ? 'source' : drag.view?.targetId === entry.id ? `drop-${drag.view.placement}` : null}
              drag={drag.handlers} onMoveOffset={moveByOffset} onOpenChange={changeOpen} onChange={changeEntry} onRemove={removeEntry} onLinkedChange={changeLinked}
            />)}
          </div>
        </section>
      </div>}</>;
  };
  const bookPage = (page: BookPage) => page.page === 'entries' ? entriesPage(page.date)
    : page.page === 'board' ? <BulletinBoard date={page.date} />
    : <PeriodNotes date={page.date} mode={page.page === 'data' ? 'day' : periodMode} part={page.page === 'data' ? undefined : page.page} onManage={() => openSettings('activities')} onImport={importFromCalendar} />;
  const toolbarItems = <>
    <NavCluster label={periodMode === 'day' ? t("Tagesnavigation") : language === 'en' ? 'Period navigation' : 'Zeitraumnavigation'} prev={{ label: periodMode === 'day' ? t("Vorheriger Tag") : language === 'en' ? 'Previous period' : 'Vorheriger Zeitraum', tip: periodMode === 'day' ? t("Vorheriger Tag · Alt ←") : language === 'en' ? 'Previous period' : 'Vorheriger Zeitraum' }} next={{ label: periodMode === 'day' ? t("Nächster Tag") : language === 'en' ? 'Next period' : 'Nächster Zeitraum', tip: periodMode === 'day' ? t("Nächster Tag · Alt →") : language === 'en' ? 'Next period' : 'Nächster Zeitraum' }}
      today={{ tip: t("Heute · Alt H"), disabled: date === today }} atToday={date === today} onPrev={() => stepPeriod(-1)} onToday={() => navigate(today)} onNext={() => stepPeriod(1)} />
    <MiniCalendarPicker date={date} open={datePickerOpen} onOpenChange={setDatePickerOpen} onPick={navigate} buttonRef={datePickerButtonRef} />
    <div className="toolbar-end">{bookMode && <BookViewSwitch view={bookView} narrow={!bookWide} onChange={setBookView} />}{periodMode === 'day' && <TagFilter label={t("Tags im Journal")} hidden={hiddenTags} onChange={next => { setNewEntryId(null); setHiddenTags(next); }} />}</div>
  </>;
  const periodLabels = language === 'en' ? ['Day', 'Week', 'Month', 'Quarter', 'Year'] : ['Tag', 'Woche', 'Monat', 'Quartal', 'Jahr'];
  // The book's views as register tabs on its top edge (Ctrl+1–5).
  const register = <nav className="book-register" aria-label={language === 'en' ? 'Journal views' : 'Journalansichten'}>
    {periodModes.map((mode, index) => <button type="button" key={mode} className="book-register-tab" data-period-mode={mode} aria-current={periodMode === mode ? 'page' : undefined}
      title={`${periodLabels[index]} · ${t('Strg')} ${index + 1}`} onClick={() => setPeriodMode(mode)}>{periodLabels[index]}{index === 0 && dirty && <span className="unsaved-dot" aria-label={t("Ungespeicherte Änderungen")} />}</button>)}
  </nav>;
  const overlayCalendar = bookMode && settings.calendarDock === 'overlay';
  // Turning both pages at once, the sheet does not cover a page: the book shows one page beside it.
  const besideCalendar = overlayCalendar && drawer.open && settings.bookPaging === 'spread';
  const calendar = <Calendar embedded journalDate={date} onOpen={openFromCalendar} onCreate={createFromCalendar} onEdit={editFromCalendar} onRemove={removeFromCalendar} onExport={exportFromCalendar} onImport={importFromCalendar} />;
  return <div className={`app actions-${settings.actionLayout}${sidebar.dragging ? ' is-resizing' : ''}${bookMode ? ' is-book' : ''}`} onFocusCapture={event => {
    const target = event.target as HTMLElement;
    if (newEntryId && !target.closest('.popover') && target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId !== newEntryId) setNewEntryId(null);
  }}>
    {/* The sidebar is the calendar (its view switch in line with the toolbar next to it); dragging its edge sets the width.
        In the book it comes down from its ribbon instead and lies next to the book. */}
    {bookMode ? overlayCalendar ? null : <CalendarDrawer open={drawer.open} animated={drawer.animated} width={sidebar.width} resizer={sidebar.handle} disabled={driveBusy} onClose={() => toggleDrawer(true)}>{calendar}</CalendarDrawer>
      : <aside inert={driveBusy} className="sidebar" aria-label={t("Kalender und Navigation")} style={{ width: sidebar.width }}>
        {calendar}
        <div className="sidebar-resizer" {...sidebar.handle} />
      </aside>}

    {/* Swiping sideways on a trackpad, or Shift + wheel, turns the day; entries that are swiped themselves keep the gesture. */}
    <main inert={driveBusy} className="main" ref={mainRef}>
      <header className={`topbar${bookMode ? ' is-book-head' : ''}`} onMouseDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button, input, [role="dialog"]')) return;
        event.preventDefault();
        const window = getCurrentWindow();
        void (event.detail === 2 ? window.toggleMaximize() : window.startDragging()).catch(reason => setError(t("Fensteraktion fehlgeschlagen: {0}", String(reason))));
      }}>
        {/* In the book the views are its register tabs; turning and the date join the title bar, so there is one bar. */}
        {bookMode ? <div className="book-head-tools">{toolbarItems}</div> : <nav className="journal-tabs" aria-label={language === 'en' ? 'Journal views' : 'Journalansichten'}>{periodModes.map((mode, index) => <button type="button" key={mode} className="journal-tab" aria-current={periodMode === mode ? 'page' : undefined} onClick={() => setPeriodMode(mode)}><Icon name={({ day: 'journal', week: 'week', month: 'month', quarter: 'quarter', year: 'year' } as const)[mode]} /><span>{(language === 'en' ? ['Day', 'Week', 'Month', 'Quarter', 'Year'] : ['Tag', 'Woche', 'Monat', 'Quartal', 'Jahr'])[index]}</span>{index === 0 && dirty && <span className="unsaved-dot" aria-label={t("Ungespeicherte Änderungen")} />}</button>)}</nav>}
        {!bookMode && <div className="titlebar-space" />}
        {/* Settings sit with the window's own controls, where Zed and most apps keep them. */}
        <button type="button" className="titlebar-button titlebar-help" aria-label={t("Tastenkürzel")} aria-keyshortcuts="F1" title={t("Tastenkürzel") + ' · F1'} onClick={()=>setHelp(true)}>F1</button>
        <button type="button" className="titlebar-button settings-button" data-mail-count={mailStatus.count || undefined} aria-label={t("Einstellungen")} aria-keyshortcuts="Control+," title={t("Einstellungen · Strg ,")} onClick={() => openSettings()}><Icon name="settings" /></button>
        <WindowControls onError={setError} />
      </header>
      {/* Like the calendar's toolbar (and Zed's under its tabs): turning the days first, then what is shown. */}
      {!bookMode && <div className="toolbar">{toolbarItems}</div>}

      {bookMode ? <JournalBook mode={periodMode} date={date} view={bookView} paging={settings.bookPaging} beside={besideCalendar} sheetWidth={sidebar.width} onNavigate={navigate} renderPage={bookPage} entriesScrollRef={scrollRef} controlRef={bookRef} onWideChange={setBookWide}
        ribbon={<CalendarRibbon open={drawer.open} onToggle={() => toggleDrawer()} />} register={register}
        overlay={overlayCalendar && <CalendarDrawer overlay open={drawer.open} animated={drawer.animated} width={sidebar.width} resizer={sidebar.handle} resizable={besideCalendar || !(bookView === 'double' && bookWide)} disabled={driveBusy} onClose={() => toggleDrawer(true)}>{calendar}</CalendarDrawer>} />
        : <div className="scroll" ref={scrollRef}>
          <div className="content">
            {periodMode === 'day' && entriesPage()}
            <PeriodNotes date={date} mode={periodMode} onManage={() => openSettings('activities')} onImport={importFromCalendar} />
            {periodMode === 'day' && <BulletinBoard key={date} date={date} />}
          </div>
        </div>}

      <span className="visually-hidden save-status" role="status" key={savedCount}>{busy ? t("Wird gespeichert …") : dirty ? (error ? t("Nicht gespeichert") : t("Wird gleich gespeichert …")) : ready ? t("Gespeichert") : t("Wird geöffnet …")}</span>
    </main>
    <ReminderToasts reminders={reminders} today={today} snoozeMinutes={10}
      onStatus={(reminder, status) => { dismissReminder(reminder); void changeLinked([reminder], status); }}
      onSnooze={reminder => { dismissReminder(reminder); journal.snoozeReminder(reminder).catch(reason => setError(t("Erinnerung: {0}", String(reason)))); }}
      onOpen={reminder => { dismissReminder(reminder); showFromCalendar(reminder.date, reminder.id); }} onDismiss={dismissReminder} />
    {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    {settingsOpen && <SettingsDialog key={settingsTab} initialTab={settingsTab} beforeSync={async () => { if (!await save()) throw new Error("Lokale ?nderungen konnten nicht gespeichert werden."); }} onDriveBusy={value => { driveWorking.current = value; setDriveBusy(value); }} settings={settings} mailStatus={mailStatus} onImport={importFromCalendar} onClose={() => { if (!driveWorking.current) setSettingsOpen(false); }} onChange={next => { setOpenEntryId(null); setSettings(next); saveSettings(next); }} />}
  </div>;
}

// One bundle for all windows; the window's label decides what it shows.
const windowLabel = getCurrentWindow().label;
if (windowLabel === 'reminder') document.documentElement.classList.add('is-popup');
createRoot(document.getElementById('root')!).render(<><ThemeSync /><UndoShortcuts />{windowLabel.startsWith('board-') ? <FloatingNote /> : windowLabel === 'calendar' ? <CalendarWindow /> : windowLabel === 'mini' ? <MiniCalendar /> : windowLabel === 'reminder' ? <ReminderPopup /> : <App />}{!windowLabel.startsWith('board-') && !['mini', 'reminder'].includes(windowLabel) && <MailImportToast />}</>);
