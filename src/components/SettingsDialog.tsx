import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { themes, withTheme } from '../settings';
import type { Settings, Theme } from '../settings';
import type { ActionLayout } from './EntryActionDock';
import type { BookView } from './JournalBook';
import type { CalendarImport } from '../journal';
import { DriveSettings } from './DriveSettings';
import { MailSettings } from './MailSettings';
import { Icon } from './Icon';
import { ColorSettings } from './ColorSettings';
import { TagSettings } from './TagSettings';
import { factorOf, screenWidth } from '../uiScale';
import type { UiScale } from '../uiScale';
import { ActivitySettings } from './ActivitySettings';

const tabs = ['appearance', 'colors', 'tags', 'activities', 'drive', 'mail'] as const;
export type SettingsTab = typeof tabs[number];

const layouts = (): { value: ActionLayout; title: string; text: string }[] => ([
  { value: 'orbit', title: 'Orbit', text: t("Aktionen kreisen um den Punkt, Planen sitzt am Zeilenende.") },
  { value: 'inline', title: t("Eingebettet"), text: t("Eine Zeile Wörter im Text, ohne Fenster.") },
  { value: 'swipe', title: t("Wischen"), text: t("Punkt zur Seite ziehen: rechts erledigen, links planen oder löschen. Antippen schaltet weiter.") },
]);

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

export function SettingsDialog({ settings, onChange, onClose, onImport, mailStatus, beforeSync, onDriveBusy, initialTab = 'appearance', bookView = 'double', onBookView }: { bookView?: BookView; onBookView?: (view: BookView) => void; beforeSync: () => Promise<void>; onDriveBusy: (busy: boolean) => void; initialTab?: SettingsTab; settings: Settings; onChange: (settings: Settings) => void; onClose: () => void; onImport: (entries: CalendarImport[]) => Promise<void>; mailStatus: { count: number; error: string } }) {
  const language = useLanguage();
  const [driveBusy, setDriveBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<string>(initialTab);
  const [screenSize, setScreenSize] = useState(1920);
  useEffect(() => { void screenWidth().then(setScreenSize); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const selector = initialTab === 'tags' ? '#settings-tags .tag-name' : initialTab === 'activities' ? '#settings-activities input' : '.settings-option[aria-checked="true"]';
    (dialogRef.current?.querySelector<HTMLElement>(selector) ?? dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts settings dialog-panes" role="dialog" aria-modal="true" aria-label={t("Einstellungen")} tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="settings-head">
        <Icon name="settings" /><strong>{t("Einstellungen")}</strong>
        <span className="settings-keys"><kbd>{t("Strg")}</kbd> <kbd>,</kbd></span>
        <button type="button" className="settings-close" disabled={driveBusy} aria-label={t("Einstellungen schließen")} title={t("Schließen · Esc")} onClick={onClose}><Icon name="done" /></button>
      </div>
      <div className="settings-body">
      <div className="settings-tabs" inert={driveBusy} role="tablist" aria-label={t("Einstellungsbereich")} aria-orientation="vertical" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = event.key === 'Home' ? 'appearance' : event.key === 'End' ? 'mail' : tabs[(tabs.indexOf(tab as typeof tabs[number]) + step + tabs.length) % tabs.length];
        setTab(next); dialogRef.current?.querySelector<HTMLButtonElement>(`#settings-${next}-tab`)?.focus();
      }}>
        <button id="settings-appearance-tab" type="button" role="tab" tabIndex={tab === 'appearance' ? 0 : -1} aria-selected={tab === 'appearance'} aria-controls="settings-appearance" onClick={event => { event.currentTarget.focus(); setTab('appearance'); }}><Icon name="layout" />{t("Darstellung")}</button>
        <button id="settings-colors-tab" type="button" role="tab" tabIndex={tab === 'colors' ? 0 : -1} aria-selected={tab === 'colors'} aria-controls="settings-colors" onClick={event => { event.currentTarget.focus(); setTab('colors'); }}><Icon name="pencil" />{t('Farben')}</button>
        <button id="settings-tags-tab" type="button" role="tab" tabIndex={tab === 'tags' ? 0 : -1} aria-selected={tab === 'tags'} aria-controls="settings-tags" onClick={event => { event.currentTarget.focus(); setTab('tags'); }}><Icon name="tag" />{t('Tags')}</button>
        <button id="settings-activities-tab" type="button" role="tab" tabIndex={tab === 'activities' ? 0 : -1} aria-selected={tab === 'activities'} aria-controls="settings-activities" onClick={event => { event.currentTarget.focus(); setTab('activities'); }}><Icon name="check" />{language === 'en' ? 'Activities' : 'Aktivit\u00e4ten'}</button>
        <button type="button" id="settings-drive-tab" role="tab" aria-selected={tab === 'drive'} tabIndex={tab === 'drive' ? 0 : -1} onClick={() => setTab('drive')}><Icon name="transfer" />Google Drive</button>
        <button id="settings-mail-tab" type="button" role="tab" tabIndex={tab === 'mail' ? 0 : -1} aria-selected={tab === 'mail'} aria-controls="settings-mail" onClick={event => { event.currentTarget.focus(); setTab('mail'); }}><Icon name="mail" />{t("E-Mail-Konten")}{mailStatus.count > 0 && <span className="mail-badge">{mailStatus.count}</span>}</button>
      </div>
      {tab === 'appearance' ? <div className="settings-panel" role="tabpanel" id="settings-appearance" aria-labelledby="settings-appearance-tab">
      <h3 id="settings-language">{t("Anzeigesprache")}</h3>
      <div className="language-options" role="radiogroup" aria-labelledby="settings-language" onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const language = settings.language === 'de' ? 'en' : 'de';
        onChange({ ...settings, language });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-language="${language}"]`)?.focus());
      }}>
        {(['de','en'] as const).map(language => <button key={language} type="button" role="radio" data-language={language} aria-checked={settings.language === language} tabIndex={settings.language === language ? 0 : -1} onClick={() => onChange({ ...settings, language })}>{language === 'de' ? 'Deutsch' : 'English'}</button>)}
      </div>
      <h3 id="settings-theme">{t('UI-Stil')}</h3>
      <p className="settings-hint">{t('Gleiche Bedienung, ein anderer Stil. Die Farben wählst du unter „Farben“.')}</p>
      <div className="theme-options" role="radiogroup" aria-labelledby="settings-theme" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const theme: Theme = themes[(themes.indexOf(settings.theme) + step + themes.length) % themes.length];
        onChange(withTheme(settings, theme));
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-theme-choice="${theme}"]`)?.focus());
      }}>
        {themes.map(theme => <button key={theme} type="button" role="radio" aria-checked={settings.theme === theme} tabIndex={settings.theme === theme ? 0 : -1} data-theme-choice={theme}
          onClick={() => onChange(withTheme(settings, theme))}>
          <span className={`theme-sample is-${theme}`} aria-hidden="true"><span>Aa</span><i /><i /><i /></span>
          <strong>{theme === 'classic' ? t("Klassisch") : theme === 'pixel' ? 'Pixel' : 'Journal'}</strong>
          <small>{theme === 'classic' ? 'IBM Plex Sans · Lilex' : theme === 'pixel' ? 'Pixelify Sans · VT323' : t('Papier, Tinte, Seiten zum Umblättern')}</small>
        </button>)}
      </div>
      {settings.theme === 'journal' && <>
        <h3 id="settings-book-view">{t('Buchansicht')}</h3>
        <p className="settings-hint">{t('In einem schmalen Fenster zeigt das Buch immer eine Seite.')}</p>
        <div className="language-options" role="radiogroup" aria-labelledby="settings-book-view" onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const view = bookView === 'double' ? 'single' : 'double';
          onBookView?.(view);
          requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-book-view="${view}"]`)?.focus());
        }}>
          {(['double', 'single'] as const).map(view => <button key={view} type="button" role="radio" data-book-view={view} aria-checked={bookView === view} tabIndex={bookView === view ? 0 : -1}
            onClick={() => onBookView?.(view)}>{view === 'double' ? t('Doppelseite') : t('Einzelseite')}</button>)}
        </div>
        <h3 id="settings-book-paging">{t('Blättern')}</h3>
        <p className="settings-hint">{t('Beide Seiten auf einmal: Die Pinnwand liegt dann über zwei Seiten. Liegt der Kalender als Blatt auf dem Buch, zeigt es daneben eine Seite.')}</p>
        <div className="language-options" role="radiogroup" aria-labelledby="settings-book-paging" onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const bookPaging = settings.bookPaging === 'page' ? 'spread' : 'page';
          onChange({ ...settings, bookPaging });
          requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-book-paging="${bookPaging}"]`)?.focus());
        }}>
          {(['page', 'spread'] as const).map(paging => <button key={paging} type="button" role="radio" data-book-paging={paging} aria-checked={settings.bookPaging === paging} tabIndex={settings.bookPaging === paging ? 0 : -1}
            onClick={() => onChange({ ...settings, bookPaging: paging })}>{paging === 'page' ? t('Seite für Seite') : t('Beide Seiten auf einmal')}</button>)}
        </div>
      </>}
      <h3 id="settings-scale">{t('Größe')}</h3>
      <p className="settings-hint">{t('Text und Bedienelemente größer, z. B. für 4K-Bildschirme. „Automatisch“ richtet sich nach dem Bildschirm, im Pixel-Stil etwas größer. ')}<kbd>{t('Strg')}</kbd> <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd></p>
      <div className="scale-options scale-slider">
        <button type="button" aria-pressed={settings.uiScale === 'auto'} onClick={() => onChange({ ...settings, uiScale: 'auto' })}>{t('Automatisch')}</button>
        <input type="range" min="75" max="200" step="1" aria-labelledby="settings-scale" value={Math.round(factorOf(settings.uiScale, screenSize, settings.theme === 'pixel') * 100)} onChange={event => onChange({ ...settings, uiScale: event.target.value as UiScale })} />
        <output>{Math.round(factorOf(settings.uiScale, screenSize, settings.theme === 'pixel') * 100)} %</output>
      </div>
      <h3 id="settings-layout">{t("Aktionen am Eintrag")}</h3>
      <p className="settings-hint">{t("Wie sich die Aktionen eines Eintrags zeigen, wenn man auf seinen Punkt klickt. ")}<kbd>←</kbd> <kbd>→</kbd>{t(" wählt.")}</p>
      <div className="settings-options" role="radiogroup" aria-labelledby="settings-layout" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = layouts()[(layouts().findIndex(layout => layout.value === settings.actionLayout) + step + layouts().length) % layouts().length].value;
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
      </div> : tab === 'colors' ? <div className="settings-panel" role="tabpanel" id="settings-colors" aria-labelledby="settings-colors-tab"><ColorSettings settings={settings} onChange={onChange} /></div>
        : tab === 'tags' ? <div className="settings-panel" role="tabpanel" id="settings-tags" aria-labelledby="settings-tags-tab"><TagSettings /></div> : tab === 'activities' ? <div className="settings-panel" role="tabpanel" id="settings-activities" aria-labelledby="settings-activities-tab"><ActivitySettings /></div> : tab === 'drive' ? <div className="settings-panel" role="tabpanel" id="settings-drive"><DriveSettings beforeSync={beforeSync} onBusy={value => { setDriveBusy(value); onDriveBusy(value); }} /></div> : <div className="settings-panel" role="tabpanel" id="settings-mail" aria-labelledby="settings-mail-tab"><MailSettings onImport={onImport} importError={mailStatus.error} /></div>}
      </div>
    </div>
  </div>;
}
