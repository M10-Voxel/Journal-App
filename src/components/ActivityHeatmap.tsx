import { useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { ActivityDefinition, PeriodData } from '../periodData';
import { activityLevel, activityPalette } from '../activityColors';
import { getLanguage } from '../i18n';
import { shiftDate, weekDates } from '../dates';
import { periodDates } from '../periods';
import { ActivityPalette } from './ActivityPalette';

export function ActivityHeatmap({ activity, dates, data, calendar }: { activity: ActivityDefinition; dates: string[]; data: PeriodData; calendar: boolean }) {
  const en = getLanguage() === 'en';
  const [selected, setSelected] = useState<string | null>(null);
  const first = dates[0], last = dates[dates.length - 1];
  const padded = periodDates(weekDates(first)[0], weekDates(last)[6]);
  const columns = padded.length / 7;
  const palette = activityPalette(activity.color);
  const detail = (date: string) => {
    const record = data.days[date]?.items[activity.id];
    const active = activityLevel(record, activity.trackTime) > 0;
    const label = new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', { weekday:'short', day:'numeric', month:'short', year:'numeric' }).format(new Date(`${date}T12:00:00`));
    return `${label} · ${active ? activity.trackTime && record?.minutes != null ? `${record.minutes} min` : en ? 'Done' : 'Erledigt' : en ? 'No activity' : 'Keine Aktivität'}${record?.text ? ` · ${record.text}` : ''}`;
  };
  const move = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offset = ({ ArrowLeft: calendar ? -1 : -7, ArrowRight: calendar ? 1 : 7, ArrowUp: calendar ? -7 : -1, ArrowDown: calendar ? 7 : 1 } as Record<string, number>)[event.key];
    if (offset == null && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const target = event.key === 'Home' ? first : event.key === 'End' ? last : shiftDate(date, offset);
    if (target < first || target > last) return;
    setSelected(target);
    event.currentTarget.closest('.activity-heatmap')?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus();
  };
  return <div className={`activity-heatmap${calendar ? ' is-calendar' : ' is-contributions'}`}>
    <div className="heatmap-scroll"><div className="heatmap-grid" style={{ '--heatmap-columns': columns } as CSSProperties} role="group" aria-label={en ? `${activity.name}: daily activity` : `${activity.name}: tägliche Aktivität`}>
      {Array.from({length:7}, (_, i) => <span key={`weekday-${i}`} className="heatmap-weekday" style={{ gridColumn:calendar ? i+1 : 1, gridRow:calendar ? 1 : i+2 }}>{new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', {weekday:'short'}).format(new Date(`2026-11-${String(2+i).padStart(2,'0')}T12:00:00`))}</span>)}
      {!calendar && Array.from({length:columns}, (_, column) => { const start = padded[column*7], end = padded[column*7+6]; const marker = dates.find(date => date >= start && date <= end && (date === first || date.endsWith('-01'))); return marker ? <span key={`month-${column}`} className="heatmap-month" style={{gridColumn:column+2, gridRow:1}}>{new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', {month:'short'}).format(new Date(`${marker}T12:00:00`))}</span> : null; })}
      {padded.map((date, index) => {
        const inRange = date >= first && date <= last;
        const level = inRange ? activityLevel(data.days[date]?.items[activity.id], activity.trackTime) : 0;
        const shade = level ? palette[level-1] : undefined;
        const lightness = shade ? .299 * parseInt(shade.slice(1,3),16) + .587 * parseInt(shade.slice(3,5),16) + .114 * parseInt(shade.slice(5,7),16) : 0;
        const style = { gridColumn:calendar ? index%7+1 : Math.floor(index/7)+2, gridRow:calendar ? Math.floor(index/7)+2 : index%7+2, backgroundColor:level ? palette[level-1] : undefined };
        return inRange ? <button key={date} type="button" className="heatmap-cell" data-date={date} data-level={level} style={style} title={detail(date)} aria-label={detail(date)} tabIndex={(selected && selected >= first && selected <= last ? selected : first) === date ? 0 : -1} onMouseEnter={() => setSelected(date)} onFocus={() => setSelected(date)} onClick={() => setSelected(date)} onKeyDown={event => move(event,date)}>{calendar && <span style={{color:level ? lightness > 145 ? '#171717' : '#ffffff' : undefined}}>{Number(date.slice(8))}</span>}</button> : <span className="heatmap-padding" key={date} style={style} />;
      })}
    </div></div>
    <p className="heatmap-detail" aria-live="polite">{selected && selected >= first && selected <= last ? detail(selected) : <span className="page-hint">{en ? 'Select a day for details' : 'Tag für Details auswählen'}</span>}</p>
    {activity.trackTime ? <ActivityPalette color={activity.color} trackTime /> : <p className="heatmap-binary-legend"><i style={{backgroundColor:palette[0]}} />{en ? 'Done' : 'Erledigt'}</p>}
  </div>;
}
