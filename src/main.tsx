import type { CalendarDay } from './journal';
import { WindowActivity } from './components/WindowActivity';
import { useViewHistory } from './viewHistory';
import { UndoShortcuts, flushHistoryWindows } from './components/UndoShortcuts';
import { t, useLanguage, setLanguage } from './i18n.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DayEditor } from './components/DayEditor';
import { DesktopWidgetWindow } from './components/DesktopWidgetWindow';
import { isDesktopWidgetLabel } from './widgetIdentity';
import type { DesktopWidgetState } from './desktopWidgets';
import { flushEditorSessions, hasEditorDrafts, installEditorHost, loadEditorDay, publishEditorDay, reloadEditorSessions, serializeEditorMutation } from './editorBridge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { Day, Entry, EntryKind, formatDate, journal, localDate, shiftDate, weekDates } from './journal';
import type { CalendarImport, LinkedAction, LinkedEdit, Reminder } from './journal';
import type { ScopeOption } from './planning';
import type { CalendarRequest } from './calendarRequests';
import { ReminderPopup, ReminderToasts, chime } from './components/ReminderToasts';
import { Icon } from './components/Icon';
import { EntryChange, entryLabels } from './components/JournalEntry';
import { useEntryDrag } from './components/useEntryDrag';
import { useListMotion } from './components/useListMotion';
import { ShortcutHelp } from './components/ShortcutHelp';
import { SettingsDialog } from './components/SettingsDialog';
import type { SettingsTab } from './components/SettingsDialog';
import { TagFilter } from './components/TagFilter';
import { manageTags, saveTags, useHiddenTags, useTags } from './tagStore';
import { ensureMailTags } from './mailTags';
import { isShown, tagOf, tagRank } from './tags';

import { useMailImport } from './components/useMailImport';
import { MailImportToast } from './components/MailImportToast';
import { UpdateNotice } from './components/UpdateNotice';
import { PeriodNotes } from './components/PeriodNotes';
import { BulletinBoard, FloatingNote } from './components/BulletinBoard';
import type { Mode } from './components/PeriodNotes';
import { hasPinboard } from './periods';
import { Settings, applyTheme, loadSettings, saveSettings, swipeAvailable } from './settings';
import { usePopupLook } from './popupLook';
import { ThemeSync } from './components/ThemeSync';
import { adjacentText, focusText, titleInput } from './components/focus';
import type { TextField } from './components/entryEditor';
import { orderEntries, moveEntry, moveEntryByOffset, mergeCalendarImport, sameGroup } from './entries';
import { Calendar, CalendarWindow } from './components/CalendarWindow';
import type { EntryEdit, NewEntry } from './components/CalendarComposer';
import { useSidebarWidth } from './components/useSidebarWidth';
import { useWheelSwipe } from './components/useWheelSwipe';
import { MiniCalendar } from './components/MiniCalendar';
import { MiniCalendarPicker } from './components/MiniCalendarPicker';
import { WindowControls } from './components/WindowControls';
import { NavCluster } from './components/NavCluster';
import { JournalBook, pageHeading, useBookView } from './components/JournalBook';
import type { BookControl } from './components/JournalBook';
import { CalendarDrawer, CalendarTab, NotebookTab, calendarDrawerKey, notebookDrawerKey, useDrawer } from './components/CalendarDrawer';
import { Notebook } from './components/Notebook';
import { SearchBox, SearchTab } from './components/Search';
import { ContextMenuHost } from './components/ContextMenu';
import type { SearchResult } from './search';
import { DetachedPanel, detachable } from './components/DetachedPanel';
import type { DetachedKind } from './components/DetachedPanel';
import type { BookPage } from './book';
import { NebulaDesk } from './components/NebulaDesk';
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
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/400-italic.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/space-mono/700-italic.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './pixel-sizes.css';
import './pixel.css';
import './colors.css';
import './tags.css';
import './popups.css';
import './journal-theme.css';
import './nebula-theme.css';
import './nebula-grid.css';
import './nebula-holo.css';
import './nebula-ticket.css';
import './popup-styles.css';
import './entryIcons.css';
import './popup-fields.css';
import './popup-sheets.css';
import './popup-chrome.css';
import './search.css';
import './components/mailDetails.css';
import './components/appNotices.css';
import './components/desktopWidgets.css';
import { applyColors } from './colors';

applyTheme(loadSettings());
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
  const boardPeriod = periodMode === 'month' || periodMode === 'year' ? periodMode : 'day';
  // Mail tags follow the language; they are created by the first mail import that needs them.
  useEffect(() => { void saveTags(current => ensureMailTags(current, language, false)).catch(() => {}); }, [language]);
  const [date, setDate] = useState(localDate);
  const [day, setDay] = useState<Day | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState(() => { const message = localStorage.getItem('journal.vaultError') ?? ''; localStorage.removeItem('journal.vaultError'); return message; });
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [newEntryId, setNewEntryId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // The popup look decides how an entry's actions open: Normal · Karte the orbit, Glas the words under the entry, the others their own sheet
  // (ActionSheet). Swiping stays for touch screens.
  const popupLook = usePopupLook();
  const actionLayout = settings.actionLayout === 'swipe' && swipeAvailable() ? 'swipe' : popupLook === 'classic-a' ? 'orbit' : popupLook === 'classic-b' ? 'inline' : 'sheet';
  const driveWorking = useRef(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null);
  const openSettings = (tab: SettingsTab = 'appearance', widgetId: string | null = null) => { setSettingsWidgetId(widgetId); setSettingsTab(tab); setSettingsOpen(true); };
  /** The checklist's and the day values' settings, from their windows and pages. */
  const manageData = (tab: 'activities' | 'scales' = 'activities') => openSettings(tab);
  useEffect(() => manageTags.register(() => openSettings('tags')), []);
  const tags = useTags();
  const [hiddenTags, setHiddenTags] = useHiddenTags('journal');
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const sidebar = useSidebarWidth();
  // The journal style shows the app as a book; its calendar comes down from a ribbon instead of the sidebar.
  const bookMode = settings.theme === 'journal';
  // Nebula lays the app out as a desktop of terminals (NebulaDesk); its calendar is a window of its own over them.
  const nebulaMode = settings.theme === 'nebula';
  // Both have their own head for the day (the book's page, Nebula's poster) and their own calendar (Ctrl+K).
  const ownLayout = bookMode || nebulaMode;
  const [bookView, setBookView] = useBookView();
  const [bookWide, setBookWide] = useState(true);
  const bookRef = useRef<BookControl>(null);
  const drawer = useDrawer(calendarDrawerKey);
  // The notebook: a sheet pulled out on the left like the calendar's (journal), a window beside the calendar's (Nebula),
  // a tab (normal).
  const notebook = useDrawer(notebookDrawerKey);
  const lastSheet = useRef<'calendar' | 'notebook'>('calendar');
  // In the book a sheet lies on the left page; with both out the notebook moves to the right page. That needs a spread:
  // on one page (or in a narrow window) the sheet taken out last puts the other back.
  const sheetsFit = bookView === 'double' && bookWide;
  const bothSheets = bookMode && drawer.open && notebook.open && sheetsFit;
  useEffect(() => { if (bookMode && drawer.open && notebook.open && !sheetsFit) (lastSheet.current === 'notebook' ? drawer : notebook).setOpen(false); }, [bookMode, drawer.open, notebook.open, sheetsFit]);
  // The window has no system title bar: its own bar (or, in the book, the cover) moves it; a double click maximizes.
  const dragWindow = (event: React.MouseEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button, input, [role="dialog"], .search')) return;
    event.preventDefault();
    const window = getCurrentWindow();
    void (event.detail === 2 ? window.toggleMaximize() : window.startDragging()).catch(reason => setError(t("Fensteraktion fehlgeschlagen: {0}", String(reason))));
  };
  const toggleDrawer = (focus = false) => {
    const opening = !drawer.open;
    if (opening) lastSheet.current = 'calendar';
    drawer.setOpen(opening);
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(opening ? '.calendar-drawer .cal, .nebula-calendar .cal' : '.calendar-tab, .nebula-calendar-toggle')?.focus({ preventScroll: true }));
  };
  const toggleNotebook = (focus = false) => {
    const opening = !notebook.open;
    if (opening) lastSheet.current = 'notebook';
    notebook.setOpen(opening);
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(opening ? '.notebook .notebook-search input' : '.notebook-tab, .nebula-notebook-toggle, .journal-tab.is-notebook')?.focus({ preventScroll: true }));
  };
  // Choosing a view (day … year) in the normal design leaves the notebook's tab.
  const choosePeriod = (mode: Mode) => { setPeriodMode(mode); if (!ownLayout && notebook.open) notebook.setOpen(false); };
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
      loadEditorDay(date, value => {
        if (active) { flushSync(() => { setDay(prepareDay(value)); setDirty(false); }); }
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
        try { await emit('editor:paused', true); await flushHistoryWindows(); }
        catch (reason) { setError(String(reason)); await emit('editor:paused', false); await getCurrentWindow().show(); return; }
        if (errorRef.current) { await getCurrentWindow().show(); if (!window.confirm(`${errorRef.current}\n${question}`)) { await emit('editor:paused', false); return; } }
        await then();
        await emit('editor:paused', false);
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
  const boardContext = { date, period: boardPeriod };
  const boardContextRef = useRef(boardContext); boardContextRef.current = boardContext;
  useEffect(() => { void emit('journal:board-context', { date, period: boardPeriod }); }, [date, boardPeriod]);
  const historyWrite = useRef(false);
  const restoreMainDay = useStableCallback(async () => {
    journal.invalidate();
    const target = dateRef.current;
    const value = await journal.load(target);
    if (dateRef.current === target) flushSync(() => { dirtyRef.current = false; setDay(prepareDay(value)); setDirty(false); setOpenEntryId(null); setNewEntryId(null); });
  });
  useEffect(() => {
    const stop = listen('history:restored', async () => {
      if (historyWrite.current) return;
      try {
        await restoreMainDay(); await reloadEditorSessions();
      } catch (reason) { setError(String(reason)); }
    });
    return () => { void stop.then(fn => fn()); };
  }, []);
  useEffect(() => {
    const stops = [
      listen('journal:hello', () => { void emit('journal:date', dateRef.current); void emit('journal:board-context', boardContextRef.current); }),
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
    if ((bookMode && drawer.open && settings.bookPaging !== 'spread') || (nebulaMode && drawer.open)) drawer.setOpen(false);
    showFromCalendar(target, entryId ?? null);
  });
  const showFromCalendar = useStableCallback((target: string, entryId: string | null) => {
    notebook.setOpen(false);
    setPeriodMode('day');
    if (target !== date) {
      navigate(target);
      // The entry takes the focus when it mounts with the newly shown day.
      if (entryId) focusEntryId.current = entryId;
    } else if (entryId) focusText(document.querySelector<TextField>(`[data-entry-id="${entryId}"] .entry-text`));
  });

  function update(change: (current: Day) => Day) {
    editCount.current += 1;
    dirtyRef.current = true;
    setDay(current => current ? change(current) : current);
    setDirty(true);
    setError('');
  }
  // Returns whether the day changes. With edits still pending, they are saved first and the day changes right after.
  const navigate = useStableCallback((target: string): boolean => {
    if (target === date || !target) return false;
    if (hasEditorDrafts()) {
      const running = pendingWidgetNavigation.current !== null;
      pendingWidgetNavigation.current = target;
      if (!running) void flushEditorSessions().then(() => {
        const next = pendingWidgetNavigation.current; pendingWidgetNavigation.current = null;
        if (next) navigate(next);
      }).catch(reason => { pendingWidgetNavigation.current = null; setError(String(reason)); });
      return true;
    }
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
  useViewHistory({ date, periodMode, bookView, calendar: drawer.open, notebook: notebook.open, settingsOpen }, async value => {
    if (!await save()) return;
    navigate(value.date); setPeriodMode(value.periodMode); setBookView(value.bookView); drawer.setOpen(value.calendar); notebook.setOpen(value.notebook); setSettingsOpen(value.settingsOpen);
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
  // Shift+wheel turns the days, except over a window with its own use for it (Nebula: the calendars, the notebook, the
  // board) – there the window alone answers.
  useWheelSwipe(stepPeriod, { root: bookMode ? undefined : mainRef, ignore: nebulaMode
    ? '.entry-dock-shell, .planner, .nebula-calendar, .nebula-notebook, .nebula-cal-panel, .nebula-panel.is-calendar, .nebula-panel.is-notebook, .board-viewport'
    : '.entry-dock-shell, .planner' });
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
      if (unchanged) { dirtyRef.current = false; setDirty(false); }
      setSavedCount(count => count + 1);
      return unchanged;
    }
    catch (reason) { setError(t("Speichern fehlgeschlagen: {0}", String(reason))); pendingNavigation.current = null; return false; }
    finally { busyRef.current = false; setBusy(false); }
  });
  const currentDayRef = useRef<Day | null>(null);
  currentDayRef.current = ready ? day : null;
  const flushMainEditor = useStableCallback(async () => {
    const deadline = Date.now() + 25000;
    while (busyRef.current || dirtyRef.current) {
      if (Date.now() > deadline) throw new Error(t('Lokale Änderungen konnten nicht gespeichert werden.'));
      if (!busyRef.current) await save();
      await new Promise(resolve => setTimeout(resolve, 10));
      if (errorRef.current) throw new Error(errorRef.current);
    }
  });
  const replaceFromWidget = useStableCallback((next: Day) => {
    if (next.date !== date || !ready) throw new Error('Der angefragte Tag ist nicht mehr geöffnet.');
    flushSync(() => { update(() => next); });
  });
  const refreshFromWidget = useStableCallback((before: Day, refreshed: Day) => {
    flushSync(() => setDay(current => current?.date === refreshed.date ? mergeCalendarImport(current, before, refreshed) : current));
  });
  const editorHostStarted = useRef(false);
  const editorHostCleanup = useRef<(() => void) | null>(null);
  const editorHostDisposed = useRef(false);
  useEffect(() => {
    if (!ready || editorHostStarted.current) return;
    editorHostStarted.current = true;
    void installEditorHost({ current: () => currentDayRef.current, replace: replaceFromWidget, flush: flushMainEditor, refresh: refreshFromWidget, onError: setError, isDirty: () => dirtyRef.current }).then(stop => {
      if (editorHostDisposed.current) stop(); else { editorHostCleanup.current = stop; if (currentDayRef.current) publishEditorDay(currentDayRef.current); }
    }).catch(reason => setError(String(reason)));
  }, [ready]);
  useEffect(() => () => { editorHostDisposed.current = true; editorHostCleanup.current?.(); }, []);
  useEffect(() => { if (ready) publishEditorDay(day); }, [day, ready]);
  useEffect(() => {
    const stop = listen<{ tab?: SettingsTab; widget?: string }>('journal:settings', event => openSettings(event.payload.tab ?? 'widgets', event.payload.widget ?? null));
    const toggle = listen('desktop-widgets:toggle', () => {
      void (async () => {
        await flushHistoryWindows();
        const state = await invoke<DesktopWidgetState>('desktop_widget_state');
        if (!state.widgets.length) { openSettings('widgets'); return; }
        const enabled = !state.widgets.some(widget => widget.enabled);
        for (const widget of state.widgets) await invoke('desktop_widget_update', { id: widget.id, update: { enabled } });
      })().catch(reason => setError(String(reason)));
    });
    return () => { void stop.then(unlisten => unlisten()); void toggle.then(unlisten => unlisten()); };
  }, []);
  // Saving is automatic; the UI checks ask for an immediate save (to count saves) with this event.
  useEffect(() => {
    const now = () => { void save(); };
    window.addEventListener('journal:save-now', now);
    return () => window.removeEventListener('journal:save-now', now);
  }, []);
  const pendingNavigation = useRef<string | null>(null);
  const pendingWidgetNavigation = useRef<string | null>(null);
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
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
      const entry: Entry = { id: crypto.randomUUID(), kind: made.kind, text: made.text, description: made.description, tag: made.tag ?? null, done: false, cancelled: false, priority: made.priority, time: made.time, end: made.end, reminder: made.reminder, reminderBefore: made.reminderBefore ?? 0, icon: made.icon ?? null, showInJournal: made.showInJournal, plan: null, repeat: made.repeat ?? null };
      if (target === date && ready) {
        captureLayout();
        update(current => ({ ...current, entries: orderEntries([...current.entries, entry]) }));
        pendingSave.current = true;
        return;
      }
      const stored = await journal.load(target);
      await journal.save({ ...stored, entries: [...stored.entries, entry] });
    });
  });

  const exportFromCalendar = useStableCallback(async () => {
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
      if (!await save()) throw new Error(t("Bitte laufende Änderungen zuerst speichern und erneut versuchen."));
      return journal.exportCalendar();
    });
  });
  const importFromCalendar = useStableCallback(async (entries: CalendarImport[]) => {
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
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
  });

  const mailStatus = useMailImport(importFromCalendar);

  const moveFromCalendar = useStableCallback(async (entry: Entry, from: string, to: string, time: string | null, end: string | null) => {
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
      if (!await save()) throw new Error(t("Bitte laufende Änderungen zuerst speichern und erneut versuchen."));
      const target = date, before = journal.cached(target);
      busyRef.current = true; setBusy(true);
      try {
        const touched = await journal.moveCalendarEntry(entry.id, from, to, time, end);
        if (touched.includes(target)) {
          const refreshed = await journal.load(target);
          setDay(current => current?.date === target ? mergeCalendarImport(current, before, refreshed) : current);
        }
      } finally { busyRef.current = false; setBusy(false); }
    });
  });
  useEffect(() => {
    const stop=listen<CalendarRequest>('calendar:request', async event => {
      const request=event.payload;
      try {
        if(driveWorking.current||historyWrite.current) throw new Error(t('Wird verarbeitet …'));
        let days: CalendarDay[] | undefined;
        switch(request.kind){
          case 'move': await moveFromCalendar(request.entry,request.from,request.to,request.time,request.end); break;
          case 'create': await createFromCalendar(request.date,request.entry); break;
          case 'edit': await editFromCalendar(request.date,request.entryId,request.change,request.scope); break;
          case 'remove': await removeFromCalendar(request.date,request.entryId,request.others); break;
          case 'export': days=await exportFromCalendar(); break;
          case 'import': await importFromCalendar(request.entries); break;
        }
        await emit('calendar:request-result',{id:request.id,days});
      } catch(error) { await emit('calendar:request-result',{id:request.id,error:String(error)}); }
    });
    return () => { void stop.then(unlisten=>unlisten()); };
  }, []);

  // Editing or removing an entry from the calendar works the same way: on the day shown here through the editor, elsewhere in the store.
  // With a scope (ScopeChoice "only this / every Tuesday / all"), the edit stays with this entry when saved and reaches
  // exactly the chosen others; without one (an entry with no linked ones), saving passes text and kind on as usual.
  const editFromCalendar = useStableCallback(async (target: string, id: string, change: EntryEdit, scope?: ScopeOption) => {
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
      const alone = scope ? [id] : [];
      if (target === date && ready) { changeEntry(id, change); for (const one of alone) keepAlone.current.add(one); pendingSave.current = true; }
      else {
        const stored = await journal.load(target);
        await journal.save({ ...stored, entries: stored.entries.map(entry => entry.id === id ? { ...entry, ...change } : entry), keepAlone: alone });
      }
      if (!scope?.others.length || !change.kind) return;
      const edit: LinkedEdit = { kind: change.kind, text: change.text ?? '', description: change.description ?? '', tag: change.tag ?? null, priority: Boolean(change.priority),
        reminder: Boolean(change.reminder), showInJournal: change.showInJournal !== false, reminderBefore: change.reminderBefore ?? 0, icon: change.icon ?? null, ...'time' in change ? { times: { time: change.time ?? null, end: change.end ?? null } } : {} };
      const here = scope.others.filter(other => other.date === date && ready);
      const same: EntryEdit = { kind: edit.kind, text: edit.text, description: edit.description, tag: edit.tag, priority: edit.priority, reminder: edit.reminder, showInJournal: edit.showInJournal, reminderBefore: edit.reminderBefore, icon: edit.icon,
        ...edit.times ? { time: edit.times.time, end: edit.times.end } : {}, ...edit.kind === 'task' ? {} : { done: false, cancelled: false } };
      for (const other of here) changeEntry(other.id, same);
      if (here.length) { for (const other of here) keepAlone.current.add(other.id); pendingSave.current = true; }
      const elsewhere = scope.others.filter(other => !here.includes(other)).map(other => other.id);
      if (elsewhere.length) await journal.editLinked(elsewhere, edit);
    });
  });
  const removeFromCalendar = useStableCallback(async (target: string, id: string, others: { id: string; date: string }[] = []) => {
    await flushHistoryWindows();
    return serializeEditorMutation(async () => {
      if (target === date && ready) { removeEntry(id); pendingSave.current = true; }
      else {
        const stored = await journal.load(target);
        await journal.save({ ...stored, entries: stored.entries.filter(entry => entry.id !== id) });
      }
      if (others.length) await changeLinkedDirect(others, 'remove');
    });
  });
  // An action chosen to reach linked entries too (ScopeChoice): those on the day shown change in the editor, all others in the store.
  const changeLinkedDirect = useStableCallback(async (others: { id: string; date: string }[], action: LinkedAction) => {
    const here = others.filter(other => other.date === date && ready);
    for (const other of here) {
      if (action === 'remove') removeEntry(other.id); else changeEntry(other.id, { done: action === 'done', cancelled: action === 'cancelled' });
    }
    const elsewhere = others.filter(other => !here.includes(other));
    try { if (elsewhere.length) await journal.changeLinked(elsewhere.map(other => ({ id: other.id, action }))); }
    catch (reason) { setError(t("Ändern fehlgeschlagen: {0}", String(reason))); }
  });

  const changeLinked = useStableCallback(async (others: { id: string; date: string }[], action: LinkedAction) => {
    await flushHistoryWindows();
    await serializeEditorMutation(() => changeLinkedDirect(others, action));
  });

  const dismissReminder = (reminder: Reminder) => setReminders(current => current.filter(item => !(item.id === reminder.id && item.due === reminder.due)));

  // New entries go directly below `afterId` when it is of the same kind and tag, otherwise to the end of their group.
  // They take the tag of that entry; without one, while entries without a tag are hidden, the first tag shown.
  const addEntry = useStableCallback((kind: EntryKind, afterId?: string, withoutTag = false) => {
    if (!ready) return;
    const after = day.entries.find(item => item.id === afterId);
    const tag = withoutTag ? null : after ? tagOf(tags, after.tag)?.id ?? null : isShown(hiddenTags, null) ? null : tags.find(item => !hiddenTags.has(item.id))?.id ?? null;
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
    driveWorking.current=true;setDriveBusy(true);historyWrite.current=true;
    try {
      await emit('editor:paused',true);await flushHistoryWindows();
      await serializeEditorMutation(async()=>{if(await invoke<boolean>('history_step',{redo:e.payload.redo,emptyEntry:e.payload.emptyEntry ?? null}))await restoreMainDay();});
    }catch(reason){setError(String(reason));}finally{historyWrite.current=false;driveWorking.current=false;setDriveBusy(false);working=false;await emit('editor:paused',false);}
  });return()=>{void stop.then(fn=>fn());};},[]);
  const onGlobalKey = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || driveWorking.current) return;
    const target = event.target as HTMLElement;
    const typing = target.matches('input, textarea, [contenteditable="true"]');
    const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const kinds: Record<string, EntryKind> = { KeyA: 'task', KeyE: 'event', KeyN: 'note' };
    if (event.key === 'F1' || (event.key === '?' && !typing && !event.ctrlKey && !event.altKey)) setHelp(open => !open);
    // Ctrl+Shift+N: the notebook, from anywhere (also out of the shortcut overview).
    else if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === 'KeyN') { setHelp(false); toggleNotebook(true); }
    else if (ctrl && event.key === ',') { setSettingsTab('appearance'); setSettingsOpen(open => !open); }
    else if (ctrl && event.code === 'KeyG') setDatePickerOpen(open => !open);
    // Ctrl+F: the search (the field in the title bar, the journal's tab at the book's edge).
    else if (ctrl && event.code === 'KeyF') { const tab = document.querySelector<HTMLElement>('.search-tab:not(.is-open)'); if (tab) tab.click(); else document.querySelector<HTMLInputElement>('.search-input')?.focus(); }
    // Ctrl+1–5: day, week, month, quarter, year (the tabs in the title bar, or the book's register tabs).
    else if (ctrl && /^Digit[1-5]$/.test(event.code)) choosePeriod(periodModes[Number(event.code.slice(5)) - 1]);
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
    else if (ownLayout && ctrl && event.code === 'KeyK') toggleDrawer(true);
    else if (ownLayout && notebook.open && (lastSheet.current === 'notebook' || !drawer.open) && event.key === 'Escape' && target === document.body) toggleNotebook(true);
    else if (ownLayout && drawer.open && event.key === 'Escape' && target === document.body) toggleDrawer(true);
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
    // In the book the page's head (JournalBook) shows the date with the navigation; in Nebula the poster does.
    return <>{!ownLayout && <div className={`document-header${slideClass}`}>
        <div className="eyebrow">{t("Tagesnotiz")}{pageDate === today && <span className="today-label">{t("Heute")}</span>}</div>
        <h1>{formatDate(pageDate)}</h1>
      </div>}
      {error && <div className="error" role="alert">{error}</div>}
      {!here && !error && <p className="loading" role="status">{t("Tagesnotiz wird geöffnet …")}</p>}
      {here && <DayEditor day={day} entries={visibleEntries} tags={tags} layout={actionLayout} className={slideClass}
        hiddenCount={hiddenByTag} onShowAll={() => setHiddenTags(new Set())} savedTraces={savedTraces} newEntryId={newEntryId} openEntryId={openEntryId}
        focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId} entriesRef={entriesRef} drag={drag} announcement={moveAnnouncement}
        onTitle={title => update(current => ({ ...current, title }))} onCreate={addEntry} onNavigate={navigate} onChange={changeEntry}
        onRemove={removeEntry} onLinkedChange={changeLinked} onMoveOffset={moveByOffset} onOpenChange={changeOpen} />}</>;
  };
  const bookPage = (page: BookPage) => page.page === 'entries' ? entriesPage(page.date)
    : page.page === 'board' ? <BulletinBoard key={`${boardPeriod}:${page.date}`} date={page.date} period={boardPeriod} />
    : <PeriodNotes date={page.date} mode={page.page === 'data' ? 'day' : periodMode} part={page.page === 'data' ? undefined : page.page} onManage={manageData} onImport={importFromCalendar} />;
  const stepLabels = {
    prev: { label: periodMode === 'day' ? t("Vorheriger Tag") : language === 'en' ? 'Previous period' : 'Vorheriger Zeitraum', tip: periodMode === 'day' ? t("Vorheriger Tag · Alt ←") : language === 'en' ? 'Previous period' : 'Vorheriger Zeitraum' },
    next: { label: periodMode === 'day' ? t("Nächster Tag") : language === 'en' ? 'Next period' : 'Nächster Zeitraum', tip: periodMode === 'day' ? t("Nächster Tag · Alt →") : language === 'en' ? 'Next period' : 'Nächster Zeitraum' },
  };
  // The book turns days on its page: the page's title opens the mini calendar, the arrows beside it step a day (or
  // period); today is the ribbon (JournalBook).
  const bookNav = (page: BookPage) => <div className="book-nav">
    <button type="button" className="book-nav-step" aria-label={stepLabels.prev.label} title={stepLabels.prev.tip} onClick={() => stepPeriod(-1)}><Icon name="left" /></button>
    <h1><MiniCalendarPicker date={date} open={datePickerOpen} onOpenChange={setDatePickerOpen} onPick={navigate} buttonRef={datePickerButtonRef} className="book-nav-date">{pageHeading(page.date, periodMode)}</MiniCalendarPicker></h1>
    <button type="button" className="book-nav-step" aria-label={stepLabels.next.label} title={stepLabels.next.tip} onClick={() => stepPeriod(1)}><Icon name="right" /></button>
  </div>;
  const toolbarItems = <>
    <NavCluster label={periodMode === 'day' ? t("Tagesnavigation") : language === 'en' ? 'Period navigation' : 'Zeitraumnavigation'} prev={stepLabels.prev} next={stepLabels.next}
      today={{ tip: t("Heute · Alt H"), disabled: date === today }} atToday={date === today} onPrev={() => stepPeriod(-1)} onToday={() => navigate(today)} onNext={() => stepPeriod(1)} />
    <MiniCalendarPicker date={date} open={datePickerOpen} onOpenChange={setDatePickerOpen} onPick={navigate} buttonRef={datePickerButtonRef} />
    <div className="toolbar-end">{!bookMode && periodMode === 'day' && <TagFilter label={t("Tags im Journal")} hidden={hiddenTags} onChange={next => { setNewEntryId(null); setHiddenTags(next); }} />}</div>
  </>;
  const periodLabels = language === 'en' ? ['Day', 'Week', 'Month', 'Quarter', 'Year'] : ['Tag', 'Woche', 'Monat', 'Quartal', 'Jahr'];
  // The book's views as register tabs on its top edge (Ctrl+1–5).
  const register = <nav className="book-register" aria-label={language === 'en' ? 'Journal views' : 'Journalansichten'}>
    {periodMode === 'day' && <div className="book-tag-register"><TagFilter label={t("Tags im Journal")} hidden={hiddenTags} onChange={next=>{setNewEntryId(null);setHiddenTags(next);}}/></div>}

    {periodModes.map((mode, index) => <button type="button" key={mode} className="book-register-tab" data-period-mode={mode} aria-current={periodMode === mode ? 'page' : undefined}
      title={`${periodLabels[index]} · ${t('Strg')} ${index + 1}`} onClick={() => setPeriodMode(mode)}>{periodLabels[index]}{index === 0 && dirty && <span className="unsaved-dot" aria-label={t("Ungespeicherte Änderungen")} />}</button>)}
  </nav>;
  // Turning both pages at once, a sheet (calendar or notebook) does not cover a page: the book shows one page beside it.
  const besideCalendar = bookMode && (drawer.open || notebook.open) && !bothSheets && settings.bookPaging === 'spread';
  const notebookView = !ownLayout && notebook.open;
  // A search result opens where it was made: the entry in its day (focused), a calendar entry with the calendar out,
  // a day by its title, a board card on its day's board, a notebook note in the notebook.
  const openResult = useStableCallback((result: SearchResult) => {
    const target = result.target;
    if (target.kind === 'title') { navigate(target.date); bookRef.current?.open('entries'); return; }
    if (target.kind === 'entry') {
      if (target.calendar) { navigate(target.date); if (ownLayout && !drawer.open) toggleDrawer(); return; }
      bookRef.current?.open('entries');
      showFromCalendar(target.date, target.id);
      return;
    }
    if (target.notebook || !target.date) {
      if (!notebook.open) toggleNotebook();
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('journal:open-note', { detail: target.id })));
      return;
    }
    if (notebookView) notebook.setOpen(false);
    navigate(target.date);
    // A card on a month's or year's board opens there.
    setPeriodMode(target.period ?? 'day');
    requestAnimationFrame(() => bookRef.current?.open('board'));
    // The card blinks once it is on screen.
    let tries = 0;
    const flash = () => {
      const card = document.querySelector<HTMLElement>(`[data-board-id="${target.id}"]`);
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.remove('is-found'); void card.offsetWidth; card.classList.add('is-found'); card.focus({ preventScroll: true }); }
      else if (++tries < 20) window.setTimeout(flash, 100);
    };
    window.setTimeout(flash, 120);
  });
  // "Im Notizblock öffnen" from a board card's menu: the notebook opens on that note.
  useEffect(() => {
    const show = (event: Event) => openResult({ target: { kind: 'card', id: (event as CustomEvent<string>).detail, date: null, notebook: true } } as SearchResult);
    window.addEventListener('journal:show-note', show);
    return () => window.removeEventListener('journal:show-note', show);
  }, []);
  const visibleOpen = visibleEntries.filter(entry => entry.kind === 'task' && !entry.done && !entry.cancelled).length;
  const nebulaStats = { entries: entryCount, open: visibleOpen, done: visibleEntries.filter(entry => entry.done).length, events: visibleEntries.filter(entry => entry.kind === 'event').length };
  const calendar = <Calendar embedded withoutDay={nebulaMode} journalDate={date} onOpen={openFromCalendar} onCreate={createFromCalendar} onEdit={editFromCalendar} onMove={moveFromCalendar} onRemove={removeFromCalendar} onExport={exportFromCalendar} onImport={importFromCalendar} />;
  return <div className={`app actions-${actionLayout}${sidebar.dragging ? ' is-resizing' : ''}${bookMode ? ' is-book' : ''}${nebulaMode ? ' is-nebula' : ''}`} onFocusCapture={event => {
    const target = event.target as HTMLElement;
    if (newEntryId && !target.closest('.popover') && target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId !== newEntryId) setNewEntryId(null);
  }}>
    {/* The sidebar is the calendar (its view switch in line with the toolbar next to it); dragging its edge sets the width.
        In the book it is always a sheet pulled out onto the book instead (JournalBook's overlay). */}
    {ownLayout ? null
      : <aside inert={driveBusy} className="sidebar" aria-label={t("Kalender und Navigation")} style={{ width: sidebar.width }}>
        {calendar}
        <div className="sidebar-resizer" {...sidebar.handle} />
      </aside>}

    {/* Swiping sideways on a trackpad, or Shift + wheel, turns the day; entries that are swiped themselves keep the gesture. */}
    <main inert={driveBusy} className="main" ref={mainRef} onMouseDown={event => { if (bookMode && (event.target === event.currentTarget || (event.target as Element).classList.contains('book-stage'))) dragWindow(event); }}>
      {/* In the book there is no title bar: the cover around the book moves the window; settings and the window's
          controls sit on it in the top right corner, beside the register tabs. */}
      {nebulaMode ? <div className="nebula-window-bar" onMouseDown={dragWindow}>
        <SearchBox variant="nebula" onOpen={openResult} />
        {/* The free bar moves the window; NebulaDesk puts the views (day … year) in the middle and the notebook's switch at
            the end. */}
        <span className="nebula-window-space" />
        <div className="nebula-bar-center" />
        <div className="nebula-bar-end" />
        <button type="button" className="titlebar-button settings-button" data-mail-count={mailStatus.count || undefined} aria-label={t("Einstellungen")} aria-keyshortcuts="Control+," title={t("Einstellungen · Strg ,")} onClick={() => openSettings()}><Icon name="settings" /></button>
        <WindowControls onError={setError} />
      </div> : bookMode ? <div className="book-window-bar" onMouseDown={dragWindow}>
        <button type="button" className="titlebar-button settings-button" data-mail-count={mailStatus.count || undefined} aria-label={t("Einstellungen")} aria-keyshortcuts="Control+," title={t("Einstellungen · Strg ,")} onClick={() => openSettings()}><Icon name="settings" /></button>
        <WindowControls onError={setError} />
      </div> : <header className="topbar" onMouseDown={dragWindow}>
        <nav className="journal-tabs" aria-label={language === 'en' ? 'Journal views' : 'Journalansichten'}>{periodModes.map((mode, index) => <button type="button" key={mode} className="journal-tab" aria-current={!notebookView && periodMode === mode ? 'page' : undefined} onClick={() => choosePeriod(mode)}><Icon name={({ day: 'journal', week: 'week', month: 'month', quarter: 'quarter', year: 'year' } as const)[mode]} /><span>{(language === 'en' ? ['Day', 'Week', 'Month', 'Quarter', 'Year'] : ['Tag', 'Woche', 'Monat', 'Quartal', 'Jahr'])[index]}</span>{index === 0 && dirty && <span className="unsaved-dot" aria-label={t("Ungespeicherte Änderungen")} />}</button>)}
          <button type="button" className="journal-tab is-notebook" aria-current={notebookView ? 'page' : undefined} aria-keyshortcuts="Control+Shift+N" title={t('Notizen · Strg ⇧ N')} onClick={() => toggleNotebook()}><Icon name="note" /><span>{t('Notizen')}</span></button></nav>
        <SearchBox variant="classic" onOpen={openResult} />
        <div className="titlebar-space" />
        {/* Settings sit with the window's own controls, where Zed and most apps keep them. */}
        <button type="button" className="titlebar-button settings-button" data-mail-count={mailStatus.count || undefined} aria-label={t("Einstellungen")} aria-keyshortcuts="Control+," title={t("Einstellungen · Strg ,")} onClick={() => openSettings()}><Icon name="settings" /></button>
        <WindowControls onError={setError} />
      </header>}
      {/* Like the calendar's toolbar (and Zed's under its tabs): turning the days first, then what is shown. */}
      {!ownLayout && !notebookView && <div className="toolbar">{toolbarItems}</div>}

      {bookMode ? <JournalBook mode={periodMode} date={date} today={today} onToday={() => navigate(today)} renderNav={bookNav} view={bookView} paging={settings.bookPaging} beside={besideCalendar} sheetWidth={sidebar.width} onNavigate={navigate} renderPage={bookPage} entriesScrollRef={scrollRef} controlRef={bookRef} onWideChange={setBookWide}
        calendarTab={<><CalendarTab open={drawer.open} onToggle={() => toggleDrawer()} /><NotebookTab open={notebook.open} onToggle={() => toggleNotebook()} /><SearchTab onOpen={openResult} /></>} register={register}
        overlay={<><CalendarDrawer overlay open={drawer.open} animated={drawer.animated} width={sidebar.width} resizer={sidebar.handle} resizable={besideCalendar || !(bookView === 'double' && bookWide)} disabled={driveBusy} onClose={() => toggleDrawer(true)}>{calendar}</CalendarDrawer>
          <CalendarDrawer overlay kind="notebook" right={bothSheets} label={t('Notizen')} open={notebook.open} animated={notebook.animated} width={sidebar.width} resizer={sidebar.handle} resizable={besideCalendar || !(bookView === 'double' && bookWide)} disabled={driveBusy} onClose={() => toggleNotebook(true)}><Notebook onOpenDay={target => openFromCalendar(target)} onClose={() => toggleNotebook(true)} /></CalendarDrawer></>} />
        : nebulaMode ? <NebulaDesk onTitleChange={title => update(current => ({ ...current, title }))} mode={periodMode} date={date} today={today} modes={periodModes} modeLabels={periodLabels} dirty={dirty} title={ready ? day.title : ''} stats={nebulaStats}
          onMode={setPeriodMode} onStep={stepPeriod} onToday={() => navigate(today)} stepLabels={stepLabels} disabled={driveBusy}
          datePicker={<MiniCalendarPicker date={date} open={datePickerOpen} onOpenChange={setDatePickerOpen} onPick={navigate} buttonRef={datePickerButtonRef} className="nebula-date">{pageHeading(date, periodMode)}</MiniCalendarPicker>}
          tagFilter={<TagFilter label={t("Tags im Journal")} hidden={hiddenTags} onChange={next => { setNewEntryId(null); setHiddenTags(next); }} />}
          entries={entriesPage()} board={<BulletinBoard key={`${boardPeriod}:${date}`} date={date} period={boardPeriod} />}
          rating={<PeriodNotes date={date} mode="day" part="rating" onManage={manageData} onImport={importFromCalendar} />}
          scales={<PeriodNotes date={date} mode="day" part="scales" onManage={manageData} onImport={importFromCalendar} />}
          notes={<PeriodNotes date={date} mode={periodMode} part="note" onManage={manageData} onImport={importFromCalendar} />}
          ratings={<PeriodNotes date={date} mode={periodMode} part="ratings" onManage={manageData} onImport={importFromCalendar} />}
          activities={<PeriodNotes date={date} mode={periodMode} part="activities" onManage={manageData} onImport={importFromCalendar} />}
          calendar={calendar} calendarOpen={drawer.open} onCalendarToggle={() => toggleDrawer()} onCalendarClose={() => toggleDrawer(true)}
          notebook={<Notebook onOpenDay={target => openFromCalendar(target)} />} notebookOpen={notebook.open} onNotebookToggle={() => toggleNotebook()} onNotebookClose={() => toggleNotebook(true)} onOpenDay={(target, entry) => showFromCalendar(target, entry ?? null)} onNavigate={navigate} scrollRef={scrollRef}
          dayCalendar={(showDate, onDateChange) => <Calendar embedded fixedView="day" journalDate={date} showDate={showDate} onDateChange={onDateChange} onOpen={openFromCalendar} onCreate={createFromCalendar} onEdit={editFromCalendar} onMove={moveFromCalendar} onRemove={removeFromCalendar} />} />
        : notebookView ? <div className="notebook-view"><Notebook onOpenDay={target => openFromCalendar(target)} /></div>
        : <div className="scroll" ref={scrollRef}>
          <div className="content">
            {periodMode === 'day' && entriesPage()}
            <PeriodNotes date={date} mode={periodMode} onManage={manageData} onImport={importFromCalendar} />
            {hasPinboard(periodMode) && <BulletinBoard key={`${boardPeriod}:${date}`} date={date} period={boardPeriod} />}
          </div>
        </div>}

      <span className="visually-hidden save-status" role="status" key={savedCount}>{busy ? t("Wird gespeichert …") : dirty ? (error ? t("Nicht gespeichert") : t("Wird gleich gespeichert …")) : ready ? t("Gespeichert") : t("Wird geöffnet …")}</span>
    </main>
    <ReminderToasts reminders={reminders} today={today} snoozeMinutes={10}
      onStatus={(reminder, status) => { dismissReminder(reminder); void changeLinked([reminder], status); }}
      onSnooze={reminder => { dismissReminder(reminder); journal.snoozeReminder(reminder).catch(reason => setError(t("Erinnerung: {0}", String(reason)))); }}
      onOpen={reminder => { dismissReminder(reminder); showFromCalendar(reminder.date, reminder.id); }} onDismiss={dismissReminder} />
    {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    <div className="app-notices"><UpdateNotice onOpen={() => openSettings('updates')} /><MailImportToast onReview={() => openSettings('mail')} /></div>
    {settingsOpen && <SettingsDialog key={settingsTab} bookView={bookView} onBookView={setBookView} initialTab={settingsTab} initialWidgetId={settingsWidgetId} beforeSync={async () => { if (!await save()) throw new Error("Lokale Änderungen konnten nicht gespeichert werden."); await flushHistoryWindows(); }} onDriveBusy={value => { driveWorking.current = value; setDriveBusy(value); void emit('editor:paused', value); }} settings={settings} mailStatus={mailStatus} onImport={importFromCalendar} onClose={() => { if (!driveWorking.current) setSettingsOpen(false); }} onChange={next => { setSettings(next); saveSettings(next); }} />}
  </div>;
}

// One bundle for all windows; the window's label decides what it shows.
const windowLabel = getCurrentWindow().label;
if (windowLabel === 'reminder') document.documentElement.classList.add('is-popup');
// A window of Nebula's desk pulled out of the journal draws its own frame on a transparent window.
if (isDesktopWidgetLabel(windowLabel)) document.documentElement.classList.add('is-desktop-widget');
if (windowLabel.startsWith('panel-')) document.documentElement.classList.add('is-panel-window');
createRoot(document.getElementById('root')!).render(<><WindowActivity /><ThemeSync /><UndoShortcuts /><ContextMenuHost />{isDesktopWidgetLabel(windowLabel) ? <DesktopWidgetWindow /> : windowLabel.startsWith('board-') ? <FloatingNote /> : windowLabel.startsWith('panel-') && detachable.includes(windowLabel.slice(6) as DetachedKind) ? <DetachedPanel kind={windowLabel.slice(6) as DetachedKind} /> : windowLabel === 'calendar' ? <CalendarWindow /> : windowLabel === 'mini' ? <MiniCalendar /> : windowLabel === 'reminder' ? <ReminderPopup /> : <App />}{(windowLabel === 'calendar' || windowLabel.startsWith('panel-')) && <MailImportToast />}</>);
