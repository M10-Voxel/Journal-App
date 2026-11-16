import { t, useLanguage } from '../i18n';
import { enabledModes, modes, modulesOf, withModule, withView } from '../features';
import type { Features, Module } from '../features';
import type { PeriodMode } from '../periods';
import { Icon } from './Icon';
import type { IconName } from './Icon';

const modeNames = (): Record<PeriodMode, string> => ({ day: t('Tag'), week: t('Woche'), month: t('Monat'), quarter: t('Quartal'), year: t('Jahr') });
const modeIcons: Record<PeriodMode, IconName> = { day: 'journal', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };
/** What a module is called in a view, and what it does there (a period's values and checklist differ from a day's). */
function moduleInfo(module: Module, mode: PeriodMode): { label: string; note: string } {
  const day = mode === 'day';
  switch (module) {
    case 'entries': return { label: t('Einträge'), note: day ? t('Aufgaben, Ereignisse und Notizen des Tages') : t('Eine eigene Liste mit Aufgaben und Notizen für den Zeitraum') };
    case 'note': return { label: t('Notiz'), note: t('Ein freier Text') };
    case 'rating': return { label: t('Bewertung'), note: day ? t('Wie war der Tag?') : t('Eine eigene Bewertung des Zeitraums') };
    case 'scales': return { label: day ? t('Tageswerte') : t('Werte'), note: day ? t('Eigene Werte wie Stress oder Schlaf') : t('Eigene Werte für den Zeitraum, unabhängig von den Tagen') };
    case 'activities': return { label: t('Checkliste'), note: day ? t('Aktivitäten mit Zeit und Timer') : t('Zählt die Zeit der Tage zusammen; der Timer trägt am richtigen Tag ein') };
    case 'evaluation': return { label: t('Auswertung'), note: t('Verlauf der Tageswerte und Aktivitäten im Überblick') };
    case 'board': return { label: t('Pinnwand'), note: day ? t('Zettel, Bilder und Links des Tages') : t('Eine eigene Pinnwand; Zettel lassen sich darauf anheften') };
  }
}

/**
 * Einstellungen → Funktionen: the notebook and each view (day … year) on or off, and what each view shows. The calendar
 * is always there; the last view and a view's last module stay on (features.ts withView/withModule).
 */
export function FeatureSettings({ features, onChange }: { features: Features; onChange: (features: Features) => void }) {
  useLanguage();
  const names = modeNames(), lastView = enabledModes(features).length === 1;
  return <>
    <section className="settings-section">
      <h3>{t('Funktionen')}</h3>
      <p className="settings-hint">{t('Was die App zeigt. Ausgeschaltetes bleibt gespeichert und kommt beim Einschalten zurück.')}</p>
      <div className="setting-row">
        <div className="setting-label"><span id="feature-calendar">{t('Kalender')}</span><small>{t('Immer an')}</small></div>
        <div className="setting-control"><button type="button" role="switch" className="switch" aria-checked="true" aria-labelledby="feature-calendar" disabled><span /></button></div>
      </div>
      <div className="setting-row">
        <div className="setting-label"><span id="feature-notebook">{t('Notizen')}</span><small>{t('Der Notizblock mit allen Zetteln')}</small></div>
        <div className="setting-control"><button type="button" role="switch" className="switch" aria-checked={features.notebook} aria-labelledby="feature-notebook" data-feature="notebook" onClick={() => onChange({ ...features, notebook: !features.notebook })}><span /></button></div>
      </div>
    </section>
    {modes.map(mode => {
      const view = features.views[mode], last = lastView && view.on;
      return <section key={mode} className={`settings-section feature-view${view.on ? '' : ' is-off'}`} data-feature-view={mode}>
        <div className="setting-row feature-view-head">
          <div className="setting-label"><span id={`feature-${mode}`}><Icon name={modeIcons[mode]} />{names[mode]}</span>{last && <small>{t('Eine Ansicht bleibt immer an')}</small>}</div>
          <div className="setting-control"><button type="button" role="switch" className="switch" aria-checked={view.on} aria-labelledby={`feature-${mode}`} disabled={last} data-feature-mode={mode} onClick={() => onChange(withView(features, mode, !view.on))}><span /></button></div>
        </div>
        {view.on && <div className="feature-modules" role="group" aria-labelledby={`feature-${mode}`}>
          {modulesOf(mode).map(module => {
            const on = view.modules.includes(module), only = on && view.modules.length === 1, info = moduleInfo(module, mode);
            return <label key={module} className="feature-module" data-feature-module={module} title={only ? t('Mindestens ein Bereich bleibt an') : undefined}>
              <input type="checkbox" checked={on} disabled={only} onChange={event => onChange(withModule(features, mode, module, event.target.checked))} />
              <span><strong>{info.label}</strong><small>{info.note}</small></span>
            </label>;
          })}
        </div>}
      </section>;
    })}
  </>;
}
