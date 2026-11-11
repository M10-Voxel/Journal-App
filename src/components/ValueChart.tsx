import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { dateFormat, t, useLanguage } from '../i18n';
import { ratingBuckets } from '../periods';
import { chartRange } from '../periodData';
import { useHiddenScales } from '../scaleVisibility';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** One line of the chart: the daily rating or a day value, its values by date (missing days stay missing). */
export interface ChartSeries { key: string; label: string; color: string; min: number; max: number; values: Record<string, number | undefined> }

const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

/**
 * The overview's day values as one line chart: a line with points per value (the daily rating and the user's own day
 * values), broken where a day has none. The y axis spans every shown line's range together; lines can be hidden (on
 * this device, scaleVisibility.ts) from the filter beside the summary. Weeks and months show days, quarters and years
 * the months' averages. Hovering or focusing a column shows every value of that day (or month).
 */
export function ValueChart({ dates, series, monthly }: { dates: string[]; series: ChartSeries[]; monthly: boolean }) {
  useLanguage();
  const [hidden, setHidden] = useHiddenScales();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const shown = series.filter(item => !hidden.has(item.key));
  const lines = shown.map(item => ({ ...item, buckets: ratingBuckets(dates, item.values, monthly) }));
  const keys = ratingBuckets(dates, {}, monthly).map(bucket => bucket.key);
  const activeIndex = activeKey == null ? -1 : keys.indexOf(activeKey);
  const active = activeIndex < 0 ? null : activeIndex;
  const setActive = (index: number | null) => setActiveKey(index == null ? null : keys[index]);
  const range = chartRange(shown);
  const label = (key: string) => dateFormat(monthly ? { month: 'short' } : { day: 'numeric', month: 'short' }).format(new Date(`${key}${monthly ? '-01' : ''}T12:00:00`));
  const width = 640, left = Math.max(34, Math.max(String(range.min).length, String(range.max).length) * 7 + 12), right = 14, top = 14, bottom = 158;
  const step = (width - left - right) / Math.max(1, keys.length);
  const x = (index: number) => left + (index + .5) * step;
  const y = (value: number) => bottom - (value - range.min) / Math.max(1, range.max - range.min) * (bottom - top);
  const ticks = [...new Set([range.min, Math.round((range.min + range.max) / 2), range.max])];
  const toggle = (key: string) => { const next = new Set(hidden); if (next.has(key)) next.delete(key); else next.add(key); setHidden(next); };
  const describe = (index: number) => `${label(keys[index])}: ${lines.map(line => `${line.label} ${line.buckets[index].value == null ? '–' : format(line.buckets[index].value!)}`).join(', ') || t('keine Reihen')}`;
  const average = (item: ChartSeries) => { const values = dates.flatMap(date => item.values[date] == null ? [] : [item.values[date]!]); return { count: values.length, value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }; };

  return <div className="rating-chart value-chart">
    <div className="value-chart-head">
      <ul className="value-legend">{shown.map(item => { const { count, value } = average(item); return <li key={item.key} data-series={item.key} style={{ '--series': item.color } as CSSProperties}>
        <i aria-hidden="true" /><span className="value-legend-name">{item.label}</span>
        <span className="value-legend-stat">{value == null ? t('noch keine Werte') : <>{t('Ø {0} / {1}', value.toFixed(1), item.max)} · {count === 1 ? t('1 Tag') : t('{0} Tage', count)}</>}</span>
      </li>; })}</ul>
      {(series.length > 1 || shown.length < series.length) && <button ref={filterButton} type="button" className={`tag-filter-button value-chart-filter${series.some(item => hidden.has(item.key)) ? ' is-filtering' : ''}`} aria-haspopup="dialog" aria-expanded={filtering}
        aria-label={t('Reihen ein- und ausblenden')} data-tip={t('Reihen ein- und ausblenden')} onClick={() => setFiltering(current => !current)}>
        <Icon name="layout" /><span className="tag-filter-dots" aria-hidden="true">{shown.slice(0, 4).map(item => <i key={item.key} style={{ '--tag': item.color } as CSSProperties} />)}</span>
        {series.length - shown.length > 0 && <span className="tag-filter-count" aria-hidden="true">−{series.length - shown.length}</span>}
      </button>}
      {filtering && <Popover anchor={filterButton.current} className="tag-filter" label={t('Reihen')} align="end" onClose={byKey => { setFiltering(false); if (byKey) filterButton.current?.focus(); }}>
        <div className="tag-filter-list" role="group" aria-label={t('Reihen')}>
          {series.map((item, index) => <button key={item.key} type="button" role="checkbox" className="tag-filter-row" data-series={item.key} aria-checked={!hidden.has(item.key)} style={{ '--tag': item.color } as CSSProperties}
            data-autofocus={index === 0 || undefined} onClick={() => toggle(item.key)}>
            <span className="tag-check" aria-hidden="true"><Icon name="check" /></span><span className="tag-filter-name">{item.label}</span><small className="value-filter-range">{item.min}–{item.max}</small>
          </button>)}
        </div>
      </Popover>}
    </div>
    <div className="rating-chart-detail" aria-live="polite">{active != null ? describe(active) : <span className="page-hint">{monthly ? t('Monatsmittel · Punkt für Details auswählen') : t('Tageswerte · Punkt für Details auswählen')}</span>}</div>
    {shown.length ? <svg viewBox="0 0 640 190" role="img" aria-label={t('Verlauf von {0} bis {1}', range.min, range.max)} data-min={range.min} data-max={range.max} onMouseLeave={() => setActive(null)}>
      {ticks.map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid" /><text x={left - 10} y={y(value) + 4} textAnchor="end" className="chart-label chart-y-label">{value}</text></g>)}
      {active != null && <line className="chart-guide" x1={x(active)} x2={x(active)} y1={top} y2={bottom} />}
      {lines.map(line => {
        // The line breaks where a day (or month) has no value; each run of values is a path of its own.
        const runs: { index: number; value: number }[][] = [];
        line.buckets.forEach((bucket, index) => { if (bucket.value == null) { if (runs.at(-1)?.length) runs.push([]); return; } if (!runs.length) runs.push([]); runs.at(-1)!.push({ index, value: bucket.value }); });
        const straight = (run: typeof runs[number]) => run.map((point, i) => `${i ? 'L' : 'M'}${x(point.index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
        // Pixel: steps instead of slopes (shown per theme, periodNotes.css).
        const stepped = (run: typeof runs[number]) => run.map((point, i) => i ? `H${((x(run[i - 1].index) + x(point.index)) / 2).toFixed(1)} V${y(point.value).toFixed(1)} H${x(point.index).toFixed(1)}` : `M${x(point.index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
        return <g key={line.key} className="chart-series" data-series={line.key} style={{ '--series': line.color } as CSSProperties}>
          {runs.filter(run => run.length > 1).map((run, i) => <g key={i}><path className="chart-line" d={straight(run)} /><path className="chart-step" d={stepped(run)} /></g>)}
          {line.buckets.map((bucket, index) => bucket.value == null ? null : <rect key={bucket.key} className={`chart-point${active === index ? ' is-active' : ''}`} data-date={bucket.key} data-value={bucket.value}
            x={x(index) - 3.5} y={y(bucket.value) - 3.5} width={7} height={7} />)}
        </g>;
      })}
      {keys.map((key, index) => <g key={key}>
        <rect className="chart-hit" data-date={key} tabIndex={0} role="button" aria-label={describe(index)} x={left + index * step} y={top} width={step} height={bottom - top}
          onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); } }}><title>{describe(index)}</title></rect>
        {(index === 0 || index === keys.length - 1 || index % Math.max(1, Math.ceil(keys.length / 7)) === 0) && <text x={x(index)} y={180} textAnchor="middle" className="chart-label">{label(key)}</text>}
      </g>)}
    </svg> : <p className="value-chart-empty">{t('Alle Reihen ausgeblendet.')}</p>}
  </div>;
}
