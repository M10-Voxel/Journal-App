import type { CSSProperties } from 'react';
import type { ActivityDefinition, PeriodData } from '../periodData';
import { activitySummary } from '../periodData';
import { getLanguage } from '../i18n';
import type { PeriodMode } from '../periods';
import { Icon } from './Icon';
import { ActivityHeatmap } from './ActivityHeatmap';

export function ActivitySummary({ activity, dates, data, mode }: { activity: ActivityDefinition; dates: string[]; data: PeriodData; mode: PeriodMode }) {
  const en = getLanguage() === 'en';
  const summary = activitySummary(dates, data.days, activity.id);
  const monthly = mode === 'quarter' || mode === 'year';
  const groups = new Map<string, typeof summary.records>();
  for (const entry of summary.records) { const key = monthly ? entry.date.slice(0,7) : entry.date; groups.set(key, [...(groups.get(key) ?? []), entry]); }
  const buckets = [...groups].map(([key, records]) => ({ key, minutes: records.reduce((sum, entry) => sum + Math.max(0, entry.record?.minutes ?? 0),0), days: records.filter(entry => entry.record?.done || (entry.record?.minutes ?? 0)>0).length, text: records.map(entry => entry.record?.text).filter(Boolean).join(' · ') }));
  const max = Math.max(1,...buckets.map(bucket => activity.trackTime ? bucket.minutes : bucket.days));
  const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes/60)} h ${minutes%60 ? `${minutes%60} min` : ''}`.trim() : `${minutes} min`;
  return <article className="activity-summary-card" style={{ '--activity-color': activity.color } as CSSProperties}>
    <header><h4><i />{activity.name}</h4><div className="activity-metrics">{activity.trackTime && <strong><Icon name="clock" />{duration(summary.minutes)}</strong>}<span>{summary.activeDays} / {dates.length} {en ? 'days' : 'Tage'}</span></div></header>
    {mode !== 'week' ? <ActivityHeatmap activity={activity} dates={dates} data={data} calendar={mode === 'month'} /> : <div className={`activity-timeline is-${mode}`} role="list" aria-label={`${activity.name} ${en ? 'over time' : 'im Verlauf'}`}>
      {buckets.map(bucket => { const amount = activity.trackTime ? bucket.minutes : bucket.days;
        const label = new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', monthly ? { month:'short' } : mode === 'week' ? { weekday:'short' } : { day:'numeric' }).format(new Date(`${bucket.key}${monthly ? '-01' : ''}T12:00:00`));
        const detail = `${bucket.key} · ${activity.trackTime ? duration(bucket.minutes) : `${bucket.days} ${en ? 'done' : 'erledigt'}`}${bucket.text ? ` · ${bucket.text}` : ''}`;
        return <div key={bucket.key} className="activity-timeline-day" role="listitem" tabIndex={0} aria-label={detail} title={detail}>
          <span className="activity-day-value">{activity.trackTime ? bucket.minutes || '–' : bucket.days ? '✓' : '–'}</span>
          <div className="activity-day-track"><span style={{ height: `${amount ? Math.max(8,amount/max*100) : 0}%` }} /></div>
          <span className="activity-day-label">{label}</span>
        </div>;
      })}
    </div>}
    {activity.trackTime && mode === 'week' && <p className="activity-unit">{en ? 'Minutes' : 'Minuten'}{monthly ? en ? ' per month' : ' pro Monat' : en ? ' per day' : ' pro Tag'}</p>}
  </article>;
}
