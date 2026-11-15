import { activityPalette, activityLevelLabel, defaultRange } from '../activityColors';
import type { ActivityRange } from '../activityColors';
import { t, useLanguage } from '../i18n';

export function ActivityPalette({ color, trackTime, preview = false, range = defaultRange }: { color: string; trackTime: boolean; preview?: boolean; range?: ActivityRange }) {
  useLanguage();
  return <div className={`activity-palette${preview ? ' is-preview' : ''}`}>
    <span>{preview ? t("Graphen-Farbstufen") : t("Weniger")}</span>
    <div className="activity-palette-swatches" role="img" aria-label={t("Sieben Farbstufen von {0} bis {1} Minuten", range.min, range.max)}>
      {activityPalette(color).map((shade, index) => <span key={index} style={{ backgroundColor: shade }} title={`${activityLevelLabel(index, range)} · ${shade}`} />)}
    </div>
    <span>{preview ? `${range.max}+ min` : t("Mehr")}</span>
    {preview && <small>{trackTime ? t("{0} → {1}+ min", activityLevelLabel(0, range), range.max) : t("Zeiterfassung aus: Erledigte Tage verwenden die erste Farbstufe.")}</small>}
  </div>;
}
