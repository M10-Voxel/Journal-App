import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useLanguage } from '../i18n';
import { changePeriodData, ensureActivityTags, usePeriodData } from '../periodStore';
import type { ActivityDefinition } from '../periodData';
import { moveActivity } from '../periodData';
import { saveTags } from '../tagStore';
import { maxTagName, tagSwatches } from '../tags';
import { ColorButton } from './ColorPicker';
import { Icon } from './Icon';
import { ActivityPalette } from './ActivityPalette';
import { activityRange, maxRangeMinutes } from '../activityColors';

export function ActivitySettings() {
  const en = useLanguage() === 'en';
  const tr = (de: string, english: string) => en ? english : de;
  const { data, error } = usePeriodData();
  const [name, setName] = useState('');
  const [tagError,setTagError] = useState('');
  // One end of the shades' minutes typed in: the other end is kept and stays six minutes away (a minute per step at least).
  const rangeChange = (item: ActivityDefinition, field: 'minMinutes' | 'maxMinutes', text: string): Partial<ActivityDefinition> => {
    const { min, max } = activityRange(item), value = Math.round(Number(text));
    if (!text.trim() || !Number.isFinite(value)) return { [field]: undefined };
    return field === 'minMinutes' ? { minMinutes: Math.max(0, Math.min(value, max - 6)), maxMinutes: max } : { maxMinutes: Math.min(maxRangeMinutes, Math.max(value, min + 6)), minMinutes: min };
  };
  const edit = (id: string, changes: Partial<ActivityDefinition>) => {
    changePeriodData(current => ({ ...current, definitions: current.definitions.map(item => item.id === id ? { ...item, ...changes } : item) }));
    const definition = data?.definitions.find(item => item.id === id);
    if (changes.color && definition?.calendarTagId) void saveTags(tags => tags.map(tag => tag.id === definition.calendarTagId ? { ...tag,color:changes.color! } : tag)).then(() => setTagError(''),reason => setTagError(String(reason)));
  };
  // The activity's tag follows its name once editing ends (unless another tag already has that name).
  const renameTag = (item: ActivityDefinition) => {
    const name = item.name.trim().slice(0, maxTagName);
    if (!name || !item.calendarTagId) return;
    void saveTags(tags => tags.some(tag => tag.id !== item.calendarTagId && tag.name.toLowerCase() === name.toLowerCase()) ? tags : tags.map(tag => tag.id === item.calendarTagId ? { ...tag, name } : tag)).then(() => setTagError(''), reason => setTagError(String(reason)));
  };
  return <div className="activity-settings">
    <h3>{tr('Aktivitäten', 'Activities')}</h3>
    <p className="settings-hint">{tr('Lege deine tägliche Checkliste fest. Farbe, Zeiterfassung und Notizfeld gelten für alle Tage. Jede Aktivität hat ein eigenes Tag: Kalender-Einträge mit diesem Tag zählen als ihre Zeit. Deaktivierte Aktivitäten bleiben in vergangenen Auswertungen erhalten.', 'Set up your daily checklist. Color, time tracking and notes apply to every day. Each activity has its own tag: calendar entries with that tag count as its time. Inactive activities remain in past analytics.')}</p>
    {(error || tagError) && <p className="error" role="alert">{error || tagError}</p>}
    {!data ? <p>{tr('Wird geladen …','Loading …')}</p> : <>
      <div className="activity-settings-list">{data.definitions.map((item,index) => <div className={`activity-settings-row${item.active ? '' : ' is-inactive'}`} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
        <div className="activity-settings-name"><ColorButton value={item.color} label={item.name} swatches={tagSwatches} onChange={color => edit(item.id, { color })} /><input aria-label={tr('Name der Aktivität','Activity name')} maxLength={80} value={item.name} onChange={e => edit(item.id, { name: e.target.value })} onBlur={() => renameTag(item)} /></div>
        <div className="activity-settings-order"><button type="button" disabled={index === 0} aria-label={`${item.name}: ${tr('nach oben','move up')}`} onClick={() => changePeriodData(current => ({ ...current,definitions:moveActivity(current.definitions,item.id,current.definitions[index-1].id) }))}><Icon name="up" /></button><button type="button" disabled={index === data.definitions.length-1} aria-label={`${item.name}: ${tr('nach unten','move down')}`} onClick={() => changePeriodData(current => ({ ...current,definitions:moveActivity(current.definitions,item.id,current.definitions[index+1].id) }))}><Icon name="down" /></button></div>
        <ActivityPalette color={item.color} trackTime={item.trackTime} range={activityRange(item)} preview />
        {item.trackTime && <div className="activity-range" role="group" aria-label={tr('Zeitspanne der Farbstufen','Time span of the shades')}>
          <label>{tr('Hellste Stufe ab','Lightest shade from')}<input type="number" inputMode="numeric" min={0} max={maxRangeMinutes - 6} step={5} value={activityRange(item).min} onChange={e => edit(item.id, rangeChange(item, 'minMinutes', e.target.value))} /><span>min</span></label>
          <label>{tr('Dunkelste Stufe ab','Darkest shade from')}<input type="number" inputMode="numeric" min={6} max={maxRangeMinutes} step={5} value={activityRange(item).max} onChange={e => edit(item.id, rangeChange(item, 'maxMinutes', e.target.value))} /><span>min</span></label>
          {(item.minMinutes !== undefined || item.maxMinutes !== undefined) && <button type="button" onClick={() => edit(item.id, { minMinutes: undefined, maxMinutes: undefined })}>{tr('Zurücksetzen','Reset')}</button>}
        </div>}
        <div className="activity-options">
          <label><span className="activity-checkbox"><input type="checkbox" checked={item.active} onChange={e => edit(item.id, { active: e.target.checked })} /><Icon name="check" className="activity-check-mark" /></span>{tr('Aktiv','Active')}</label>
          <label><span className="activity-checkbox"><input type="checkbox" checked={item.trackTime} onChange={e => edit(item.id, { trackTime: e.target.checked })} /><Icon name="check" className="activity-check-mark" /></span><Icon name="clock" />{tr('Zeit erfassen','Track time')}</label>
          <label><span className="activity-checkbox"><input type="checkbox" checked={item.textField} onChange={e => edit(item.id, { textField: e.target.checked })} /><Icon name="check" className="activity-check-mark" /></span><Icon name="note" />{tr('Notizfeld','Notes')}</label>
        </div>
      </div>)}</div>
      <form className="activity-settings-add" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; changePeriodData(current => ({ ...current, definitions: [...current.definitions, { id: crypto.randomUUID(), name: name.trim(), color: tagSwatches[current.definitions.length % tagSwatches.length], trackTime: true, textField: false, active: true }] })); setName(''); void ensureActivityTags().then(() => setTagError(''), reason => setTagError(String(reason))); }}>
        <input aria-label={tr('Neue Aktivität','New activity')} placeholder={tr('Neue Aktivität …','New activity …')} value={name} maxLength={80} onChange={e => setName(e.target.value)} /><button type="submit" disabled={!name.trim()}>{tr('Hinzufügen','Add')}</button>
      </form>
    </>}
  </div>;
}
