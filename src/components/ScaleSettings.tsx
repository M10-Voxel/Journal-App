import { useState } from 'react';
import type { CSSProperties } from 'react';
import { t, useLanguage } from '../i18n';
import { changePeriodData, usePeriodData } from '../periodStore';
import type { RatingScale, ScaleDefinition } from '../periodData';
import { defaultRatingColor, defaultScaleRange, maxScaleSpan, moveScale, ratingScale } from '../periodData';
import { tagSwatches } from '../tags';
import { ColorButton } from './ColorPicker';
import { Icon } from './Icon';

/**
 * Day values ("Tageswerte") in the settings: first the daily rating (its colour and span), then the user's own values
 * such as stress or sleep – each with a name, a colour and a span (whole numbers, 0–10 by default), active or not, in an
 * order of their own. There are none at first. Removing one asks once more; until then its values stay stored.
 */
export function ScaleSettings() {
  useLanguage();
  const { data, error } = usePeriodData();
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const edit = (id: string, changes: Partial<ScaleDefinition>) => changePeriodData(current => ({ ...current, scales: (current.scales ?? []).map(item => item.id === id ? { ...item, ...changes } : item) }));
  const editRating = (changes: Partial<RatingScale>) => changePeriodData(current => ({ ...current, rating: { ...ratingScale(current), ...changes } }));
  const scales = data?.scales ?? [];
  const rating = ratingScale(data);
  return <div className="activity-settings scale-settings">
    <h3>{t('Tageswerte')}</h3>
    <p className="settings-hint">{t('Werte, die du jeden Tag mit der Maus einträgst – etwa Stress oder Schlaf. Jeder Wert hat eine Farbe und eine Spanne aus ganzen Zahlen. Die Zeiträume zeigen alle Werte zusammen mit der Tagesbewertung in einem Verlauf.')}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!data ? <p>{t('Wird geladen …')}</p> : <>
      <div className="activity-settings-list">
        <div className="activity-settings-row scale-settings-row is-rating" data-scale-id="rating" style={{ '--activity-color': rating.color } as CSSProperties}>
          <div className="activity-settings-name"><ColorButton value={data.rating ? rating.color : defaultRatingColor} label={t('Tagesbewertung')} swatches={tagSwatches} onChange={color => editRating({ color })} /><strong>{t('Tagesbewertung')}</strong></div>
          <RangeFields label={t('Tagesbewertung')} min={rating.min} max={rating.max} isDefault={rating.min === defaultScaleRange.min && rating.max === defaultScaleRange.max} onChange={range => editRating(range)} />
        </div>
        {scales.map((item, index) => <div className={`activity-settings-row scale-settings-row${item.active ? '' : ' is-inactive'}`} data-scale-id={item.id} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
          <div className="activity-settings-name"><ColorButton value={item.color} label={item.name} swatches={tagSwatches} onChange={color => edit(item.id, { color })} /><input aria-label={t('Name des Tageswerts')} maxLength={80} value={item.name} onChange={e => edit(item.id, { name: e.target.value })} /></div>
          <div className="activity-settings-order">
            <button type="button" disabled={index === 0} aria-label={t('{0}: nach oben', item.name)} onClick={() => changePeriodData(current => { const list = current.scales ?? []; return { ...current, scales: moveScale(list, item.id, list[index - 1].id) }; })}><Icon name="up" /></button>
            <button type="button" disabled={index === scales.length - 1} aria-label={t('{0}: nach unten', item.name)} onClick={() => changePeriodData(current => { const list = current.scales ?? []; return { ...current, scales: moveScale(list, item.id, list[index + 1].id) }; })}><Icon name="down" /></button>
          </div>
          <RangeFields label={item.name} min={item.min} max={item.max} isDefault={item.min === defaultScaleRange.min && item.max === defaultScaleRange.max} onChange={range => edit(item.id, range)} />
          <div className="activity-options">
            <label><span className="activity-checkbox"><input type="checkbox" checked={item.active} onChange={e => edit(item.id, { active: e.target.checked })} /><Icon name="check" className="activity-check-mark" /></span>{t('Aktiv')}</label>
            {/* Like a tag: the first click asks, the second removes; leaving the button keeps the value. */}
            {removing === item.id
              ? <button type="button" className="scale-remove is-asking" data-autofocus onBlur={() => setRemoving(null)} onClick={() => { setRemoving(null); changePeriodData(current => ({ ...current, scales: (current.scales ?? []).filter(other => other.id !== item.id) })); }}>{t('Löschen?')}</button>
              : <button type="button" className="scale-remove" aria-label={t('{0} löschen', item.name)} onClick={event => { const row = event.currentTarget.closest('.scale-settings-row'); setRemoving(item.id); requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>('.scale-remove')?.focus()); }}><Icon name="trash" />{t('Löschen')}</button>}
          </div>
        </div>)}
      </div>
      <form className="activity-settings-add" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; changePeriodData(current => ({ ...current, scales: [...(current.scales ?? []), { id: crypto.randomUUID(), name: name.trim(), color: tagSwatches[(current.scales ?? []).length % tagSwatches.length], ...defaultScaleRange, active: true }] })); setName(''); }}>
        <input aria-label={t('Neuer Tageswert')} placeholder={t('Neuer Tageswert, z. B. Stress …')} value={name} maxLength={80} onChange={e => setName(e.target.value)} /><button type="submit" disabled={!name.trim()}>{t('Hinzufügen')}</button>
      </form>
    </>}
  </div>;
}

/** The span: lowest and highest value, whole numbers, the lowest below the highest (typing one end keeps the other). */
function RangeFields({ label, min, max, isDefault, onChange }: { label: string; min: number; max: number; isDefault: boolean; onChange: (range: { min: number; max: number }) => void }) {
  const [draft, setDraft] = useState<{ min?: string; max?: string }>({});
  const commit = (field: 'min' | 'max', text: string) => {
    setDraft(current => ({ ...current, [field]: text }));
    const value = Math.round(Number(text));
    if (!text.trim() || !Number.isFinite(value) || Math.abs(value) > 100000) return;
    if (field === 'min' && value < max && max - value <= maxScaleSpan) onChange({ min: value, max });
    if (field === 'max' && value > min && value - min <= maxScaleSpan) onChange({ min, max: value });
  };
  return <div className="activity-range scale-range" role="group" aria-label={t('Spanne von {0}', label)}>
    <label>{t('Von')}<input type="number" inputMode="numeric" step={1} aria-label={t('{0}: kleinster Wert', label)} value={draft.min ?? min} onChange={e => commit('min', e.target.value)} onBlur={() => setDraft(current => ({ ...current, min: undefined }))} /></label>
    <label>{t('bis')}<input type="number" inputMode="numeric" step={1} aria-label={t('{0}: größter Wert', label)} value={draft.max ?? max} onChange={e => commit('max', e.target.value)} onBlur={() => setDraft(current => ({ ...current, max: undefined }))} /></label>
    {!isDefault && <button type="button" onClick={() => { setDraft({}); onChange({ ...defaultScaleRange }); }}>{t('Zurücksetzen')}</button>}
  </div>;
}
