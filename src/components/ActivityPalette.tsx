import { activityPalette, activityLevelLabel } from '../activityColors';
import { getLanguage } from '../i18n';

export function ActivityPalette({ color, trackTime, preview = false }: { color: string; trackTime: boolean; preview?: boolean }) {
  const en = getLanguage() === 'en';
  return <div className={`activity-palette${preview ? ' is-preview' : ''}`}>
    <span>{preview ? en ? 'Graph shades' : 'Graphen-Farbstufen' : en ? 'Less' : 'Weniger'}</span>
    <div className="activity-palette-swatches" role="img" aria-label={en ? 'Seven shades, darker with every 30 minutes' : 'Sieben Farbstufen, dunkler mit jeweils weiteren 30 Minuten'}>
      {activityPalette(color).map((shade, index) => <span key={index} style={{ backgroundColor: shade }} title={`${activityLevelLabel(index)} · ${shade}`} />)}
    </div>
    <span>{preview ? '180+ min' : en ? 'More' : 'Mehr'}</span>
    {preview && <small>{trackTime ? en ? '0–29 min → 180+ min · 30 minute steps' : '0–29 min → 180+ min · Schritte von 30 Minuten' : en ? 'Time tracking off: completed days use the first shade.' : 'Zeiterfassung aus: Erledigte Tage verwenden die erste Farbstufe.'}</small>}
  </div>;
}
