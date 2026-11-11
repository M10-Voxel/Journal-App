import { useEffect, useState } from 'react';
import { copyWidgetPreferences } from '../calendarPreferences';
import { copyWidgetChrome, useWidgetChrome } from '../widgetChrome';
import { setGlassLook } from '../settings';
import { currentWidgetId, useDesktopWidgetState } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { DesktopEntriesWidget } from './DesktopEntriesWidget';
import { DesktopCalendarWidget } from './DesktopCalendarWidget';
import { DesktopBoardWidget } from './DesktopBoardWidget';
import { DesktopPeriodWidget } from './DesktopPeriodWidget';
import { DesktopNotebookWidget } from './DesktopNotebookWidget';
import './widgetGlass.css';

/** The window's look: the transparent one when chosen in the widget's settings, the app's design otherwise. */
function WidgetLook({ id }: { id: string }) {
  const [chrome] = useWidgetChrome(id);
  useEffect(() => { setGlassLook(chrome.glass ? chrome.glassText : null); }, [chrome.glass, chrome.glassText]);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--glass-blur', `${chrome.glassBlur}px`); root.setProperty('--glass-radius', `${chrome.glassRadius}px`);
  }, [chrome.glassBlur, chrome.glassRadius]);
  return null;
}

/** Register future content renderers here; the frame, placement and lifecycle are shared. */
export function DesktopWidgetWindow() {
  const [prepared, setPrepared] = useState(false);
  useEffect(() => {
    const source = new URLSearchParams(location.search).get('widget-source'), target = currentWidgetId();
    if (source && target && source !== target && /^[a-z0-9-]{1,64}$/.test(source)) { copyWidgetPreferences(source, target); copyWidgetChrome(source, target); }
    setPrepared(true);
  }, []);
  const {state, error} = useDesktopWidgetState();
  const widget = state?.widgets.find(item => item.id === currentWidgetId());
  if (!prepared || !state || !widget) return error ? <p role="alert">{error}</p> : null;
  return <><WidgetLook id={widget.id} />{content(widget, state)}</>;
}

function content(widget: DesktopWidgetInstance, state: DesktopWidgetState) {
  switch (widget.kind) {
    case 'daily-note': return <DesktopEntriesWidget widget={widget} registry={state} />;
    case 'calendar': return <DesktopCalendarWidget widget={widget} registry={state} />;
    case 'board': return <DesktopBoardWidget widget={widget} registry={state} />;
    case 'day-values': case 'activities': return <DesktopPeriodWidget widget={widget} registry={state} kind={widget.kind} />;
    case 'notebook': return <DesktopNotebookWidget widget={widget} registry={state} />;
    default: return null;
  }
}
