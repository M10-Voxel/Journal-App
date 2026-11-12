import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '../i18n';
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

/**
 * A failing widget content must not leave an empty window on the desktop: it shows what happened and can load again.
 * (Saved data is not touched; the widget reloads its window.)
 */
class WidgetErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: String(error instanceof Error ? error.message : error) }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('Widget content failed', error, info.componentStack); }
  render() {
    if (this.state.error === null) return this.props.children;
    return <section className="desktop-widget desktop-widget-failed" role="alert">
      <p><strong>{t('Das Widget konnte nicht angezeigt werden.')}</strong></p>
      <p className="widget-failed-reason">{this.state.error}</p>
      <button type="button" onClick={() => location.reload()}>{t('Neu laden')}</button>
    </section>;
  }
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
  return <><WidgetLook id={widget.id} /><WidgetErrorBoundary key={widget.kind}>{content(widget, state)}</WidgetErrorBoundary></>;
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
