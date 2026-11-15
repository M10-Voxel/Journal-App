import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SortHandle, useSortRows } from './SortHandle';
import { moveTo } from '../sortable';
import { useLanguage, t } from '../i18n';
import { createDesktopWidget, removeDesktopWidget, setDesktopWidgetLayers, widgetsByLayer, updateDesktopWidget, useDesktopWidgetState, widgetDisplayName, widgetTypeInfo } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetKind, DesktopWidgetState, DesktopWidgetUpdate } from '../desktopWidgets';
import { flushHistoryWindows } from './UndoShortcuts';
import { Icon } from './Icon';
import { TagFilter } from './TagFilter';
import { useHiddenTags } from '../tagStore';
import { glassBlurRange, glassRadiusRange, useWidgetChrome } from '../widgetChrome';
import { calendarWidgetPreferencesKey, loadCalendarPreferences } from '../calendarPreferences';
import type { CalendarKinds } from '../calendarPreferences';
import type { EntryKind } from '../journal';
import './desktopWidgetSettings.css';

function WidgetName({ widget, disabled, onSave }: {widget: DesktopWidgetInstance; disabled: boolean; onSave(name: string): void}) {
  useLanguage(); const [value, setValue] = useState(widget.name);
  useEffect(() => setValue(widget.name), [widget.name]);
  return <form className="widgets-name" onSubmit={event => {event.preventDefault(); if (!disabled && value.trim() !== widget.name) onSave(value.trim());}}>
    <label htmlFor={`widget-name-${widget.id}`}>Name</label>
    <div><input id={`widget-name-${widget.id}`} value={value} maxLength={80} placeholder={t("Name des Widget-Typs verwenden")} disabled={disabled} onChange={event => setValue(event.target.value)} onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();setValue(widget.name);}}} />
      <button type="submit" disabled={disabled || value.trim() === widget.name} aria-label={t("Namen speichern")} title={t("Namen speichern")}><Icon name="check" /></button></div>
  </form>;
}

/**
 * Which widget lies over which: the widgets from front (top) to back, sorted by dragging a row or ↑ ↓ on its grip.
 * Only where widgets overlap on the desktop does it show.
 */
function WidgetLayers({ state, disabled, onOrder }: {state: DesktopWidgetState; disabled: boolean; onOrder(ids: string[]): Promise<void>}) {
  useLanguage();
  const layers = widgetsByLayer(state.widgets);
  const move = (from: number, to: number) => onOrder(moveTo(layers, from, to).map(widget => widget.id));
  const drag = useSortRows(move);
  if (layers.length < 2) return null;
  return <section className="widgets-layers" aria-labelledby="widget-layers-title">
    <div className="setting-label"><span id="widget-layers-title">{t("Ebenen")}</span><small>{t("Wo sich Widgets überlappen, liegt das obere in dieser Liste vorne. Zum Ändern ziehen.")}</small></div>
    <ol className="widgets-layer-list" aria-disabled={disabled || undefined}>
      {layers.map((widget, index) => { const info = widgetTypeInfo(widget.kind), name = widgetDisplayName(widget, state.widgets); return <li key={widget.id} className={`widgets-layer${widget.enabled ? '' : ' is-hidden'}`} data-sort-item={widget.id} data-widget-layer={widget.id} onPointerDown={disabled ? undefined : drag}>
        <SortHandle name={name} index={index} count={layers.length} onMove={move} />
        <Icon name={info.icon} /><span className="widgets-layer-name">{name}</span>
        <small>{index === 0 ? t("vorne") : index === layers.length - 1 ? t("hinten") : ''}{!widget.enabled && <em>{t("ausgeblendet")}</em>}</small>
      </li>; })}
    </ol>
  </section>;
}

/** A slider of the transparent look, with its value in px. */
function GlassSlider({ id, setting, label, hint, value, range, before, onChange }: {id: string; setting: string; label: string; hint: string; value: number; range: readonly [number, number]; before?: ReactNode; onChange(value: number): void}) {
  return <div className="setting-row widgets-glass-slider"><div className="setting-label"><label htmlFor={id}>{label}</label><small>{hint}</small></div>
    <div className="setting-control">{before}<input id={id} type="range" min={range[0]} max={range[1]} step={1} value={value} data-widget-setting={setting} style={{'--fill': `${(value - range[0]) / (range[1] - range[0]) * 100}%`} as CSSProperties}
      onChange={event => onChange(Number(event.target.value))} /><output htmlFor={id}>{value} px</output></div></div>;
}

/** The kinds a calendar widget shows, in its calendar preferences (the widget hears the change by the storage event). */
function useCalendarKinds(id: string): [CalendarKinds, (kind: EntryKind) => void] {
  const key = calendarWidgetPreferencesKey(id);
  const [kinds, setKinds] = useState(() => loadCalendarPreferences(key).kinds);
  useEffect(() => {
    setKinds(loadCalendarPreferences(key).kinds);
    const changed = (event: StorageEvent) => {if (event.key === key || event.key === null) setKinds(loadCalendarPreferences(key).kinds);};
    window.addEventListener('storage', changed);return () => window.removeEventListener('storage', changed);
  }, [key]);
  const toggle = (kind: EntryKind) => {
    const prefs = loadCalendarPreferences(key), next = {...prefs.kinds, [kind]: !prefs.kinds[kind]};
    try {localStorage.setItem(key, JSON.stringify({...prefs, kinds: next}));} catch { /* shown for this session only */ }
    setKinds(next);
  };
  return [kinds, toggle];
}

function CalendarKindsSetting({ widget }: {widget: DesktopWidgetInstance}) {
  useLanguage();
  const [kinds, toggle] = useCalendarKinds(widget.id);
  const names: Record<EntryKind, string> = {event: t('Ereignisse'), task: t('Aufgaben'), note: t('Notizen')};
  return <div className="setting-row"><div className="setting-label"><span>{t("Angezeigte Einträge")}</span><small>{t("Welche Arten von Einträgen der Kalender zeigt.")}</small></div>
    <div className="setting-control widgets-kinds" role="group" aria-label={t("Angezeigte Einträge")}>
      {(['event', 'task', 'note'] as EntryKind[]).map(kind => <button key={kind} type="button" aria-pressed={kinds[kind]} data-widget-kind={kind} onClick={() => toggle(kind)}><Icon name={kind} />{names[kind]}</button>)}
    </div></div>;
}

/**
 * What the widget itself shows, kept out of the widget so it stays quiet: the "open in Journal" button in its header,
 * which tags it shows and, for a calendar, which kinds of entries.
 */
function WidgetDisplay({ widget }: {widget: DesktopWidgetInstance}) {
  useLanguage();
  const [chrome, setChrome] = useWidgetChrome(widget.id);
  const [hidden, setHidden] = useHiddenTags(`widget-${widget.id}`);
  // Day values and activities have no tags.
  const tagged = widget.kind !== 'day-values' && widget.kind !== 'activities';
  return <div className="widgets-display">
    <div className="setting-row"><div className="setting-label"><span id={`widget-open-${widget.id}`}>{t("Knopf „In Journal öffnen“")}</span><small>{t("In der Kopfzeile des Widgets, neben der Navigation.")}</small></div>
      <div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby={`widget-open-${widget.id}`} aria-checked={chrome.openButton} data-widget-setting="open-button" onClick={() => setChrome({openButton: !chrome.openButton})}><span /></button></div></div>
    <div className="setting-row"><div className="setting-label"><span id={`widget-glass-${widget.id}`}>{t("Durchsichtig")}</span><small>{t("Ohne Fläche und Rahmen: nur der Inhalt über deinem Hintergrundbild, Popups als kleine Glasflächen. Unabhängig vom Design der App.")}</small></div>
      <div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby={`widget-glass-${widget.id}`} aria-checked={chrome.glass} data-widget-setting="glass" onClick={() => setChrome({glass: !chrome.glass})}><span /></button></div></div>
    {chrome.glass && <div className="setting-row widgets-glass-text"><div className="setting-label"><span>{t("Schrift")}</span><small>{t("Hell für ein dunkles Hintergrundbild, dunkel für ein helles.")}</small></div>
      <div className="setting-control"><div className="segmented" role="radiogroup" aria-label={t("Schrift")}>
        {(['light', 'dark'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={chrome.glassText === value} data-glass-text={value} onClick={() => setChrome({glassText: value})}>{value === 'light' ? t("Hell") : t("Dunkel")}</button>)}
      </div></div></div>}
    {chrome.glass && <div className="setting-row"><div className="setting-label"><span id={`widget-glass-popups-${widget.id}`}>{t("Popups im App-Stil")}</span><small>{t("Menüs, Planer und Auswahlfenster behalten das Design der App; alles andere bleibt durchsichtig.")}</small></div>
      <div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby={`widget-glass-popups-${widget.id}`} aria-checked={chrome.glassAppPopups} data-widget-setting="glass-app-popups" onClick={() => setChrome({glassAppPopups: !chrome.glassAppPopups})}><span /></button></div></div>}
    {chrome.glass && <GlassSlider id={`widget-blur-${widget.id}`} setting="blur" label={t("Hintergrund-Blur")} hint={t("Stärke für Bild- und Wallpaper-Engine-Blur. Live Blur folgt animierten Hintergründen. 0 = ganz klar.")}
      before={<span className="widgets-live-blur"><button type="button" role="switch" className="switch" aria-label="Live Blur" aria-checked={chrome.liveBlur} data-widget-setting="live-blur" onClick={() => setChrome({liveBlur: !chrome.liveBlur})}><span /></button><span>Live Blur</span></span>}
      value={chrome.glassBlur} range={glassBlurRange} onChange={glassBlur => setChrome({glassBlur})} />}
    {chrome.glass && <GlassSlider id={`widget-radius-${widget.id}`} setting="radius" label={t("Rundung")} hint={t("Aller Kurven: Popups, Knöpfe, Felder, Einträge und Karten.")}
      value={chrome.glassRadius} range={glassRadiusRange} onChange={glassRadius => setChrome({glassRadius})} />}
    {tagged && <div className="setting-row"><div className="setting-label"><span>{t("Angezeigte Tags")}</span><small>{widget.kind === 'board' ? t("Zettel mit ausgeblendetem Tag erscheinen auf dieser Pinnwand nicht.") : widget.kind === 'notebook' ? t("Zettel mit ausgeblendetem Tag erscheinen in diesem Widget nicht.") : t("Einträge mit ausgeblendetem Tag erscheinen in diesem Widget nicht.")}</small></div>
      <div className="setting-control"><TagFilter label={t("Tags im Widget")} hidden={hidden} onChange={setHidden} /></div></div>}
    {widget.kind === 'calendar' && <CalendarKindsSetting widget={widget} />}
  </div>;
}

export function DesktopWidgetSettings({ initialWidgetId }: {initialWidgetId?: string | null}) {
  useLanguage();
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
    <div className="widgets-heading"><span className="widgets-heading-icon"><Icon name="offline" /></span><div><h3>{t("Desktop-Widgets")}</h3><p>{t("Deine Werkzeuge, direkt auf dem Desktop.")}</p></div>
      <button type="button" className="widgets-add" aria-expanded={catalog} disabled={disabled} onClick={() => setCatalog(open => !open)}><span aria-hidden="true">+</span>{t("Widget hinzufügen")}</button></div>
    {!state && !error && <p role="status" className="settings-hint">{t("Wird geladen …")}</p>}
    {state && <>
      {!state.supported && <p className="settings-hint">{t("Desktop-Widgets sind derzeit unter Windows verfügbar.")}</p>}
      {(catalog || !state.widgets.length) && <div className="widgets-catalog" aria-label={t("Verfügbare Widget-Typen")}>
        {state.types.map(type => {const info = widgetTypeInfo(type.kind);return <button type="button" key={type.kind} className="widgets-type" data-widget-type={type.kind} disabled={disabled || !type.available} onClick={() => void add(type.kind)}>
          <span className="widgets-type-top"><Icon name={info.icon} /><span className={`widgets-type-badge${type.available ? ' is-available' : ''}`}>{type.available ? t("Verfügbar") : t("Folgt später")}</span></span>
          <strong>{info.label}</strong><span>{info.description}</span>{type.available && <small>{t("+ Zum Desktop hinzufügen")}</small>}
        </button>;})}
      </div>}
      <div className="widgets-list-head"><h4>{t("Deine Widgets")}<span>{state.widgets.length}</span></h4><span>{t("{0} eingeblendet", enabled)}</span>
        {!!state.widgets.length && <div><button type="button" disabled={disabled || enabled === state.widgets.length} onClick={() => void visibility(true)}>{t("Alle einblenden")}</button><button type="button" disabled={disabled || !enabled} onClick={() => void visibility(false)}>{t("Alle ausblenden")}</button></div>}</div>
      {!state.widgets.length && <div className="widgets-empty"><Icon name="offline" /><strong>{t("Platz für dein erstes Widget")}</strong><p>{t("Wähle oben einen Typ aus. Jedes Widget behält seine eigene Position, Größe und Einstellungen.")}</p></div>}
      <div className="widgets-list">
        {state.widgets.map(widget => {
          const name = widgetDisplayName(widget, state.widgets), info = widgetTypeInfo(widget.kind), open = selected === widget.id;
          const available = state.types.some(type => type.kind === widget.kind && type.available);
          return <article key={widget.id} className={`widgets-instance${open ? ' is-selected' : ''}`} data-widget-instance={widget.id}>
            <div className="widgets-instance-head"><button type="button" className="widgets-select" aria-expanded={open} aria-controls={`widget-details-${widget.id}`} onClick={() => {setSelected(open ? null : widget.id);setRemoving(null);}}>
              <span className="widgets-instance-icon"><Icon name={info.icon} /></span><span><strong>{name}</strong><small><i className={widget.enabled ? 'is-visible' : ''} />{info.label}<span>·</span>{widget.enabled ? t("Auf dem Desktop") : t("Ausgeblendet")}</small></span><Icon name={open ? 'up' : 'down'} /></button>
              <button type="button" role="switch" className="switch" aria-label={t("{0} anzeigen", name)} aria-checked={widget.enabled} disabled={disabled || !available} onClick={() => void update(widget, {enabled: !widget.enabled})}><span /></button></div>
            {widget.error && <p className="widgets-instance-error" role="alert">{widget.error}</p>}
            {open && <div className="widgets-details" id={`widget-details-${widget.id}`}>
              <WidgetName widget={widget} disabled={disabled} onSave={name => void update(widget, {name})} />
              <WidgetDisplay widget={widget} />
              <div className="widgets-instance-actions">
                <button type="button" aria-pressed={widget.locked} disabled={disabled} onClick={() => void update(widget, {locked: !widget.locked})}><Icon name="pin" />{widget.locked ? t("Position gesperrt") : t("Position sperren")}</button>
                <button type="button" disabled={disabled} onClick={() => void update(widget, {reset: true})}><Icon name="undo" />{t("Position zurücksetzen")}</button>
                <button type="button" disabled={disabled || !available} onClick={() => void add(widget.kind, widget.id)}><Icon name="copy" />{t("Duplizieren")}</button>
                <button type="button" className="is-danger" disabled={disabled} onClick={() => setRemoving(widget.id)}><Icon name="trash" />{t("Entfernen")}</button>
              </div>
              {removing === widget.id && <div className="widgets-remove" role="group" aria-label={t("Widget entfernen")}><p>{t("Dieses Widget entfernen? Deine Notizen und Einträge bleiben gespeichert.")}</p><button type="button" disabled={disabled} onClick={() => setRemoving(null)}>{t("Abbrechen")}</button><button type="button" className="is-danger" disabled={disabled} onClick={() => void run(async () => {await flushHistoryWindows(new Set(['main', `widget-${widget.id}`]));return removeDesktopWidget(widget.id);})}>{t("Widget entfernen")}</button></div>}
              <p className="widgets-placement">{widget.placement ? `${Math.round(widget.placement.width)} × ${Math.round(widget.placement.height)} · ${t("Position auf diesem Gerät gespeichert")}` : t("Position und Größe werden automatisch gespeichert.")}</p>
            </div>}
          </article>;
        })}
      </div>
      <WidgetLayers state={state} disabled={disabled} onOrder={ids => run(() => setDesktopWidgetLayers(ids))} />
      <div className="widgets-global"><div className="setting-row"><div className="setting-label"><span id="widget-autostart">{t("Mit Windows starten")}</span><small>{t("Stellt alle eingeblendeten Widgets wieder her. Journal startet im Hintergrund.")}</small></div><div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby="widget-autostart" aria-checked={state.autostart} disabled={disabled} onClick={() => void run(() => updateDesktopWidget({autostart: !state.autostart}, null))}><span /></button></div></div></div>
      <p className="settings-hint widgets-footnote">{t("Verschiebe Widgets über den freien Teil ihrer Kopfzeile und ändere die Größe an den Rändern. Ein Rechtsklick auf die Kopfzeile sperrt, blendet aus oder öffnet diese Einstellungen. Über das Menü im Infobereich erreichst du die Verwaltung auch bei ausgeblendetem Journal.")}</p>
    </>}
    {(error || state?.error) && <p className="error" role="alert">{error || state?.error}</p>}
  </section>;
}
