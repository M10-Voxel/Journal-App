import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { journal } from '../journal';
import type { Entry, EntryKind } from '../journal';
import { formatShortDate } from '../dates';
import { formatDuration, slotMinutes, snapMinutes } from '../calendar';
import { canBeNote, formatSpan, linkedScopes, timeOfMinutes } from '../planning';
import type { ScopeOption } from '../planning';
import { ScopeChoice } from './ScopeChoice';
import { Icon, priorityIcon } from './Icon';

/** A range marked in the time grid, in minutes of its day. */
export interface Draft { date: string; start: number; end: number }
/** What the composer creates: an event or a task (a time block) over the marked range. */
export interface NewEntry { kind: 'event' | 'task'; text: string; time: string; end: string; priority: boolean; reminder: boolean }
/** What editing an entry in the calendar changes. */
export type EntryEdit = Partial<Pick<Entry, 'kind' | 'text' | 'priority' | 'reminder' | 'time' | 'end' | 'done' | 'cancelled'>>;

const widths = { create: 340, edit: 376 };
let lastKind: NewEntry['kind'] = 'event';
const kindLabels: Record<EntryKind, string> = { event: 'Ereignis', task: 'Aufgabe', note: 'Notiz' };
const kindKeys: Record<string, EntryKind> = { KeyE: 'event', KeyA: 'task', KeyN: 'note' };

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
  const editing = Boolean(entry);
  const width = widths[editing ? 'edit' : 'create'];
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? lastKind);
  const [text, setText] = useState(entry?.text ?? '');
  const [priority, setPriority] = useState(entry?.priority ?? false);
  const [reminder, setReminder] = useState(entry?.reminder ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [removing, setRemoving] = useState<ScopeOption[] | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; side: 'left' | 'right' | 'below' } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ onCancel });
  latest.current = { onCancel };
  const kinds: EntryKind[] = editing && !draft && canBeNote({ ...entry!, reminder }) ? ['event', 'task', 'note'] : ['event', 'task'];

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
    const scrollers = [window, ...document.querySelectorAll('.cal-time, .cal-month-day')];
    for (const target of scrollers) target.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => { for (const target of scrollers) target.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
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
    const start = Math.min(24 * 60 - length, Math.max(0, draft.start + amount));
    onChange({ ...draft, start, end: start + length });
  };
  const setEdge = (edge: 'start' | 'end', value: number) => draft && onChange?.(edge === 'start'
    ? { ...draft, start: Math.min(draft.end - snapMinutes, Math.max(0, value)) }
    : { ...draft, end: Math.max(draft.start + snapMinutes, Math.min(24 * 60, value)) });
  const chooseKind = (next: EntryKind) => {
    if (!kinds.includes(next)) return;
    if (!editing && next !== 'note') lastKind = next;
    setKind(next);
  };
  async function submit() {
    if (busy) return;
    if (!text.trim()) { setShaking(true); inputRef.current?.focus(); return; }
    setBusy(true);
    setError('');
    try {
      if (!entry) await onCreate?.({ kind: kind === 'note' ? 'event' : kind, text: text.trim(), time: timeOfMinutes(draft!.start), end: timeOfMinutes(draft!.end), priority, reminder });
      else {
        // An entry without an end keeps having none, unless its length changed.
        const times = draft ? { time: timeOfMinutes(draft.start), end: entry.end || length !== slotMinutes ? timeOfMinutes(draft.end) : null } : {};
        await onSave?.({ kind, text: text.trim(), priority, reminder: kind === 'note' ? false : reminder, ...times, ...kind === 'task' ? {} : { done: false, cancelled: false } });
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
  function onKeyDown(event: KeyboardEvent) {
    const key = event.key;
    if (removing) return;
    if (key === 'Escape') onCancel(true);
    else if (key === 'Enter' && !event.altKey) void submit();
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
    return <button type="button" className="cal-composer-time" aria-label={`${edge === 'start' ? 'Beginn' : 'Ende'} ${timeOfMinutes(value)}, mit Pfeiltasten oder Mausrad ändern`}
      data-tip={`${edge === 'start' ? 'Beginn' : 'Ende'} · ↑ ↓ oder Mausrad`}
      onWheel={(event: WheelEvent) => step(event.deltaY > 0 ? snapMinutes : -snapMinutes)}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowUp' ? -snapMinutes : snapMinutes); } }}>
      <span key={value}>{timeOfMinutes(value)}</span>
    </button>;
  };
  let order = 0;
  const satellite = (): CSSProperties => ({ '--i': order++ } as CSSProperties);
  const label = kindLabels[kind];
  const title = editing ? `${label} bearbeiten` : kind === 'event' ? 'Neues Ereignis' : 'Neue Aufgabe';

  return createPortal(<div ref={cardRef} className={`cal-composer is-${place?.side ?? 'right'}${place ? ' is-placed' : ''}${editing ? ' is-editing' : ''}`} role="dialog" aria-label={`${title} am ${formatShortDate(date)}`}
    style={{ left: place?.left ?? -9999, top: place?.top ?? 0, width } as CSSProperties} onKeyDown={onKeyDown}>
    <div className="cal-composer-head">
      <div className="cal-composer-kinds" role="radiogroup" aria-label="Art">
        {kinds.map(value => <button key={value} type="button" role="radio" className="cal-satellite" style={satellite()} aria-checked={kind === value}
          aria-label={value === 'task' && !editing ? 'Aufgabe (Zeitblock)' : kindLabels[value]} data-tip={`${kindLabels[value]} · Alt ${value === 'event' ? 'E' : value === 'task' ? 'A' : 'N'}`} onClick={() => chooseKind(value)}><Icon name={value} /></button>)}
      </div>
      <input ref={inputRef} className={`cal-composer-text${shaking ? ' is-shaking' : ''}`} onAnimationEnd={() => setShaking(false)} value={text} placeholder={kind === 'event' ? 'Neues Ereignis …' : kind === 'task' ? 'Neue Aufgabe …' : 'Notiz …'} aria-label="Text" disabled={busy}
        onChange={event => setText(event.target.value)} />
    </div>
    <div className="cal-composer-foot">
      <div className={`cal-composer-when${draft ? '' : ' is-untimed'}`}>
        <span className="cal-composer-day">{formatShortDate(date)}</span>
        {draft ? <>{timeChip('start')}<span className="cal-composer-dash">–</span>{timeChip('end')}<span className="cal-composer-length" key={length}>{formatDuration(length)}</span></>
          : <span className="cal-composer-untimed">{entry?.time ? formatSpan(entry.time, entry.end) : 'ohne Uhrzeit'}</span>}
      </div>
      <button type="button" className="cal-satellite cal-composer-priority" style={satellite()} aria-pressed={priority} aria-label="Hohe Priorität" data-tip="Priorität · Alt P" onClick={() => setPriority(value => !value)}><Icon name={priorityIcon(kind)} /></button>
      {kind !== 'note' && <button type="button" className="cal-satellite cal-composer-reminder" style={satellite()} aria-pressed={reminder} aria-label="Erinnern" data-tip="Erinnern" onClick={() => setReminder(value => !value)}><Icon name="bell" /></button>}
      {editing && <button type="button" className="cal-satellite cal-composer-remove" style={satellite()} aria-label={`${label} löschen`} data-tip="Löschen · Alt Entf" disabled={busy} onClick={() => void remove()}><Icon name="trash" /></button>}
      <button type="button" className="cal-satellite cal-composer-create" style={satellite()} aria-label={editing ? 'Speichern' : `${label} anlegen`} data-tip={editing ? 'Speichern · Enter' : 'Anlegen · Enter'} disabled={busy} onClick={() => void submit()}><Icon name="check" /></button>
    </div>
    {removing && <ScopeChoice className="in-composer" action="remove" options={removing} onChoose={option => void remove(option)} onCancel={() => { setRemoving(null); inputRef.current?.focus(); }} />}
    {error && <div className="cal-composer-error" role="alert">{error}</div>}
  </div>, document.body);
}
