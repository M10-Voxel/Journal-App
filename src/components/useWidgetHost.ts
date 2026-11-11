import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { updateDesktopWidget } from '../desktopWidgets';
import { manageTags } from '../tagStore';
import { ensureWidgetSurface } from '../widgetSurface';

/**
 * What every desktop widget does with its host, whatever it shows:
 * - It prepares its content (`prepare`) and the drawing surface, then tells the host it is ready (shown).
 * - Hiding (from the header's menu, the settings or the tray's `desktop-widget:close`) first saves what is pending.
 * - "Manage tags" opens the widget settings' tags (the widget window has no settings of its own).
 * Returns the hide action.
 */
export function useWidgetHost({ id, flush, prepare, onError }: { id: string; flush: () => Promise<unknown>; prepare?: () => Promise<unknown>; onError: (error: string) => void }) {
  const latest = useRef({ flush, prepare, onError });
  latest.current = { flush, prepare, onError };
  const report = (reason: unknown) => latest.current.onError(String(reason));
  const close = useCallback(async () => {
    try { await latest.current.flush(); await updateDesktopWidget({ enabled: false }, id); }
    catch (reason) { report(reason); }
  }, [id]);
  useEffect(() => {
    let stopped = false;
    void Promise.all([latest.current.prepare?.(), ensureWidgetSurface()]).catch(report)
      .finally(() => { if (!stopped) void invoke('desktop_widget_ready').catch(report); });
    const stop = listen('desktop-widget:close', () => void close());
    const unregister = manageTags.register(() => { void invoke('desktop_widget_open_settings', { tab: 'tags' }).catch(report); });
    return () => { stopped = true; unregister(); void stop.then(unlisten => unlisten()); };
  }, [close]);
  return close;
}
