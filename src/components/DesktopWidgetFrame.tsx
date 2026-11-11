import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { updateDesktopWidget, widgetDisplayName, widgetTypeInfo } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { useLanguage, t } from '../i18n';
import { usePopupLook } from '../popupLook';
import { ensureWidgetSurface, startWidgetGesture } from '../widgetSurface';
import { WidgetPopupSurface } from './WidgetPopupSurface';
import { windowGrips } from './useFloatingWindow';
import { Icon } from './Icon';

export { ensureWidgetSurface };
export function DesktopWidgetFrame({ widget, registry, command, onOpen, onClose, onError, children, footer }: {
  widget: DesktopWidgetInstance; registry: DesktopWidgetState; command: string; children: ReactNode; footer?: ReactNode;
  onOpen(): void; onClose(): void; onError(error: string): void;
}) {
  const en = useLanguage() === 'en', nebula = usePopupLook().startsWith('nebula-');
  const name = widgetDisplayName(widget, registry.widgets, en);
  return <section className={`desktop-widget${nebula ? ' nebula-terminal' : ''} is-${widget.kind}${widget.kind === 'daily-note' ? ' is-entries' : ''}`} data-widget-id={widget.id} data-locked={widget.locked || undefined} aria-label={name}>
    <WidgetPopupSurface />
    <header className={`desktop-widget-head${nebula ? ' nebula-terminal-head' : ''}`} onPointerDown={event => {
      if (event.button !== 0 || widget.locked || (event.target as Element).closest('button,input')) return;
      startWidgetGesture(event);
    }}>
      <span className="desktop-widget-name" title={name}><span className="widget-nebula-prompt"><b>[journal@~]$</b> {widget.name ? `${name} · ` : ''}{command}</span><span className="widget-plain-name"><Icon name={widgetTypeInfo(widget.kind, en).icon} />{name}</span></span>
      <span className="desktop-widget-tools">
        <button type="button" aria-label={en ? 'Open in Journal' : 'In Journal öffnen'} title={en ? 'Open in Journal' : 'In Journal öffnen'} onClick={onOpen}><Icon name="jump" /></button>
        <button type="button" aria-label={en ? 'Lock position' : 'Position sperren'} title={en ? 'Lock position and size' : 'Position und Größe sperren'} aria-pressed={widget.locked} onClick={() => void updateDesktopWidget({locked: !widget.locked}, widget.id).catch(reason => onError(String(reason)))}><Icon name="pin" /></button>
        <button type="button" aria-label={t('Einstellungen')} title={t('Einstellungen')} onClick={() => void invoke('desktop_widget_open_settings', {}).catch(reason => onError(String(reason)))}><Icon name="settings" /></button>
        <button type="button" className="widget-close" aria-label={en ? 'Hide widget' : 'Widget ausblenden'} title={en ? 'Hide widget' : 'Widget ausblenden'} onClick={onClose}>×</button>
      </span>
    </header>
    {children}
    {footer && <footer className="desktop-widget-status">{footer}</footer>}
    {!widget.locked && windowGrips.map(grip => <span key={grip.name} className={`widget-grip is-${grip.name}`} aria-hidden="true" onPointerDown={event => startWidgetGesture(event, grip.name)} />)}
  </section>;
}
