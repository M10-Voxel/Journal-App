export type IconName = 'journal' | 'calendar' | 'date-range' | 'left' | 'right' | 'up' | 'down' | 'grip' | 'offline' | 'save' | 'task' | 'note' | 'event' | 'done' | 'cancel' | 'trash';

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'journal' && <><path d="M4 2.5h8.5v11H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5Z" /><path d="M5.5 2.5v11M8 6h2M8 8.5h2" /></>}
    {name === 'calendar' && <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M5 2v3M11 2v3M2.5 7h11M5.5 10h2" /></>}
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
    {name === 'trash' && <><path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.5 9h7l.5-9M6.5 7v4M9.5 7v4" /></>}
  </svg>;
}
