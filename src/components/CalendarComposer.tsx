import { decodeMailContent } from '../mailContent';
import { MailContent } from './MailContent';
import { MarkdownField } from './MarkdownField';
import { useDismissLayer } from './useDismissLayer';
import { shiftDate } from '../dates';
import { copyCalendarEntry } from '../calendarClipboard';
import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { journal } from '../journal';
import type { Entry, EntryKind, Repeat } from '../journal';
import { formatMonth, formatShortDate, localDate, shiftMonth } from '../dates';
import { minutesOf, formatDuration, slotMinutes, snapMinutes } from '../calendar';
import { formatEnd, canBeNote, editScopes, formatSpan, linkedScopes, repeatChange, timeOfMinutes } from '../planning';
import { defaultRule, describe, withStart } from '../repeat';
import type { RepeatRule } from '../repeat';
import { RepeatPanel } from './RepeatPanel';
import { CompactMonth } from './calendarShared';
import type { ScopeOption } from '../planning';
import { ScopeChoice } from './ScopeChoice';
import { Icon, priorityIcon } from './Icon';
import { TagPicker } from './TagPicker';
import { EntryIcon, IconPicker } from './EntryIcon';
import { ReminderChoice, reminderLeadLabel } from './ReminderChoice';
import { contrastRatio } from '../colors';
import { DateField, TimeField } from './FieldPickers';
import { PopupHead, PopupKeys } from './PopupChrome';
import { usePopupLook } from '../popupLook';
import { tagOf } from '../tags';
import { useTags } from '../tagStore';

/** A range marked in the time grid, in minutes of its day. */
export interface Draft { date: string; start: number; end: number }
/** What the composer creates: an event or a task (a time block) over the marked range. */
export interface NewEntry { kind: EntryKind; text: string; description: string; tag: string | null; time: string | null; end: string | null; priority: boolean; reminder: boolean; reminderBefore?: number; icon?: string | null; showInJournal: boolean; repeat?: Repeat }
/** What editing an entry in the calendar changes. */
export type EntryEdit = Partial<Pick<Entry, 'kind' | 'text' | 'description' | 'tag' | 'priority' | 'reminder' | 'reminderBefore' | 'icon' | 'time' | 'end' | 'done' | 'cancelled' | 'showInJournal' | 'repeat'>>;

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
export function CalendarComposer({ date, draft, entry, span, onSpanChange, tag: initialTag = null, anchor, onChange, onCancel, onCreate, onSave, onRemove }: {
  /** A new entry over several days (drawn over days): from `date` to `span.end`, all day unless times are chosen. */
  span?: { end: string };
  onSpanChange?: (range: { start: string; end: string }) => void;
  date: string; draft: Draft | null; entry?: Entry; tag?: string | null; anchor: () => DOMRect | null; onChange?: (draft: Draft) => void; onCancel: (byKey: boolean) => void;
  onCreate?: (entry: NewEntry) => Promise<void>; onSave?: (change: EntryEdit, scope?: ScopeOption) => Promise<void>; onRemove?: (others: ScopeOption['others']) => Promise<void>;
}) {
  useLanguage();
  const editing = Boolean(entry);
  const look = usePopupLook();
  const width = widths[editing ? 'edit' : 'create'];
  // A range marked in the calendar becomes a calendar entry unless chosen otherwise (it is the first choice, too).
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? 'event');
  const [text, setText] = useState(entry?.text ?? '');
  const longSpan=Boolean(span) || Boolean(entry?.time && entry.end && minutesOf(entry.end)-minutesOf(entry.time)>1440);
  const [longEndDate,setLongEndDate]=useState(span ? span.end : entry?.end ? shiftDate(date,Math.floor(minutesOf(entry.end)/1440)) : date);
  const [longStartTime,setLongStartTime]=useState(entry?.time ?? '00:00');
  const [longEndTime,setLongEndTime]=useState(entry?.end ? timeOfMinutes(minutesOf(entry.end)%1440) : '23:59');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [priority, setPriority] = useState(entry?.priority ?? false);
  // The tag (Alt G): a new range takes the one the calendar suggests (see newTag), an entry keeps its own.
  const tags = useTags();
  const [tagId, setTagId] = useState<string | null>(entry ? entry.tag ?? null : initialTag);
  const tag = tagOf(tags, tagId);
  const [tagging, setTagging] = useState(false);
  const tagButton = useRef<HTMLButtonElement>(null);
  const [reminder, setReminder] = useState(entry?.reminder ?? false);
  const [reminderBefore, setReminderBefore] = useState(entry?.reminderBefore ?? 0);
  const [icon, setIcon] = useState<string | null>(entry?.icon ?? null);
  const [choosingIcon, setChoosingIcon] = useState(false);
  const [choosingReminder, setChoosingReminder] = useState(false);
  const iconButton = useRef<HTMLButtonElement>(null), reminderButton = useRef<HTMLButtonElement>(null);
  const [showInJournal, setShowInJournal] = useState(entry ? entry.showInJournal !== false : false);
  const selectedKind: ComposerKind = showInJournal ? kind : 'calendar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [removing, setRemoving] = useState<ScopeOption[] | null>(null);
  // An edit of an entry with linked ones (a series, several days) asks before it is applied how far it reaches.
  const [applying, setApplying] = useState<{ change: EntryEdit; options: ScopeOption[] } | null>(null);
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
  useDismissLayer({element:()=>cardRef.current,inside:target=>!!target.closest('.cal-selection, .shortcut-backdrop'),onDismiss:()=>latest.current.onCancel(false)});
  // Selected-range handles stay interactive; another press only dismisses the card.
  useEffect(() => {
    // Escape also discards while the focus is still elsewhere (right after marking).
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !cardRef.current?.contains(event.target as Node)) { event.preventDefault(); latest.current.onCancel(true); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);

  const length = draft ? draft.end - draft.start : 0;
  // Steps follow the range as last set, not as last drawn: keys repeating faster than the card redraws would else
  // all start from the same range and get lost.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const changeDraft = (next: Draft) => { latestDraft.current = next; onChange?.(next); };
  const shift = (amount: number) => {
    const current = latestDraft.current;
    if (!current || !onChange) return;
    // It may run past midnight; its start stays on its day.
    const start = Math.min(24 * 60 - snapMinutes, Math.max(0, current.start + amount));
    changeDraft({ ...current, start, end: start + current.end - current.start });
  };
  // `by` steps from the edge as last set; `to` sets it.
  const setEdge = (edge: 'start' | 'end', change: { to: number } | { by: number }) => {
    const current = latestDraft.current;
    if (!current || !onChange) return;
    const value = 'to' in change ? change.to : (edge === 'start' ? current.start : current.end) + change.by;
    changeDraft(edge === 'start'
      ? { ...current, start: Math.min(current.end - snapMinutes, Math.max(0, current.end - 24 * 60, value)) }
      : { ...current, end: Math.max(current.start + snapMinutes, Math.min(current.start + 24 * 60, 48 * 60 - snapMinutes, value)) });
  };
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
      // Over several days: the end in minutes from the first day's start (as storage.rs keeps it).
      const longEnd = (Date.parse(longEndDate) - Date.parse(date)) / 86400000 * 1440 + minutesOf(longEndTime);
      if (longSpan && (longEnd <= minutesOf(longStartTime) || longEnd - minutesOf(longStartTime) > 366 * 1440)) { setError(t('Bitte den Zeitraum prüfen.')); setBusy(false); return; }
      if (!entry) {
        const times = longSpan ? { time: longStartTime, end: timeOfMinutes(longEnd) } : { time: draft ? timeOfMinutes(draft.start) : null, end: draft ? timeOfMinutes(draft.end) : null };
        const made = { kind: kind === 'note' ? 'event' as const : kind, text: text.trim(), description: description.trim(), tag: tagId, ...times, priority, reminder, reminderBefore: reminder ? reminderBefore : 0, icon, showInJournal };
        await onCreate?.({ ...made, repeat: repeatOf({ id: '', done: false, cancelled: false, plan: null, ...made }) });
      } else {
        // An entry without an end keeps having none, unless its length changed.
        const times = longSpan ? {time:longStartTime,end:timeOfMinutes((Date.parse(longEndDate)-Date.parse(date))/86400000*1440+minutesOf(longEndTime))} : draft ? { time: timeOfMinutes(draft.start), end: entry.end || length !== slotMinutes ? timeOfMinutes(draft.end) : null } : {};
        const repeat = repeatOf(entry);
        const change: EntryEdit = { kind, text: text.trim(), description: description.trim(), tag: tagId, priority, showInJournal, reminder: kind === 'note' ? false : reminder, reminderBefore: kind !== 'note' && reminder ? reminderBefore : 0, icon, ...times, ...kind === 'task' ? {} : { done: false, cancelled: false }, ...repeat ? { repeat } : {} };
        // A changed rule makes a new series anyway; otherwise the group decides whether there is anything to ask.
        const options = repeat ? [] : editScopes(await journal.linked(entry.id).catch(() => []), entry.id, date);
        if (options.length > 1) { setApplying({ change, options }); setBusy(false); return; }
        await onSave?.(change);
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
    if(entry && event.ctrlKey && event.key.toLowerCase()==='c' && !window.getSelection()?.toString() && (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) || event.target.selectionStart===event.target.selectionEnd)) {
      event.preventDefault();copyCalendarEntry({...entry,text,description,priority,tag:tagId,reminder,reminderBefore,icon,showInJournal,kind,repeat:rule ? {...entry.repeat!,rule} : null});return;
    }
    const key = event.key;
    if (removing || applying) return;
    if (key === 'Escape' && repeatView) { setRepeatView(repeatView === 'end' ? 'rule' : null); if (repeatView === 'rule') inputRef.current?.focus(); }
    else if (key === 'Escape') onCancel(true);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyW' && kind !== 'note') toggleRepeat();
    // Enter in the description is a new line there; Ctrl+Enter saves from anywhere.
    else if (key === 'Enter' && !event.altKey && (!(event.target as Element).closest?.('.cal-composer-description') || event.ctrlKey || event.metaKey)) void submit();
    else if (event.altKey && !event.ctrlKey && event.code in kindKeys) chooseKind(kindKeys[event.code]);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyP') setPriority(value => !value);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyG') setTagging(true);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyI') setChoosingIcon(true);
    else if (event.altKey && !event.ctrlKey && key === 'Delete' && editing) void remove();
    else if ((key === 'ArrowUp' || key === 'ArrowDown') && draft && event.target === inputRef.current && !event.altKey && !event.ctrlKey) {
      const step = key === 'ArrowUp' ? -snapMinutes : snapMinutes;
      if (event.shiftKey) setEdge('end', { by: step }); else shift(step);
    }
    else return;
    // The journal's own shortcuts (Alt+E, Alt+A, Alt+P …) must not act behind the card.
    event.preventDefault();
    event.stopPropagation();
  }
  const timeChip = (edge: 'start' | 'end') => {
    const value = edge === 'start' ? draft!.start : draft!.end;
    const step = (amount: number) => setEdge(edge, { by: amount });
    return <button type="button" className="cal-composer-time" aria-label={t("{0} {1}, mit Pfeiltasten oder Mausrad ändern", edge === 'start' ? t("Beginn") : t("Ende"), formatEnd(timeOfMinutes(value)).replace('⁺¹', t(" am nächsten Tag")))}
      data-tip={t("{0} · ↑ ↓ oder Mausrad", edge === 'start' ? t("Beginn") : t("Ende"))}
      onWheel={(event: WheelEvent) => step(event.deltaY > 0 ? snapMinutes : -snapMinutes)}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowUp' ? -snapMinutes : snapMinutes); } }}>
      <span key={value}>{formatEnd(timeOfMinutes(value))}</span>
    </button>;
  };
  let order = 0;
  const satellite = (style?: CSSProperties): CSSProperties => ({ ...style, '--i': order++ } as CSSProperties);
  const label = selectedKind === 'calendar' ? t("Kalendereintrag") : kindLabels()[kind];
  const title = editing ? t("{0} bearbeiten", label) : selectedKind === 'calendar' ? t("Neuer Kalendereintrag") : kind === 'event' ? t("Neues Ereignis") : t("Neue Aufgabe");

  return createPortal(<div ref={cardRef} className={`cal-composer is-${place?.side ?? 'right'}${place ? ' is-placed' : ''}${editing ? ' is-editing' : ''}${tag ? ' has-tag' : ''}`} role="dialog" aria-label={t("{0} am {1}", title, formatShortDate(date))}
    style={{ left: place?.left ?? -9999, top: place?.top ?? 0, width, '--tag': tag?.color, ...tag ? { '--accent': tag.color, '--on-accent': contrastRatio('#ffffff', tag.color) > contrastRatio('#06101f', tag.color) ? '#ffffff' : '#06101f' } : {} } as CSSProperties} onKeyDown={onKeyDown}>
    <PopupHead look={look} title={title} command={editing ? 'entry --edit' : 'entry --new'} onClose={() => onCancel(false)} />
    <div className="cal-composer-head">
      <div className="cal-composer-kinds" role="radiogroup" aria-label={t("Art")}>
        {kinds.map(value => <button key={value} type="button" role="radio" className="cal-satellite" style={satellite()} aria-checked={selectedKind === value}
          aria-label={value === 'task' && !editing ? t("Aufgabe (Zeitblock)") : kindLabels()[value]} data-tip={`${kindLabels()[value]} · Alt ${kindKey[value]}`} onClick={() => chooseKind(value)}><Icon name={value} /></button>)}
      </div>
      <input ref={inputRef} className={`cal-composer-text${shaking ? ' is-shaking' : ''}`} onAnimationEnd={() => setShaking(false)} value={text} placeholder={selectedKind === 'calendar' ? t("Neuer Kalendereintrag …") : kind === 'event' ? t("Neues Ereignis …") : kind === 'task' ? t("Neue Aufgabe …") : t("Notiz …")} aria-label={t("Text")} disabled={busy}
        onChange={event => setText(event.target.value)} />
    </div>
    {entry && <button type="button" className="cal-composer-copy" onClick={() => copyCalendarEntry({...entry,text,description,priority,tag:tagId,reminder,reminderBefore,icon,showInJournal,kind,repeat:rule ? {...entry.repeat!,rule} : null})}><Icon name="copy" />{t("Kopieren")}<kbd>{t("Strg")} C</kbd></button>}
    {longSpan && <div className="cal-multi-form" role="group" aria-label={t('Zeitraum')}>
      <div className="cal-multi-row"><span className="cal-multi-label">{t('Beginn')}</span>{onSpanChange ? <DateField className="cal-multi-input is-start" label={t('Beginn')} value={date} onChange={start => { const end=longEndDate < start ? start : longEndDate; setLongEndDate(end); onSpanChange({start,end}); }} /> : <span className="cal-composer-day">{formatShortDate(date)}</span>}<TimeField className="cal-multi-input" label={t('Beginn')} value={longStartTime} onChange={setLongStartTime} /></div>
      <div className="cal-multi-row"><span className="cal-multi-label">{t('Ende')}</span><DateField className="cal-multi-input is-end" label={t('Ende')} min={date} value={longEndDate} onChange={end => { setLongEndDate(end); onSpanChange?.({start:date,end}); }} /><TimeField className="cal-multi-input" label={t('Ende')} value={longEndTime} onChange={setLongEndTime} /></div>
    </div>}
    {decodeMailContent(description) ? <MailContent mail={decodeMailContent(description)!}/> : <MarkdownField className="cal-composer-description" label={t("Beschreibung")} placeholder={t("Beschreibung hinzufügen …")} value={description} onChange={setDescription} disabled={busy} />}
    <div className="cal-composer-foot">
      <div className={`cal-composer-when${draft ? '' : ' is-untimed'}`}>
        <span className="cal-composer-day">{formatShortDate(date)}</span>
        {draft ? <>{timeChip('start')}<span className="cal-composer-dash">–</span>{timeChip('end')}<span className="cal-composer-length" key={length}>{formatDuration(length)}</span></>
          : longSpan ? <span className="cal-composer-untimed">– {formatShortDate(longEndDate)}</span> : <span className="cal-composer-untimed">{entry?.time ? formatSpan(entry.time, entry.end) : t("ohne Uhrzeit")}</span>}
      </div>
      <button ref={tagButton} type="button" className={`cal-satellite cal-composer-tag${tag ? ' has-tag' : ''}`} style={satellite(tag ? { '--tag': tag.color } as CSSProperties : undefined)} aria-pressed={Boolean(tag)} aria-haspopup="dialog" aria-expanded={tagging}
        aria-label={tag ? t("Tag: {0}", tag.name) : t("Tag zuweisen")} data-tip={tag ? t("{0} · Alt G", tag.name) : t("Tag · Alt G")} onClick={() => setTagging(value => !value)}>{tag?.icon ? <EntryIcon name={tag.icon} className="tag-icon" /> : tag ? <span className="tag-dot" /> : <Icon name="tag" />}</button>
      {/* The entry's icon (Alt I), in the tag's colour; the calendar shows it at the entry's lower right. */}
      <button ref={iconButton} type="button" className={`cal-satellite cal-composer-icon${icon ? ' has-icon' : ''}`} style={satellite(tag ? { '--tag': tag.color } as CSSProperties : undefined)} aria-pressed={Boolean(icon)}
        aria-haspopup="dialog" aria-expanded={choosingIcon} aria-label={icon ? t('Icon: {0}', icon) : t('Icon wählen')} data-tip={icon ? t('{0} · Alt I', icon) : t('Icon · Alt I')} onClick={() => setChoosingIcon(value => !value)}>
        {icon ? <EntryIcon name={icon} /> : <EntryIcon name="face-slightly-smiling-plus" />}</button>
      <button type="button" className="cal-satellite cal-composer-priority" style={satellite()} aria-pressed={priority} aria-label={t("Hohe Priorität")} data-tip={t("Priorität · Alt P")} onClick={() => setPriority(value => !value)}><Icon name={priorityIcon(kind)} /></button>
      {kind !== 'note' && <button type="button" className="cal-satellite cal-composer-repeat" style={satellite()} aria-pressed={Boolean(rule)} aria-expanded={repeatView !== null}
        aria-label={shownRule ? t("Wiederholen: {0}", describe(shownRule)) : t("Wiederholen")} data-tip={shownRule ? `${describe(shownRule)} · Alt W` : t("Wiederholen · Alt W")} onClick={toggleRepeat}><Icon name="repeat" /></button>}
      {kind !== 'note' && <button ref={reminderButton} type="button" className="cal-satellite cal-composer-reminder" style={satellite()} aria-pressed={reminder} aria-haspopup="dialog" aria-expanded={choosingReminder}
        aria-label={reminder ? t('Erinnerung: {0}', reminderLeadLabel(reminderBefore)) : t("Erinnern")} data-tip={reminder ? t('Erinnerung {0}', reminderLeadLabel(reminderBefore)) : t("Erinnern")} onClick={() => setChoosingReminder(value => !value)}><Icon name="bell" /></button>}
      {editing && <button type="button" className="cal-satellite cal-composer-remove" style={satellite()} aria-label={t("{0} löschen", label)} data-tip={t("Löschen · Alt Entf")} disabled={busy} onClick={() => void remove()}><Icon name="trash" /></button>}
      <button type="button" className="cal-satellite cal-composer-create" style={satellite()} aria-label={editing ? t("Speichern") : t("{0} anlegen", label)} data-tip={editing ? t("Speichern · Enter") : t("Anlegen · Enter")} disabled={busy} onClick={() => void submit()}><Icon name="check" /></button>
    </div>
    {/* The other looks name their buttons in words (the round satellites stay for the options). */}
    {look !== 'classic-a' && <div className="chrome-actions">
      <button type="button" className="chrome-cancel" onClick={() => onCancel(false)}>{t('Abbrechen')}</button>
      {editing && <button type="button" className="chrome-remove" disabled={busy} onClick={() => void remove()}>{t('Löschen')}</button>}
      <button type="button" className="chrome-submit" disabled={busy} onClick={() => void submit()}>{editing ? t('Speichern') : t('Anlegen')}</button>
    </div>}
    <PopupKeys look={look} keys={[['Enter', editing ? t('speichern') : t('anlegen')], ['Esc', t('abbrechen')], ['Alt G', t('tag')], ['Alt W', t('wiederholen')]]}
      status={`${formatShortDate(date)}${draft ? ` · ${timeOfMinutes(draft.start)} – ${formatEnd(timeOfMinutes(draft.end))}` : ''}${tag ? ` · ${tag.name}` : ''}`} />
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
    {choosingIcon && <IconPicker anchor={iconButton.current} value={icon} color={tag?.color} onPick={setIcon} onClose={byKey => { setChoosingIcon(false); if (byKey) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }} />}
    {choosingReminder && <ReminderChoice anchor={reminderButton.current} value={{ reminder, before: reminderBefore }} timed={Boolean(draft || entry?.time)}
      onChange={next => { setReminder(next.reminder); setReminderBefore(next.before); }} onClose={byKey => { setChoosingReminder(false); if (byKey) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }} />}
    {tagging && <TagPicker anchor={tagButton.current} value={tagId} onPick={setTagId} onClose={byKey => { setTagging(false); if (byKey) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }} />}
    {applying && <ScopeChoice className="in-composer" action="edit" options={applying.options} onCancel={() => { setApplying(null); inputRef.current?.focus(); }}
      onChoose={option => { const { change } = applying; setApplying(null); setBusy(true); void onSave?.(change, option).catch(reason => { setError(String(reason)); setBusy(false); }); }} />}
    {removing && <ScopeChoice className="in-composer" action="remove" options={removing} onChoose={option => void remove(option)} onCancel={() => { setRemoving(null); inputRef.current?.focus(); }} />}
    {error && <div className="cal-composer-error" role="alert">{error}</div>}
  </div>, document.body);
}
