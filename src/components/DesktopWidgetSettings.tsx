import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { createDesktopWidget, removeDesktopWidget, updateDesktopWidget, useDesktopWidgetState, widgetDisplayName, widgetTypeInfo } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetKind, DesktopWidgetState, DesktopWidgetUpdate } from '../desktopWidgets';
import { flushHistoryWindows } from './UndoShortcuts';
import { Icon } from './Icon';
import './desktopWidgetSettings.css';

function WidgetName({ widget, disabled, onSave }: {widget: DesktopWidgetInstance; disabled: boolean; onSave(name: string): void}) {
  const en = useLanguage() === 'en', [value, setValue] = useState(widget.name);
  useEffect(() => setValue(widget.name), [widget.name]);
  return <form className="widgets-name" onSubmit={event => {event.preventDefault(); if (!disabled && value.trim() !== widget.name) onSave(value.trim());}}>
    <label htmlFor={`widget-name-${widget.id}`}>Name</label>
    <div><input id={`widget-name-${widget.id}`} value={value} maxLength={80} placeholder={en ? 'Use the widget type name' : 'Name des Widget-Typs verwenden'} disabled={disabled} onChange={event => setValue(event.target.value)} onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();setValue(widget.name);}}} />
      <button type="submit" disabled={disabled || value.trim() === widget.name} aria-label={en ? 'Save name' : 'Namen speichern'} title={en ? 'Save name' : 'Namen speichern'}><Icon name="check" /></button></div>
  </form>;
}

export function DesktopWidgetSettings({ initialWidgetId }: {initialWidgetId?: string | null}) {
  const en = useLanguage() === 'en';
  const { state, setState, error, setError } = useDesktopWidgetState();
  const [busy, setBusy] = useState(false), [catalog, setCatalog] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialWidgetId ?? null), [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {if (initialWidgetId) setSelected(initialWidgetId);}, [initialWidgetId]);
  useEffect(() => {if (state && selected && !state.widgets.some(widget => widget.id === selected)) setSelected(state.widgets[0]?.id ?? null);}, [state, selected]);
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-widget-instance="${selected}"]`)?.scrollIntoView({block: 'nearest'}));
    return () => cancelAnimationFrame(frame);
  }, [selected, state?.widgets.length]);
  const run = async (work: () => Promise<DesktopWidgetState>, added = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = await work();
      if (added) {const known = new Set(state?.widgets.map(widget => widget.id));setSelected(next.widgets.find(widget => !known.has(widget.id))?.id ?? null);setCatalog(false);}
      setState(next); setRemoving(null);
    } catch (reason) {setError(String(reason));}
    finally {setBusy(false);}
  };
  const update = (widget: DesktopWidgetInstance, patch: DesktopWidgetUpdate) => run(async () => {
    if (patch.enabled === false) await flushHistoryWindows(new Set(['main', `widget-${widget.id}`]));
    return updateDesktopWidget(patch, widget.id);
  });
  const add = (kind: DesktopWidgetKind, source: string | null = null) => run(() => createDesktopWidget(kind, source), true);
  const visibility = (enabled: boolean) => run(async () => {
    if (!enabled) await flushHistoryWindows();
    let next = state!;
    for (const widget of state!.widgets) if (widget.enabled !== enabled && state!.types.some(type => type.kind === widget.kind && type.available)) next = await updateDesktopWidget({enabled}, widget.id);
    return next;
  });
  const enabled = state?.widgets.filter(widget => widget.enabled).length ?? 0;
  const disabled = busy || !state?.supported || !!state.error;
  return <section className="settings-section desktop-widget-settings" aria-busy={busy}>
    <div className="widgets-heading"><span className="widgets-heading-icon"><Icon name="offline" /></span><div><h3>{en ? 'Desktop widgets' : 'Desktop-Widgets'}</h3><p>{en ? 'Your tools, directly on the desktop.' : 'Deine Werkzeuge, direkt auf dem Desktop.'}</p></div>
      <button type="button" className="widgets-add" aria-expanded={catalog} disabled={disabled} onClick={() => setCatalog(open => !open)}><span aria-hidden="true">+</span>{en ? 'Add widget' : 'Widget hinzufügen'}</button></div>
    {!state && !error && <p role="status" className="settings-hint">{en ? 'Loading…' : 'Wird geladen …'}</p>}
    {state && <>
      {!state.supported && <p className="settings-hint">{en ? 'Desktop widgets are currently available on Windows.' : 'Desktop-Widgets sind derzeit unter Windows verfügbar.'}</p>}
      {(catalog || !state.widgets.length) && <div className="widgets-catalog" aria-label={en ? 'Available widget types' : 'Verfügbare Widget-Typen'}>
        {state.types.map(type => {const info = widgetTypeInfo(type.kind, en);return <button type="button" key={type.kind} className="widgets-type" data-widget-type={type.kind} disabled={disabled || !type.available} onClick={() => void add(type.kind)}>
          <span className="widgets-type-top"><Icon name={info.icon} /><span className={`widgets-type-badge${type.available ? ' is-available' : ''}`}>{type.available ? en ? 'Available' : 'Verfügbar' : en ? 'Coming later' : 'Folgt später'}</span></span>
          <strong>{info.label}</strong><span>{info.description}</span>{type.available && <small>{en ? '+ Add to desktop' : '+ Zum Desktop hinzufügen'}</small>}
        </button>;})}
      </div>}
      <div className="widgets-list-head"><h4>{en ? 'Your widgets' : 'Deine Widgets'}<span>{state.widgets.length}</span></h4><span>{en ? `${enabled} visible` : `${enabled} eingeblendet`}</span>
        {!!state.widgets.length && <div><button type="button" disabled={disabled || enabled === state.widgets.length} onClick={() => void visibility(true)}>{en ? 'Show all' : 'Alle einblenden'}</button><button type="button" disabled={disabled || !enabled} onClick={() => void visibility(false)}>{en ? 'Hide all' : 'Alle ausblenden'}</button></div>}</div>
      {!state.widgets.length && <div className="widgets-empty"><Icon name="offline" /><strong>{en ? 'Make room for your first widget' : 'Platz für dein erstes Widget'}</strong><p>{en ? 'Choose a type above. Each widget keeps its own position, size and settings.' : 'Wähle oben einen Typ aus. Jedes Widget behält seine eigene Position, Größe und Einstellungen.'}</p></div>}
      <div className="widgets-list">
        {state.widgets.map(widget => {
          const name = widgetDisplayName(widget, state.widgets, en), info = widgetTypeInfo(widget.kind, en), open = selected === widget.id;
          const available = state.types.some(type => type.kind === widget.kind && type.available);
          return <article key={widget.id} className={`widgets-instance${open ? ' is-selected' : ''}`} data-widget-instance={widget.id}>
            <div className="widgets-instance-head"><button type="button" className="widgets-select" aria-expanded={open} aria-controls={`widget-details-${widget.id}`} onClick={() => {setSelected(open ? null : widget.id);setRemoving(null);}}>
              <span className="widgets-instance-icon"><Icon name={info.icon} /></span><span><strong>{name}</strong><small><i className={widget.enabled ? 'is-visible' : ''} />{info.label}<span>·</span>{widget.enabled ? en ? 'On desktop' : 'Auf dem Desktop' : en ? 'Hidden' : 'Ausgeblendet'}</small></span><Icon name={open ? 'up' : 'down'} /></button>
              <button type="button" role="switch" className="switch" aria-label={en ? `Show ${name}` : `${name} anzeigen`} aria-checked={widget.enabled} disabled={disabled || !available} onClick={() => void update(widget, {enabled: !widget.enabled})}><span /></button></div>
            {widget.error && <p className="widgets-instance-error" role="alert">{widget.error}</p>}
            {open && <div className="widgets-details" id={`widget-details-${widget.id}`}>
              <WidgetName widget={widget} disabled={disabled} onSave={name => void update(widget, {name})} />
              <div className="widgets-instance-actions">
                <button type="button" aria-pressed={widget.locked} disabled={disabled} onClick={() => void update(widget, {locked: !widget.locked})}><Icon name="pin" />{widget.locked ? en ? 'Position locked' : 'Position gesperrt' : en ? 'Lock position' : 'Position sperren'}</button>
                <button type="button" disabled={disabled} onClick={() => void update(widget, {reset: true})}><Icon name="undo" />{en ? 'Reset position' : 'Position zurücksetzen'}</button>
                <button type="button" disabled={disabled || !available} onClick={() => void add(widget.kind, widget.id)}><Icon name="copy" />{en ? 'Duplicate' : 'Duplizieren'}</button>
                <button type="button" className="is-danger" disabled={disabled} onClick={() => setRemoving(widget.id)}><Icon name="trash" />{en ? 'Remove' : 'Entfernen'}</button>
              </div>
              {removing === widget.id && <div className="widgets-remove" role="group" aria-label={en ? 'Remove widget' : 'Widget entfernen'}><p>{en ? 'Remove this widget? Your notes and entries stay saved.' : 'Dieses Widget entfernen? Deine Notizen und Einträge bleiben gespeichert.'}</p><button type="button" disabled={disabled} onClick={() => setRemoving(null)}>{en ? 'Cancel' : 'Abbrechen'}</button><button type="button" className="is-danger" disabled={disabled} onClick={() => void run(async () => {await flushHistoryWindows(new Set(['main', `widget-${widget.id}`]));return removeDesktopWidget(widget.id);})}>{en ? 'Remove widget' : 'Widget entfernen'}</button></div>}
              <p className="widgets-placement">{widget.placement ? `${Math.round(widget.placement.width)} × ${Math.round(widget.placement.height)} · ${en ? 'Position saved on this device' : 'Position auf diesem Gerät gespeichert'}` : en ? 'Position and size are saved automatically.' : 'Position und Größe werden automatisch gespeichert.'}</p>
            </div>}
          </article>;
        })}
      </div>
      <div className="widgets-global"><div className="setting-row"><div className="setting-label"><span id="widget-autostart">{en ? 'Start with Windows' : 'Mit Windows starten'}</span><small>{en ? 'Restores all visible widgets. Journal starts in the background.' : 'Stellt alle eingeblendeten Widgets wieder her. Journal startet im Hintergrund.'}</small></div><div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby="widget-autostart" aria-checked={state.autostart} disabled={disabled} onClick={() => void run(() => updateDesktopWidget({autostart: !state.autostart}, null))}><span /></button></div></div></div>
      <p className="settings-hint widgets-footnote">{en ? 'Move widgets by their headers and resize them at the edges. Each daily note has independent date navigation. Use the tray menu to manage widgets while Journal is hidden.' : 'Verschiebe Widgets über ihre Kopfzeile und ändere die Größe an den Rändern. Jede Tagesnotiz hat eine eigene Tagesnavigation. Über das Menü im Infobereich erreichst du die Verwaltung auch bei ausgeblendetem Journal.'}</p>
    </>}
    {(error || state?.error) && <p className="error" role="alert">{error || state?.error}</p>}
  </section>;
}
