import { usePeriodData } from './periodStore';

/** The tags of the checklist's activities (see tagKinds.ts). */
export function useActivityTagIds(): ReadonlySet<string> {
  const { data } = usePeriodData();
  return new Set((data?.definitions ?? []).flatMap(item => item.calendarTagId ? [item.calendarTagId] : []));
}
