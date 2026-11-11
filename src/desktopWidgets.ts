import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { widgetIdFromLabel } from './widgetIdentity';
import type { IconName } from './components/Icon';

export type DesktopWidgetKind = 'daily-note' | 'calendar';
export interface DesktopWidgetInstance { id: string; kind: DesktopWidgetKind; name: string; enabled: boolean; locked: boolean; placement: {monitor: string; x: number; y: number; width: number; height: number} | null; error: string | null }
export interface DesktopWidgetState { supported: boolean; autostart: boolean; widgets: DesktopWidgetInstance[]; types: {kind: DesktopWidgetKind; available: boolean}[]; error: string | null }
export interface DesktopWidgetUpdate { enabled?: boolean; locked?: boolean; name?: string; autostart?: boolean; reset?: boolean }
export const currentWidgetId = () => widgetIdFromLabel(getCurrentWindow().label);
export const updateDesktopWidget = (update: DesktopWidgetUpdate, id: string | null = currentWidgetId()) => invoke<DesktopWidgetState>('desktop_widget_update', { id, update });
export const createDesktopWidget = (kind: DesktopWidgetKind, source: string | null = null) => invoke<DesktopWidgetState>('desktop_widget_create', { kind, source });
export const removeDesktopWidget = (id: string) => invoke<DesktopWidgetState>('desktop_widget_remove', { id });
export const widgetTypeInfo = (kind: DesktopWidgetKind, en: boolean): {label: string; description: string; icon: IconName} => kind === 'calendar'
  ? {label: en ? 'Calendar' : 'Kalender', description: en ? 'The complete calendar with its different views.' : 'Das vollständige Kalenderfenster mit seinen verschiedenen Ansichten.', icon: 'calendar'}
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
