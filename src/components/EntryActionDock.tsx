import { useLayoutEffect, useRef } from 'react';
import type { Entry } from '../journal';
import { Icon } from './Icon';

type TaskStatus = 'open' | 'done' | 'cancelled';

export function EntryActionDock({ entry, label, isOpen, canMoveUp, canMoveDown, onStatusChange, onMove, onRemove, onClose }: {
  entry: Entry; label: string; isOpen: boolean; canMoveUp: boolean; canMoveDown: boolean;
  onStatusChange: (status: TaskStatus) => void; onMove: (offset: -1 | 1) => void; onRemove: () => void; onClose: () => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const status: TaskStatus = entry.done ? 'done' : entry.cancelled ? 'cancelled' : 'open';

  useLayoutEffect(() => {
    if (!isOpen) return;
    const primary = dockRef.current?.querySelector<HTMLButtonElement>('[data-primary-action="true"]')
      ?? dockRef.current?.querySelector<HTMLButtonElement>('.dock-order button:not(:disabled)')
      ?? dockRef.current?.querySelector<HTMLButtonElement>('.dock-close');
    primary?.focus({ preventScroll: true });
  }, [isOpen]);

  return <div ref={dockRef} className={`entry-dock-shell${isOpen ? ' is-open' : ''}`} inert={!isOpen} aria-hidden={!isOpen} role="group" aria-label={`Aktionen für ${label}`} onKeyDown={event => {
    if (event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const scope = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (event.target as HTMLElement).closest('.status-track') ?? dockRef.current : dockRef.current;
    const buttons = Array.from(scope?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }}>
    <div className="entry-dock-clip"><div className="entry-dock">
      <div className="dock-command-row">
        {entry.kind === 'task' ? <div className="status-track" data-status={status} role="group" aria-label="Status der Aufgabe">
          <button type="button" aria-label="Wieder öffnen" aria-pressed={status === 'open'} data-primary-action={status !== 'open'} onClick={() => onStatusChange('open')}><Icon name="task" /><span>Offen</span></button>
          <button type="button" aria-label="Als erledigt markieren" aria-pressed={status === 'done'} data-primary-action={status === 'open'} onClick={() => onStatusChange('done')}><Icon name="done" /><span>Erledigt</span></button>
          <button type="button" aria-label="Aufgabe abbrechen" aria-pressed={status === 'cancelled'} onClick={() => onStatusChange('cancelled')}><Icon name="cancel" /><span>Abgebrochen</span></button>
        </div> : <span className="dock-kind"><Icon name={entry.kind} />{label}</span>}
        <div className="dock-utilities">
          <div className="dock-order" role="group" aria-label="Reihenfolge">
            <button type="button" aria-label="Nach oben" title="Nach oben · Alt + ↑" disabled={!canMoveUp} onClick={() => onMove(-1)}><Icon name="up" /></button>
            <button type="button" aria-label="Nach unten" title="Nach unten · Alt + ↓" disabled={!canMoveDown} onClick={() => onMove(1)}><Icon name="down" /></button>
          </div>
          <span className="dock-divider" />
          <button type="button" className="dock-remove" aria-label="Eintrag entfernen" title="Eintrag entfernen" onClick={onRemove}><Icon name="trash" /></button>
          <button type="button" className="dock-close" aria-label="Aktionen schließen" title="Aktionen schließen · Escape" onClick={onClose}><kbd>Esc</kbd></button>
        </div>
      </div>
      {entry.kind !== 'note' && <div className="dock-planning" role="group" aria-label="Planung – demnächst verfügbar">
        <span className="planning-label">Planen</span>
        {entry.kind === 'task' && <button type="button" disabled title="Auf morgen verschieben – demnächst verfügbar"><Icon name="right" />Morgen</button>}
        <button type="button" disabled title="Datum auswählen – demnächst verfügbar"><Icon name="calendar" />Datum</button>
        <button type="button" disabled title="Für mehrere Tage planen – demnächst verfügbar"><Icon name="date-range" />Mehrere Tage</button>
        <span className="planning-soon">Demnächst</span>
      </div>}
    </div></div>
  </div>;
}
