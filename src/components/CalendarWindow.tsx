import { calendarDaysWithSpans, calendarSpanLanes, calendarSpanSegment } from '../calendarSpans';
import { readCalendarEntry } from '../calendarClipboard';
import { withStart, occurrences, seriesHorizon } from '../repeat';
import { Popover } from './Popover';
import { t, useLanguage } from '../i18n';
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDay, Entry, EntryKind, formatDate, formatWeekday, localDate } from '../journal';
import { monthGrid, shiftDate } from '../dates';
import { plainText } from '../markdown';
import { shortTitle, CalendarView, calendarViews, durationOf, formatDuration, formatMonthName, isoWeek, layoutTimed, minutesOf, orderForCalendar, shiftView, snapMinutes, snapRange, viewDates, viewRange, viewTitle } from '../calendar';
import { formatEnd, timeOfMinutes } from '../planning';
import type { ScopeOption } from '../planning';
import { CalendarComposer } from './CalendarComposer';
import type { Draft, EntryEdit, NewEntry } from './CalendarComposer';
import { CalendarItem, CompactMonth, EditInCalendar, OpenInJournal, dayLabel, hasJournalContent, entrySymbol, openInJournal, useCalendarData, useJournalDate, useNow } from './calendarShared';
import { NavCluster } from './NavCluster';
import { calendarSelection, clearCalendarSelection, selectInFrame } from '../calendarSelection';
import { Icon } from './Icon';
import { CalendarTransfer } from './CalendarTransfer';
import type { CalendarImport } from '../journal';
import { useWheelSwipe } from './useWheelSwipe';
import { TagFilter } from './TagFilter';
import { useHiddenTags, useTags } from '../tagStore';
import { filterTagDays, isShown, tagOf } from '../tags';
import { requestCalendarCreate, requestCalendarMove } from '../calendarRequests';

// The calendar: in the journal's sidebar, or in a window of its own (currently not offered). Year and month like
// Apple's and Samsung's calendars, week, work week and day as a time grid with a band for entries without time
// (Apple's "ganztägig"), the kinds to show as toggles like TaskNotes' filters. It follows the day the journal shows.
// Keys (with the focus in the calendar): ← → step, H today, J / M / W / A / T (or 1–5) switch the view.
// Swiping sideways (or Shift + wheel) steps as well.
type Kinds = Record<EntryKind, boolean>;
const storageKey = 'journal.calendar';
function loadPrefs(): { view: CalendarView; kinds: Kinds } {
  const fallback = { view: 'month' as CalendarView, kinds: { event: true, task: true, note: false } };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<typeof fallback>;
    return { view: calendarViews().some(item => item.view === stored.view) ? stored.view! : fallback.view, kinds: { ...fallback.kinds, ...stored.kinds } };
  } catch { return fallback; }
}
const kindPlurals = (): Record<EntryKind, string> => ({ event: t("Ereignisse"), task: t("Aufgaben"), note: t("Notizen") });
const weekdayNames = () => ([t("Mo"), t("Di"), t("Mi"), t("Do"), t("Fr"), t("Sa"), t("So")]);
const weekendClass = (date: string, index?: number) => {
  const weekday = index ?? (new Date(`${date}T12:00`).getDay() + 6) % 7;
  return weekday === 5 ? ' is-saturday' : weekday === 6 ? ' is-sunday' : '';
};

/** The calendar as a window of its own: it hears the journal's day through events and asks the journal window to show days. */
export function CalendarWindow() {
  useLanguage();
  return <Calendar journalDate={useJournalDate()} onOpen={openInJournal} onCreate={requestCalendarCreate} onMove={requestCalendarMove} autoFocus />;
}

// Memoized: in the sidebar it must not re-render while the journal is being typed in (`onOpen` is stable).
/** An entry being edited (right click): its day and the element the card is placed at. */
type Editing = { entry: Entry; date: string; element: HTMLElement };
export const Calendar = memo(function Calendar({ journalDate, onOpen, onCreate, onEdit, onMove, onRemove, onExport, onImport, embedded = false, autoFocus = false, fixedView, showDate, onDateChange }: {
  onExport?: () => Promise<CalendarDay[]>; onImport?: (entries: CalendarImport[]) => Promise<void>;
  journalDate: string | null; onOpen: (date: string, entry?: string) => void; embedded?: boolean; autoFocus?: boolean;
  /** Always this view, without the view tabs (Nebula's day beside the overview); the stored view stays the other calendars'. */
  fixedView?: CalendarView;
  /** A day to show other than the journal's (Nebula: a day of the week picked in its strip). */
  showDate?: string;
  /** Hears the day the calendar shows. */
  onDateChange?: (date: string) => void;
  onCreate?: (date: string, entry: NewEntry) => Promise<void>; onEdit?: (date: string, id: string, change: EntryEdit, scope?: ScopeOption) => Promise<void>; onRemove?: (date: string, id: string, others: { id: string; date: string }[]) => Promise<void>;
  onMove?: (entry: Entry, from: string, to: string, time: string | null, end: string | null) => Promise<void>;
}) {
  useLanguage();
  const [prefs, setPrefs] = useState(loadPrefs);
  const { kinds } = prefs;
  const view = fixedView ?? prefs.view;
  const now = useNow();
  const today = localDate(now);
  const [date, setDate] = useState(journalDate ?? today);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const range = viewRange(view, date);
  useLayoutEffect(()=>{
    const root=rootRef.current;if(!root || (view!=='month' && view!=='year'))return;
    const align=()=>root.querySelectorAll<HTMLElement>('.cal-month-day,.cal-month-kw,.cal-year-grid > *').forEach(cell=>{
      const columns=Math.max(1,Math.round(cell.offsetWidth/14)),rows=Math.max(1,Math.round(cell.offsetHeight/14));
      cell.style.setProperty('--paper-columns',String(columns));cell.style.setProperty('--paper-rows',String(rows));
    });
    align();const observer=new ResizeObserver(align);observer.observe(root);root.querySelectorAll('.cal-month-grid,.cal-year-grid').forEach(grid=>observer.observe(grid));return()=>observer.disconnect();
  },[view,date]);

  // One day more before: an appointment from the evening before may reach into the first shown day.
  const { days, error } = useCalendarData(shiftDate(range.from, -366), range.to);
  const title = viewTitle(view, date);
  const tags = useTags();
  const [hiddenTags, setHiddenTags] = useHiddenTags('calendar');
  const visibleDays = useMemo(() => filterTagDays(days, hiddenTags), [days, hiddenTags, tags]);
  const entriesOn = (value: string) => orderForCalendar((visibleDays.get(value)?.entries ?? []).filter(entry => kinds[entry.kind]));
  const displayDays=useMemo(()=>calendarDaysWithSpans(visibleDays,range.from,range.to),[visibleDays,range.from,range.to]);
  const displayEntriesOn=(value:string)=>orderForCalendar((displayDays.get(value)?.entries ?? []).filter(entry=>kinds[entry.kind])).sort((a,b)=>Number(Boolean(b.end && minutesOf(b.end)>1440))-Number(Boolean(a.end && minutesOf(a.end)>1440)));
  // A range drawn while entries without a tag are hidden takes the first tag shown, so it does not vanish at once.
  const newTag = isShown(hiddenTags, null) ? null : tags.find(tag => !hiddenTags.has(tag.id))?.id ?? null;

  useEffect(() => { try {
    // A calendar with a fixed view keeps the stored view (another calendar's) and stores only the kinds shown.
    const stored = fixedView ? { ...loadPrefs(), kinds: prefs.kinds } : prefs;
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch { /* keep it for this session */ } }, [prefs]);
  useEffect(() => { if (autoFocus) rootRef.current?.focus(); }, []);
  // Whenever the journal shows another day, the calendar goes there; browsing the calendar leaves the journal alone.
  useEffect(() => { if (journalDate && !showDate) go(journalDate); }, [journalDate]);
  useEffect(() => { if (showDate) go(showDate); }, [showDate]);
  useEffect(() => { onDateChange?.(date); }, [date]);
  // Another page or view leaves the entry being edited behind.
  const pageKey = view === 'year' ? date.slice(0, 4) : view === 'month' ? date.slice(0, 7) : viewDates(view, date)[0];
  useEffect(() => setEditing(null), [view, pageKey]);
  const refocus = () => rootRef.current?.focus({ preventScroll: true });
  // Timed entries in a time grid are edited there, as a range that can be moved and resized; all others in place.
  const gridDates = view === 'week' || view === 'workweek' || view === 'day' ? viewDates(view, date) : [];
  const inGrid = editing?.entry.time && !(editing.entry.end && durationOf({time:editing.entry.time,end:editing.entry.end})>1440) && gridDates.includes(editing.date) ? editing : null;
  const save = async (change: EntryEdit, scope?: ScopeOption) => { if (editing) { await onEdit!(editing.date, editing.entry.id, change, scope); setEditing(null); refocus(); } };
  const remove = async (others: { id: string; date: string }[]) => { if (editing) { await onRemove!(editing.date, editing.entry.id, others); setEditing(null); refocus(); } };
  const editContext = { move:onMove, remove: onRemove ? (entry:Entry, value:string, others:ScopeOption['others'])=>onRemove(value,entry.id,others) : undefined, edit: onEdit ? (entry: Entry, value: string, element: HTMLElement) => setEditing({ entry, date: value, element }) : null, editingId: editing?.entry.id ?? null };

  const setView = (next: CalendarView) => { if (!fixedView) setPrefs(current => ({ ...current, view: next })); };
  // Going somewhere directly shows it in place; stepping slides the next page in from that side.
  const go = (value: string) => { setSlide(null); setDate(value); };
  const show = (next: CalendarView, value: string) => { go(value); setView(next); };
  // A day clicked in any view opens its note in the journal; the calendar goes there too.
  const openDay = (value: string) => { go(value); onOpen(value); };
  const step = (amount: 1 | -1) => { setSlide(amount > 0 ? 'next' : 'prev'); setDate(shiftView(view, date, amount)); };
  useWheelSwipe(step, { root:rootRef, ignore:'.cal-viewbar, .cal-toolbar, .cal-composer' });
  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as Element).closest('input, .cal-composer')) return;
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const byKey = calendarViews().find((item, index) => item.key === event.key.toUpperCase() || String(index + 1) === event.key);
    if (byKey) setView(byKey.view);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') step(event.key === 'ArrowLeft' ? -1 : 1);
    else if (event.key === 'h' || event.key === 'H') go(today);
    else return;
    event.preventDefault();
  }

  const [multi,setMulti]=useState<{start:string;end:string}|null>(null);
  const [rangeDraw,setRangeDraw]=useState<{start:string;end:string}|null>(null);
  const suppressClick=useRef(false);
  const suppressContext=useRef(false);
  const rangePage=useRef(date);rangePage.current=date;
  useEffect(()=>{rootRef.current?.querySelectorAll<HTMLElement>('[data-range-date]').forEach(cell=>{const date=cell.dataset.rangeDate!, shown=rangeDraw ?? multi;cell.toggleAttribute('data-range-selected',Boolean(shown && date>=shown.start && date<=shown.end));});},[rangeDraw,multi,date,view]);

  // A left drag over the calendar draws a frame: the entries wholly inside it are chosen (Ctrl adds to the choice). A
  // chosen entry dragged moves them all; Delete removes them; Escape or a press elsewhere lets them go.
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const beginFrame = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target as Element;
    if (!target.closest('.cal-body') || target.closest('.cal-item, button, input, textarea, a, .cal-composer, .popover, .cal-selection, .sidebar-resizer')) { if (!target.closest('.cal-item.is-selected')) clearCalendarSelection(); return; }
    const root = rootRef.current; if (!root) return;
    const start = { x: event.clientX, y: event.clientY }, keep = event.ctrlKey;
    if (!keep) clearCalendarSelection();
    let moved = false;
    const follow = (e: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      moved = true;
      const rect = new DOMRect(Math.min(start.x, e.clientX), Math.min(start.y, e.clientY), Math.abs(e.clientX - start.x), Math.abs(e.clientY - start.y));
      setFrame({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      selectInFrame(root, rect, keep);
    };
    const end = () => {
      window.removeEventListener('pointermove', follow); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      setFrame(null);
      if (moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 250); root.focus({ preventScroll: true }); }
    };
    window.addEventListener('pointermove', follow); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  };
  useEffect(() => clearCalendarSelection, []);
  useEffect(() => clearCalendarSelection(), [view, date]);
  const removeChosen = async () => {
    const chosen = [...calendarSelection().values()];
    clearCalendarSelection();
    if (onRemove) await Promise.all(chosen.map(item => onRemove(item.date, item.entry.id, []))).catch(reason => setNotice(String(reason)));
  };
  const beginMulti=(event:ReactPointerEvent<HTMLDivElement>)=>{
   if(!onCreate || event.button!==2 || (event.target as Element).closest('.cal-item,input,button:not(.cal-year-day):not(.cal-month-number)'))return;
   const cell=(event.target as Element).closest<HTMLElement>('[data-range-date]');if(!cell)return;event.preventDefault();
   const start=cell.dataset.rangeDate!;let end=start,moved=false,x=event.clientX,y=event.clientY,lastFlip=0;
   const follow=(e:globalThis.PointerEvent)=>{x=e.clientX;y=e.clientY;moved ||= Math.hypot(x-event.clientX,y-event.clientY)>5;const target=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-range-date]')?.dataset.rangeDate;if(target)end=target;if(moved)setRangeDraw({start:start<end?start:end,end:start<end?end:start});};
   const timer=setInterval(()=>{if(!moved || !rootRef.current)return;const r=rootRef.current.getBoundingClientRect();const direction=x>r.right-24 || y>Math.min(r.bottom,innerHeight)-24?1:x<r.left+24?-1:0;if(direction && Date.now()-lastFlip>900){lastFlip=Date.now();const next=shiftView(view,rangePage.current,direction as 1|-1);rangePage.current=next;setDate(next);const nextDays=viewDates(view,next);end=direction>0?nextDays[nextDays.length-1]:nextDays[0];setRangeDraw({start:start<end?start:end,end:start<end?end:start});}},150);
   const finish=()=>{clearInterval(timer);window.removeEventListener('pointermove',follow);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);if(moved){suppressContext.current=true;window.setTimeout(()=>{suppressContext.current=false;},250);setMulti({start:start<end?start:end,end:start<end?end:start});}setRangeDraw(null);};
   const cancel=()=>{moved=false;finish();};window.addEventListener('pointermove',follow);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
  };
  const pasteTarget = useRef<string | null>(null);
  const [pasting, setPasting] = useState<{entry:Entry;date:string} | null>(null);
  const [notice,setNotice] = useState('');
  useEffect(()=>{const copied=()=>setNotice(t('Eintrag kopiert'));window.addEventListener('calendar:copied',copied);return()=>window.removeEventListener('calendar:copied',copied);},[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2500);return()=>clearTimeout(timer);},[notice]);
  const paste = async (entry:Entry,target:string,whole:boolean) => {
    if(!onCreate) {setNotice(t('Dieser Eintrag kann hier nicht eingefügt werden.'));return;}
    try {
      const rule=whole && entry.repeat?.rule ? withStart(entry.repeat.rule,target) : null;
      const horizon=seriesHorizon(localDate(),target);
      const repeat=rule ? {series:crypto.randomUUID(),rule,horizon,dates:occurrences(rule,target,horizon).filter(value=>value>target)} : undefined;
      await onCreate(target,{kind:entry.kind,text:entry.text,description:entry.description ?? '',tag:entry.tag ?? null,time:entry.time ?? null,end:entry.end ?? null,priority:entry.priority,reminder:Boolean(entry.reminder),showInJournal:entry.showInJournal!==false,repeat});
      setPasting(null);setNotice(t('Eintrag eingefügt'));
    }catch(reason){setNotice(String(reason));}
  };
  useEffect(()=>{
    const key=(event:globalThis.KeyboardEvent)=>{
      if(!event.ctrlKey || event.key.toLowerCase()!=='v' || !onCreate || !rootRef.current?.matches(':hover, :focus-within'))return;
      if(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable=true]'))return;
      const entry=readCalendarEntry();if(!entry)return;
      event.preventDefault();const target=pasteTarget.current ?? date;
      if(entry.repeat?.rule)setPasting({entry,date:target});else void paste(entry,target,false);
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[date,onCreate]);
  const selectedIndex = calendarViews().findIndex(item => item.view === view);
  return <OpenInJournal.Provider value={onOpen}><EditInCalendar.Provider value={editContext}>
    <div ref={rootRef} className={`cal${embedded ? ' is-embedded' : ''}${fixedView ? ' is-fixed' : ''}`} data-view={view} tabIndex={-1} aria-label={t("Kalender")} onKeyDown={event => {
      if (calendarSelection().size && !(event.target as Element).closest('input, textarea, [contenteditable="true"], .cal-composer, .popover')) {
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); void removeChosen(); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clearCalendarSelection(); return; }
      }
      onKeyDown(event);
    }} onPointerDown={event => { beginMulti(event); beginFrame(event); }} onContextMenuCapture={event=>{const target=event.target as Element;if(target.closest('.cal-item,.cal-composer,.popover'))return;if(suppressContext.current){suppressContext.current=false;event.preventDefault();event.stopPropagation();return;}if(target.closest('.cal-time-column')){event.preventDefault();return;}const cell=target.closest<HTMLElement>('[data-range-date]');if(onCreate && cell && !cell.classList.contains('cal-time-allday-cell')){event.preventDefault();const selected=cell.dataset.rangeDate!;setMulti({start:selected,end:selected});}}} onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}} onPointerMove={event=>{const day=(event.target as Element).closest<HTMLElement>('[data-date]')?.dataset.date;pasteTarget.current=day ?? date;}}>
      {/* Drawn over several days: the normal card, with the span's start and end (and repeating, tags, priority …). */}
      {multi && onCreate && <CalendarComposer key="multi" date={multi.start} draft={null} span={{ end: multi.end }} onSpanChange={setMulti} tag={newTag}
        anchor={() => (rootRef.current?.querySelector(`[data-range-date="${multi.end}"]`) ?? rootRef.current?.querySelector(`[data-range-date="${multi.start}"]`) ?? rootRef.current)?.getBoundingClientRect() ?? null}
        onCancel={byKey => { setMulti(null); if (byKey) refocus(); }} onCreate={async entry => { await onCreate(multi.start, entry); setMulti(null); refocus(); }} />}
      {frame && <div className="cal-frame" aria-hidden="true" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }} />}
      {rangeDraw && <div className="cal-action-notice">{formatDate(rangeDraw.start)} – {formatDate(rangeDraw.end)}</div>}
      {notice && <div className="cal-action-notice" role="status">{notice}</div>}
      {pasting && <Popover anchor={rootRef.current} label={t('Einfügen')} onClose={()=>setPasting(null)}><div className="cal-paste-choice"><p>{t('Wiederholung einfügen')}</p><button type="button" onClick={()=>void paste(pasting.entry,pasting.date,false)}>{t('Nur diesen Tag')}</button><button type="button" onClick={()=>void paste(pasting.entry,pasting.date,true)}>{t('Mit Wiederholung')}</button></div></Popover>}
      {!fixedView && <nav className="cal-viewbar" aria-label={t("Kalenderansicht")}>
        <div className="cal-views" role="tablist" aria-label={t("Ansicht")} style={{ '--index': selectedIndex, '--count': calendarViews().length } as CSSProperties}>
          <span className="cal-views-indicator" aria-hidden="true" />
          {calendarViews().map((item, index) => <button key={item.view} type="button" role="tab" aria-selected={item.view === view} aria-label={item.label} title={`${item.label} · ${item.key} ${t('oder')} ${index + 1}`} onClick={() => setView(item.view)}>
            <span className="cal-view-long">{item.label}</span><span className="cal-view-short" aria-hidden="true">{item.short}</span>
          </button>)}
        </div>
        {onExport && onImport && <CalendarTransfer onExport={onExport} onImport={onImport} />}
      </nav>}
      {/* The same toolbar as the journal's: turning first (the same capsule), then the title, the filters at the end. */}
      <header className="cal-toolbar toolbar">
        <div className="cal-nav"><NavCluster label={t("Kalendernavigation")} prev={{ label: t("Zurück"), tip: t("Zurück · ←") }} next={{ label: t("Weiter"), tip: t("Weiter · →") }} today={{ tip: t("Heute · H") }}
          atToday={viewDates(view, date).includes(today)} onPrev={() => step(-1)} onToday={() => go(today)} onNext={() => step(1)} /></div>
        <h1 className="cal-title" title={`${title.main} ${title.sub}`} key={`${view}-${title.main}-${title.sub}`}><strong><span className="cal-title-long">{title.main}</span><span className="cal-title-short" aria-hidden="true">{shortTitle(title.main)}</span></strong>{title.sub && <> <span className="cal-title-sub">{title.sub}</span></>}</h1>
        <div className="cal-actions">
          <TagFilter label={t("Tags im Kalender")} hidden={hiddenTags} onChange={setHiddenTags} />
          {/* Like the orbit's satellites: round, the shown kinds lit. */}
          <div className="cal-filter" role="group" aria-label={t("Angezeigte Einträge")}>
            {(['event', 'task', 'note'] as EntryKind[]).map(kind => <button key={kind} type="button" className={`cal-filter-${kind}`} aria-pressed={kinds[kind]} title={`${kindPlurals()[kind]} ${kinds[kind] ? 'ausblenden' : 'zeigen'}`}
              onClick={() => setPrefs(current => ({ ...current, kinds: { ...current.kinds, [kind]: !current.kinds[kind] } }))}><Icon name={kind} /></button>)}
          </div>
        </div>
      </header>
      {error && <div className="cal-error" role="alert">{error}</div>}
      <div className="cal-body">
        <div className={`cal-page${slide ? ` slide-${slide}` : ''}`}>
          {view === 'year' && <YearView date={date} today={today} journalDate={journalDate} days={displayDays} entriesOn={displayEntriesOn} onDay={openDay} onMonth={value => show('month', value)} />}
          {view === 'month' && <MonthView date={date} today={today} journalDate={journalDate} days={displayDays} entriesOn={displayEntriesOn} onDay={openDay} onMore={value => show('day', value)} onWeek={value => show('week', value)} />}
          {(view === 'week' || view === 'workweek' || view === 'day') && <div className="cal-split">
            <TimeGrid journalDays={days} dates={viewDates(view, date)} today={today} now={now} journalDate={journalDate} entriesOn={entriesOn} onDay={openDay} onCreate={onCreate} newTag={newTag}
              editing={inGrid} onEditEnd={byKey => { setEditing(null); if (byKey) refocus(); }} onSave={save} onRemove={remove} />
            {view === 'day' && <DaySide date={date} today={today} journalDate={journalDate} days={displayDays} hiddenTags={hiddenTags} onPick={openDay} />}
          </div>}
        </div>
      </div>
    </div>
    {editing && !inGrid && <CalendarComposer key={editing.entry.id} date={editing.date} draft={null} entry={editing.entry} onSave={save} onRemove={remove}
      anchor={() => editing.element.isConnected ? editing.element.getBoundingClientRect() : null} onCancel={byKey => { setEditing(null); if (byKey) refocus(); }} />}
  </EditInCalendar.Provider></OpenInJournal.Provider>;
});

/**
 * Twelve small months (Apple's year view). Below a day's number a dot means tasks, a blue ring events, both a dot in a
 * blue ring (notes, when shown, a faint dot). A day opens its note in the journal, a month name the month view.
 */
function YearView({ date, today, journalDate, days, entriesOn, onDay, onMonth }: { date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void; onMonth: (date: string) => void }) {
  useLanguage();
  const year = date.slice(0, 4);
  const tags = useTags();
  const spans = calendarSpanLanes(viewDates('year', date), entriesOn);
  return <div className="cal-year">
    {Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).map(month => <section key={month} className={`cal-year-month${today.startsWith(month) ? ' is-current' : ''}`} aria-label={formatMonthName(`${month}-01`)}>
      <button type="button" className="cal-year-name" onClick={() => onMonth(date.startsWith(month) ? date : `${month}-01`)}>{formatMonthName(`${month}-01`)}</button>
      <div className="cal-year-weekdays" aria-hidden="true">{weekdayNames().map((name, index) => <span key={name} className={weekendClass('', index)}>{name[0]}</span>)}</div>
      <div className="cal-year-grid">
        {monthGrid(month).map((value, index) => {
          if (!value.startsWith(month)) return <span key={value} style={{ gridRow: Math.floor(index / 7) + 1, gridColumn: index % 7 + 1 }} />;
          const entries = entriesOn(value);
          const task = entries.some(entry => entry.kind === 'task'), event = entries.some(entry => entry.kind === 'event');
          const mark = task || event ? `${task ? ' is-task' : ''}${event ? ' is-event' : ''}` : entries.length ? ' is-note' : '';
          return <button key={value} type="button" data-range-date={value} data-date={value} className={`cal-year-day${hasJournalContent(days.get(value)) ? ' has-journal-content' : ''}${weekendClass(value, index % 7)}${value === today ? ' is-today' : ''}${value === journalDate ? ' is-journal' : ''}${mark ? ' has-mark' : ''}`}
            style={{ gridRow: Math.floor(index / 7) + 1, gridColumn: index % 7 + 1 }}
            aria-current={value === today ? 'date' : undefined} title={dayLabel(value, days.get(value))} onClick={() => onDay(value)}>
            <span>{Number(value.slice(8))}</span>{mark && <i className={`cal-year-mark${mark}`} aria-hidden="true" />}
          </button>;
        })}
        {Array.from({ length: 6 }, (_, week) => {
          const dates = monthGrid(month).slice(week * 7, week * 7 + 7);
          return spans.map(span => {
            const segment = calendarSpanSegment(span, dates.filter(value => value.startsWith(month)));
            if (!segment) return null;
            const monthDates = dates.filter(value => value.startsWith(month));
            const first = dates.indexOf(monthDates[segment.start]), last = dates.indexOf(monthDates[segment.end]);
            return <div key={`${week}/${span.entry.id}`} aria-hidden="true" data-span-entry={span.entry.id}
              className={`cal-year-span${segment.starts ? ' is-span-start' : ''}${segment.ends ? ' is-span-end' : ''}`}
              style={{ gridRow: week + 1, gridColumn: `${first + 1} / ${last + 2}`, '--span-inset': `${1 + Math.min(span.lane, 3) * 2}px`, '--span-color': tagOf(tags, span.entry.tag)?.color ?? 'var(--event)' } as CSSProperties} />;
          });
        })}
      </div>
    </section>)}
  </div>;
}

/** Six weeks with week numbers. As many entries as fit, then "+n weitere"; a day number opens the day view. */
function MonthView({ date, today, journalDate, days, entriesOn, onDay, onMore, onWeek }: {
  date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void; onMore: (date: string) => void; onWeek: (date: string) => void;
}) {
  useLanguage();
  const month = date.slice(0, 7);
  const grid = monthGrid(month);
  const spans = calendarSpanLanes(grid, entriesOn);
  const gridRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(3);
  // The grid is a new element for every month (its key); the old one, once removed, would measure 0 and hide all entries.
  useLayoutEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.height) setLines(Math.max(0, Math.floor((entry.contentRect.height / 6 - 30) / 20))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [month]);
  return <div className="cal-month">
    <div className="cal-month-head" aria-hidden="true"><span>{t("KW")}</span>{weekdayNames().map((name, index) => <span key={name} className={weekendClass('', index)}>{name}</span>)}</div>
    <div className="cal-month-grid" ref={gridRef} key={month}>
      {Array.from({ length: 6 }, (_, week) => {
        const dates = grid.slice(week * 7, week * 7 + 7);
        const segments = spans.flatMap(span => { const segment = calendarSpanSegment(span, dates); return segment ? [{ span, segment }] : []; });
        const required = Math.max(0, ...segments.map(({ span }) => span.lane + 1));
        const overflow = dates.some(value => required + entriesOn(value).filter(entry => !spans.some(span => span.entry.id === entry.id)).length > lines);
        const spanLines = Math.min(Math.max(0, lines - (overflow ? 1 : 0)), required);
        return <div key={week} className="cal-month-week">
        <button type="button" className="cal-month-kw" title={t("Woche zeigen")} onClick={() => onWeek(grid[week * 7])}>{isoWeek(grid[week * 7])}</button>
        {grid.slice(week * 7, week * 7 + 7).map((value, index) => {
          const all = entriesOn(value);
          const entries = all.filter(entry => !spans.some(span => span.entry.id === entry.id));
          const displayedSpans = segments.filter(({ span, segment }) => span.lane < spanLines && index >= segment.start && index <= segment.end).length;
          const room = Math.max(0, lines - spanLines);
          const needsMore = all.length > displayedSpans + room;
          const visible = entries.slice(0, Math.max(0, room - (needsMore ? 1 : 0)));
          const hidden = all.length - displayedSpans - visible.length;
          const title = days.get(value)?.title;
          return <div key={value} data-range-date={value} data-date={value} className={`cal-month-day${hasJournalContent(days.get(value)) ? ' has-journal-content' : ''}${weekendClass(value, index)}${value.startsWith(month) ? '' : ' is-outside'}${value === today ? ' is-today' : ''}${value === journalDate ? ' is-journal' : ''}`}
            style={{ gridColumn: index + 2, gridRow: 1 }}
            onClick={() => onDay(value)}>
            <div className="cal-month-day-head">
              <button type="button" className="cal-month-number" aria-label={t("{0} im Journal öffnen", formatDate(value))} aria-current={value === today ? 'date' : undefined} onClick={event => { event.stopPropagation(); onDay(value); }}>
                {value.endsWith('-01') ? <>{Number(value.slice(8))}.<small> {formatMonthName(value).slice(0, 3)}</small></> : Number(value.slice(8))}
              </button>
              {title && <span className="cal-month-title" title={title}>{title}</span>}
            </div>
            {spanLines > 0 && <div className="cal-month-span-space" style={{ height: `calc(${spanLines} * var(--month-entry-step))` }} aria-hidden="true" />}
            {visible.map(entry => <CalendarItem key={entry.id} entry={entry} date={value} />)}
            {hidden > 0 && <button type="button" className="cal-more" title={t("Alle in der Tagesansicht")} onClick={event => { event.stopPropagation(); onMore(value); }}>+{hidden}{t(" weitere")}</button>}
          </div>;
        })}
        {segments.filter(({ span }) => span.lane < spanLines).map(({ span, segment }) => <div key={span.entry.id}
          className={`cal-month-span${segment.starts ? ' is-span-start' : ''}${segment.ends ? ' is-span-end' : ''}`}
          data-span-entry={span.entry.id} style={{ gridRow: 1, gridColumn: `${segment.start + 2} / ${segment.end + 3}`, marginTop: `calc(var(--month-entry-top) + ${span.lane} * var(--month-entry-step))` }}>
          <CalendarItem entry={span.entry} date={dates[segment.start]} />
        </div>)}
      </div>; })}
    </div>
  </div>;
}

/** How close (px) to the visible grid's top or bottom edge a drag starts scrolling, and how fast at most (px per frame). */
const scrollZone = 40, scrollSpeed = 14;
// `anchor` and every position are minutes from the start of the origin's day, so a range can run on into the next day.
// `beyond` (px) grows while the pointer rests at the bottom or top with nothing left to scroll: the range runs on into the next
// (or previous) day.
type Gesture = { mode: 'new' | 'start' | 'end' | 'move'; column: HTMLElement; date: string; anchor: number; origin: Draft; x: number; y: number; beyond: number; moved: boolean; pressX: number; pressY: number };
/**
 * Days as columns over 24 hours. Entries without time sit in the band on top, timed ones in the grid (as long as they
 * last, an hour without an end; side by side where they overlap). Today's column shows the current time as a line, like
 * Apple's red one. With `onCreate`, dragging in a column marks a range in quarter hours (a mere click marks nothing; near
 * the edges the grid scrolls along) and the composer opens next to it; the marked range can still be moved and resized.
 * A click into the band on top makes an entry for the whole day, without a time.
 */
function TimeGrid({ journalDays, dates, today, now, journalDate, entriesOn, onDay, onCreate, newTag, editing, onEditEnd, onSave, onRemove }: {
  journalDays: Map<string, CalendarDay>; newTag?: string | null; dates: string[]; today: string; now: Date; journalDate: string | null; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void;
  onCreate?: (date: string, entry: NewEntry) => Promise<void>;
  editing: Editing | null; onEditEnd: (byKey: boolean) => void; onSave: (change: EntryEdit, scope?: ScopeOption) => Promise<void>; onRemove: (others: { id: string; date: string }[]) => Promise<void>;
}) {
  // An entry being edited keeps its own look: its range wears the entry's colour (its tag's) with a dashed edge.
  const gridTags = useTags();
  const editTone = editing ? tagOf(gridTags, editing.entry.tag)?.color ?? (editing.entry.kind === 'event' ? 'var(--event)' : 'var(--muted)') : null;
  // The card sits by the part of the range that is on screen, both days of one past midnight taken together.
  const selectionRect = () => {
    const grid = scrollRef.current, parts = [...(grid?.querySelectorAll<HTMLElement>('.cal-selection') ?? [])].map(part => part.getBoundingClientRect());
    if (!grid || !parts.length) return null;
    const view = grid.getBoundingClientRect(), body = grid.querySelector('.cal-time-top')?.getBoundingClientRect().bottom ?? view.top;
    const left = Math.min(...parts.map(r => r.left)), right = Math.max(...parts.map(r => r.right));
    const top = Math.max(body, Math.min(...parts.map(r => r.top))), bottom = Math.min(view.bottom, Math.max(...parts.map(r => r.bottom)));
    return bottom > top ? new DOMRect(left, top, right - left, bottom - top) : new DOMRect(left, Math.min(top, view.bottom - 24), right - left, 24);
  };
  useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hourHeight, setHourHeight] = useState(48);
  const previousHourHeight = useRef(hourHeight);
  const baseHourHeight=useRef(48);
  const zoom=useRef((()=>{try{return Math.max(.5,Math.min(4,Number(localStorage.getItem('journal.calendarZoom'))||1));}catch{return 1;}})());
  useEffect(()=>{
    const wheel=(event:WheelEvent)=>{
      const grid=scrollRef.current;if(!event.ctrlKey || !grid || !(event.target instanceof Node) || !grid.contains(event.target))return;
      event.preventDefault();event.stopPropagation();
      const nextZoom=Math.max(.5,Math.min(4,zoom.current*Math.exp(-event.deltaY*.002)));
      const next=Math.max(24,Math.min(320,baseHourHeight.current*nextZoom));
      const offset=Math.max(0,event.clientY-grid.getBoundingClientRect().top-(grid.querySelector('.cal-time-top')?.getBoundingClientRect().height ?? 0));
      pendingStart.current=false;scrollAnchor.current=(grid.scrollTop+offset)/previousHourHeight.current-offset/next;
      zoom.current=nextZoom;try{localStorage.setItem('journal.calendarZoom',String(nextZoom));}catch{/* Keep zoom for this session. */}setHourHeight(next);
    };
    document.addEventListener('wheel',wheel,{passive:false,capture:true});return()=>document.removeEventListener('wheel',wheel,true);
  },[]);
  // Fit a whole number of paper columns inside each day, keeping day boundaries on grid lines.
  useLayoutEffect(()=>{
    const grid=scrollRef.current;if(!grid)return;
    const align=()=>grid.querySelectorAll<HTMLElement>('.cal-time-column').forEach(column=>{
      const cells=Math.max(1,Math.round(column.getBoundingClientRect().width/(hourHeight/4)));
      column.style.setProperty('--paper-columns',String(cells));
    });
    align();const observer=new ResizeObserver(align);observer.observe(grid);return()=>observer.disconnect();
  },[hourHeight,dates[0],dates.length]);
  const scrollAnchor = useRef<number | null>(4);
  const pendingStart = useRef(true);
  const restoreStart = (scroller: HTMLElement, height: number) => {
    if (!scroller.clientHeight) return;
    scroller.scrollTop = 4 * height;
    // Before the first measurement, a tall window can fit the entire default grid.
    // Its scrollTop is clamped to zero; retain 04:00 until the scaled grid can scroll.
    if (Math.abs(scroller.scrollTop - 4 * height) < 1) {
      pendingStart.current = false;
      scrollAnchor.current = null;
    }
  };
  // Aim for twenty visible hours on a tall display. Smaller windows retain readable quarter-hour targets.
  // Observe the actual grid viewport and sticky header, so sidebar resizing and all-day entries count too.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const header = scroller?.querySelector<HTMLElement>('.cal-time-top');
    if (!scroller || !header) return;
    const measure = () => {
      const available = scroller.clientHeight - header.offsetHeight;
      if (available <= 0) return;
      baseHourHeight.current=Math.max(36,Math.ceil(available / 20 * 4)/4);
      const next = Math.max(24,Math.min(320,baseHourHeight.current*zoom.current));
      if (next === previousHourHeight.current) {
        if (pendingStart.current) restoreStart(scroller, next);
        return;
      }
      scrollAnchor.current = pendingStart.current ? 4 : scroller.scrollTop / previousHourHeight.current;
      setHourHeight(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller); observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    previousHourHeight.current = hourHeight;
    if (scrollRef.current) {
      if (pendingStart.current) restoreStart(scrollRef.current, hourHeight);
      else if (scrollAnchor.current !== null) scrollRef.current.scrollTop = scrollAnchor.current * hourHeight;
    }
    if (!pendingStart.current) scrollAnchor.current = null;
  }, [hourHeight]);
  const selectionRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // A new entry for the whole day (a click into the band on top), and the cell its card sits at.
  const [allDay, setAllDay] = useState<{ date: string; element: HTMLElement } | null>(null);
  const [marking, setMarking] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  // Appointments past midnight: the block ends at 24:00 on its day and goes on from 00:00 on the next.
  const columns = dates.map(date => {
    const entries = entriesOn(date).filter(entry=>!entry.time || !entry.end || durationOf({time:entry.time,end:entry.end})<=1440), before = shiftDate(date, -1);
    const own = entries.filter((entry): entry is Entry & { time: string } => Boolean(entry.time))
      .map(entry => ({ id: entry.id, time: entry.time, end: entry.end && entry.end > '24:00' ? '24:00' : entry.end, entry, from: date, night: entry.end && entry.end > '24:00' ? 'start' as const : undefined }));
    const carried = entriesOn(before).filter((entry): entry is Entry & { time: string; end: string } => Boolean(entry.time && entry.end && minutesOf(entry.end)-minutesOf(entry.time)<=1440 && minutesOf(entry.end)>1440))
      .map(entry => ({ id: `${entry.id}:rest`, time: '00:00', end: timeOfMinutes(minutesOf(entry.end) - 24 * 60), entry, from: before, night: 'rest' as const }));
    return { date, untimed: entries.filter(entry => !entry.time), timed: layoutTimed([...carried, ...own]) };
  });
  const spans=[...journalDays].flatMap(([date,day])=>day.entries.filter(entry=>entriesOn(date).some(shown=>shown.id===entry.id) && entry.time && entry.end && durationOf({time:entry.time,end:entry.end})>1440).map(entry=>({date,entry,end:shiftDate(date,Math.floor((minutesOf(entry.end!)-1)/1440))}))).filter(item=>item.date<=dates[dates.length-1] && item.end>=dates[0]);
  // Always open the shown days at 04:00, independently of their appointments.
  useLayoutEffect(() => {
    pendingStart.current = true;
    scrollAnchor.current = 4;
    if (scrollRef.current) restoreStart(scrollRef.current, hourHeight);
    setDraft(null);
    setMarking(false);
    gesture.current = null;
    cancelAnimationFrame(frame.current);
  }, [dates[0], dates.length]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // Editing a timed entry shows it as a marked range over its block: moved, resized and saved like a new one.
  const editDraft = useRef(false);
  useEffect(() => {
    if (!editing?.entry.time) {
      // Editing ended elsewhere (another view, a click outside): its range goes with it.
      if (editDraft.current) { editDraft.current = false; setDraft(null); }
      return;
    }
    const start = minutesOf(editing.entry.time);
    editDraft.current = true;
    setDraft({ date: editing.date, start, end: start + durationOf({ time: editing.entry.time, end: editing.entry.end }) });
  }, [editing?.entry.id]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // After Enter or Escape the calendar keeps the focus, so its keys work on.
  const refocus = () => (scrollRef.current?.closest('.cal') as HTMLElement | null)?.focus({ preventScroll: true });
  const minutesAt = (column: HTMLElement, y: number) => (y - column.getBoundingClientRect().top) / hourHeight * 60;
  const snap = (value: number) => Math.round(value / snapMinutes) * snapMinutes;
  // The column under the pointer (the nearest at the sides), and the pointer as minutes from the start of `date`'s day.
  const columnAt = (x: number) => {
    const all = [...scrollRef.current?.querySelectorAll<HTMLElement>('.cal-time-column') ?? []];
    return all.find(column => { const r = column.getBoundingClientRect(); return x >= r.left && x < r.right; }) ?? (x < (all[0]?.getBoundingClientRect().left ?? 0) ? all[0] : all.at(-1)!);
  };
  const minutesFrom = (date: string, x: number, y: number) => {
    const column = columnAt(x);
    return (dates.indexOf(column.dataset.date!) - dates.indexOf(date)) * 24 * 60 + minutesAt(column, y);
  };
  /** A range in minutes from `date`'s day, kept within the shown days, at most a day long, moved onto the day it starts on. */
  function placed(date: string, start: number, end: number): Draft {
    const first = -dates.indexOf(date) * 24 * 60, last = (dates.length - dates.indexOf(date)) * 24 * 60;
    if (start < first) { end += first - start; start = first; }
    if (end > last + 24 * 60) { start -= end - last - 24 * 60; end = last + 24 * 60; }
    start = Math.min(start, last - snapMinutes);
    const days = Math.floor(start / (24 * 60));
    return { date: shiftDate(date, days), start: start - days * 24 * 60, end: Math.min(end, start + 24 * 60) - days * 24 * 60 };
  }
  function follow(x: number, y: number) {
    const current = gesture.current;
    if (!current) return;
    current.x = x; current.y = y;
    const { origin } = current;
    const at = minutesFrom(origin.date, x, y) + current.beyond / hourHeight * 60;
    // Moved means the pointer itself went somewhere (a click that the grid scrolls under stays a click).
    if (Math.hypot(x - current.pressX, y - current.pressY) > 3) current.moved = true;
    if (current.mode === 'new') {
      if (!current.moved) return;
      // In whole quarters from the anchor's to the pointer's, either way, also into the next or previous day.
      const [from, to] = [Math.floor(current.anchor / snapMinutes) * snapMinutes, Math.floor(at / snapMinutes) * snapMinutes];
      const [start, end] = [Math.min(from, to), Math.max(from, to) + snapMinutes];
      setDraft(end - start > 24 * 60 ? placed(origin.date, to < from ? end - 24 * 60 : start, to < from ? end : start + 24 * 60) : placed(origin.date, start, end));
    }
    else if (current.mode === 'start') setDraft(placed(origin.date, Math.min(origin.end - snapMinutes, Math.max(origin.end - 24 * 60, snap(at))), origin.end));
    else if (current.mode === 'end') setDraft(placed(origin.date, origin.start, Math.max(origin.start + snapMinutes, Math.min(origin.start + 24 * 60, snap(at)))));
    else {
      const delta = snap(at - current.anchor);
      setDraft(placed(origin.date, origin.start + delta, origin.end + delta));
    }
  }
  // While dragging near the top or bottom of the visible hours, the grid scrolls (faster the closer) and the range follows.
  function autoScroll() {
    const current = gesture.current, scroller = scrollRef.current;
    if (!current || !scroller) return;
    const top = scroller.querySelector('.cal-time-top')!.getBoundingClientRect().bottom, bottom = scroller.getBoundingClientRect().bottom;
    // Only a pointer that really moves scrolls along: a click near the edge stays a click.
    const dragging = current.moved;
    const speed = !dragging ? 0 : current.y < top + scrollZone ? -(top + scrollZone - current.y) : current.y > bottom - scrollZone ? current.y - (bottom - scrollZone) : 0;
    if (speed) {
      const before = scroller.scrollTop;
      scroller.scrollTop += Math.max(-scrollSpeed, Math.min(scrollSpeed, speed / 2));
      if (scroller.scrollTop === before) current.beyond = Math.max(-24 * hourHeight, Math.min(24 * hourHeight, current.beyond + Math.max(-scrollSpeed, Math.min(scrollSpeed, speed / 2))));
      follow(current.x, current.y);
    }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function begin(event: ReactPointerEvent<HTMLElement>, mode: Gesture['mode'], date: string) {
    if (!onCreate || event.button !== (mode === 'new' ? 2 : 0)) return;
    // Marking anew leaves the entry being edited.
    if (mode === 'new' && editing) { editDraft.current = false; onEditEnd(false); }
    const column = (event.currentTarget.closest('.cal-time-column') as HTMLElement | null) ?? event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    column.setPointerCapture(event.pointerId);
    const origin: Draft = mode === 'new' ? { date, ...snapRange(minutesAt(column, event.clientY), minutesAt(column, event.clientY)) } : draft!;
    const anchor = minutesFrom(origin.date, event.clientX, event.clientY);
    gesture.current = { mode, column, date, anchor, origin, x: event.clientX, y: event.clientY, beyond: 0, moved: false, pressX: event.clientX, pressY: event.clientY };
    setMarking(true);
    if (mode === 'new') setDraft(null);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(autoScroll);
  }
  function finish() {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setMarking(false);
    // Only dragging marks a range; a click without moving leaves the grid as it was.
    if (current.mode === 'new' && !current.moved) setDraft(null);
  }
  const columnHandlers = (date: string) => onCreate ? {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { if (!(event.target as Element).closest('.cal-item, .cal-selection')) begin(event, 'new', date); },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => { if (gesture.current) follow(event.clientX, event.clientY); },
    onPointerUp: finish,
    onLostPointerCapture: finish,
  } : {};

  return <div className={`cal-time${onCreate ? ' can-create' : ''}${marking ? ' is-marking' : ''}`} ref={scrollRef} style={{ '--days': dates.length, '--hour': `${hourHeight}px` } as CSSProperties}>
    <div className="cal-time-top">
      <div className="cal-time-head">
        <span className="cal-time-corner">{t("KW ")}{isoWeek(dates[0])}</span>
        {dates.map(date => {
          const label = <><span className="cal-time-weekday">{formatWeekday(date)}</span><strong>{Number(date.slice(8))}</strong></>;
          const classes = `cal-time-day${hasJournalContent(journalDays.get(date)) ? ' has-journal-content' : ''}${weekendClass(date)}${date === today ? ' is-today' : ''}${date === journalDate ? ' is-journal' : ''}`;
          return <button key={date} type="button" className={classes} title={t("{0} im Journal öffnen", formatDate(date))} onClick={() => onDay(date)}>{label}</button>;
        })}
      </div>
      <div className={`cal-time-allday${columns.some(column => column.untimed.length) ? '' : ' is-empty'}`}>
        <span className="cal-time-corner">{t("ohne Zeit")}</span>{spans.map((item,index)=><div key={item.entry.id} className="cal-multiday-bar" style={{gridColumn:`${Math.max(0,dates.indexOf(item.date))+2} / ${item.end>=dates[dates.length-1]?dates.length+2:dates.indexOf(item.end)+3}`,gridRow:index+2}}><CalendarItem entry={item.entry} date={item.date}/></div>)}
        {columns.map((column,index) => <div key={column.date} data-range-date={column.date} style={{gridColumn:index+2}} className={`cal-time-allday-cell${weekendClass(column.date)}${allDay?.date === column.date ? ' is-composing' : ''}`}
          title={onCreate ? t("Rechtsklick: Eintrag für den ganzen Tag") : undefined}
          onContextMenu={event => { if (!onCreate || (event.target as Element).closest('.cal-item')) return; event.preventDefault(); event.stopPropagation(); setDraft(null); if (editing) onEditEnd(false); setAllDay({ date: column.date, element: event.currentTarget }); }}>
          {column.untimed.map(entry => <CalendarItem key={entry.id} entry={entry} date={column.date} />)}
        </div>)}
      </div>
    </div>
    <div className="cal-time-body">
      <div className="cal-time-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * hourHeight }}>{hour ? `${String(hour).padStart(2, '0')}:00` : ''}</span>)}</div>
      {columns.map(column => <div key={column.date} data-date={column.date} className={`cal-time-column${weekendClass(column.date)}${column.date === today ? ' is-today' : ''}`} {...columnHandlers(column.date)}>
        {column.timed.map(({ item, start, duration, left, width }) => <CalendarItem key={item.id} entry={item.entry} date={item.from} variant="block" short={duration < 45} night={item.night}
          style={{ top: start / 60 * hourHeight + (item.night === 'rest' ? 0 : 1), height: Math.max(10, duration / 60 * hourHeight - (item.night ? 1 : 3)), left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }} />)}
        {column.date === today && <div className="cal-now" style={{ top: nowMinutes / 60 * hourHeight }} aria-hidden="true" />}
        {draft?.date === column.date && <div ref={selectionRef} className={`cal-selection${marking ? ' is-marking' : ''}${draft.end - draft.start < 45 ? ' is-short' : ''}${draft.end > 24 * 60 ? ' is-night-start' : ''}${editTone ? ' is-edit' : ''}`}
          style={{ top: draft.start / 60 * hourHeight, height: (Math.min(draft.end, 24 * 60) - draft.start) / 60 * hourHeight, ...editTone ? { '--tone': editTone } : {} } as CSSProperties} onPointerDown={event => begin(event, 'move', column.date)}>
          <i className="cal-selection-edge is-start" title={t("Beginn ziehen")} onPointerDown={event => begin(event, 'start', column.date)} />
          <span className="cal-selection-time">{timeOfMinutes(draft.start)} – {formatEnd(timeOfMinutes(draft.end))}</span>
          <span className="cal-selection-length">{formatDuration(draft.end - draft.start)}</span>
          {draft.end <= 24 * 60 && <i className="cal-selection-edge is-end" title={t("Ende ziehen")} onPointerDown={event => begin(event, 'end', column.date)} />}
        </div>}
        {/* Past midnight the range goes on in the next day's column, where its end can be dragged. */}
        {draft && draft.end > 24 * 60 && shiftDate(draft.date, 1) === column.date && <div className={`cal-selection is-night-rest${marking ? ' is-marking' : ''}${editTone ? ' is-edit' : ''}`}
          style={{ top: 0, height: (draft.end - 24 * 60) / 60 * hourHeight , ...editTone ? { '--tone': editTone } : {} } as CSSProperties} onPointerDown={event => begin(event, 'move', column.date)}>
          <span className="cal-selection-time">{t("bis ")}{formatEnd(timeOfMinutes(draft.end))}</span>
          <i className="cal-selection-edge is-end" title={t("Ende ziehen")} onPointerDown={event => begin(event, 'end', column.date)} />
        </div>}
      </div>)}
      {dates.includes(today) && <div className="cal-now-row" style={{ top: nowMinutes / 60 * hourHeight }} aria-hidden="true"><span>{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span></div>}
    </div>
    {allDay && onCreate && <CalendarComposer key={`day-${allDay.date}`} date={allDay.date} draft={null} tag={newTag} anchor={() => allDay.element.isConnected ? allDay.element.getBoundingClientRect() : null}
      onCancel={byKey => { setAllDay(null); if (byKey) refocus(); }} onCreate={async entry => { await onCreate(allDay.date, entry); setAllDay(null); refocus(); }} />}
    {draft && !marking && onCreate && (editing && draft.date === editing.date
      ? <CalendarComposer key={editing.entry.id} date={draft.date} draft={draft} entry={editing.entry} anchor={selectionRect} onChange={setDraft}
        onCancel={byKey => { setDraft(null); onEditEnd(byKey); }} onSave={async (change, scope) => { await onSave(change, scope); setDraft(null); }} onRemove={async others => { await onRemove(others); setDraft(null); }} />
      : <CalendarComposer key={`new-${draft.date}`} date={draft.date} draft={draft} tag={newTag} anchor={selectionRect} onChange={setDraft}
        onCancel={byKey => { setDraft(null); if (byKey) refocus(); }} onCreate={async entry => { await onCreate(draft.date, entry); setDraft(null); refocus(); }} />)}
  </div>;
}

/** Next to the day's hours: the month to pick another day, and the day as the journal has it (title, counts, notes). */
function DaySide({ date, today, journalDate, days, hiddenTags, onPick }: { date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; hiddenTags: ReadonlySet<string>; onPick: (date: string) => void }) {
  useLanguage();
  const open = useContext(OpenInJournal);
  const { edit } = useContext(EditInCalendar);
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  // Paging the small month on its own needs that month's days for the dots.
  const grid = monthGrid(month);
  const shown = filterTagDays(useCalendarData(shiftDate(grid[0],-366), grid[grid.length - 1]).days, hiddenTags);
  const day = days.get(date);
  const entries = day?.entries ?? [];
  const tasks = entries.filter(entry => entry.kind === 'task');
  const notes = entries.filter(entry => entry.kind === 'note');
  const events = entries.filter(entry => entry.kind === 'event');
  return <aside className="cal-day-side" aria-label={t("Tagesübersicht")}>
    <CompactMonth month={month} days={shown} today={today} selected={date} onMonth={setMonth} onPick={onPick} />
    <section className="cal-day-summary">
      <h2>{formatDate(date)}</h2>
      {day?.title ? <p className="cal-day-name">{day.title}</p> : <p className="cal-day-name is-empty">{t("Ohne Titel")}</p>}
      <div className="cal-day-stats">
        <span><Icon name="event" />{events.length} {events.length === 1 ? t("Ereignis") : t("Ereignisse")}</span>
        <span><Icon name="task" />{tasks.filter(entry => entry.done).length}/{tasks.length} {tasks.length === 1 ? t("Aufgabe") : t("Aufgaben")}{t(" erledigt")}</span>
      </div>
      {notes.length > 0 && <div className="cal-day-notes">
        <h3>{t("Notizen")}</h3>
        {notes.map(note => <button key={note.id} type="button" className={`cal-day-note${note.priority ? ' is-priority' : ''}`} onClick={() => open(date, note.id)}
          onContextMenu={event => { if (!edit) return; event.preventDefault(); edit(note, date, event.currentTarget); }}><Icon name={entrySymbol(note)} /><span>{plainText(note.text) || t("ohne Text")}</span></button>)}
      </div>}
      <button type="button" className="cal-open" disabled={date === journalDate} onClick={() => open(date)}><Icon name="jump" />{t("Im Journal öffnen")}</button>
    </section>
  </aside>;
}
