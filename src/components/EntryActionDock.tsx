import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, FocusEvent, ReactNode } from 'react';
import type { Entry, EntryKind } from '../journal';
import { Icon, IconName, priorityIcon } from './Icon';
import { PlanCalendar } from './PlanCalendar';
import type { PlannerView } from './PlanCalendar';
import type { SwipeActions } from './useSwipe';
import { formatShortDate } from '../dates';
import { Schedule, canBeNote, canPlan, keepDuration, planChange, tomorrowChange } from '../planning';

export type TaskStatus = 'open' | 'done' | 'cancelled';
export type EntryPreview = TaskStatus | EntryKind | 'remove' | 'up' | 'down' | 'priority' | 'tomorrow' | 'unplan';
export type PlanUpdate = Partial<Pick<Entry, 'time' | 'end' | 'reminder' | 'plan'>>;
/** How the actions appear: satellites around the symbol, words in the text flow, or gestures (setting, see SettingsDialog). */
export type ActionLayout = 'orbit' | 'inline' | 'swipe';
/** One action as the inline layout lists it. */
interface ActionItem {
  id: string; label: string; icon: IconName; preview?: EntryPreview; disabled?: boolean;
  /** The current state (e.g. the task's status) is shown but not offered as an action. */
  current?: boolean;
  run: () => void;
}

// Clockwise from the bottom-left, so keyboard order follows the orbit: abgebrochen (lower left), offen (left), erledigt (upper left).
const statusActions: { status: TaskStatus; icon: IconName; label: string; tip: string; angle: number; bar: number }[] = [
  { status: 'cancelled', icon: 'cancel', label: 'Aufgabe abbrechen', tip: 'Abgebrochen · Alt X', angle: 135, bar: 2 },
  { status: 'open', icon: 'task', label: 'Wieder öffnen', tip: 'Offen', angle: 180, bar: 0 },
  { status: 'done', icon: 'check', label: 'Als erledigt markieren', tip: 'Erledigt · Alt D', angle: 225, bar: 1 },
];
const orbitRadius = 44;
/** Position on the orbit around the entry symbol; 0° is right, 90° down (screen coordinates). */
const onOrbit = (angle: number): CSSProperties => ({
  '--x': `${Math.round(Math.cos(angle * Math.PI / 180) * orbitRadius)}px`,
  '--y': `${Math.round(Math.sin(angle * Math.PI / 180) * orbitRadius)}px`,
} as CSSProperties);
const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
const kindActions: { kind: EntryKind; label: string; short: string; hint: string }[] = [
  { kind: 'event', label: 'Als Ereignis', short: 'ereignis', hint: 'Alt ⇧ E' },
  { kind: 'task', label: 'Als Aufgabe', short: 'aufgabe', hint: 'Alt ⇧ A' },
  { kind: 'note', label: 'Als Notiz', short: 'notiz', hint: 'Alt ⇧ N' },
];

// The layouts share everything but their markup (styles are scoped by .actions-orbit / .actions-inline / .actions-swipe on the app):
// Inline: no surface at all; the row opens a line of word-like actions in the document flow, in the writing font.
// Swipe: gestures on the symbol (see useSwipe); opened explicitly, it only shows a small legend of the gestures, which also works as buttons.
// The orbit: the entry's actions as satellites, each where it belongs:
// - an orbit around the symbol: ↑ above and ↓ below (moving the entry that way), the task states on the left,
//   priority (upper right) and removing (lower right), so nothing lands on the text;
// - planning as a separate cluster at the end of the row, where times and target dates are shown; the calendar opens from there;
// - the kind (event, task, note) as a second cluster next to it: the orbit has no free place left for tasks, and the
//   kind belongs to the entry as a whole rather than to one direction;
// - asking how far removing a linked entry reaches (ScopeChoice) grows out of the trash satellite itself.
// Icon-only: hovering or keyboard-focusing an action previews its effect on the entry itself.
export function EntryActionDock({ layout, swipeActions, removeChoice, onClose, entry, day, label, isOpen, planning, plannerView, traceSaved, canMoveUp, canMoveDown, onStatusChange, onKindChange, onPriorityChange, onMove, onRemove, onPreview, onPlanDatePreview, onPlanningChange, onPlan, onNavigate }: {
  layout: ActionLayout; swipeActions: SwipeActions<EntryPreview>; removeChoice?: ReactNode; onClose: () => void; entry: Entry; day: string; label: string; isOpen: boolean; planning: boolean; plannerView: PlannerView; traceSaved: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onStatusChange: (status: TaskStatus) => void; onKindChange: (kind: EntryKind) => void; onPriorityChange: () => void; onMove: (offset: -1 | 1) => void; onRemove: () => void; onPreview: (preview: EntryPreview | null) => void;
  onPlanDatePreview: (date: string | null, count?: number) => void; onPlanningChange: (planning: boolean, view?: PlannerView) => void; onPlan: (change: PlanUpdate) => void; onNavigate: (date: string) => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const wasPlanning = useRef(false);
  const trace = entry.plan;
  const status: TaskStatus = entry.done ? 'done' : entry.cancelled ? 'cancelled' : 'open';
  let order = 0;
  const stagger = (style: CSSProperties = {}): CSSProperties => ({ ...style, '--i': order++ } as CSSProperties);
  const previewing = (preview: EntryPreview) => ({
    // Pointer *movement* starts a preview, so a toolbar opening under a resting cursor does not fake one.
    onPointerMove: () => onPreview(preview),
    onPointerLeave: () => onPreview(null),
    onFocus: (event: FocusEvent<HTMLButtonElement>) => { if (event.currentTarget.matches(':focus-visible')) onPreview(preview); },
    onBlur: () => onPreview(null),
  });

  // A linked entry asks on removing whether the others go too (ScopeChoice).
  const removeTip = trace ? `Entfernen · auf Wunsch auch am ${trace.targets.map(target => formatShortDate(target.date)).join(', ')}` : entry.origin ? `Entfernen · auf Wunsch auch die Spur am ${formatShortDate(entry.origin)}` : 'Entfernen · Alt Entf';
  const satellite = layout === 'orbit' ? 'dock-satellite ' : '';
  const place = (angle: number) => stagger(layout === 'orbit' ? onOrbit(angle) : {});
  const up = () => <button type="button" className={`${satellite}dock-up`} style={place(270)} aria-label="Nach oben" data-tip="Nach oben · Alt ↑" disabled={!canMoveUp} {...previewing('up')} onClick={() => onMove(-1)}><Icon name="up" /></button>;
  const down = () => <button type="button" className={`${satellite}dock-down`} style={place(90)} aria-label="Nach unten" data-tip="Nach unten · Alt ↓" disabled={!canMoveDown} {...previewing('down')} onClick={() => onMove(1)}><Icon name="down" /></button>;
  const priority = () => <button type="button" className={`${satellite}dock-priority`} style={place(315)} aria-label={entry.priority ? 'Priorität entfernen' : 'Als Priorität markieren'} data-tip={entry.priority ? 'Priorität entfernen · Alt P' : 'Hohe Priorität · Alt P'} aria-pressed={entry.priority}
    {...previewing('priority')} onClick={onPriorityChange}><Icon name={priorityIcon(entry.kind)} /></button>;
  const remove = () => <button type="button" className={`${satellite}dock-remove`} style={place(45)} aria-label="Eintrag entfernen" data-tip={removeTip} {...previewing('remove')} onClick={onRemove}><Icon name="trash" /></button>;
  const unplan = () => <button type="button" className={`${satellite}dock-unplan`} style={place(135)} aria-label="Planung zurücknehmen" data-tip="Zurücknehmen" {...previewing('unplan')} onClick={() => onPlan({ plan: null })}><Icon name="undo" /></button>;
  const jump = () => trace && <button type="button" className={`${satellite}dock-jump`} style={place(180)} aria-label={`Zum ${formatShortDate(trace.targets[0].date)} springen`} data-tip={formatShortDate(trace.targets[0].date)} data-primary-action="true" onClick={() => onNavigate(trace.targets[0].date)}><Icon name="jump" /></button>;
  const states = (ordered: typeof statusActions) => <div className="status-track" data-status={status} role="group" aria-label="Status der Aufgabe">
    {ordered.map(action => <button key={action.status} type="button" className={satellite.trim() || undefined} style={place(action.angle)} aria-label={action.label} data-tip={action.tip} aria-pressed={status === action.status}
      data-primary-action={action.status === (status === 'open' ? 'done' : 'open')} {...previewing(action.status)} onClick={() => onStatusChange(action.status)}>
      <Icon name={action.icon} />
    </button>)}
  </div>;
  const planningGroup = () => <div className="dock-planning" role="group" aria-label="Planen">
    {entry.kind === 'task' && <button type="button" className="dock-plan-tomorrow" style={stagger()} aria-label="Auf morgen verschieben" data-tip="Morgen · Alt M" {...previewing('tomorrow')} onClick={() => onPlan(tomorrowChange(entry, day))}><Icon name="plan-tomorrow" /></button>}
    <button type="button" className="dock-plan-date" style={stagger()} aria-label="Datum und Uhrzeit planen" aria-haspopup="dialog" data-tip="Planen · Alt T" onClick={() => onPlanningChange(true)}><Icon name="calendar" /></button>
    <button type="button" className="dock-plan-days" style={stagger()} aria-label="Mehrere Tage" aria-haspopup="dialog" data-tip="Mehrere Tage · Alt ⇧ T" onClick={() => onPlanningChange(true, 'days')}><Icon name="plan-days" /></button>
  </div>;
  const kindGroup = () => <div className="dock-kind" role="group" aria-label="Art">
    {kindActions.map(action => <button key={action.kind} type="button" className={`dock-kind-${action.kind}`} style={stagger()} aria-label={action.label} data-tip={`${action.label.replace('Als ', '')} · ${action.hint}`}
      aria-pressed={entry.kind === action.kind} disabled={action.kind === 'note' && entry.kind !== 'note' && !canBeNote(entry)}
      {...(entry.kind === action.kind ? {} : previewing(action.kind))} onClick={() => onKindChange(action.kind)}><Icon name={action.kind} /></button>)}
  </div>;
  const isTask = entry.kind === 'task' && !trace;
  // Inline groups: the actions as short, lower-case words as they read in a sentence.
  const groupOf: Record<string, number> = { jump: 0, unplan: 0, open: 1, done: 1, cancelled: 1, priority: 2, 'kind-event': 2.5, 'kind-task': 2.5, 'kind-note': 2.5, tomorrow: 3, plan: 3, days: 3, up: 4, down: 4, remove: 5 };
  const shortWords: Record<string, string> = { jump: 'zum tag', unplan: 'zurücknehmen', open: 'offen', done: 'erledigt', cancelled: 'abbrechen', priority: 'priorität', 'kind-event': 'als ereignis', 'kind-task': 'als aufgabe', 'kind-note': 'als notiz', tomorrow: 'morgen', plan: 'planen', days: 'mehrere tage', up: '', down: '', remove: 'löschen' };
  const inlineGroups = () => {
    const items = actionItems().map(item => ({ ...item, short: shortWords[item.id] }));
    const order = ['open', 'done', 'cancelled'];
    items.sort((a, b) => groupOf[a.id] - groupOf[b.id] || order.indexOf(a.id) - order.indexOf(b.id));
    const groups: (typeof items)[] = [];
    for (const item of items) { const last = groups.at(-1); if (last && groupOf[last[0].id] === groupOf[item.id]) last.push(item); else groups.push([item]); }
    return groups;
  };
  const actionItems = (): ActionItem[] => [
    ...trace ? [
      { id: 'jump', label: `Zum ${formatShortDate(trace.targets[0].date)} springen`, icon: 'jump' as const, run: () => onNavigate(trace.targets[0].date) },
      ...!traceSaved ? [{ id: 'unplan', label: 'Planung zurücknehmen', icon: 'undo' as const, preview: 'unplan' as const, run: () => onPlan({ plan: null }) }] : [],
    ] : [],
    ...isTask ? [
      { id: 'done', label: 'Erledigt', icon: 'check' as const, preview: 'done' as const, current: status === 'done', run: () => onStatusChange('done') },
      { id: 'cancelled', label: 'Abbrechen', icon: 'cancel' as const, preview: 'cancelled' as const, current: status === 'cancelled', run: () => onStatusChange('cancelled') },
      { id: 'open', label: 'Wieder öffnen', icon: 'task' as const, preview: 'open' as const, current: status === 'open', run: () => onStatusChange('open') },
    ] : [],
    ...!trace ? [{ id: 'priority', label: entry.priority ? 'Priorität entfernen' : 'Hohe Priorität', icon: priorityIcon(entry.kind), preview: 'priority' as const, run: onPriorityChange }] : [],
    ...kindActions.filter(action => action.kind !== entry.kind && (action.kind !== 'note' || canBeNote(entry))).map(action => ({ id: `kind-${action.kind}`, label: action.label, icon: action.kind, preview: action.kind, run: () => onKindChange(action.kind) })),
    ...canPlan(entry) ? [
      ...entry.kind === 'task' ? [{ id: 'tomorrow', label: 'Auf morgen', icon: 'plan-tomorrow' as const, preview: 'tomorrow' as const, run: () => onPlan(tomorrowChange(entry, day)) }] : [],
      { id: 'plan', label: 'Planen …', icon: 'calendar' as const, run: () => onPlanningChange(true) },
      { id: 'days', label: 'Mehrere Tage', icon: 'plan-days' as const, run: () => onPlanningChange(true, 'days') },
    ] : [],
    { id: 'up', label: 'Nach oben', icon: 'up' as const, preview: 'up' as const, disabled: !canMoveUp, run: () => onMove(-1) },
    { id: 'down', label: 'Nach unten', icon: 'down' as const, preview: 'down' as const, disabled: !canMoveDown, run: () => onMove(1) },
    { id: 'remove', label: trace || entry.origin ? removeTip.replace('Entfernen', 'Löschen').replace(' · Alt Entf', '') : 'Löschen', icon: 'trash' as const, preview: 'remove' as const, run: onRemove },
  ];

  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!isOpen || !dock) return;
    const primary = dock.querySelector<HTMLButtonElement>('[data-primary-action="true"]');
    (primary ?? dock).focus({ preventScroll: true });
    dock.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [isOpen]);
  useLayoutEffect(() => {
    if (wasPlanning.current && !planning && isOpen) dockRef.current?.querySelector<HTMLButtonElement>('.dock-plan-date')?.focus({ preventScroll: true });
    wasPlanning.current = planning;
  }, [planning]);

  if (planning) return <div ref={dockRef} className={`entry-dock-shell${isOpen ? ' is-open' : ''}`} inert={!isOpen} aria-hidden={!isOpen}>
    <PlanCalendar day={day} initialView={plannerView} initial={{ date: day, time: entry.time ?? null, reminder: entry.reminder ?? false }} onPreview={onPlanDatePreview}
      onCancel={() => onPlanningChange(false)} onConfirm={(dates: string[], schedule: Schedule) => onPlan(planChange(day, dates, { ...schedule, end: keepDuration(entry, schedule.time) }))} />
  </div>;

  return <div ref={dockRef} className={`entry-dock-shell${isOpen ? ' is-open' : ''}`} inert={!isOpen} aria-hidden={!isOpen} role="toolbar" aria-label={`Aktionen für ${label}`} tabIndex={-1} onKeyDown={event => {
    if (event.altKey || !navigationKeys.includes(event.key) || (event.target as HTMLElement).tagName === 'INPUT') return;
    event.preventDefault();
    const buttons = Array.from(dockRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1);
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }}>
    {layout === 'swipe' ? <div className="entry-dock swipe-legend">
      {(['right', 'down', 'up', 'left'] as const).flatMap(towards => swipeActions[towards].map((action, stage) => <button key={action.id} type="button" className="legend-action" style={stagger({ '--tone': action.color } as CSSProperties)} aria-label={action.label}
        data-primary-action={towards === 'right' && stage === 0 ? 'true' : undefined} {...(action.preview ? previewing(action.preview) : {})} onClick={() => { action.run(); if (action.id !== 'plan' && action.id !== 'days') onClose(); }}>
        <span className="legend-arrow">{{ left: '←', right: '→'.repeat(stage + 1), up: '↑', down: '↓'.repeat(stage + 1) }[towards]}</span><Icon name={action.icon} /><span>{action.label}</span>
      </button>))}
    </div> : layout === 'inline' ? <div className="entry-dock">
      {inlineGroups().map(group => <span className="dock-group" key={group[0].id}>
        {group.map(item => <button key={item.id} type="button" className={`dock-word dock-${item.id}`} style={stagger()} disabled={item.disabled} aria-pressed={item.current ?? undefined}
          aria-label={item.label} data-primary-action={(isTask && item.id === (status === 'open' ? 'done' : 'open')) || (trace && item.id === 'jump') ? 'true' : undefined}
          {...(item.preview && !item.current ? previewing(item.preview) : {})} onClick={() => { if (!item.current) item.run(); }}>
          <Icon name={item.icon} /><span>{item.short ?? item.label}</span>
        </button>)}
      </span>)}
    </div> : <div className={`entry-dock${removeChoice ? ' is-asking' : ''}`}>
      <svg className="dock-orbit" aria-hidden="true" viewBox="-50 -50 100 100"><circle r={orbitRadius} pathLength={1} /></svg>
      {up()}
      {!trace && priority()}
      {removeChoice ? <div className="dock-remove-choice" style={onOrbit(45)}>{removeChoice}</div> : remove()}
      {down()}
      {trace && <>{!traceSaved && unplan()}{jump()}</>}
      {isTask && states(statusActions)}
      <div className="dock-clusters">{kindGroup()}{canPlan(entry) && planningGroup()}</div>
    </div>}
  </div>;
}
