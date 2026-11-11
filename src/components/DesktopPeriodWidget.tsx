import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { t } from '../i18n';
import { flushPeriodData, usePeriodData } from '../periodStore';
import { flushCalendarRequests, requestCalendarImport } from '../calendarRequests';
import { PeriodNotes } from './PeriodNotes';
import type { ManageTab } from './PeriodNotes';
import { DesktopWidgetFrame } from './DesktopWidgetFrame';
import type { WidgetSaveState } from './DesktopWidgetFrame';
import { useWidgetDay } from './useWidgetDay';
import { useWidgetHost } from './useWidgetHost';

/**
 * A day's values or activities on the desktop: the header holds the day's navigation, the rest only the values (the
 * rating and the day values, or the checklist with notes, minutes and timers), without headings or manage buttons.
 * Setting them up is in the header's right-click menu (the app's settings). The app and other widgets hear every change.
 */
export function DesktopPeriodWidget({ widget, registry, kind }: {widget: DesktopWidgetInstance; registry: DesktopWidgetState; kind: 'day-values' | 'activities'}) {
  const [error, setError] = useState('');
  const { date, nav } = useWidgetDay();
  const period = usePeriodData();
  const close = useWidgetHost({ id: widget.id, flush: () => Promise.all([flushPeriodData(), flushCalendarRequests()]), onError: setError });
  const manage = (tab: ManageTab = kind === 'activities' ? 'activities' : 'scales') => void invoke('desktop_widget_open_settings', { tab }).catch(reason => setError(String(reason)));
  const save: WidgetSaveState = period.error ? 'error' : period.saving ? 'saving' : 'saved';
  const parts = { date, mode: 'day' as const, onManage: manage, onImport: requestCalendarImport, bare: true };
  return <DesktopWidgetFrame widget={widget} registry={registry} date={date} nav={nav} save={save} onError={setError} onClose={() => void close()}
    menu={[{ id: 'manage', label: kind === 'activities' ? t('Aktivitäten verwalten …') : t('Tageswerte verwalten …'), icon: 'settings', run: () => manage() }]}
    onOpen={() => void flushPeriodData().then(() => invoke('show_day', { date, entry: null })).catch(reason => setError(String(reason)))}>
    {error && <p className="widget-message is-error" role="alert">{error}</p>}
    <div className={`desktop-widget-body desktop-widget-period is-${kind}`}>
      {kind === 'activities' ? <PeriodNotes {...parts} part="activities" />
        : <><PeriodNotes {...parts} part="rating" /><PeriodNotes {...parts} part="scales" /></>}
    </div>
  </DesktopWidgetFrame>;
}
