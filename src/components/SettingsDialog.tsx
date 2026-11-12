import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { pixelActive, swipeAvailable, themes, withTheme } from '../settings';
import type { PopupStyle, Settings, Theme } from '../settings';
import type { ActionLayout } from './EntryActionDock';
import type { BookView } from './JournalBook';
import type { CalendarImport } from '../journal';
import { DriveSettings } from './DriveSettings';
import { MailSettings } from './MailSettings';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { ColorSettings } from './ColorSettings';
import { TagSettings } from './TagSettings';
import { factorOf, screenWidth } from '../uiScale';
import type { UiScale } from '../uiScale';
import { ScaleSettings } from './ScaleSettings';
import { ActivitySettings } from './ActivitySettings';
import { StorageSettings } from './StorageSettings';
import { UpdateSettings } from './UpdateSettings';
import { DesktopWidgetSettings } from './DesktopWidgetSettings';
import '../settings.css';

const tabs = ['appearance', 'colors', 'tags', 'activities', 'scales', 'widgets', 'storage', 'drive', 'mail', 'updates'] as const;
export type SettingsTab = typeof tabs[number];
const tabInfo = (): Record<SettingsTab, { icon: IconName; label: string }> => ({
  appearance: { icon: 'layout', label: t("Darstellung") }, colors: { icon: 'pencil', label: t('Farben') }, tags: { icon: 'tag', label: t('Tags') },
  widgets: { icon: 'offline', label: 'Desktop-Widgets' },
  activities: { icon: 'check', label: t('Aktivitäten') }, scales: { icon: 'week', label: t('Tageswerte') }, storage: { icon: 'save', label: t('Speicherort') }, drive: { icon: 'transfer', label: 'Google Drive' }, mail: { icon: 'mail', label: t("E-Mail-Konten") }, updates: { icon: 'repeat', label: t('Updates') },
});

const themeInfo = (): Record<Theme, { title: string; text: string }> => ({
  classic: { title: t('Normal'), text: t('Klar und kompakt') },
  journal: { title: 'Journal', text: t('Ein Buch zum Umblättern') },
  nebula: { title: 'Nebula', text: t('Y2K · Cybercore · Brutalismus') },
});

const layouts = (): { value: ActionLayout; title: string; text: string }[] => ([
  { value: 'orbit', title: 'Orbit', text: t("Aktionen kreisen um den Punkt.") },
  { value: 'inline', title: t("Eingebettet"), text: t("Eine Zeile Wörter unter dem Eintrag.") },
  // Swiping stays for touch screens (the Android version); on the desktop it is not offered (settings.ts).
  ...swipeAvailable() ? [{ value: 'swipe' as const, title: t("Wischen"), text: t("Den Punkt zur Seite ziehen.") }] : [],
]);

/** The two looks of the popups in each design (popup-styles.css). */
const popupStyles = (theme: Theme): { value: PopupStyle; title: string; text: string }[] => ({
  classic: [{ value: 'a' as const, title: t('Karte'), text: t('Fest, mit weichem Schatten') }, { value: 'b' as const, title: t('Glas'), text: t('Durchscheinend und hell umrandet') }],
  journal: [{ value: 'a' as const, title: t('Karteikarte'), text: t('Papier mit rotem Rand') }, { value: 'b' as const, title: t('Notizblock'), text: t('Gelbes Blatt mit Ringbindung') }],
  nebula: [{ value: 'a' as const, title: 'Terminal', text: t('Schwarzes Fenster mit Prompt') }, { value: 'b' as const, title: t('Holo-Papier'), text: t('Graues Papier, violetter Balken') }],
})[theme];

/** Arrow keys move through a row of radio buttons (the options' order), like a native radio group. */
function arrowStep<T>(event: KeyboardEvent, values: readonly T[], current: T): T | null {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return null;
  event.preventDefault();
  const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  return values[(values.indexOf(current) + step + values.length) % values.length];
}

/** One setting: its name (and a short note) on the left, its control on the right. */
function SettingRow({ label, id, note, children }: { label: string; id: string; note?: ReactNode; children: ReactNode }) {
  return <div className="setting-row">
    <div className="setting-label"><span id={id}>{label}</span>{note && <small>{note}</small>}</div>
    <div className="setting-control">{children}</div>
  </div>;
}

/** A few choices side by side (language, book view …); `attribute` names the data attribute each option carries. */
function Segmented<T extends string>({ labelledBy, value, options, attribute, onChange }: {
  labelledBy: string; value: T; options: readonly { value: T; label: string }[]; attribute: string; onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref} className="segmented" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={event => {
    const next = arrowStep(event, options.map(option => option.value), value);
    if (next === null) return;
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[${attribute}="${next}"]`)?.focus());
  }}>
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1}
      {...{ [attribute]: option.value }} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

// Small previews of the layouts, drawn like the real thing: the entry's dot, a text line and its actions.
function Preview({ layout }: { layout: ActionLayout }) {
  useLanguage();
  return <svg className="settings-preview" viewBox="0 0 120 64" aria-hidden="true">
    <rect x="44" y="18" width="62" height="4" rx="2" className="preview-text" />
    {layout === 'swipe' ? <>
      <rect x="2" y="10" width="34" height="20" rx="4" className="preview-lane" />
      <path d="M8 20h10m-3-3 3 3-3 3" className="preview-thread" />
      <rect x="30" y="10" width="88" height="20" rx="4" className="preview-row" />
      <rect x="52" y="18" width="54" height="4" rx="2" className="preview-text" />
      <circle cx="40" cy="20" r="3.5" className="preview-dot" />
      <path d="M40 42h-14m4-4-4 4 4 4M40 42h14m-4-4 4 4-4 4" className="preview-thread" />
    </> : layout === 'inline' ? <>
      <path d="M24 26v13.5h12" className="preview-thread" />
      {[40, 58, 76, 94].map((x, index) => <rect key={x} x={x} y="38" width={index === 0 ? 14 : 12} height="3" rx="1.5" className={index === 1 ? 'preview-satellite' : 'preview-text'} />)}
      <rect x="44" y="50" width="48" height="4" rx="2" className="preview-text" />
    </> : <>
      <circle cx="24" cy="20" r="14" className="preview-orbit" />
      {[270, 315, 45, 90, 135, 180, 225].map(angle => <circle key={angle} cx={24 + 14 * Math.cos(angle * Math.PI / 180)} cy={20 + 14 * Math.sin(angle * Math.PI / 180)} r="4" className="preview-satellite" />)}
      <rect x="82" y="30" width="24" height="9" rx="4.5" className="preview-pill" />
    </>}
    <circle cx="24" cy="20" r="3.5" className="preview-dot" />
  </svg>;
}

export function SettingsDialog({ settings, onChange, onClose, onImport, mailStatus, beforeSync, onDriveBusy, initialTab = 'appearance', initialWidgetId, bookView = 'double', onBookView }: { bookView?: BookView; onBookView?: (view: BookView) => void; beforeSync: () => Promise<void>; onDriveBusy: (busy: boolean) => void; initialTab?: SettingsTab; initialWidgetId?: string | null; settings: Settings; onChange: (settings: Settings) => void; onClose: () => void; onImport: (entries: CalendarImport[]) => Promise<void>; mailStatus: { count: number; error: string } }) {
  useLanguage();
  const [driveBusy, setDriveBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [screenSize, setScreenSize] = useState(1920);
  useEffect(() => { void screenWidth().then(setScreenSize); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const selector = initialTab === 'tags' ? '#settings-tags .tag-name' : initialTab === 'activities' ? '#settings-activities input' : initialTab === 'scales' ? '#settings-scales input' : '[data-theme-choice][aria-checked="true"]';
    (dialogRef.current?.querySelector<HTMLElement>(selector) ?? dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const show = (next: SettingsTab) => { setTab(next); requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>(`#settings-${next}-tab`)?.focus()); };
  const scale = Math.round(factorOf(settings.uiScale, screenSize, pixelActive(settings)) * 100);
  const info = tabInfo();

  const appearance = <>
    <section className="settings-section">
      <h3 id="settings-theme">{t('Design')}</h3>
      <div className="theme-options" role="radiogroup" aria-labelledby="settings-theme" onKeyDown={event => {
        const theme = arrowStep(event, themes, settings.theme);
        if (theme === null) return;
        onChange(withTheme(settings, theme));
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-theme-choice="${theme}"]`)?.focus());
      }}>
        {themes.map(theme => <button key={theme} type="button" role="radio" aria-checked={settings.theme === theme} tabIndex={settings.theme === theme ? 0 : -1} data-theme-choice={theme}
          onClick={() => onChange(withTheme(settings, theme))}>
          <span className={`theme-sample is-${theme}${settings.pixel && theme !== 'nebula' ? ' is-pixel' : ''}`} aria-hidden="true"><span>Aa</span><i /><i /><i /></span>
          <strong>{themeInfo()[theme].title}</strong>
          <small>{themeInfo()[theme].text}</small>
        </button>)}
      </div>
      <SettingRow id="settings-pixel" label={t('Pixel-Look')} note={settings.theme === 'nebula' ? t('Nebula hat eine eigene Schrift; gilt für Normal und Journal') : t('Pixelschrift, eckige Formen, Bewegung in Stufen')}>
        <button type="button" role="switch" className="switch" aria-checked={settings.pixel} aria-labelledby="settings-pixel" data-pixel-toggle disabled={settings.theme === 'nebula'} onClick={() => onChange({ ...settings, pixel: !settings.pixel })}><span /></button>
      </SettingRow>
      <h3 id="settings-popups" className="settings-subhead">{t('Popups')}</h3>
      <p className="settings-hint">{t('Planer, Kalendereinträge und Auswahlen')}</p>
      <div className="popup-style-options" role="radiogroup" aria-labelledby="settings-popups" onKeyDown={event => {
        const next = arrowStep(event, ['a', 'b'] as const, settings.popupStyle);
        if (next === null) return;
        onChange({ ...settings, popupStyle: next });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-popup-style="${next}"]`)?.focus());
      }}>
        {popupStyles(settings.theme).map(option => <button key={option.value} type="button" role="radio" aria-checked={settings.popupStyle === option.value} tabIndex={settings.popupStyle === option.value ? 0 : -1}
          data-popup-style={option.value} onClick={() => onChange({ ...settings, popupStyle: option.value })}>
          <span className={`popup-sample is-${settings.theme}-${option.value}`} aria-hidden="true"><b /><span>{Array.from({ length: 14 }, (_, index) => <i key={index} className={index === 9 ? 'is-on' : undefined} />)}</span><em /></span>
          <strong>{option.title}</strong>
          <small>{option.text}</small>
        </button>)}
      </div>
    </section>
    {settings.theme === 'journal' && <section className="settings-section">
      <h3>{t('Buch')}</h3>
      <SettingRow id="settings-book-view" label={t('Ansicht')} note={t('Im schmalen Fenster immer eine Seite')}>
        <Segmented labelledBy="settings-book-view" attribute="data-book-view" value={bookView} onChange={view => onBookView?.(view)}
          options={[{ value: 'double', label: t('Doppelseite') }, { value: 'single', label: t('Einzelseite') }]} />
      </SettingRow>
      <SettingRow id="settings-book-paging" label={t('Blättern')} note={t('Auf einmal: Die Pinnwand liegt über beiden Seiten')}>
        <Segmented labelledBy="settings-book-paging" attribute="data-book-paging" value={settings.bookPaging} onChange={bookPaging => onChange({ ...settings, bookPaging })}
          options={[{ value: 'page', label: t('Seite für Seite') }, { value: 'spread', label: t('Beide auf einmal') }]} />
      </SettingRow>
    </section>}
    <section className="settings-section">
      <h3>{t('Allgemein')}</h3>
      <SettingRow id="settings-language" label={t("Sprache")}>
        <Segmented labelledBy="settings-language" attribute="data-language" value={settings.language} onChange={language => onChange({ ...settings, language })}
          options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
      </SettingRow>
      <SettingRow id="settings-scale" label={t('Größe')} note={<><kbd>{t('Strg')}</kbd> <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></>}>
        <div className="scale-options scale-slider">
          <input type="range" min="75" max="200" step="1" aria-labelledby="settings-scale" value={scale} onChange={event => onChange({ ...settings, uiScale: event.target.value as UiScale })} />
          <output>{scale} %</output>
          <button type="button" aria-pressed={settings.uiScale === 'auto'} title={t('Nach dem Bildschirm richten')} onClick={() => onChange({ ...settings, uiScale: 'auto' })}>{t('Automatisch')}</button>
        </div>
      </SettingRow>
    </section>
    <section className="settings-section">
      <h3>{t('Handschrift')}</h3>
      <SettingRow id="settings-ink-pressure" label={t('Druckempfindlichkeit')} note={t('Füller-Strich, der mit dem Stiftdruck breiter wird; aus: gleichmäßige Breite')}>
        <button type="button" role="switch" className="switch" aria-checked={settings.inkPressure} aria-labelledby="settings-ink-pressure" data-ink-pressure onClick={() => onChange({ ...settings, inkPressure: !settings.inkPressure })}><span /></button>
      </SettingRow>
    </section>
    {/* How an entry's actions open follows the popup look above; only touch screens choose swiping here. */}
    {swipeAvailable() && <section className="settings-section">
      <h3 id="settings-layout">{t("Aktionen am Eintrag")}</h3>
      <div className="settings-options" role="radiogroup" aria-labelledby="settings-layout" onKeyDown={event => {
        const next = arrowStep(event, layouts().map(layout => layout.value), settings.actionLayout);
        if (next === null) return;
        onChange({ ...settings, actionLayout: next });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('.settings-option[aria-checked="true"]')?.focus());
      }}>
        {layouts().map(layout => <button key={layout.value} type="button" role="radio" className="settings-option" aria-checked={settings.actionLayout === layout.value}
          tabIndex={settings.actionLayout === layout.value ? 0 : -1} data-layout={layout.value} onClick={event => { event.currentTarget.focus(); onChange({ ...settings, actionLayout: layout.value }); }}>
          <Preview layout={layout.value} />
          <strong>{layout.title}</strong>
          <span>{layout.text}</span>
        </button>)}
      </div>
    </section>}
  </>;

  const panels: Record<SettingsTab, ReactNode> = {
    appearance, colors: <ColorSettings settings={settings} onChange={onChange} />, tags: <TagSettings />, activities: <ActivitySettings />, scales: <ScaleSettings />,
    storage: <StorageSettings beforeChange={beforeSync} onBusy={value => { setDriveBusy(value); onDriveBusy(value); }} />,
    updates: <UpdateSettings beforeChange={beforeSync} onBusy={value => { setDriveBusy(value); onDriveBusy(value); }} />,
    widgets: <DesktopWidgetSettings initialWidgetId={initialWidgetId} />,
    drive: <DriveSettings beforeSync={beforeSync} onBusy={value => { setDriveBusy(value); onDriveBusy(value); }} />,
    mail: <MailSettings onImport={onImport} importError={mailStatus.error} />,
  };

  return <div className="shortcut-backdrop" onPointerDown={event => { if (!driveBusy && event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts settings dialog-panes" role="dialog" aria-modal="true" aria-label={t("Einstellungen")} tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!driveBusy) onClose(); } }}>
      <div className="settings-head">
        <Icon name="settings" /><strong>{t("Einstellungen")}</strong>
        <span className="settings-keys"><kbd>{t("Strg")}</kbd> <kbd>,</kbd></span>
        <button type="button" className="settings-close" disabled={driveBusy} aria-label={t("Einstellungen schließen")} title={t("Schließen · Esc")} onClick={onClose}><Icon name="done" /></button>
      </div>
      <div className="settings-body">
        <div className="settings-tabs" inert={driveBusy} role="tablist" aria-label={t("Einstellungsbereich")} aria-orientation="vertical" onKeyDown={event => {
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); show(event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1]); return; }
          const next = arrowStep(event, tabs, tab);
          if (next !== null) show(next);
        }}>
          {tabs.map(id => <button key={id} id={`settings-${id}-tab`} type="button" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`settings-${id}`}
            onClick={event => { event.currentTarget.focus(); setTab(id); }}>
            <Icon name={info[id].icon} />{info[id].label}{id === 'mail' && mailStatus.count > 0 && <span className="mail-badge">{mailStatus.count}</span>}
          </button>)}
        </div>
        <div className="settings-panel" role="tabpanel" id={`settings-${tab}`} aria-labelledby={`settings-${tab}-tab`}>{panels[tab]}</div>
      </div>
    </div>
  </div>;
}
