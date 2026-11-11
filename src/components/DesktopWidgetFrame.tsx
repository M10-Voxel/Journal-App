import type { ReactNode, Ref } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { updateDesktopWidget, widgetDisplayName } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { useLanguage, t } from '../i18n';
import { usePopupLook } from '../popupLook';
import { useWidgetChrome } from '../widgetChrome';
import { startWidgetGesture } from '../widgetSurface';
import { WidgetPopupSurface } from './WidgetPopupSurface';
import { WidgetBackdrop } from './WidgetBackdrop';
import { windowGrips } from './useFloatingWindow';
import { contextMenu } from './ContextMenu';
import type { MenuEntry } from './ContextMenu';
import { Icon } from './Icon';

/** How far the widget's content is saved: shown as a small dot in the header only while it is not. */
export type WidgetSaveState = 'saved' | 'pending' | 'saving' | 'error';

/**
 * The shared frame of every desktop widget: a quiet header that holds only the widget's navigation (`nav`, or the
 * element given to `navRef` for content that renders its own) and, if wanted (see widgetChrome), the button that opens
 * the shown day in the journal. The free parts of the header move the widget, its edges resize it. Locking, hiding and
 * the settings are in the header's right-click menu, the widget settings and the tray.
 */
export function DesktopWidgetFrame({ widget, registry, date, nav, navRef, toolsRef, menu = [], save = 'saved', onOpen, onClose, onError, children }: {
  widget: DesktopWidgetInstance; registry: DesktopWidgetState; date?: string; nav?: ReactNode; navRef?: Ref<HTMLDivElement>; save?: WidgetSaveState; children: ReactNode;
  /** A place before "open in Journal" for content that adds things itself (the pinboard's "+"). */
  toolsRef?: Ref<HTMLDivElement>;
  /** Further items for the header's right-click menu, before its own (e.g. managing the activities). */
  menu?: MenuEntry[];
  onOpen(): void; onClose(): void; onError(error: string): void;
}) {
  const en = useLanguage() === 'en', nebula = usePopupLook().startsWith('nebula-');
  const [chrome] = useWidgetChrome(widget.id);
  const name = widgetDisplayName(widget, registry.widgets, en);
  const report = (work: Promise<unknown>) => void work.catch(reason => onError(String(reason)));
  const saveLabel = save === 'error' ? t('Nicht gespeichert') : save === 'saving' ? t('Wird gespeichert …') : t('Wird gleich gespeichert …');
  return <section className={`desktop-widget${nebula ? ' nebula-terminal' : ''} is-${widget.kind}${widget.kind === 'daily-note' ? ' is-entries' : ''}`} data-widget-id={widget.id} data-date={date} data-locked={widget.locked || undefined} aria-label={name}>
    <WidgetPopupSurface />
    <WidgetBackdrop active={chrome.glass && chrome.glassBlur > 0} blur={chrome.glassBlur} />
    <header className="desktop-widget-head" onPointerDown={event => {
      if (event.button !== 0 || widget.locked || (event.target as Element).closest('button,input,a,[role=button]')) return;
      startWidgetGesture(event);
    }} onContextMenu={contextMenu(() => ({ title: name, command: 'widget', items: [
      ...menu, ...(menu.length ? ['-' as const] : []),
      { id: 'settings', label: t('Einstellungen'), icon: 'settings', keys: t('Strg') + ' ,', run: () => report(invoke('desktop_widget_open_settings', {})) },
      { id: 'lock', label: widget.locked ? en ? 'Unlock position' : 'Position entsperren' : en ? 'Lock position and size' : 'Position und Größe sperren', icon: 'pin', checked: widget.locked, run: () => report(updateDesktopWidget({ locked: !widget.locked }, widget.id)) },
      '-',
      { id: 'hide', label: en ? 'Hide widget' : 'Widget ausblenden', icon: 'cancel', run: onClose },
    ] }))}>
      <div className="desktop-widget-nav" ref={navRef}>{nav}</div>
      {toolsRef && <div className="desktop-widget-tools" ref={toolsRef} />}
      {save !== 'saved' && <span className={`desktop-widget-save is-${save}`} role="status" title={saveLabel} aria-label={saveLabel} />}
      {chrome.openButton && <button type="button" className="desktop-widget-open" aria-label={t('In Journal öffnen')} title={t('In Journal öffnen')} onClick={onOpen}><Icon name="jump" /></button>}
    </header>
    {children}
    {!widget.locked && windowGrips.map(grip => <span key={grip.name} className={`widget-grip is-${grip.name}`} aria-hidden="true" onPointerDown={event => startWidgetGesture(event, grip.name)} />)}
  </section>;
}
