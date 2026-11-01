import type { Entry, EntryKind } from '../journal';
import { PixelIcon } from './PixelIcon';

export type IconName = 'journal' | 'calendar' | 'plan-tomorrow' | 'plan-days' | 'date-range' | 'left' | 'right' | 'up' | 'down' | 'grip' | 'offline' | 'save' | 'task' | 'note' | 'event' | 'done' | 'cancel' | 'trash' | 'tomorrow' | 'priority' | 'priority-event' | 'priority-note'
  | 'migrated' | 'migrated-event' | 'scheduled' | 'scheduled-event' | 'scheduled-multi' | 'scheduled-multi-event' | 'clock' | 'bell' | 'check' | 'undo' | 'jump' | 'settings' | 'search' | 'pin' | 'month' | 'transfer' | 'repeat' | 'mail' | 'layout' | 'pencil';

export const priorityIcon = (kind: EntryKind): IconName => kind === 'event' ? 'priority-event' : kind === 'note' ? 'priority-note' : 'priority';

// Traces of planned entries: `>` moved to tomorrow, `<` planned for a date, `<<` planned for several days. Events use the outlined variant, like their priority star.
export function traceIcon(entry: Pick<Entry, 'kind' | 'plan'>): IconName {
  const event = entry.kind === 'event';
  const via = entry.plan?.via;
  if (via === 'tomorrow') return event ? 'migrated-event' : 'migrated';
  if (via === 'days' || (entry.plan?.targets.length ?? 0) > 1) return event ? 'scheduled-multi-event' : 'scheduled-multi';
  return event ? 'scheduled-event' : 'scheduled';
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} data-icon={name} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="icon-standard">
    {name === 'transfer' && <><path d="M5 2v10m-3-3 3 3 3-3M11 14V4m-3 3 3-3 3 3" /></>}
    {name === 'journal' && <><path d="M4 2.5h8.5v11H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5Z" /><path d="M5.5 2.5v11M8 6h2M8 8.5h2" /></>}
    {name === 'calendar' && <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M5 2v3M11 2v3M2.5 7h11M5.5 10h2" /></>}
    {/* The planning actions share the calendar: an arrow to the next day, a span over several days. */}
    {name === 'plan-tomorrow' && <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M5 2v3M11 2v3M2.5 7h11M5 10.25h5.5M8.75 8.5l1.75 1.75L8.75 12" /></>}
    {name === 'plan-days' && <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M5 2v3M11 2v3M2.5 7h11M5 9v2.5M11 9v2.5M5 10.25h6" /></>}
    {name === 'date-range' && <><path d="M3 5.5v-2h10v2M3 10.5v2h10v-2M2 8h12" /><path d="m4 6-2 2 2 2M12 6l2 2-2 2" /></>}
    {name === 'left' && <path d="m9.5 4-4 4 4 4" />}
    {name === 'right' && <path d="m6.5 4 4 4-4 4" />}
    {name === 'up' && <path d="m4 9.5 4-4 4 4" />}
    {name === 'down' && <path d="m4 6.5 4 4 4-4" />}
    {name === 'grip' && <g fill="currentColor" stroke="none">{[4, 8, 12].flatMap(y => [6, 10].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}</g>}
    {name === 'offline' && <><rect x="2.5" y="3" width="11" height="8" rx="1" /><path d="M6 13h4M8 11v2" /></>}
    {name === 'save' && <><path d="M3 2.5h8l2 2v9H3Z" /><path d="M5 2.5v4h5v-4M5.5 13.5V9h5v4.5" /></>}
    {name === 'task' && <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />}
    {name === 'note' && <path d="M3.5 8h9" />}
    {name === 'event' && <circle cx="8" cy="8" r="4.5" />}
    {name === 'done' && <path d="m4 4 8 8M12 4l-8 8" strokeWidth="1.8" />}
    {name === 'cancel' && <><circle cx="8" cy="8" r="5" /><path d="m4.5 11.5 7-7" /></>}
    {name === 'tomorrow' && <><path d="M2.5 8h7.5M7.5 5l3 3-3 3" /><path d="M13 3.5v9" /></>}
    {name === 'priority' && <path d="M8 3v10M3.67 5.5l8.66 5M3.67 10.5l8.66-5" strokeWidth="1.8" />}
    {name === 'priority-event' && <path d="M6.8 2h2.4v3.92l3.4-1.96 1.2 2.08L10.4 8l3.4 1.96-1.2 2.08-3.4-1.96V14H6.8v-3.92l-3.4 1.96-1.2-2.08L5.6 8 2.2 6.04l1.2-2.08 3.4 1.96Z" strokeWidth="1.1" />}
    {name === 'priority-note' && <path d="M3.5 8h9" strokeWidth="3" />}
    {name === 'migrated' && <path d="m5.5 3 5 5-5 5" strokeWidth="1.8" />}
    {name === 'migrated-event' && <path d="M12.8 8 6.2 1.9 4.4 3.7 8.9 8l-4.5 4.3 1.8 1.8Z" strokeWidth="1.1" />}
    {name === 'scheduled' && <path d="M10.5 3 5.5 8l5 5" strokeWidth="1.8" />}
    {name === 'scheduled-event' && <path d="M3.2 8 9.8 1.9l1.8 1.8L7.1 8l4.5 4.3-1.8 1.8Z" strokeWidth="1.1" />}
    {name === 'scheduled-multi' && <path d="M8 3.5 3.5 8 8 12.5M13 3.5 8.5 8l4.5 4.5" strokeWidth="1.8" />}
    {name === 'scheduled-multi-event' && <path d="M1.6 8 7 3l1.5 1.5L5.1 8l3.4 3.5L7 13ZM7.1 8l5.4-5 1.5 1.5L10.6 8l3.4 3.5-1.5 1.5Z" strokeWidth="1.1" />}
    {/* Two arrows chasing each other round: the entry comes again. */}
    {name === 'repeat' && <><path d="M13 8a5 5 0 0 1-8.54 3.54M3 8a5 5 0 0 1 8.54-3.54" /><path d="M11.54 1.5v3h-3M4.46 14.5v-3h3" /></>}
    {name === 'clock' && <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>}
    {name === 'bell' && <><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3Z" /><path d="M6.5 14h3" /></>}
    {name === 'check' && <path d="m3.5 8.5 3 3 6-7" strokeWidth="1.6" />}
    {name === 'undo' && <><path d="M5.5 4 2.5 7l3 3" /><path d="M2.5 7h7a3.5 3.5 0 0 1 0 7H7" /></>}
    {name === 'jump' && <><path d="M6.5 3.5h-3v9h9v-3" /><path d="M9 3h4v4M13 3 7.5 8.5" /></>}
    {/* A cog with eight teeth (not a sun): settings. */}
    {name === 'settings' && <><path d="M6.54 3.22 L6.85 1.50 L9.15 1.50 L9.46 3.22 L10.35 3.59 L11.79 2.59 L13.41 4.21 L12.41 5.65 L12.78 6.54 L14.50 6.85 L14.50 9.15 L12.78 9.46 L12.41 10.35 L13.41 11.79 L11.79 13.41 L10.35 12.41 L9.46 12.78 L9.15 14.50 L6.85 14.50 L6.54 12.78 L5.65 12.41 L4.21 13.41 L2.59 11.79 L3.59 10.35 L3.22 9.46 L1.50 9.15 L1.50 6.85 L3.22 6.54 L3.59 5.65 L2.59 4.21 L4.21 2.59 L5.65 3.59Z" strokeWidth="1.2" /><circle cx="8" cy="8" r="2.1" /></>}
    {name === 'pencil' && <><path d="M10.5 2.8 13.2 5.5 6 12.7l-3.2.5.5-3.2Z" /><path d="m9.2 4.1 2.7 2.7" /></>}
    {name === 'mail' && <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4.5 5.5-4.5" /></>}
    {name === 'layout' && <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11M6 6.5h8" /></>}
    {name === 'search' && <><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.3 3.3" /></>}
    {name === 'month' && <><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><g fill="currentColor" stroke="none">{[5.5, 8, 10.5].flatMap(y => [5.5, 8, 10.5].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r=".8" />))}</g></>}
    {name === 'pin' && <><path d="m9.5 2.5 4 4-2 1-2.5 2.5.5 2.5-1 1-6-6 1-1 2.5.5L8.5 4.5Z" /><path d="m2.5 13.5 3.5-3.5" /></>}
    {name === 'trash' && <><path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.5 9h7l.5-9M6.5 7v4M9.5 7v4" /></>}
    </g><PixelIcon name={name} />
  </svg>;
}
