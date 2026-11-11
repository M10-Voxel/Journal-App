import { useEffect, useState } from 'react';
import { copyWidgetPreferences } from '../calendarPreferences';
import { currentWidgetId, useDesktopWidgetState } from '../desktopWidgets';
import { DesktopEntriesWidget } from './DesktopEntriesWidget';
import { DesktopCalendarWidget } from './DesktopCalendarWidget';

/** Register future content renderers here; the frame, placement and lifecycle are shared. */
export function DesktopWidgetWindow() {
  const [prepared, setPrepared] = useState(false);
  useEffect(() => {
    const source = new URLSearchParams(location.search).get('widget-source'), target = currentWidgetId();
    if (source && target && source !== target && /^[a-z0-9-]{1,64}$/.test(source)) copyWidgetPreferences(source, target);
    setPrepared(true);
  }, []);
  const {state, error} = useDesktopWidgetState();
  const widget = state?.widgets.find(item => item.id === currentWidgetId());
  if (!prepared || !state || !widget) return error ? <p role="alert">{error}</p> : null;
  switch (widget.kind) {
    case 'daily-note': return <DesktopEntriesWidget widget={widget} registry={state} />;
    case 'calendar': return <DesktopCalendarWidget widget={widget} registry={state} />;
    default: return null;
  }
}
