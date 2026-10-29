import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, FocusEvent } from 'react';
import type { Entry } from '../journal';
import { Icon, IconName, priorityIcon, traceIcon } from './Icon';
import { PlanCalendar } from './PlanCalendar';
import { formatShortDate } from '../dates';
import { Schedule, canPlan, planChange, tomorrowChange } from '../planning';

export type TaskStatus = 'open' | 'done' | 'cancelled';
export type EntryPreview = TaskStatus | 'remove' | 'up' | 'down' | 'priority' | 'tomorrow' | 'unplan';
export type PlanUpdate = Partial<Pick<Entry, 'time' | 'reminder' | 'plan'>>;

const statusActions: { status: TaskStatus; icon: IconName; label: string; tip: string }[] = [
  { status: 'open', icon: 'task', label: 'Wieder öffnen', tip: 'Offen' },
  { status: 'done', icon: 'done', label: 'Als erledigt markieren', tip: 'Erledigt · Alt D' },
  { status: 'cancelled', icon: 'cancel', label: 'Aufgabe abbrechen', tip: 'Abgebrochen · Alt X' },
];
const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];

// A compact floating toolbar under the entry. It is icon-only: hovering or keyboard-focusing an action previews its effect on the entry itself.
// Choosing "Datum" swaps the pill for a calendar in place; traces (planned-away entries) get jump/undo instead of status and planning.
export function EntryActionDock({ entry, day, label, isOpen, planning, plannerView, traceSaved, canMoveUp, canMoveDown, onStatusChange, onPriorityChange, onMove, onRemove, onPreview, onPlanDatePreview, onPlanningChange, onPlan, onNavigate }: {
  entry: Entry; day: string; label: string; isOpen: boolean; planning: boolean; plannerView: 'date' | 'time'; traceSaved: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onStatusChange: (status: TaskStatus) => void; onPriorityChange: () => void; onMove: (offset: -1 | 1) => void; onRemove: () => void; onPreview: (preview: EntryPreview | null) => void;
  onPlanDatePreview: (date: string | null) => void; onPlanningChange: (planning: boolean) => void; onPlan: (change: PlanUpdate) => void; onNavigate: (date: string) => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const wasPlanning = useRef(false);
  const trace = entry.plan;
  const status: TaskStatus = entry.done ? 'done' : entry.cancelled ? 'cancelled' : 'open';
  let order = 0;
  const stagger = (): CSSProperties => ({ '--i': order++ } as CSSProperties);
  const previewing = (preview: EntryPreview) => ({
    // Pointer *movement* starts a preview, so a toolbar opening under a resting cursor does not fake one.
    onPointerMove: () => onPreview(preview),
    onPointerLeave: () => onPreview(null),
    onFocus: (event: FocusEvent<HTMLButtonElement>) => { if (event.currentTarget.matches(':focus-visible')) onPreview(preview); },
    onBlur: () => onPreview(null),
  });

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
      onCancel={() => onPlanningChange(false)} onConfirm={(date: string, schedule: Schedule) => onPlan(planChange(day, [date], schedule))} />
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
    <div className="entry-dock">
      {trace && <>
        <button type="button" className="dock-jump" style={stagger()} aria-label={`Zum ${formatShortDate(trace.targets[0].date)} springen`} data-tip={formatShortDate(trace.targets[0].date)} data-primary-action="true" onClick={() => onNavigate(trace.targets[0].date)}><Icon name="jump" /></button>
        {!traceSaved && <button type="button" className="dock-unplan" style={stagger()} aria-label="Planung zurücknehmen" data-tip="Zurücknehmen" {...previewing('unplan')} onClick={() => onPlan({ plan: null })}><Icon name="undo" /></button>}
        <span className="dock-divider" />
      </>}
      {entry.kind === 'task' && !trace && <>
        <div className="status-track" data-status={status} role="group" aria-label="Status der Aufgabe">
          {statusActions.map(action => <button key={action.status} type="button" style={stagger()} aria-label={action.label} data-tip={action.tip} aria-pressed={status === action.status}
            data-primary-action={action.status === (status === 'open' ? 'done' : 'open')} {...previewing(action.status)} onClick={() => onStatusChange(action.status)}>
            <Icon name={action.icon} />
          </button>)}
        </div>
        <span className="dock-divider" />
      </>}
      {!trace && <><button type="button" className="dock-priority" style={stagger()} aria-label={entry.priority ? 'Priorität entfernen' : 'Als Priorität markieren'} data-tip={entry.priority ? 'Priorität entfernen · Alt P' : 'Hohe Priorität · Alt P'} aria-pressed={entry.priority}
        {...previewing('priority')} onClick={onPriorityChange}><Icon name={priorityIcon(entry.kind)} /></button>
      <span className="dock-divider" /></>}
      <div className="dock-order" role="group" aria-label="Reihenfolge">
        <button type="button" style={stagger()} aria-label="Nach oben" data-tip="Alt ↑" disabled={!canMoveUp} {...previewing('up')} onClick={() => onMove(-1)}><Icon name="up" /></button>
        <button type="button" style={stagger()} aria-label="Nach unten" data-tip="Alt ↓" disabled={!canMoveDown} {...previewing('down')} onClick={() => onMove(1)}><Icon name="down" /></button>
      </div>
      {canPlan(entry) && <>
        <span className="dock-divider" />
        <div className="dock-planning" role="group" aria-label="Planen">
          {entry.kind === 'task' && <button type="button" className="dock-plan-tomorrow" style={stagger()} aria-label="Auf morgen verschieben" data-tip="Morgen · Alt M" {...previewing('tomorrow')} onClick={() => onPlan(tomorrowChange(entry, day))}><Icon name="migrated" /></button>}
          <button type="button" className="dock-plan-date" style={stagger()} aria-label="Datum und Uhrzeit planen" aria-haspopup="dialog" data-tip="Planen · Alt T" onClick={() => onPlanningChange(true)}><Icon name="calendar" /></button>
          <button type="button" className="dock-plan-days" style={stagger()} disabled aria-label="Mehrere Tage" data-tip="Mehrere Tage · bald"><Icon name={traceIcon({ kind: entry.kind, plan: { via: 'days', targets: [], time: null, reminder: false } })} /></button>
        </div>
      </>}
      <span className="dock-divider" />
      <button type="button" className="dock-remove" style={stagger()} aria-label="Eintrag entfernen" data-tip={trace ? `Entfernen · auch am ${trace.targets.map(target => formatShortDate(target.date)).join(', ')}` : entry.origin ? `Entfernen · auch die Spur am ${formatShortDate(entry.origin)}` : 'Entfernen · Alt Entf'} {...previewing('remove')} onClick={onRemove}><Icon name="trash" /></button>
    </div>
  </div>;
}
