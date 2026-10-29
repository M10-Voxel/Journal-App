import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, FocusEvent } from 'react';
import type { Entry } from '../journal';
import { Icon, IconName, priorityIcon, traceIcon } from './Icon';
import { PlanCalendar } from './PlanCalendar';
import type { PlannerView } from './PlanCalendar';
import { ActionPalette } from './ActionPalette';
import type { PaletteItem } from './ActionPalette';
import type { SwipeActions } from './useSwipe';
import { formatShortDate } from '../dates';
import { Schedule, canPlan, planChange, tomorrowChange } from '../planning';

export type TaskStatus = 'open' | 'done' | 'cancelled';
export type EntryPreview = TaskStatus | 'remove' | 'up' | 'down' | 'priority' | 'tomorrow' | 'unplan';
export type PlanUpdate = Partial<Pick<Entry, 'time' | 'reminder' | 'plan'>>;
/** How the actions appear: one compact bar under the row, or satellites around the symbol (setting, see SettingsDialog). */
export type ActionLayout = 'bar' | 'orbit' | 'palette' | 'inline' | 'swipe';

// Clockwise from the bottom-left, so keyboard order follows the orbit: abgebrochen (lower left), offen (left), erledigt (upper left).
const statusActions: { status: TaskStatus; icon: IconName; label: string; tip: string; angle: number; bar: number }[] = [
  { status: 'cancelled', icon: 'cancel', label: 'Aufgabe abbrechen', tip: 'Abgebrochen · Alt X', angle: 135, bar: 2 },
  { status: 'open', icon: 'task', label: 'Wieder öffnen', tip: 'Offen', angle: 180, bar: 0 },
  { status: 'done', icon: 'done', label: 'Als erledigt markieren', tip: 'Erledigt · Alt D', angle: 225, bar: 1 },
];
const orbitRadius = 44;
/** Position on the orbit around the entry symbol; 0° is right, 90° down (screen coordinates). */
const onOrbit = (angle: number): CSSProperties => ({
  '--x': `${Math.round(Math.cos(angle * Math.PI / 180) * orbitRadius)}px`,
  '--y': `${Math.round(Math.sin(angle * Math.PI / 180) * orbitRadius)}px`,
} as CSSProperties);
const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];

// Two layouts share everything but their markup (styles are scoped by .actions-bar / .actions-orbit on the app):
// The bar: one compact pill under the row; choosing "Datum" turns it into the calendar in place.
// The palette: a searchable command list (see ActionPalette), keyboard-first like an editor's command palette.
// Inline: no surface at all; the row opens a line of word-like actions in the document flow, in the writing font.
// Swipe: gestures on the symbol (see useSwipe); opened explicitly, it only shows a small legend of the gestures, which also works as buttons.
// The orbit: the entry's actions as satellites, each where it belongs:
// - an orbit around the symbol: ↑ above and ↓ below (moving the entry that way), the task states on the left,
//   priority (upper right) and removing (lower right), so nothing lands on the text;
// - planning as a separate cluster at the end of the row, where times and target dates are shown; the calendar opens from there.
// Icon-only: hovering or keyboard-focusing an action previews its effect on the entry itself.
export function EntryActionDock({ layout, swipeActions, onClose, entry, day, label, isOpen, planning, plannerView, traceSaved, canMoveUp, canMoveDown, onStatusChange, onPriorityChange, onMove, onRemove, onPreview, onPlanDatePreview, onPlanningChange, onPlan, onNavigate }: {
  layout: ActionLayout; swipeActions: SwipeActions<EntryPreview>; onClose: () => void; entry: Entry; day: string; label: string; isOpen: boolean; planning: boolean; plannerView: PlannerView; traceSaved: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onStatusChange: (status: TaskStatus) => void; onPriorityChange: () => void; onMove: (offset: -1 | 1) => void; onRemove: () => void; onPreview: (preview: EntryPreview | null) => void;
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

  const removeTip = trace ? `Entfernen · auch am ${trace.targets.map(target => formatShortDate(target.date)).join(', ')}` : entry.origin ? `Entfernen · auch die Spur am ${formatShortDate(entry.origin)}` : 'Entfernen · Alt Entf';
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
    {entry.kind === 'task' && <button type="button" className="dock-plan-tomorrow" style={stagger()} aria-label="Auf morgen verschieben" data-tip="Morgen · Alt M" {...previewing('tomorrow')} onClick={() => onPlan(tomorrowChange(entry, day))}><Icon name="migrated" /></button>}
    <button type="button" className="dock-plan-date" style={stagger()} aria-label="Datum und Uhrzeit planen" aria-haspopup="dialog" data-tip="Planen · Alt T" onClick={() => onPlanningChange(true)}><Icon name="calendar" /></button>
    <button type="button" className="dock-plan-days" style={stagger()} aria-label="Mehrere Tage" aria-haspopup="dialog" data-tip="Mehrere Tage · Alt ⇧ T" onClick={() => onPlanningChange(true, 'days')}><Icon name={traceIcon({ kind: entry.kind, plan: { via: 'days', targets: [], time: null, reminder: false } })} /></button>
  </div>;
  const isTask = entry.kind === 'task' && !trace;
  // Inline groups reuse the palette's actions, with short, lower-case words as they read in a sentence.
  const groupOf: Record<string, number> = { jump: 0, unplan: 0, open: 1, done: 1, cancelled: 1, priority: 2, tomorrow: 3, plan: 3, days: 3, up: 4, down: 4, remove: 5 };
  const shortWords: Record<string, string> = { jump: 'zum tag', unplan: 'zurücknehmen', open: 'offen', done: 'erledigt', cancelled: 'abbrechen', priority: 'priorität', tomorrow: 'morgen', plan: 'planen', days: 'mehrere tage', up: '', down: '', remove: 'löschen' };
  const inlineGroups = () => {
    const items = paletteItems().map(item => ({ ...item, short: shortWords[item.id] }));
    const order = ['open', 'done', 'cancelled'];
    items.sort((a, b) => groupOf[a.id] - groupOf[b.id] || order.indexOf(a.id) - order.indexOf(b.id));
    const groups: (typeof items)[] = [];
    for (const item of items) { const last = groups.at(-1); if (last && groupOf[last[0].id] === groupOf[item.id]) last.push(item); else groups.push([item]); }
    return groups;
  };
  const paletteItems = (): PaletteItem<EntryPreview>[] => [
    ...trace ? [
      { id: 'jump', label: `Zum ${formatShortDate(trace.targets[0].date)} springen`, icon: 'jump' as const, keywords: 'spur ziel tag öffnen gehe', hint: 'Alt T', run: () => onNavigate(trace.targets[0].date) },
      ...!traceSaved ? [{ id: 'unplan', label: 'Planung zurücknehmen', icon: 'undo' as const, keywords: 'rückgängig undo zurück', preview: 'unplan' as const, run: () => onPlan({ plan: null }) }] : [],
    ] : [],
    ...isTask ? [
      { id: 'done', label: 'Erledigt', icon: 'done' as const, keywords: 'fertig done abhaken haken', hint: 'Alt D', preview: 'done' as const, current: status === 'done', run: () => onStatusChange('done') },
      { id: 'cancelled', label: 'Abbrechen', icon: 'cancel' as const, keywords: 'abgebrochen streichen cancel verwerfen', hint: 'Alt X', preview: 'cancelled' as const, current: status === 'cancelled', run: () => onStatusChange('cancelled') },
      { id: 'open', label: 'Wieder öffnen', icon: 'task' as const, keywords: 'offen reopen zurücksetzen', preview: 'open' as const, current: status === 'open', run: () => onStatusChange('open') },
    ] : [],
    ...!trace ? [{ id: 'priority', label: entry.priority ? 'Priorität entfernen' : 'Hohe Priorität', icon: priorityIcon(entry.kind), keywords: 'wichtig stern priority markieren', hint: 'Alt P', preview: 'priority' as const, run: onPriorityChange }] : [],
    ...canPlan(entry) ? [
      ...entry.kind === 'task' ? [{ id: 'tomorrow', label: 'Auf morgen', icon: 'migrated' as const, keywords: 'morgen verschieben tomorrow später', hint: 'Alt M', preview: 'tomorrow' as const, run: () => onPlan(tomorrowChange(entry, day)) }] : [],
      { id: 'plan', label: 'Planen …', icon: 'calendar' as const, keywords: 'datum termin kalender uhrzeit zeit erinnerung schedule', hint: 'Alt T', stays: true, run: () => onPlanningChange(true) },
      { id: 'days', label: 'Mehrere Tage', icon: traceIcon({ kind: entry.kind, plan: { via: 'days', targets: [], time: null, reminder: false } }), keywords: 'zeitraum tage wiederholen woche', hint: 'Alt ⇧ T', stays: true, run: () => onPlanningChange(true, 'days') },
    ] : [],
    { id: 'up', label: 'Nach oben', icon: 'up' as const, keywords: 'verschieben hoch reihenfolge', hint: 'Alt ↑', preview: 'up' as const, disabled: !canMoveUp, run: () => onMove(-1) },
    { id: 'down', label: 'Nach unten', icon: 'down' as const, keywords: 'verschieben runter reihenfolge', hint: 'Alt ↓', preview: 'down' as const, disabled: !canMoveDown, run: () => onMove(1) },
    { id: 'remove', label: trace || entry.origin ? removeTip.replace('Entfernen', 'Löschen').replace(' · Alt Entf', '') : 'Löschen', icon: 'trash' as const, keywords: 'entfernen delete papierkorb', hint: 'Alt Entf', preview: 'remove' as const, run: onRemove },
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
      onCancel={() => onPlanningChange(false)} onConfirm={(dates: string[], schedule: Schedule) => onPlan(planChange(day, dates, schedule))} />
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
    </div> : layout === 'palette' ? <div className="entry-dock">
      {isOpen && <ActionPalette items={paletteItems()} onPreview={onPreview} onClose={onClose} />}
    </div> : layout === 'orbit' ? <div className="entry-dock">
      <svg className="dock-orbit" aria-hidden="true" viewBox="-50 -50 100 100"><circle r={orbitRadius} pathLength={1} /></svg>
      {up()}
      {!trace && priority()}
      {remove()}
      {down()}
      {trace && <>{!traceSaved && unplan()}{jump()}</>}
      {isTask && states(statusActions)}
      {canPlan(entry) && planningGroup()}
    </div> : <div className="entry-dock">
      {trace && <>{jump()}{!traceSaved && unplan()}<span className="dock-divider" /></>}
      {isTask && <>{states([...statusActions].sort((a, b) => a.bar - b.bar))}<span className="dock-divider" /></>}
      {!trace && <>{priority()}<span className="dock-divider" /></>}
      <div className="dock-order" role="group" aria-label="Reihenfolge">{up()}{down()}</div>
      {canPlan(entry) && <><span className="dock-divider" />{planningGroup()}</>}
      <span className="dock-divider" />
      {remove()}
    </div>}
  </div>;
}
