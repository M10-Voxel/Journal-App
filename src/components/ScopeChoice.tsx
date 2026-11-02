import { t, useLanguage } from '../i18n';
import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { ChoiceAction, ScopeOption } from '../planning';
import { formatShortDate } from '../dates';
import { formatWeekdayLong } from '../calendar';
import { Icon, IconName } from './Icon';

const actionLabels = (): Record<ChoiceAction, { label: string; icon: IconName }> => ({
  remove: { label: t("Löschen"), icon: 'trash' }, done: { label: t("Erledigt"), icon: 'check' }, cancelled: { label: t("Abbrechen"), icon: 'cancel' }, edit: { label: t("Anwenden"), icon: 'check' },
});
export function scopeLabel(option: ScopeOption): string {
  const count = option.others.length;
  if (option.scope === 'this') return t("Nur diesen");
  if (option.scope === 'following') return count === 1 ? t("Auch den folgenden") : t("Auch die {0} folgenden", count);
  // 2026-11-02 is a Monday: the weekday's name in the display language.
  if (option.scope === 'weekday') return t("Jeden {0}", formatWeekdayLong(`2026-11-0${2 + (option.weekday ?? 0)}`));
  return t("Alle {0}", count + 1);
}
const scopeTip = (option: ScopeOption) => option.others.length ? option.others.map(other => formatShortDate(other.date)).join(', ') : t("Die anderen bleiben, wie sie sind");

/**
 * When an action on a linked entry (a trace, a moved copy, one of several days) could reach the others too: a small pill
 * that asks how far – only this one, also the following ones, or all. The least reaching choice has the focus, so Enter
 * keeps to this entry; ← → move between the choices, Escape (or leaving the pill) cancels the action.
 * As `satellite` it replaces the orbit's round button it came from: the button stays as the pill's start, and the pill
 * grows out of it to the right.
 */
export function ScopeChoice({ action, options, onChoose, onCancel, variant = 'pill', className = '' }: {
  action: ChoiceAction; options: ScopeOption[]; onChoose: (option: ScopeOption) => void; onCancel: () => void; variant?: 'pill' | 'satellite'; className?: string;
}) {
  useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const { label, icon } = actionLabels()[action];
  useEffect(() => { rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, []);
  function onKeyDown(event: KeyboardEvent) {
    const buttons = [...rootRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') onCancel();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  return <div ref={rootRef} className={`scope-choice is-${action} is-${variant} ${className}`} role="dialog" aria-label={t("{0}: auch für verknüpfte Termine?", label)} onKeyDown={onKeyDown}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCancel(); }}>
    {variant === 'satellite' ? <span className="scope-choice-cap"><Icon name={icon} /><span className="visually-hidden">{label}</span></span>
      : <span className="scope-choice-title"><Icon name={icon} />{label}</span>}
    {options.map((option, index) => <button key={option.scope} type="button" className={`scope-choice-${option.scope}`} style={{ '--i': index } as CSSProperties} data-tip={scopeTip(option)}
      onClick={() => onChoose(option)}>{scopeLabel(option)}</button>)}
  </div>;
}
