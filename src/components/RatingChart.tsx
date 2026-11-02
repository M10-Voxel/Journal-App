import { useState } from 'react';
import { getLanguage } from '../i18n';
import { ratingBuckets } from '../periods';
export function RatingChart({ dates, ratings, monthly }: { dates: string[]; ratings: Record<string, number | undefined>; monthly: boolean }) {
  const en = getLanguage() === 'en';
  const [active, setActive] = useState<number | null>(null);
  const buckets = ratingBuckets(dates, ratings, monthly);
  const format = (key: string) => new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', monthly ? { month: 'short' } : { day: 'numeric', month: 'short' }).format(new Date(`${key}${monthly ? '-01' : ''}T12:00:00`));
  const width = 640, left = 30, right = 12, top = 14, bottom = 158;
  const step = (width-left-right)/Math.max(1,buckets.length);
  const selected = active == null ? null : buckets[active];
  return <div className="rating-chart">
    <div className="rating-chart-detail" aria-live="polite">{selected ? `${format(selected.key)} · ${selected.value == null ? en ? 'No rating' : 'Keine Bewertung' : `${selected.value.toFixed(1)} / 10`}${monthly && selected.count ? ` · ${selected.count} ${en ? 'days' : 'Tage'}` : ''}` : en ? 'Daily ratings · select a bar for details' : 'Tagesbewertungen · Balken für Details auswählen'}</div>
    <svg viewBox="0 0 640 190" role="img" aria-label={en ? 'Ratings from 1 to 10 over the selected period' : 'Bewertungen von 1 bis 10 im gewählten Zeitraum'}>
      {[0,5,10].map(value => { const y = bottom - value/10*(bottom-top); return <g key={value}><line x1={left} x2={width-right} y1={y} y2={y} className="chart-grid"/><text x={left-10} y={y+4} textAnchor="end" className="chart-label">{value}</text></g>; })}
      {buckets.map((bucket,i) => { const x=left+i*step+step*.18, w=step*.64; const height=(bucket.value ?? 0)/10*(bottom-top); const detail=`${format(bucket.key)}: ${bucket.value == null ? en ? 'No rating' : 'Keine Bewertung' : `${bucket.value.toFixed(1)}/10`}`; return <g key={bucket.key}>
        <rect className={`chart-column${active===i ? ' is-active' : ''}`} x={x} y={bucket.value == null ? bottom-2 : bottom-height} width={w} height={bucket.value == null ? 2 : height} data-empty={bucket.value == null || undefined} rx={Math.min(3,w/2)} />
        <rect className="chart-hit" tabIndex={0} role="button" aria-label={detail} x={left+i*step} y={top} width={step} height={bottom-top} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} onKeyDown={e => { if(e.key==='Enter'||e.key===' ') { e.preventDefault();setActive(i); } }}><title>{detail}</title></rect>
        {(i===0 || i===buckets.length-1 || i % Math.max(1,Math.ceil(buckets.length/7))===0) && <text x={x+w/2} y={180} textAnchor="middle" className="chart-label">{format(bucket.key)}</text>}
      </g>; })}
    </svg>
  </div>;
}
