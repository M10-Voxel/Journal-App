import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLanguage } from '../i18n';
import { createDesktopWidget, removeDesktopWidget, updateDesktopWidget, useDesktopWidgetState, widgetDisplayName, widgetTypeInfo } from '../desktopWidgets';
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
  const en = useLanguage() === 'en', [value, setValue] = useState(widget.name);
  useEffect(() => setValue(widget.name), [widget.name]);
  return <form className="widgets-name" onSubmit={event => {event.preventDefault(); if (!disabled && value.trim() !== widget.name) onSave(value.trim());}}>
    <label htmlFor={`widget-name-${widget.id}`}>Name</label>
    <div><input id={`widget-name-${widget.id}`} value={value} maxLength={80} placeholder={en ? 'Use the widget type name' : 'Name des Widget-Typs verwenden'} disabled={disabled} onChange={event => setValue(event.target.value)} onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();setValue(widget.name);}}} />
      <button type="submit" disabled={disabled || value.trim() === widget.name} aria-label={en ? 'Save name' : 'Namen speichern'} title={en ? 'Save name' : 'Namen speichern'}><Icon name="check" /></button></div>
  </form>;
}

/** A slider of the transparent look, with its value in px. */
function GlassSlider({ id, setting, label, hint, value, range, onChange }: {id: string; setting: string; label: string; hint: string; value: number; range: readonly [number, number]; onChange(value: number): void}) {
  return <div className="setting-row widgets-glass-slider"><div className="setting-label"><label htmlFor={id}>{label}</label><small>{hint}</small></div>
    <div className="setting-control"><input id={id} type="range" min={range[0]} max={range[1]} step={1} value={value} data-widget-setting={setting} style={{'--fill': `${(value - range[0]) / (range[1] - range[0]) * 100}%`} as CSSProperties}
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
  const en = useLanguage() === 'en';
  const [kinds, toggle] = useCalendarKinds(widget.id);
  const names: Record<EntryKind, string> = en ? {event: 'Events', task: 'Tasks', note: 'Notes'} : {event: 'Ereignisse', task: 'Aufgaben', note: 'Notizen'};
  return <div className="setting-row"><div className="setting-label"><span>{en ? 'Entries shown' : 'Angezeigte Einträge'}</span><small>{en ? 'Which kinds of entries the calendar shows.' : 'Welche Arten von Einträgen der Kalender zeigt.'}</small></div>
    <div className="setting-control widgets-kinds" role="group" aria-label={en ? 'Entries shown' : 'Angezeigte Einträge'}>
      {(['event', 'task', 'note'] as EntryKind[]).map(kind => <button key={kind} type="button" aria-pressed={kinds[kind]} data-widget-kind={kind} onClick={() => toggle(kind)}><Icon name={kind} />{names[kind]}</button>)}
    </div></div>;
}

/**
 * What the widget itself shows, kept out of the widget so it stays quiet: the "open in Journal" button in its header,
 * which tags it shows and, for a calendar, which kinds of entries.
 */
function WidgetDisplay({ widget }: {widget: DesktopWidgetInstance}) {
  const en = useLanguage() === 'en';
  const [chrome, setChrome] = useWidgetChrome(widget.id);
  const [hidden, setHidden] = useHiddenTags(`widget-${widget.id}`);
  // Day values and activities have no tags.
  const tagged = widget.kind !== 'day-values' && widget.kind !== 'activities';
  return <div className="widgets-display">
    <div className="setting-row"><div className="setting-label"><span id={`widget-open-${widget.id}`}>{en ? 'Button "Open in Journal"' : 'Knopf „In Journal öffnen“'}</span><small>{en ? 'In the widget header, beside the navigation.' : 'In der Kopfzeile des Widgets, neben der Navigation.'}</small></div>
      <div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby={`widget-open-${widget.id}`} aria-checked={chrome.openButton} data-widget-setting="open-button" onClick={() => setChrome({openButton: !chrome.openButton})}><span /></button></div></div>
    <div className="setting-row"><div className="setting-label"><span id={`widget-glass-${widget.id}`}>{en ? 'Transparent' : 'Durchsichtig'}</span><small>{en ? 'No background or frame: only the content over your wallpaper, popups as small glass panels. Independent of the app’s design.' : 'Ohne Fläche und Rahmen: nur der Inhalt über deinem Hintergrundbild, Popups als kleine Glasflächen. Unabhängig vom Design der App.'}</small></div>
      <div className="setting-control"><button type="button" role="switch" className="switch" aria-labelledby={`widget-glass-${widget.id}`} aria-checked={chrome.glass} data-widget-setting="glass" onClick={() => setChrome({glass: !chrome.glass})}><span /></button></div></div>
    {chrome.glass && <div className="setting-row widgets-glass-text"><div className="setting-label"><span>{en ? 'Type' : 'Schrift'}</span><small>{en ? 'Light for a dark wallpaper, dark for a light one.' : 'Hell für ein dunkles Hintergrundbild, dunkel für ein helles.'}</small></div>
      <div className="setting-control"><div className="segmented" role="radiogroup" aria-label={en ? 'Type' : 'Schrift'}>
        {(['light', 'dark'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={chrome.glassText === value} data-glass-text={value} onClick={() => setChrome({glassText: value})}>{value === 'light' ? en ? 'Light' : 'Hell' : en ? 'Dark' : 'Dunkel'}</button>)}
      </div></div></div>}
    {chrome.glass && <GlassSlider id={`widget-blur-${widget.id}`} setting="blur" label={en ? 'Background blur' : 'Hintergrund-Blur'} hint={en ? 'A constant frosted background: how strongly your wallpaper behind the widget is blurred. 0 = fully clear.' : 'Konstanter Milchglas-Hintergrund: wie stark dein Hintergrundbild hinter dem Widget weichgezeichnet wird. 0 = ganz klar.'}
      value={chrome.glassBlur} range={glassBlurRange} onChange={glassBlur => setChrome({glassBlur})} />}
    {chrome.glass && <GlassSlider id={`widget-radius-${widget.id}`} setting="radius" label={en ? 'Rounding' : 'Rundung'} hint={en ? 'Of every curve: popups, buttons, fields, entries and cards.' : 'Aller Kurven: Popups, Knöpfe, Felder, Einträge und Karten.'}
      value={chrome.glassRadius} range={glassRadiusRange} onChange={glassRadius => setChrome({glassRadius})} />}
    {tagged && <div className="setting-row"><div className="setting-label"><span>{en ? 'Tags shown' : 'Angezeigte Tags'}</span><small>{widget.kind === 'board' ? en ? 'Notes with a hidden tag stay off this pinboard.' : 'Zettel mit ausgeblendetem Tag erscheinen auf dieser Pinnwand nicht.' : widget.kind === 'notebook' ? en ? 'Notes with a hidden tag stay out of this widget.' : 'Zettel mit ausgeblendetem Tag erscheinen in diesem Widget nicht.' : en ? 'Entries with a hidden tag stay out of this widget.' : 'Einträge mit ausgeblendetem Tag erscheinen in diesem Widget nicht.'}</small></div>
      <div className="setting-control"><TagFilter label={en ? 'Tags in the widget' : 'Tags im Widget'} hidden={hidden} onChange={setHidden} /></div></div>}
    {widget.kind === 'calendar' && <CalendarKindsSetting widget={widget} />}
  </div>;
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
              <WidgetDisplay widget={widget} />
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
      <p className="settings-hint widgets-footnote">{en ? 'Move widgets by the free part of their headers and resize them at the edges. A right click on the header locks, hides or opens these settings. Use the tray menu to manage widgets while Journal is hidden.' : 'Verschiebe Widgets über den freien Teil ihrer Kopfzeile und ändere die Größe an den Rändern. Ein Rechtsklick auf die Kopfzeile sperrt, blendet aus oder öffnet diese Einstellungen. Über das Menü im Infobereich erreichst du die Verwaltung auch bei ausgeblendetem Journal.'}</p>
    </>}
    {(error || state?.error) && <p className="error" role="alert">{error || state?.error}</p>}
  </section>;
}
