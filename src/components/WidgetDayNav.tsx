import type { RefObject } from 'react';
import { formatDate, localDate, shiftDate } from '../journal';
import { t } from '../i18n';
import { MiniCalendarPicker } from './MiniCalendarPicker';
import { NavCluster } from './NavCluster';

/**
 * A day widget's header navigation (daily note, pinboard): back, today, forward and the date with its mini calendar.
 * `onNavigate(date, follow)`: `follow` keeps the widget on "today" across midnight.
 */
export function WidgetDayNav({ date, today, followToday, picker, onPickerChange, onNavigate, dateRef }: {
  date: string; today: string; followToday: boolean; picker: boolean; onPickerChange(open: boolean): void;
  onNavigate(date: string, follow: boolean): void; dateRef: RefObject<HTMLButtonElement | null>;
}) {
  return <>
    <NavCluster label={t('Tagesnavigation')} prev={{ label: t('Vorheriger Tag'), tip: t('Vorheriger Tag · Alt ←') }} next={{ label: t('Nächster Tag'), tip: t('Nächster Tag · Alt →') }}
      today={{ tip: t('Heute · Alt H'), disabled: followToday && date === today }} atToday={date === today}
      onPrev={() => onNavigate(shiftDate(date, -1), false)} onToday={() => onNavigate(localDate(), true)} onNext={() => onNavigate(shiftDate(date, 1), false)} />
    <MiniCalendarPicker date={date} open={picker} onOpenChange={onPickerChange} onPick={target => onNavigate(target, target === localDate())} buttonRef={dateRef} className="widget-date">{formatDate(date)}</MiniCalendarPicker>
  </>;
}
