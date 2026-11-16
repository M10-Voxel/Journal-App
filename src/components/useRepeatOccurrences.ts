import { useEffect, useState } from 'react';
import { occurrences, occurrencesAsync, type RepeatRule } from '../repeat';

/** Keep native previews immediate, and discard stale replies when an ICS preview changes. */
export function useRepeatOccurrences(rule: RepeatRule | null, from: string, to: string, limit = 5000): string[] {
  const key = JSON.stringify([rule, from, to, limit]);
  const [result, setResult] = useState<{key:string; dates:string[]}>({key:'', dates:[]});
  useEffect(() => {
    let active = true;
    if (rule?.ics) void occurrencesAsync(rule, from, to, limit).then(dates => {if (active) setResult({key, dates});}, () => {if (active) setResult({key, dates:[]});});
    return () => { active = false; };
  }, [key]);
  return rule?.ics ? result.key === key ? result.dates : [] : rule ? occurrences(rule, from, to, limit) : [];
}
