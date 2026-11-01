import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { journal } from '../journal';
import type { Entry, EntryKind, Repeat } from '../journal';
import { formatMonth, formatShortDate, localDate, shiftMonth } from '../dates';
import { formatDuration, slotMinutes, snapMinutes } from '../calendar';
import { formatEnd, canBeNote, formatSpan, linkedScopes, repeatChange, timeOfMinutes } from '../planning';
import { defaultRule, describe, withStart } from '../repeat';
import type { RepeatRule } from '../repeat';
import { RepeatPanel } from './RepeatPanel';
import { CompactMonth } from './calendarShared';
import type { ScopeOption } from '../planning';
import { ScopeChoice } from './ScopeChoice';
import { Icon, priorityIcon } from './Icon';

/** A range marked in the time grid, in minutes of its day. */
export interface Draft { date: string; start: number; end: number }
/** What the composer creates: an event or a task (a time block) over the marked range. */
export interface NewEntry { kind: 'event' | 'task'; text: string; description: string; time: string; end: string; priority: boolean; reminder: boolean; showInJournal: boolean; repeat?: Repeat }
/** What editing an entry in the calendar changes. */
export type EntryEdit = Partial<Pick<Entry, 'kind' | 'text' | 'description' | 'priority' | 'reminder' | 'time' | 'end' | 'done' | 'cancelled' | 'showInJournal' | 'repeat'>>;

const widths = { create: 400, edit: 436 };
type ComposerKind = EntryKind | 'calendar';
const kindLabels = (): Record<ComposerKind, string> => ({ event: t("Ereignis"), task: t("Aufgabe"), note: t("Notiz"), calendar: t("Nur im Kalender") });
const kindKeys: Record<string, ComposerKind> = { KeyE: 'event', KeyA: 'task', KeyN: 'note', KeyK: 'calendar' };
const kindKey: Record<ComposerKind, string> = { event: 'E', task: 'A', note: 'N', calendar: 'K' };

/**
 * A small card next to a marked range (to create an entry there) or next to an entry (right click, to edit it), made like
 * the entry's orbit: round satellites spring out one after another, the chosen kind ringed in blue, around a line to type
 * into. A range stays editable: its edges and the times in the card move in quarter hours (drag, wheel or ↑ ↓), the whole
 * range with ↑ ↓ in the text, its end with ⇧ ↑ ↓. Enter creates or saves, Escape (or a click elsewhere) discards.
 * Editing also offers the note (where it may be one: no time, reminder or planning) and removing.
 */
export function CalendarComposer({ date, draft, entry, anchor, onChange, onCancel, onCreate, onSave, onRemove }: {
  date: string; draft: Draft | null; entry?: Entry; anchor: () => DOMRect | null; onChange?: (draft: Draft) => void; onCancel: (byKey: boolean) => void;
  onCreate?: (entry: NewEntry) => Promise<void>; onSave?: (change: EntryEdit) => Promise<void>; onRemove?: (others: ScopeOption['others']) => Promise<void>;
}) {
  useLanguage();
  const editing = Boolean(entry);
  const width = widths[editing ? 'edit' : 'create'];
  // A range marked in the calendar becomes a calendar entry unless chosen otherwise (it is the first choice, too).
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? 'event');
  const [text, setText] = useState(entry?.text ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [priority, setPriority] = useState(entry?.priority ?? false);
  const [reminder, setReminder] = useState(entry?.reminder ?? false);
  const [showInJournal, setShowInJournal] = useState(entry ? entry.showInJournal !== false : false);
  const selectedKind: ComposerKind = showInJournal ? kind : 'calendar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [removing, setRemoving] = useState<ScopeOption[] | null>(null);
  // Repeating (↻ or Alt W): the planner's repeat view opens under the card's lines; its end date is picked in a small month.
  const [rule, setRule] = useState<RepeatRule | null>(entry?.repeat?.rule ?? null);
  const [repeatView, setRepeatView] = useState<'rule' | 'end' | null>(null);
  const [endMonth, setEndMonth] = useState(date.slice(0, 7));
  // The card's day is the first occurrence; a written rule keeps its weekdays ("Wöchentlich am Mittwoch" stays Wednesday).
  const shownRule = rule && !entry?.repeat ? withStart(rule, date, false) : rule;
  const [place, setPlace] = useState<{ left: number; top: number; side: 'left' | 'right' | 'below' } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ onCancel });
  latest.current = { onCancel };
  const kinds: ComposerKind[] = editing && !draft && canBeNote({ ...entry!, reminder, repeat: rule ? entry!.repeat : null }) ? ['calendar', 'event', 'task', 'note'] : ['calendar', 'event', 'task'];

  // Next to the range or entry: on its right if there is room, else on its left, else below it; always inside the window.
  useLayoutEffect(() => {
    const position = () => {
      const rect = anchor();
      const card = cardRef.current;
      if (!rect || !card) return;
      const height = card.offsetHeight, gap = 10, margin = 8;
      let side: 'left' | 'right' | 'below' = 'right';
      let left = rect.right + gap;
      if (left + width > innerWidth - margin) { side = 'left'; left = rect.left - gap - width; }
      if (left < margin) { side = 'below'; left = Math.min(innerWidth - margin - width, Math.max(margin, rect.left + rect.width / 2 - width / 2)); }
      const top = side === 'below' ? Math.min(rect.bottom + gap, innerHeight - margin - height) : Math.min(innerHeight - margin - height, Math.max(margin, rect.top));
      setPlace(current => current && current.left === left && current.top === top && current.side === side ? current : { left, top, side });
    };
    position();
    const observer = new ResizeObserver(position);
    if (cardRef.current) observer.observe(cardRef.current);
    const scrollers = [window, ...document.querySelectorAll('.cal-time, .cal-month-day')];
    for (const target of scrollers) target.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => { observer.disconnect(); for (const target of scrollers) target.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
  }, [draft]);
  // Focused once the click that ended the marking has settled (it would otherwise leave the focus on the calendar).
  useEffect(() => {
    const frame = requestAnimationFrame(() => { inputRef.current?.focus({ preventScroll: true }); if (editing) inputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, []);
  // A click outside the card discards it; clicks in the grid are left to the grid (they mark or adjust a range).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest('.cal-composer, .cal-time-column')) latest.current.onCancel(false);
    };
    // Escape also discards while the focus is still elsewhere (right after marking).
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !cardRef.current?.contains(event.target as Node)) { event.preventDefault(); latest.current.onCancel(true); } };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('keydown', onKey); };
  }, []);

  const length = draft ? draft.end - draft.start : 0;
  const shift = (amount: number) => {
    if (!draft || !onChange) return;
    // It may run past midnight; its start stays on its day.
    const start = Math.min(24 * 60 - snapMinutes, Math.max(0, draft.start + amount));
    onChange({ ...draft, start, end: start + length });
  };
  const setEdge = (edge: 'start' | 'end', value: number) => draft && onChange?.(edge === 'start'
    ? { ...draft, start: Math.min(draft.end - snapMinutes, Math.max(0, draft.end - 24 * 60, value)) }
    : { ...draft, end: Math.max(draft.start + snapMinutes, Math.min(draft.start + 24 * 60, 48 * 60 - snapMinutes, value)) });
  const chooseKind = (next: ComposerKind) => {
    if (!kinds.includes(next)) return;
    setKind(next === 'calendar' ? 'event' : next);
    setShowInJournal(next !== 'calendar');
  };
  async function submit() {
    if (busy) return;
    if (!text.trim()) { setShaking(true); inputRef.current?.focus(); return; }
    setBusy(true);
    setError('');
    try {
      // The same change the planner makes: a new or changed rule starts a series here (see repeatChange).
      const repeatOf = (base: Entry) => kind === 'note' ? undefined : repeatChange(base, date, [date], { time: null, reminder }, shownRule, localDate()).repeat ?? undefined;
      if (!entry) {
        const made = { kind: kind === 'note' ? 'event' as const : kind, text: text.trim(), description: description.trim(), time: timeOfMinutes(draft!.start), end: timeOfMinutes(draft!.end), priority, reminder, showInJournal };
        await onCreate?.({ ...made, repeat: repeatOf({ id: '', done: false, cancelled: false, plan: null, ...made }) });
      } else {
        // An entry without an end keeps having none, unless its length changed.
        const times = draft ? { time: timeOfMinutes(draft.start), end: entry.end || length !== slotMinutes ? timeOfMinutes(draft.end) : null } : {};
        const repeat = repeatOf(entry);
        await onSave?.({ kind, text: text.trim(), description: description.trim(), priority, showInJournal, reminder: kind === 'note' ? false : reminder, ...times, ...kind === 'task' ? {} : { done: false, cancelled: false }, ...repeat ? { repeat } : {} });
      }
    }
    catch (reason) { setError(String(reason)); setBusy(false); }
  }
  // A linked entry (moved, or one of several days) asks first whether the following or all others go too.
  async function remove(option?: ScopeOption) {
    if (busy || !onRemove || !entry) return;
    if (!option) {
      const options = linkedScopes(await journal.linked(entry.id).catch(() => []), entry.id, 'remove');
      if (options.length > 1) { setRemoving(options); return; }
    }
    setRemoving(null);
    setBusy(true);
    try { await onRemove(option?.others ?? []); } catch (reason) { setError(String(reason)); setBusy(false); }
  }
  function toggleRepeat() {
    if (repeatView) { setRepeatView(null); inputRef.current?.focus(); return; }
    if (!rule) setRule(defaultRule(date));
    setRepeatView('rule');
  }
  function onKeyDown(event: KeyboardEvent) {
    const key = event.key;
    if (removing) return;
    if (key === 'Escape' && repeatView) { setRepeatView(repeatView === 'end' ? 'rule' : null); if (repeatView === 'rule') inputRef.current?.focus(); }
    else if (key === 'Escape') onCancel(true);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyW' && kind !== 'note') toggleRepeat();
    else if (key === 'Enter' && !event.altKey && (!(event.target instanceof HTMLTextAreaElement) || event.ctrlKey || event.metaKey)) void submit();
    else if (event.altKey && !event.ctrlKey && event.code in kindKeys) chooseKind(kindKeys[event.code]);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyP') setPriority(value => !value);
    else if (event.altKey && !event.ctrlKey && key === 'Delete' && editing) void remove();
    else if ((key === 'ArrowUp' || key === 'ArrowDown') && draft && event.target === inputRef.current && !event.altKey && !event.ctrlKey) {
      const step = key === 'ArrowUp' ? -snapMinutes : snapMinutes;
      if (event.shiftKey) setEdge('end', draft.end + step); else shift(step);
    }
    else return;
    // The journal's own shortcuts (Alt+E, Alt+A, Alt+P …) must not act behind the card.
    event.preventDefault();
    event.stopPropagation();
  }
  const timeChip = (edge: 'start' | 'end') => {
    const value = edge === 'start' ? draft!.start : draft!.end;
    const step = (amount: number) => setEdge(edge, value + amount);
    return <button type="button" className="cal-composer-time" aria-label={t("{0} {1}, mit Pfeiltasten oder Mausrad ändern", edge === 'start' ? t("Beginn") : t("Ende"), formatEnd(timeOfMinutes(value)).replace('⁺¹', t(" am nächsten Tag")))}
      data-tip={t("{0} · ↑ ↓ oder Mausrad", edge === 'start' ? t("Beginn") : t("Ende"))}
      onWheel={(event: WheelEvent) => step(event.deltaY > 0 ? snapMinutes : -snapMinutes)}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowUp' ? -snapMinutes : snapMinutes); } }}>
      <span key={value}>{formatEnd(timeOfMinutes(value))}</span>
    </button>;
  };
  let order = 0;
  const satellite = (): CSSProperties => ({ '--i': order++ } as CSSProperties);
  const label = selectedKind === 'calendar' ? t("Kalendereintrag") : kindLabels()[kind];
  const title = editing ? t("{0} bearbeiten", label) : selectedKind === 'calendar' ? t("Neuer Kalendereintrag") : kind === 'event' ? t("Neues Ereignis") : t("Neue Aufgabe");

  return createPortal(<div ref={cardRef} className={`cal-composer is-${place?.side ?? 'right'}${place ? ' is-placed' : ''}${editing ? ' is-editing' : ''}`} role="dialog" aria-label={t("{0} am {1}", title, formatShortDate(date))}
    style={{ left: place?.left ?? -9999, top: place?.top ?? 0, width } as CSSProperties} onKeyDown={onKeyDown}>
    <div className="cal-composer-head">
      <div className="cal-composer-kinds" role="radiogroup" aria-label={t("Art")}>
        {kinds.map(value => <button key={value} type="button" role="radio" className="cal-satellite" style={satellite()} aria-checked={selectedKind === value}
          aria-label={value === 'task' && !editing ? t("Aufgabe (Zeitblock)") : kindLabels()[value]} data-tip={`${kindLabels()[value]} · Alt ${kindKey[value]}`} onClick={() => chooseKind(value)}><Icon name={value} /></button>)}
      </div>
      <input ref={inputRef} className={`cal-composer-text${shaking ? ' is-shaking' : ''}`} onAnimationEnd={() => setShaking(false)} value={text} placeholder={selectedKind === 'calendar' ? t("Neuer Kalendereintrag …") : kind === 'event' ? t("Neues Ereignis …") : kind === 'task' ? t("Neue Aufgabe …") : t("Notiz …")} aria-label={t("Text")} disabled={busy}
        onChange={event => setText(event.target.value)} />
    </div>
    <textarea className="cal-composer-description" aria-label={t("Beschreibung")} placeholder={t("Beschreibung hinzufügen …")} value={description} onChange={event => setDescription(event.target.value)} disabled={busy} rows={2} maxLength={100000} />
    <div className="cal-composer-foot">
      <div className={`cal-composer-when${draft ? '' : ' is-untimed'}`}>
        <span className="cal-composer-day">{formatShortDate(date)}</span>
        {draft ? <>{timeChip('start')}<span className="cal-composer-dash">–</span>{timeChip('end')}<span className="cal-composer-length" key={length}>{formatDuration(length)}</span></>
          : <span className="cal-composer-untimed">{entry?.time ? formatSpan(entry.time, entry.end) : t("ohne Uhrzeit")}</span>}
      </div>
      <button type="button" className="cal-satellite cal-composer-priority" style={satellite()} aria-pressed={priority} aria-label={t("Hohe Priorität")} data-tip={t("Priorität · Alt P")} onClick={() => setPriority(value => !value)}><Icon name={priorityIcon(kind)} /></button>
      {kind !== 'note' && <button type="button" className="cal-satellite cal-composer-repeat" style={satellite()} aria-pressed={Boolean(rule)} aria-expanded={repeatView !== null}
        aria-label={shownRule ? t("Wiederholen: {0}", describe(shownRule)) : t("Wiederholen")} data-tip={shownRule ? `${describe(shownRule)} · Alt W` : t("Wiederholen · Alt W")} onClick={toggleRepeat}><Icon name="repeat" /></button>}
      {kind !== 'note' && <button type="button" className="cal-satellite cal-composer-reminder" style={satellite()} aria-pressed={reminder} aria-label={t("Erinnern")} data-tip={t("Erinnern zur Uhrzeit")} onClick={() => setReminder(value => !value)}><Icon name="bell" /></button>}
      {editing && <button type="button" className="cal-satellite cal-composer-remove" style={satellite()} aria-label={t("{0} löschen", label)} data-tip={t("Löschen · Alt Entf")} disabled={busy} onClick={() => void remove()}><Icon name="trash" /></button>}
      <button type="button" className="cal-satellite cal-composer-create" style={satellite()} aria-label={editing ? t("Speichern") : t("{0} anlegen", label)} data-tip={editing ? t("Speichern · Enter") : t("Anlegen · Enter")} disabled={busy} onClick={() => void submit()}><Icon name="check" /></button>
    </div>
    {repeatView && shownRule && <div className="cal-composer-repeat-panel">
      {repeatView === 'rule'
        ? <RepeatPanel rule={shownRule} today={localDate()} onChange={setRule} onBack={() => { setRepeatView(null); inputRef.current?.focus(); }}
          onOff={() => { setRule(null); setRepeatView(null); inputRef.current?.focus(); }} onPickEnd={() => { setEndMonth((shownRule.end?.until ?? date).slice(0, 7)); setRepeatView('end'); }} />
        : <div className="cal-composer-end" role="group" aria-label={t("Ende wählen")}>
          <div className="cal-composer-end-head">
            <button type="button" className="clock-back" aria-label={t("Zurück")} data-tip={t("Zurück · Esc")} onClick={() => setRepeatView('rule')}><Icon name="left" /></button>
            <span className="repeat-summary"><em>{t("Ende · ")}</em>{formatMonth(endMonth)}</span>
            <button type="button" className="cal-icon-button" aria-label={t("Vorheriger Monat")} onClick={() => setEndMonth(shiftMonth(endMonth, -1))}><Icon name="up" /></button>
            <button type="button" className="cal-icon-button" aria-label={t("Nächster Monat")} onClick={() => setEndMonth(shiftMonth(endMonth, 1))}><Icon name="down" /></button>
          </div>
          <CompactMonth month={endMonth} days={new Map()} today={localDate()} selected={shownRule.end?.until ?? null} onMonth={setEndMonth}
            onPick={until => { setRule({ ...shownRule, end: { until: until < shownRule.start ? shownRule.start : until } }); setRepeatView('rule'); }} />
        </div>}
    </div>}
    {removing && <ScopeChoice className="in-composer" action="remove" options={removing} onChoose={option => void remove(option)} onCancel={() => { setRemoving(null); inputRef.current?.focus(); }} />}
    {error && <div className="cal-composer-error" role="alert">{error}</div>}
  </div>, document.body);
}
