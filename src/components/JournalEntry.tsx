import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Entry, EntryKind, journal } from '../journal';
import type { LinkedAction } from '../journal';
import { EntryText } from './EntryText';
import { EntryActionDock, EntryPreview, PlanUpdate, TaskStatus } from './EntryActionDock';
import type { ActionLayout } from './EntryActionDock';
import type { PlannerView } from './PlanCalendar';
import { Icon, IconName, priorityIcon, traceIcon } from './Icon';
import { formatShortDate } from '../dates';
import { canBeNote, canPlan, formatSpan, linkedScopes, tomorrowChange } from '../planning';
import type { ScopeAction, ScopeOption } from '../planning';
import { ScopeChoice } from './ScopeChoice';
import { adjacentText, focusText, titleInput } from './focus';
import { asTextField } from './entryEditor';
import { swipeStages, useSwipe } from './useSwipe';
import type { SwipeAction, SwipeActions, SwipeDirection } from './useSwipe';
import type { TextField } from './entryEditor';
import type { EntryDragHandlers } from './useEntryDrag';

export const entryLabels = { task: 'Aufgabe', event: 'Ereignis', note: 'Notiz' };
export type EntryChange = Partial<Pick<Entry, 'kind' | 'text' | 'done' | 'cancelled' | 'priority' | 'time' | 'end' | 'reminder' | 'plan'>>;
export type DragState = 'source' | 'drop-before' | 'drop-after' | null;
interface TextSelection { start: number; end: number; direction: 'forward' | 'backward' | 'none' }

// Memoized: all callbacks receive the entry ID and are stable, so typing in one row re-renders only that row.
export const JournalEntry = memo(function JournalEntry({ layout, entry, day, traceSaved, isNew, isOpen, isGroupStart, canMoveUp, canMoveDown, dragState, drag, onMoveOffset, onOpenChange, onChange, onRemove, onLinkedChange, onCreate, onNavigate, focusEntryId, focusMoveEntryId }: {
  layout: ActionLayout; entry: Entry; day: string; traceSaved: boolean; onNavigate: (date: string) => void; onCreate: (kind: Entry['kind'], afterId: string) => void; isNew: boolean; isOpen: boolean; onOpenChange: (id: string, open: boolean) => void;
  onChange: (id: string, change: EntryChange) => void; onRemove: (id: string) => void; focusEntryId: { current: string | null };
  /** The same action for linked entries elsewhere (chosen in ScopeChoice). */
  onLinkedChange: (others: ScopeOption['others'], action: LinkedAction) => void;
  isGroupStart: boolean; canMoveUp: boolean; canMoveDown: boolean; dragState: DragState; drag: EntryDragHandlers;
  onMoveOffset: (id: string, offset: -1 | 1, keepTextFocus?: boolean) => boolean; focusMoveEntryId: { current: string | null };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const restoreSelection = useRef<TextSelection | null>(null);
  const restorePriorityFocus = useRef(false);
  const lastPointerDown = useRef(0);
  const restoreSymbolFocus = useRef(false);
  // Set when the toolbar or planner was opened by a shortcut while typing, so closing it returns to the text.
  const returnToText = useRef(false);
  const label = entryLabels[entry.kind];
  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const [pop, setPop] = useState<{ key: number; status: TaskStatus | 'planned' } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [plannerView, setPlannerView] = useState<PlannerView>('date');
  const [planCount, setPlanCount] = useState(1);
  const [scopeAsk, setScopeAsk] = useState<{ action: ScopeAction; options: ScopeOption[]; apply: () => void; fromOrbit: boolean } | null>(null);
  const trace = entry.plan ?? null;
  const status: TaskStatus | undefined = entry.kind === 'task' && !trace ? entry.done ? 'done' : entry.cancelled ? 'cancelled' : 'open' : undefined;
  const previewStatus = status && (preview === 'open' || preview === 'done' || preview === 'cancelled') ? preview : undefined;
  const shownStatus = previewStatus ?? status;
  const shownPriority = preview === 'priority' ? !entry.priority : entry.priority;
  // Hovering another kind shows its symbol as a ghost.
  const previewKind = preview === 'event' || preview === 'task' || preview === 'note' ? preview : null;
  const shownKind = previewKind ?? entry.kind;
  const strike = shownStatus === 'cancelled' ? status === 'cancelled' ? 'solid' : 'ghost' : null;
  // The symbol previews planning as well: `>` for tomorrow, `<` for another date in the calendar, the plain symbol when undoing a trace.
  const plannedIcon: IconName | null = preview === 'unplan' ? null
    : preview === 'tomorrow' ? traceIcon({ kind: shownKind, plan: { via: 'tomorrow', targets: [], time: null, reminder: false } })
    : planning && planDate && planDate !== day ? traceIcon({ kind: shownKind, plan: { via: planCount > 1 ? 'days' : 'date', targets: [], time: null, reminder: false } })
    : trace ? traceIcon({ kind: shownKind, plan: trace }) : null;
  const planGhost = preview === 'tomorrow' || preview === 'unplan' || (planning && planDate !== null && planDate !== day);
  const statusLabel = trace ? `, geplant auf ${trace.targets.map(target => formatShortDate(target.date)).join(', ')}` : status === 'done' ? ', erledigt' : status === 'cancelled' ? ', abgebrochen' : status === 'open' ? ', offen' : '';

  useLayoutEffect(() => {
    if (restorePriorityFocus.current) {
      const button = rootRef.current?.querySelector<HTMLButtonElement>('.dock-priority');
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: 'nearest' });
      restorePriorityFocus.current = false;
      return;
    }
    const selection = restoreSelection.current;
    if (selection) {
      const text = rootRef.current?.querySelector<TextField>('.entry-text');
      text?.focus({ preventScroll: true });
      text?.setSelectionRange(selection.start, selection.end, selection.direction);
      text?.scrollIntoView({ block: 'nearest' });
      restoreSelection.current = null;
    } else if (restoreSymbolFocus.current) {
      triggerRef.current?.focus({ preventScroll: true });
      restoreSymbolFocus.current = false;
    } else if (focusMoveEntryId.current === entry.id) {
      gripRef.current?.focus({ preventScroll: true });
      gripRef.current?.scrollIntoView({ block: 'nearest' });
      focusMoveEntryId.current = null;
    }
  });

  useEffect(() => { if (!isOpen) { setPreview(null); setPlanning(false); setPlanDate(null); } }, [isOpen]);
  // While the actions or the calendar are open, a press anywhere outside this entry closes them, and Escape works even when
  // focus is not inside (e.g. after opening the calendar by a swipe). Handlers inside that already took Escape mark it handled.
  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (target && !rootRef.current?.contains(target) && !target.closest('.format-menu, .shortcut-backdrop')) onOpenChange(entry.id, false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeActions();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape); };
  }, [isOpen]);

  function plan(change: PlanUpdate) {
    setPreview(null);
    setPlanning(false);
    setPlanDate(null);
    onChange(entry.id, change);
    if (change.plan) setPop(current => ({ key: (current?.key ?? 0) + 1, status: 'planned' }));
    closeActions();
  }
  // Switching between pill and calendar removes the hovered button without a pointerleave, so the preview is reset here.
  function changePlanning(next: boolean, view?: PlannerView) {
    setPreview(null);
    if (next && view) setPlannerView(view);
    // Leaving the calendar (Escape) leaves the actions altogether, in every layout.
    if (!next) { closeActions(); return; }
    setPlanning(next);
    if (!next) setPlanDate(null);
  }
  function openPlanner(view: PlannerView = 'date', fromText = false) {
    returnToText.current = fromText;
    setPlannerView(view);
    onOpenChange(entry.id, true);
    changePlanning(true);
  }
  // A moved entry (its trace, a copy, one of several days) may take the others along: finishing reaches the following
  // ones, removing and cancelling also the earlier ones. The group comes from the store; with nothing to ask, the action
  // happens at once.
  const linked = Boolean(entry.plan || entry.origin);
  async function withScope(action: ScopeAction, apply: () => void) {
    if (!linked) { apply(); return; }
    const group = await journal.linked(entry.id).catch(() => []);
    const options = linkedScopes(group, entry.id, action);
    if (options.length < 2) apply(); else setScopeAsk({ action, options, apply, fromOrbit: action === 'remove' && layout === 'orbit' && isOpen });
  }
  // Removing from the open orbit extends the trash satellite into the question; everything else asks under the row.
  const fromSatellite = Boolean(scopeAsk?.fromOrbit);
  // Closing the orbit takes the question that grew out of it along.
  useEffect(() => { if (!isOpen && scopeAsk?.fromOrbit) setScopeAsk(null); }, [isOpen]);
  const scopeChoice = (variant: 'pill' | 'satellite' = 'pill') => scopeAsk && <ScopeChoice action={scopeAsk.action} options={scopeAsk.options} variant={variant} onChoose={chooseScope}
    onCancel={() => { setScopeAsk(null); requestAnimationFrame(() => (rootRef.current?.querySelector<HTMLElement>(variant === 'satellite' ? '.dock-remove' : '.entry-symbol') ?? triggerRef.current)?.focus({ preventScroll: true })); }} />;
  function chooseScope(option: ScopeOption) {
    if (!scopeAsk) return;
    setScopeAsk(null);
    scopeAsk.apply();
    if (option.others.length) onLinkedChange(option.others, scopeAsk.action);
  }
  function changeStatus(next: TaskStatus) {
    setPreview(null);
    if (next === status) return;
    const apply = () => {
      onChange(entry.id, { done: next === 'done', cancelled: next === 'cancelled' });
      setPop(current => ({ key: (current?.key ?? 0) + 1, status: next }));
    };
    if (next === 'open') apply(); else void withScope(next, apply);
  }
  // The kind can change between event, task and note (a note only without time and planning; see canBeNote). Like
  // priority it re-sorts the list. Only a task keeps a status; a trace passes the new kind on to its copies when saved.
  function changeKind(next: EntryKind, text: TextField | null = null) {
    setPreview(null);
    if (next === entry.kind || (next === 'note' && !canBeNote(entry))) return;
    if (text) restoreSelection.current = { start: text.selectionStart, end: text.selectionEnd, direction: text.selectionDirection };
    else restoreSymbolFocus.current = true;
    onChange(entry.id, { kind: next, ...next === 'task' ? {} : { done: false, cancelled: false } });
  }
  // Priority re-sorts the list, which moves this row's DOM node; focus is restored after the move.
  function togglePriority(text: TextField | null) {
    if (text) restoreSelection.current = { start: text.selectionStart, end: text.selectionEnd, direction: text.selectionDirection };
    else if (isOpen) restorePriorityFocus.current = true;
    else restoreSymbolFocus.current = true;
    setPreview(null);
    onChange(entry.id, { priority: !entry.priority });
  }

  // Entry shortcuts (see ShortcutHelp): Alt + letter acts on this entry, Ctrl+↑/↓ moves between entries, Enter/Backspace work like an outliner.
  function onShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
    const text = asTextField(event.target);
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyT' && canPlan(entry)) { openPlanner('days', Boolean(text)); return true; }
    const kindKeys: Record<string, EntryKind> = { KeyE: 'event', KeyA: 'task', KeyN: 'note' };
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code in kindKeys) { changeKind(kindKeys[event.code], text); return true; }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      switch (event.code) {
        case 'KeyD': if (!status) return false; changeStatus(status === 'done' ? 'open' : 'done'); return true;
        case 'KeyX': if (!status) return false; changeStatus(status === 'cancelled' ? 'open' : 'cancelled'); return true;
        case 'KeyP': if (trace) return false; togglePriority(text); return true;
        case 'KeyM': if (entry.kind !== 'task' || !canPlan(entry)) return false; returnToText.current = Boolean(text); plan(tomorrowChange(entry, day)); return true;
        case 'KeyT': if (trace) { onNavigate(trace.targets[0].date); return true; } if (!canPlan(entry)) return false; openPlanner('date', Boolean(text)); return true;
        case 'KeyU': if (!canPlan(entry)) return false; openPlanner('time', Boolean(text)); return true;
        case 'Enter': if (isOpen) closeActions(); else { returnToText.current = Boolean(text); onOpenChange(entry.id, true); } return true;
        case 'Delete': { if (linked) { remove(); return true; } const neighbor = adjacentText(rootRef.current, 1) ?? adjacentText(rootRef.current, -1); remove(); if (!focusText(neighbor)) titleInput()?.focus(); return true; }
      }
      return false;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const target = adjacentText(rootRef.current, event.key === 'ArrowUp' ? -1 : 1);
      if (!focusText(target) && event.key === 'ArrowUp') focusText(titleInput());
      return true;
    }
    if (!text || !plain || event.nativeEvent.isComposing) return false;
    if (event.key === 'Enter' && !event.shiftKey) { onCreate(entry.kind, entry.id); return true; }
    if (event.key === 'Backspace' && text.value === '' && !trace) {
      const neighbor = adjacentText(rootRef.current, -1) ?? adjacentText(rootRef.current, 1);
      onRemove(entry.id);
      if (!focusText(neighbor)) titleInput()?.focus();
      return true;
    }
    const collapsed = text.selectionStart === text.selectionEnd;
    if (event.key === 'ArrowUp' && collapsed && text.selectionStart === 0) return focusText(adjacentText(rootRef.current, -1)) || focusText(titleInput());
    if (event.key === 'ArrowDown' && collapsed && text.selectionEnd === text.value.length) return focusText(adjacentText(rootRef.current, 1), 'start');
    return false;
  }

  function remove() {
    // In the open orbit the question grows out of the trash satellite, so the orbit stays while asking.
    if (!(layout === 'orbit' && isOpen && linked)) onOpenChange(entry.id, false);
    // The row fades out first; the list then closes the gap (see useListMotion).
    void withScope('remove', () => {
      onOpenChange(entry.id, false);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) onRemove(entry.id); else setLeaving(true);
    });
  }

  // Layout "swipe": the symbol is a handle. Right (three stages): tomorrow, plan one day, plan several days; left: remove;
  // down: done, further down cancelled (a finished task reopens); up: priority. A tap cycles a task's state.
  const swipeActions: SwipeActions<EntryPreview> = (() => {
    // A linked entry stays in place while asking whether the others go too.
    const removeAction: SwipeAction<EntryPreview> = { id: 'remove', label: 'löschen', icon: 'trash', color: '#DF6262', preview: 'remove', leaves: !linked, run: () => linked ? remove() : onRemove(entry.id) };
    const priorityAction: SwipeAction<EntryPreview> = { id: 'priority', label: entry.priority ? 'priorität weg' : 'priorität', icon: priorityIcon(entry.kind), color: 'var(--priority)', preview: 'priority', run: () => togglePriority(null) };
    if (trace) return {
      right: [{ id: 'jump', label: 'zum tag', icon: 'jump', color: '#8FB3E8', run: () => onNavigate(trace.targets[0].date) },
        ...traceSaved ? [] : [{ id: 'unplan', label: 'zurücknehmen', icon: 'undo', color: '#BC95C9', preview: 'unplan', run: () => onChange(entry.id, { plan: null }) } as SwipeAction<EntryPreview>]],
      left: [removeAction], up: [], down: [],
    };
    const right: SwipeAction<EntryPreview>[] = canPlan(entry) ? [
      { id: 'tomorrow', label: 'morgen', icon: 'plan-tomorrow', color: '#C2DCE9', preview: 'tomorrow', run: () => plan(tomorrowChange(entry, day)) },
      { id: 'plan', label: 'planen', icon: 'calendar', color: '#569EFF', run: () => openPlanner('date') },
      { id: 'days', label: 'mehrere tage', icon: 'plan-days', color: '#C69BFF', run: () => openPlanner('days') },
    ] : [];
    const reopen: SwipeAction<EntryPreview> = { id: 'open', label: 'wieder offen', icon: 'task', color: '#E2D7B7', preview: 'open', run: () => changeStatus('open') };
    const done: SwipeAction<EntryPreview> = { id: 'done', label: 'erledigt', icon: 'check', color: '#76D982', preview: 'done', run: () => changeStatus('done') };
    const cancelled: SwipeAction<EntryPreview> = { id: 'cancelled', label: 'abbrechen', icon: 'cancel', color: '#AD4075', preview: 'cancelled', run: () => changeStatus('cancelled') };
    const down = status === 'open' ? [done, cancelled] : status === 'done' ? [reopen, cancelled] : status === 'cancelled' ? [reopen, done] : [];
    return { right, left: [removeAction], up: [priorityAction], down };
  })();
  const nextStatus: Record<TaskStatus, TaskStatus> = { open: 'done', done: 'cancelled', cancelled: 'open' };
  const swipe = useSwipe({ actions: swipeActions, onPreview: setPreview, onTap: () => { if (status) changeStatus(nextStatus[status]); } });

  function closeActions() {
    onOpenChange(entry.id, false);
    if (returnToText.current) { returnToText.current = false; rootRef.current?.querySelector<TextField>('.entry-text')?.focus({ preventScroll: true }); }
    else triggerRef.current?.focus({ preventScroll: true });
  }

  const dragClass = dragState === 'source' ? ' entry-dragging' : dragState ? ` ${dragState}` : '';
  return <div ref={rootRef} className={`entry${isNew ? ' entry-new' : ''}${isGroupStart ? ' entry-group-start' : ''}${isOpen ? ' entry-open' : ''}${leaving ? ' entry-leaving' : ''}${dragClass}`} data-entry-id={entry.id} data-entry-kind={entry.kind} data-status={status} data-priority={entry.priority ? 'high' : undefined} data-preview={preview ?? undefined} data-trace={trace ? trace.via : undefined} data-swipe={layout === 'swipe' && swipe.phase !== 'idle' ? swipe.phase : undefined}
    // Swiping the entry keeps the gesture from turning the day; Shift + wheel always turns the day.
    onWheel={event => { if (layout === 'swipe' && !isOpen && !event.shiftKey && swipe.wheel(event.deltaX, event.deltaY)) event.stopPropagation(); }}
    onAnimationEnd={event => { if (leaving && event.target === event.currentTarget && event.animationName === 'entry-out') onRemove(entry.id); }}
    onPointerDownCapture={() => { lastPointerDown.current = performance.now(); }}
    // Focus leaving to nowhere right after a click inside this row (e.g. a re-rendered calendar day) is not "clicking outside".
    onBlur={event => {
      if (restorePriorityFocus.current || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (!event.relatedTarget && performance.now() - lastPointerDown.current < 600) return;
      onOpenChange(entry.id, false);
    }}
    onFocusCapture={event => { if (asTextField(event.target)) onOpenChange(entry.id, false); }}
    onKeyDown={event => {
      if (onShortcut(event)) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        event.stopPropagation();
        const text = asTextField(event.target);
        if (text) restoreSelection.current = { start: text.selectionStart, end: text.selectionEnd, direction: text.selectionDirection };
        if (!onMoveOffset(entry.id, event.key === 'ArrowUp' ? -1 : 1, Boolean(text))) restoreSelection.current = null;
      }
      if (event.key === 'Escape') {
        drag.cancel();
        if (isOpen) { event.preventDefault(); closeActions(); }
      }
    }}>
    <button ref={gripRef} type="button" className="entry-grip" aria-label={`${label} verschieben: ${entry.text || 'ohne Text'}`} aria-describedby="entry-reorder-help" title="Zum Verschieben ziehen · Alt + ↑ / ↓" disabled={!canMoveUp && !canMoveDown}
      onPointerDown={event => { onOpenChange(entry.id, false); drag.start(event, entry); }} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel}><Icon name="grip" /></button>
    {layout === 'swipe' && swipe.phase !== 'idle' && (() => {
      // The symbol stays where it rests and becomes the action's icon (sideways with its word above it); a bar in the action's
      // colour grows from it in the drag direction. Sideways it spans the whole entry, behind the text; up and down it covers the neighbours.
      const stages = swipe.axis === 'x' ? swipeStages.x : swipeStages.y;
      const reach = Math.min(1, Math.abs(swipe.distance) / stages[stages.length - 1]);
      const shown = swipe.target?.action ?? swipeActions[swipe.direction][0];
      const vertical = swipe.direction === 'up' || swipe.direction === 'down';
      const { x, y } = swipe.offset;
      const trail: CSSProperties = vertical ? { left: 0, top: 3 + Math.min(0, y), width: 30, height: 30 + Math.abs(y) } : { left: Math.min(0, x), top: 0, bottom: 0, width: 30 + Math.abs(x) };
      const style = { '--tone': shown?.color ?? 'var(--muted)', '--reach': reach, '--label': Math.min(1, Math.max(0, (Math.abs(swipe.distance) - 40) / 30)) } as CSSProperties;
      return <>
        <div className={`swipe-trail is-${swipe.direction}${vertical ? ' is-vertical' : ''}${swipe.target ? ' is-armed' : ''}`} aria-hidden="true" style={{ ...style, ...trail }} />
        {shown && <div className={`swipe-handle is-${swipe.direction}${swipe.target ? ' is-armed' : ''}`} aria-hidden="true" style={style}>
          <span className="swipe-icon" key={shown.id}><Icon name={shown.icon} /></span>
          {!vertical && <span className="swipe-label" key={`label-${shown.id}`}>{shown.label}</span>}
        </div>}
      </>;
    })()}
    <div className="entry-main">
      <div className="entry-actions">
        <button ref={triggerRef} type="button" className="entry-symbol" aria-label={`Aktionen für ${label}${statusLabel}${entry.priority ? ', hohe Priorität' : ''}: ${entry.text || 'ohne Text'}`} aria-expanded={isOpen} aria-keyshortcuts={layout === 'swipe' ? 'ArrowRight Shift+ArrowRight Control+Shift+ArrowRight ArrowDown Shift+ArrowDown ArrowUp Shift+ArrowLeft' : undefined}
          {...(layout === 'swipe' ? swipe.handle : {})}
          onClick={event => { if (layout !== 'swipe') onOpenChange(entry.id, !isOpen); else if (event.detail === 0 && status) changeStatus(nextStatus[status]); }}
          onKeyDown={event => {
            // Swipe layout on the focused symbol: → / ⇧→ / Ctrl+⇧→ the three stages right, ↓ / ⇧↓ done / cancelled, ↑ priority, ⇧← remove.
            if (layout === 'swipe' && !event.altKey && (!event.ctrlKey || (event.key === 'ArrowRight' && event.shiftKey))) {
              const towards = ({ ArrowRight: 'right', ArrowDown: 'down', ArrowUp: event.shiftKey ? null : 'up', ArrowLeft: event.shiftKey ? 'left' : null } as Record<string, SwipeDirection | null>)[event.key];
              if (towards) { event.preventDefault(); swipe.trigger(towards, towards === 'right' ? (event.shiftKey ? event.ctrlKey ? 2 : 1 : 0) : towards === 'down' && event.shiftKey ? 1 : 0); return; }
            }
            if (event.key === 'ArrowDown' && !event.altKey && !isOpen) { event.preventDefault(); onOpenChange(entry.id, true); }
          }}>
          <Icon key={`icon-${pop?.key ?? 0}`} name={plannedIcon ?? (shownStatus === 'done' && !previewKind ? 'done' : shownPriority ? priorityIcon(shownKind) : shownKind)} className={planGhost || previewKind || preview === 'priority' || (previewStatus && previewStatus !== status) ? 'icon-ghost' : pop ? 'icon-pop' : ''} />
          {pop?.status === 'done' && <span key={`burst-${pop.key}`} className="symbol-burst" aria-hidden="true" />}
        </button>
      </div>
      <EntryText entry={entry} label={entry.priority ? `${label} mit hoher Priorität` : label} strike={strike} focusEntryId={focusEntryId} onChange={text => onChange(entry.id, { text })} />
      {!trace && (entry.time || entry.reminder) && <button type="button" className="entry-when" aria-label={`Termin${entry.time ? ` ${formatSpan(entry.time, entry.end)}` : ''}${entry.reminder ? ', mit Erinnerung' : ''} ändern`} onClick={() => openPlanner()}>
        {entry.time && <span>{formatSpan(entry.time, entry.end)}</span>}{entry.reminder && <Icon name="bell" />}
      </button>}
      {trace && <button type="button" className="entry-trace-target" aria-label={`Zum ${formatShortDate(trace.targets[0].date)} springen`} onClick={() => onNavigate(trace.targets[0].date)}>
        <span>{trace.targets.length > 1 ? `${trace.targets.length} Tage` : formatShortDate(trace.targets[0].date)}</span>{trace.time && <span className="entry-trace-time">{formatSpan(trace.time, trace.end)}</span>}{trace.reminder && <Icon name="bell" />}
      </button>}
    </div>
    {scopeAsk && !fromSatellite && scopeChoice()}
    <EntryActionDock layout={layout} swipeActions={swipeActions} removeChoice={fromSatellite ? scopeChoice('satellite') : undefined} onClose={closeActions} entry={entry} day={day} label={label} isOpen={isOpen} planning={planning} plannerView={plannerView} traceSaved={traceSaved} onPlanningChange={changePlanning} onPlanDatePreview={(date, count = 1) => { setPlanDate(date); setPlanCount(count); }} onPlan={plan} onNavigate={onNavigate} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onPreview={next => { if (!restorePriorityFocus.current) setPreview(next); }} onRemove={remove} onPriorityChange={() => togglePriority(null)} onMove={offset => { setPreview(null); onMoveOffset(entry.id, offset); }} onStatusChange={changeStatus} onKindChange={kind => changeKind(kind)} />
  </div>;
});
