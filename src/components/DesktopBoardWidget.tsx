import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { t } from '../i18n';
import { BulletinBoard } from './BulletinBoard';
import { DesktopWidgetFrame } from './DesktopWidgetFrame';
import { useWidgetDay } from './useWidgetDay';
import { useWidgetHost } from './useWidgetHost';

/**
 * A day's pinboard on the desktop: the header holds the day's navigation and a "+" (the board's add menu), the rest is
 * the cork alone, framed to the widget (drag or wheel to move, Ctrl+wheel to zoom). Cards are saved as they change, so
 * there is nothing to flush; the tags it shows are the widget's (see its settings).
 */
export function DesktopBoardWidget({ widget, registry }: {widget: DesktopWidgetInstance; registry: DesktopWidgetState}) {
  const [error, setError] = useState('');
  const [tools, setTools] = useState<HTMLDivElement | null>(null);
  const { date, nav } = useWidgetDay();
  const close = useWidgetHost({ id: widget.id, flush: async () => {}, onError: setError });
  return <DesktopWidgetFrame widget={widget} registry={registry} date={date} nav={nav} toolsRef={setTools} onError={setError} onClose={() => void close()}
    onOpen={() => void invoke('show_day', { date, entry: null }).catch(reason => setError(String(reason)))}>
    {error && <p className="widget-message is-error" role="alert">{t('Pinnwand')}: {error}</p>}
    <div className="desktop-widget-board board-framed">
      <BulletinBoard key={date} date={date} tagScope={`widget-${widget.id}`} toolsSlot={tools} />
    </div>
  </DesktopWidgetFrame>;
}
