import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { widgetIdFromLabel } from './widgetIdentity';
import type { IconName } from './components/Icon';

export type DesktopWidgetKind = 'daily-note' | 'calendar' | 'board' | 'day-values' | 'activities' | 'notebook';
export interface DesktopWidgetInstance { id: string; kind: DesktopWidgetKind; name: string; enabled: boolean; locked: boolean; /** Higher lies in front. */ layer: number; placement: {monitor: string; x: number; y: number; width: number; height: number} | null; error: string | null }
export interface DesktopWidgetState { supported: boolean; autostart: boolean; widgets: DesktopWidgetInstance[]; types: {kind: DesktopWidgetKind; available: boolean}[]; error: string | null }
export interface DesktopWidgetUpdate { enabled?: boolean; locked?: boolean; name?: string; autostart?: boolean; reset?: boolean }
export const currentWidgetId = () => widgetIdFromLabel(getCurrentWindow().label);
export const updateDesktopWidget = (update: DesktopWidgetUpdate, id: string | null = currentWidgetId()) => invoke<DesktopWidgetState>('desktop_widget_update', { id, update });
export const createDesktopWidget = (kind: DesktopWidgetKind, source: string | null = null) => invoke<DesktopWidgetState>('desktop_widget_create', { kind, source });
/** The widgets' stacking, `ids` from front to back. */
export const setDesktopWidgetLayers = (ids: string[]) => invoke<DesktopWidgetState>('desktop_widget_layers', { ids });
/** The widgets from front to back (equal layers: the later one in front). */
export const widgetsByLayer = (widgets: DesktopWidgetInstance[]) => widgets.map((widget, index) => ({ widget, index })).sort((a, b) => (b.widget.layer ?? 0) - (a.widget.layer ?? 0) || b.index - a.index).map(item => item.widget);
export const removeDesktopWidget = (id: string) => invoke<DesktopWidgetState>('desktop_widget_remove', { id });
export const widgetTypeInfo = (kind: DesktopWidgetKind, en: boolean): {label: string; description: string; icon: IconName} => kind === 'calendar'
  ? {label: en ? 'Calendar' : 'Kalender', description: en ? 'The complete calendar with its different views.' : 'Das vollständige Kalenderfenster mit seinen verschiedenen Ansichten.', icon: 'calendar'}
  : kind === 'board'
  ? {label: en ? 'Pinboard' : 'Pinnwand', description: en ? "A day's notes, images and links, pinned on the desktop." : 'Zettel, Bilder und Links eines Tages, direkt auf dem Desktop angepinnt.', icon: 'pin'}
  : kind === 'day-values'
  ? {label: en ? 'Day values' : 'Tageswerte', description: en ? 'Rate the day and set your values such as stress or sleep.' : 'Den Tag bewerten und eigene Werte wie Stress oder Schlaf eintragen.', icon: 'priority'}
  : kind === 'activities'
  ? {label: en ? 'Activities' : 'Aktivitäten', description: en ? "Tick off the day's activities, with notes, minutes and timer." : 'Die Aktivitäten des Tages abhaken, mit Notiz, Minuten und Timer.', icon: 'check'}
  : kind === 'notebook'
  ? {label: en ? 'Notes' : 'Notizen', description: en ? 'One note of your notebook at a time, to read and write.' : 'Ein Zettel aus deinem Notizblock zum Lesen und Schreiben, ohne Ordnerbaum.', icon: 'note'}
  : {label: en ? 'Daily note' : 'Tagesnotiz', description: en ? 'Write, plan and complete entries directly on the desktop.' : 'Einträge direkt auf dem Desktop schreiben, planen und erledigen.', icon: 'journal'};
export function widgetDisplayName(widget: DesktopWidgetInstance, widgets: DesktopWidgetInstance[], en: boolean): string {
  if (widget.name) return widget.name;
  const peers = widgets.filter(other => other.kind === widget.kind), label = widgetTypeInfo(widget.kind, en).label;
  return peers.length > 1 ? `${label} ${peers.findIndex(other => other.id === widget.id) + 1}` : label;
}
export function useDesktopWidgetState() {
  const [state, setState] = useState<DesktopWidgetState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, revision = 0;
    const stop = listen<DesktopWidgetState>('desktop-widget:state', event => { if (active) { revision++; setState(event.payload); if (!event.payload.error) setError(''); } });
    void stop.then(async () => { const before = revision; const value = await invoke<DesktopWidgetState>('desktop_widget_state'); if (active && before === revision) setState(value); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; void stop.then(unlisten => unlisten()); };
  }, []);
  return { state, setState, error, setError };
}
