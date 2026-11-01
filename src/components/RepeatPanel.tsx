import { t, useLanguage } from '../i18n';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { defaultPause, describe, describeMonths, describePattern, formatOccurrence, occurrences, onChoices, onLabel, unitNames, weekdayOf, weekdayShort } from '../repeat';
import type { RepeatRule, RepeatUnit } from '../repeat';
import { parseRepeat, suggestions } from '../repeatText';
import { Icon } from './Icon';

const units: RepeatUnit[] = ['day', 'week', 'month', 'year'];
// Clicks keep the focus on the panel, so Enter still confirms and the keys keep working after using the mouse.
const keep = (event: MouseEvent) => event.preventDefault();

function Stepper({ value, min, max, label, suffix = '', onChange }: { value: number; min: number; max: number; label: string; suffix?: string; onChange: (value: number) => void }) {
  useLanguage();
  return <span className="repeat-step" role="group" aria-label={`${label}: ${value}`}>
    <button type="button" aria-label={t("{0} verringern", label)} disabled={value <= min} onMouseDown={keep} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
    <span className="repeat-value" key={value}>{value}{suffix}</span>
    <button type="button" aria-label={t("{0} erhöhen", label)} disabled={value >= max} onMouseDown={keep} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
  </span>;
}

// How an entry repeats, over the hidden calendar (like the clock, so the planner keeps its size). The unit buttons are
// the quick choices – Tag, Woche, Monat, Jahr each repeat right away from the chosen date (Jahr: a birthday) – and the
// rows below refine them: every n, which weekdays, which day of the month (same date, 2nd Friday, last Friday, month's
// end, Easter-based holidays), pauses (3 weeks on, 1 off) and an end. The head says it in words, the foot lists what comes next.
// The head is also a text field: the rule in words, and writing there ("alle 3 Wochen am Montag, Mittwoch", "every other
// week on tue", "jährlich am 12. März", "Karfreitag", "10 mal", see repeatText.ts) sets everything below at once; the
// foot then says what was understood. Enter keeps it, Esc goes back to what was there.
// Keyboard: ←/→ unit, ↑/↓ every n, 1–7 weekdays, P pause, Entf off, / write, Enter confirms, Esc back.
export function RepeatPanel({ rule, today, onChange, onBack, onOff, onPickEnd }: {
  rule: RepeatRule; today: string; onChange: (rule: RepeatRule) => void; onBack: () => void; onOff: () => void; onPickEnd: () => void;
}) {
  useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);
  // While writing: the text, the rule before it (for Esc), and the words not understood.
  const [draft, setDraft] = useState<{ text: string; before: RepeatRule; unknown: string[]; understood: boolean } | null>(null);
  // The rest of the word being typed, shown grey after the cursor; Tab (or → at the end) takes it.
  // Only with the cursor at the end of a text that fits the field (otherwise the grey rest would not line up).
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  // Starting to write selects the whole sentence at once (right after it replaced the short form), so typing replaces it.
  const selectAll = useRef(false);
  useLayoutEffect(() => { if (selectAll.current && draft) { selectAll.current = false; inputRef.current?.select(); setCaretAtEnd(false); } });
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => { const field = inputRef.current; if (field) setFits(field.scrollWidth <= field.clientWidth + 1); }, [draft?.text]);
  // Suggestions for the word being typed, like an editor's completions; Esc closes them until the text changes.
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  const listFor = (text: string) => closed ? [] : suggestions(text);
  const items = draft && caretAtEnd ? listFor(draft.text) : [];
  const typed = (text: string) => /([a-zäöüß]+)$/i.exec(text)?.[1] ?? '';
  const top = items[Math.min(pick, items.length - 1)];
  const ghost = draft && top?.prefix && fits ? top.word.slice(typed(draft.text).length) : '';
  function accept(text: string, word: string) {
    setCaretAtEnd(true); setPick(0);
    write(`${text.slice(0, text.length - typed(text).length)}${word} `);
  }
  const months = rule.unit !== 'year' && rule.months?.length ? rule.months : null;
  const monthsChip = months && <button type="button" className="repeat-chip is-months" aria-label={t("Nur {0}, Einschränkung entfernen", describeMonths(months))} title={t("Nur in diesen Monaten · Klick entfernt")}
    onMouseDown={keep} onClick={() => onChange({ ...rule, months: null })}>{t("nur ")}{describeMonths(months)} <Icon name="done" /></button>;
  function write(text: string) {
    const before = draft?.before ?? rule;
    const parsed = text.trim() ? parseRepeat(text, before) : null;
    setDraft({ text, before, unknown: parsed?.unknown ?? [], understood: Boolean(parsed) });
    if (parsed) onChange(parsed.rule);
  }
  function stopWriting(keep: boolean) {
    if (!keep && draft) onChange(draft.before);
    setDraft(null);
    rootRef.current?.focus({ preventScroll: true });
  }
  const every = Math.max(1, rule.every);
  const weekdays = rule.weekdays?.length ? rule.weekdays : [weekdayOf(rule.start)];
  const pausing = rule.unit === 'day' || rule.unit === 'week', onUnit = !pausing;
  const pause = pausing ? rule.pause ?? null : null;
  const endMode = rule.end?.count ? 'count' : rule.end?.until ? 'until' : 'never';
  const upcoming = occurrences(rule, rule.start > today ? rule.start : today, '9999-12-31', 3);

  // Another unit is a quick choice of its own ("Jahr": yearly), so it starts again at every 1.
  function setUnit(unit: RepeatUnit) {
    const next: RepeatRule = { ...rule, unit, every: unit === rule.unit ? rule.every : 1 };
    if (unit === 'week' && !rule.weekdays?.length) next.weekdays = [weekdayOf(rule.start)];
    if ((unit === 'month' || unit === 'year') && !onChoices(rule.start, unit).includes(rule.on ?? 'date')) next.on = 'date';
    if (unit === 'week' && rule.pause) next.pause = { ...rule.pause, unit: 'week' };
    onChange(next);
  }
  // At least one weekday stays.
  function toggleDay(day: number) {
    const next = weekdays.includes(day) ? weekdays.filter(value => value !== day) : [...weekdays, day].sort();
    if (next.length) onChange({ ...rule, weekdays: next });
  }
  const togglePause = () => onChange({ ...rule, pause: pause ? null : defaultPause(rule.unit) });
  function setEnd(mode: typeof endMode) {
    if (mode === 'until') { onPickEnd(); return; }
    onChange({ ...rule, end: mode === 'count' ? { count: rule.end?.count ?? 10 } : null });
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target === inputRef.current) return;
    if (event.key === '/') { event.preventDefault(); event.stopPropagation(); inputRef.current?.focus(); return; }
    const index = units.indexOf(rule.unit);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setUnit(units[(index + (event.key === 'ArrowLeft' ? 3 : 1)) % 4]);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') onChange({ ...rule, every: Math.min(99, Math.max(1, every + (event.key === 'ArrowUp' ? 1 : -1))) });
    else if (/^[1-7]$/.test(event.key) && rule.unit === 'week') toggleDay(Number(event.key) - 1);
    else if (event.code === 'KeyP' && pausing) togglePause();
    else if (event.key === 'Delete' || event.key === 'Backspace') onOff();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  return <div className={`repeat${draft ? ' is-writing' : ''}`} ref={rootRef} tabIndex={-1} role="group" aria-label={t("Wiederholen: {0}", describe(rule))} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown 1 2 3 4 5 6 7 P Delete" onKeyDown={onKey}>
    <div className="clock-head repeat-head">
      <button type="button" className="clock-back" aria-label={t("Zurück zum Kalender")} data-tip={t("Zurück · Esc")} onMouseDown={keep} onClick={onBack}><Icon name="left" /></button>
      <span className="repeat-write-field">
      <Icon name="pencil" className="repeat-write-icon" />
      {ghost && <span className="repeat-ghost" aria-hidden="true"><span>{draft!.text}</span>{ghost}</span>}
      <input ref={inputRef} className={`repeat-summary repeat-write${draft && !draft.understood && draft.text.trim() ? ' is-unclear' : ''}`} aria-label={t("Wiederholung in Worten (Deutsch oder Englisch)")} aria-keyshortcuts="/" title={t("In Worten schreiben, z. B. „alle 2 Wochen am Mo, Mi“ · /")}
        value={draft?.text ?? describePattern(rule)} placeholder={t("z. B. alle 2 Wochen am Mo, Mi")} spellCheck={false}
        onFocus={() => { if (!draft) { selectAll.current = true; setDraft({ text: describe(rule), before: rule, unknown: [], understood: true }); } }}
        onChange={event => { setCaretAtEnd(event.target.selectionStart === event.target.value.length); setClosed(false); setPick(0); write(event.target.value); }}
        onSelect={event => setCaretAtEnd(event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)} onBlur={() => { if (draft) setDraft(null); }}
        onKeyDown={event => {
          // Taken from the field as it is now, not from the last render.
          const field = event.currentTarget, atEnd = field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
          const live = atEnd ? listFor(field.value) : [], chosen = live[Math.min(pick, live.length - 1)];
          const take = () => { event.preventDefault(); event.stopPropagation(); };
          if (live.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { take(); setPick(current => (current + (event.key === 'ArrowDown' ? 1 : live.length - 1)) % live.length); }
          else if (chosen && !event.shiftKey && (event.key === 'Tab' || event.key === 'Enter' || (event.key === 'ArrowRight' && chosen.prefix))) { take(); accept(field.value, chosen.word); }
          else if (event.key === 'Enter') { take(); stopWriting(true); }
          else if (event.key === 'Escape') { take(); if (live.length) setClosed(true); else stopWriting(false); }
          else event.stopPropagation();
        }} />
      </span>
      <button type="button" className="repeat-off" aria-label={t("Nicht wiederholen")} data-tip={t("Aus · Entf")} onMouseDown={keep} onClick={onOff}><Icon name="done" /></button>
    </div>
    {items.length > 0 && <div className="repeat-suggest" role="listbox" aria-label={t("Vorschläge")}>
      {items.map((item, index) => <div key={item.word} role="option" aria-selected={item === top} className={`repeat-suggest-item${item === top ? ' is-picked' : ''}`}
        onMouseDown={event => { event.preventDefault(); accept(draft!.text, item.word); }} onMouseEnter={() => setPick(index)}>
        <span className="repeat-suggest-word">{[...item.word].map((letter, at) => item.matches.includes(at) ? <b key={at}>{letter}</b> : letter)}</span>
        <span className="repeat-suggest-role">{item.description}</span>
      </div>)}
    </div>}
    <div className="repeat-units" role="group" aria-label={t("Wiederholen jeden")}>
      {units.map(unit => <button key={unit} type="button" aria-pressed={rule.unit === unit} onMouseDown={keep} onClick={() => setUnit(unit)}>{unitNames()[unit][0]}</button>)}
    </div>
    {/* Monthly and yearly read as one line: "Alle 1 Monat am 30. / letzter Fr". */}
    <div className={`repeat-row${onUnit ? ' is-on' : ''}`}>
      <span className="repeat-label">{t("Alle")}</span>
      <Stepper value={every} min={1} max={99} label={t("Abstand")} onChange={value => onChange({ ...rule, every: value })} />
      <span>{unitNames()[rule.unit][every === 1 ? 0 : 1]}</span>
      {onUnit && <span className="repeat-on" role="group" aria-label={rule.unit === 'year' ? t("Tag im Jahr") : t("Tag im Monat")}>
        <span>{t("am")}</span>
        {onChoices(rule.start, rule.unit).map((on, index) => <Fragment key={on}>
          {index > 0 && <span className="repeat-or" aria-hidden="true">/</span>}
          <button type="button" className="repeat-chip" aria-pressed={(rule.on ?? 'date') === on} onMouseDown={keep} onClick={() => onChange({ ...rule, on })}>{onLabel(rule.start, rule.unit, on)}</button>
        </Fragment>)}
      </span>}
      {onUnit && monthsChip}
    </div>
    {rule.unit === 'week' && <div className="repeat-weekdays" role="group" aria-label={t("Wochentage")}>
      {weekdayShort().map((name, day) => <button key={name} type="button" aria-pressed={weekdays.includes(day)} aria-keyshortcuts={String(day + 1)} onMouseDown={keep} onClick={() => toggleDay(day)}>{name}</button>)}
    </div>}
    {pausing && <div className="repeat-row repeat-pause">
      <button type="button" className="repeat-chip" aria-pressed={Boolean(pause)} data-tip={t("Pause · P")} onMouseDown={keep} onClick={togglePause}>Pause</button>
      {!pause && monthsChip}
      {pause && <>
        <Stepper value={pause.on} min={1} max={52} label={t("Zeiträume mit Terminen")} suffix={t(' an')} onChange={on => onChange({ ...rule, pause: { ...pause, on } })} />
        <Stepper value={pause.off} min={1} max={52} label={t("Zeiträume Pause")} suffix={t(' aus')} onChange={off => onChange({ ...rule, pause: { ...pause, off } })} />
        {rule.unit === 'day'
          ? <button type="button" className="repeat-chip" aria-label={t("Zeiträume in {0}, umschalten", pause.unit === 'week' ? t("Wochen") : t("Tagen"))} onMouseDown={keep} onClick={() => onChange({ ...rule, pause: { ...pause, unit: pause.unit === 'week' ? 'day' : 'week' } })}>{pause.unit === 'week' ? t("Wo") : t("Tg")}</button>
          : <span className="repeat-unit">{t("Wo")}</span>}
      </>}
    </div>}
    <div className="repeat-row">
      <span className="repeat-label">{t("Ende")}</span>
      <span className="repeat-segments" role="group" aria-label={t("Ende")}>
        {/* A chosen end date takes the place of "Datum" itself, so the row stays inside the panel; clicking it picks again. */}
        {([['never', t("Nie")], ['count', t("Anzahl")], ['until', endMode === 'until' ? t("bis {0}", formatOccurrence(rule.end!.until!)) : t("Datum")]] as const).map(([mode, label]) => <button key={mode} type="button" className={mode === 'until' && endMode === 'until' ? 'is-date' : undefined}
          aria-pressed={endMode === mode} aria-label={mode === 'until' && endMode === 'until' ? t("{0}, ändern", label) : undefined} onMouseDown={keep} onClick={() => setEnd(mode)}>{label}</button>)}
      </span>
      {endMode === 'count' && <Stepper value={rule.end!.count!} min={1} max={999} label={t("Anzahl")} suffix="×" onChange={count => onChange({ ...rule, end: { count } })} />}
    </div>
    {draft ? <div className={`repeat-next is-writing${draft.understood && !draft.unknown.length ? '' : ' is-unclear'}`} role="status">
      {!draft.text.trim() ? t("Wiederholung beschreiben …") : !draft.understood ? t("Nicht verstanden") : draft.unknown.length ? t("{0} · ohne „{1}“", describe(rule), draft.unknown.join(' ')) : `${describe(rule)} ✓`}
    </div> : <div className="repeat-next" aria-label={t("Nächste Termine")}>{upcoming.length ? upcoming.map(formatOccurrence).join(' · ') : t("Keine weiteren Termine")}</div>}
  </div>;
}
