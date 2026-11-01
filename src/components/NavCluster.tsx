import { Icon } from './Icon';

/**
 * Back, today, forward: the same capsule wherever days or ranges are turned (journal and calendar toolbars), always at
 * the start of the toolbar, before what it turns. "Heute" is dimmed while today is already shown.
 */
export function NavCluster({ label, prev, next, today, atToday, onPrev, onToday, onNext }: {
  label: string; prev: { label: string; tip: string }; next: { label: string; tip: string }; today: { tip: string; disabled?: boolean };
  atToday: boolean; onPrev: () => void; onToday: () => void; onNext: () => void;
}) {
  return <nav className="nav-cluster" aria-label={label}>
    <button type="button" className="nav-step" aria-label={prev.label} title={prev.tip} onClick={onPrev}><Icon name="left" /></button>
    <button type="button" className={`nav-today${atToday ? ' is-current' : ''}`} title={today.tip} disabled={today.disabled} onClick={onToday}>Heute</button>
    <button type="button" className="nav-step" aria-label={next.label} title={next.tip} onClick={onNext}><Icon name="right" /></button>
  </nav>;
}
