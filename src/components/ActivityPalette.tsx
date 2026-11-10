import { activityPalette, activityLevelLabel, defaultRange } from '../activityColors';
import type { ActivityRange } from '../activityColors';
import { getLanguage } from '../i18n';

export function ActivityPalette({ color, trackTime, preview = false, range = defaultRange }: { color: string; trackTime: boolean; preview?: boolean; range?: ActivityRange }) {
  const en = getLanguage() === 'en';
  return <div className={`activity-palette${preview ? ' is-preview' : ''}`}>
    <span>{preview ? en ? 'Graph shades' : 'Graphen-Farbstufen' : en ? 'Less' : 'Weniger'}</span>
    <div className="activity-palette-swatches" role="img" aria-label={en ? `Seven shades from ${range.min} to ${range.max} minutes` : `Sieben Farbstufen von ${range.min} bis ${range.max} Minuten`}>
      {activityPalette(color).map((shade, index) => <span key={index} style={{ backgroundColor: shade }} title={`${activityLevelLabel(index, range)} · ${shade}`} />)}
    </div>
    <span>{preview ? `${range.max}+ min` : en ? 'More' : 'Mehr'}</span>
    {preview && <small>{trackTime ? en ? `${activityLevelLabel(0, range)} → ${range.max}+ min` : `${activityLevelLabel(0, range)} → ${range.max}+ min` : en ? 'Time tracking off: completed days use the first shade.' : 'Zeiterfassung aus: Erledigte Tage verwenden die erste Farbstufe.'}</small>}
  </div>;
}
