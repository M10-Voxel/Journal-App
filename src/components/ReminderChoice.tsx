import { useState } from 'react';
import { t, useLanguage } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** The longest lead time (30 days, as the store allows; see reminders in storage.rs). */
export const maxReminderBefore = 30 * 24 * 60;
export type ReminderSetting = { reminder: boolean; before: number };
type Unit = 'min' | 'hour' | 'day';
const unitMinutes: Record<Unit, number> = { min: 1, hour: 60, day: 1440 };
const presets = [0, 10, 60, 1440] as const;

/** "zur Uhrzeit", "5 Min. vorher", "1 Std. vorher", "2 Tage vorher". */
export function reminderLeadLabel(before: number | undefined): string {
  const minutes = Math.max(0, Math.round(before ?? 0));
  if (!minutes) return t('zur Uhrzeit');
  if (minutes % 1440 === 0) return minutes === 1440 ? t('1 Tag vorher') : t('{0} Tage vorher', minutes / 1440);
  if (minutes % 60 === 0) return t('{0} Std. vorher', minutes / 60);
  return t('{0} Min. vorher', minutes);
}
const unitOf = (minutes: number): Unit => minutes && minutes % 1440 === 0 ? 'day' : minutes && minutes % 60 === 0 ? 'hour' : 'min';

/**
 * When a reminder comes: off, at the time, 10 minutes, an hour or a day ahead, or a time of one's own (a number with arrows and
 * minutes, hours or days). Presets take effect and close; the own time changes as it is typed, Enter closes.
 */
export function ReminderChoice({ anchor, value, timed, onChange, onClose }: {
  anchor: HTMLElement | null; value: ReminderSetting; timed: boolean; onChange: (value: ReminderSetting) => void; onClose: (byKey: boolean) => void;
}) {
  useLanguage();
  const custom = value.reminder && !presets.includes(value.before as typeof presets[number]);
  const [unit, setUnit] = useState<Unit>(unitOf(custom ? value.before : 30));
  const [amount, setAmount] = useState(custom ? Math.max(1, Math.round(value.before / unitMinutes[unitOf(value.before)])) : 30);
  const [own, setOwn] = useState(custom);
  const choices: { key: string; label: string; set: ReminderSetting }[] = [
    { key: 'off', label: t('Keine Erinnerung'), set: { reminder: false, before: value.before } },
    { key: '0', label: timed ? t('Zur Uhrzeit') : t('Um 9:00 (ohne Uhrzeit)'), set: { reminder: true, before: 0 } },
    { key: '10', label: t('10 Min. vorher'), set: { reminder: true, before: 10 } },
    { key: '60', label: t('1 Std. vorher'), set: { reminder: true, before: 60 } },
    { key: '1440', label: t('1 Tag vorher'), set: { reminder: true, before: 1440 } },
  ];
  const current = !value.reminder ? 'off' : own ? 'own' : String(value.before);
  const ownMinutes = (count: number, of: Unit) => Math.max(1, Math.min(maxReminderBefore, Math.round(count) * unitMinutes[of]));
  const applyOwn = (count: number, of: Unit) => {
    const limited = Math.max(1, Math.min(Math.floor(maxReminderBefore / unitMinutes[of]), Math.round(count) || 1));
    setAmount(limited); setUnit(of); setOwn(true);
    onChange({ reminder: true, before: ownMinutes(limited, of) });
  };
  return <Popover anchor={anchor} className="reminder-choice" label={t('Erinnerung')} onClose={onClose}>
    <div className="reminder-choice-list" role="radiogroup" aria-label={t('Wann erinnern')} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if ((event.target as HTMLElement).closest('.reminder-choice-own')) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      {choices.map(choice => <button key={choice.key} type="button" role="radio" aria-checked={current === choice.key} data-reminder-choice={choice.key}
        data-autofocus={current === choice.key ? true : undefined} className={`reminder-choice-option${current === choice.key ? ' is-current' : ''}`}
        onClick={() => { setOwn(false); onChange(choice.set); onClose(true); }}>
        <Icon name={choice.key === 'off' ? 'done' : 'bell'} /><span>{choice.label}</span>{current === choice.key && <Icon name="check" className="reminder-choice-check" />}
      </button>)}
      <div className={`reminder-choice-own${current === 'own' ? ' is-current' : ''}`}>
        <button type="button" role="radio" aria-checked={current === 'own'} data-reminder-choice="own" data-autofocus={current === 'own' ? true : undefined} className="reminder-choice-option"
          onClick={() => applyOwn(amount, unit)}><Icon name="clock" /><span>{t('Eigene Zeit')}</span>{current === 'own' && <Icon name="check" className="reminder-choice-check" />}</button>
        <div className="reminder-choice-amount" role="group" aria-label={t('Eigene Zeit vorher')}>
          <span className="reminder-choice-number">
            <input type="number" inputMode="numeric" min={1} max={Math.floor(maxReminderBefore / unitMinutes[unit])} value={amount} aria-label={t('Anzahl')}
              onChange={event => applyOwn(Number(event.target.value), unit)} onFocus={event => event.currentTarget.select()}
              onKeyDown={event => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); applyOwn(amount + (event.key === 'ArrowUp' ? 1 : -1), unit); }
                else if (event.key === 'Enter') { event.preventDefault(); applyOwn(amount, unit); onClose(true); }
              }} />
            <span className="reminder-choice-steps">
              <button type="button" tabIndex={-1} aria-label={t('Mehr')} onClick={() => applyOwn(amount + 1, unit)}><Icon name="up" /></button>
              <button type="button" tabIndex={-1} aria-label={t('Weniger')} onClick={() => applyOwn(amount - 1, unit)}><Icon name="down" /></button>
            </span>
          </span>
          <span className="reminder-choice-units" role="radiogroup" aria-label={t('Einheit')}>
            {(['min', 'hour', 'day'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={own && unit === option} data-reminder-unit={option}
              onClick={() => applyOwn(amount, option)}>{option === 'min' ? t('Min.') : option === 'hour' ? t('Std.') : t('Tage')}</button>)}
          </span>
          <span className="reminder-choice-suffix">{t('vorher')}</span>
        </div>
      </div>
    </div>
  </Popover>;
}
