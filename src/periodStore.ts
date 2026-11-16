import { listen } from '@tauri-apps/api/event';
import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
const ownLabel = () => { try { return getCurrentWindow().label; } catch { return ''; } };
import { normalizePeriodData } from './periodData';
import type { PeriodData } from './periodData';
import { activityTags, entryMinutes } from './activityCalendar';
import { loadRange, shiftDate } from './journal';
import { currentTags, loadTags, saveTags } from './tagStore';

let snapshot: { data: PeriodData | null; error: string; saving: boolean } = { data: null, error: '', saving: false };
let loading: Promise<void> | null = null;
let writes = Promise.resolve();
let revision = 0;
let listening = false;
function listenForHistory() {
  if (listening) return;
  listening = true;
  const reload = async () => {
    const version = ++revision;
    try {
      const raw = await invoke<string>('load_period_data');
      if (version === revision) publish({ data: normalizePeriodData(JSON.parse(raw)), error: '', saving: false });
    } catch (reason) { publish({ ...snapshot, error: String(reason) }); }
  };
  void listen('history:restored', reload);
  // Saved by another window (the app or a widget; its label is the payload) or restored from Drive (no payload).
  void listen<string | null>('period:changed', event => { if (event.payload !== ownLabel()) void reload(); });
}
const listeners = new Set<() => void>();
function publish(next: typeof snapshot) { snapshot = next; listeners.forEach(listener => listener()); }
function ensure() {
  listenForHistory();
  return loading ??= invoke<string>('load_period_data').then(raw => {
    publish({ data: normalizePeriodData(JSON.parse(raw)), error: '', saving: false });
    void moveTimerTime().then(ensureActivityTags).catch(reason => publish({ ...snapshot, error: String(reason) }));
  }).catch(reason => { loading = null; publish({ ...snapshot, error: String(reason) }); });
}
// Writes go out one at a time, the newest state only: typing in a note changes the data on every key, and a write
// waiting behind one in flight is replaced by the next change instead of saving every state in turn (the last saved is
// always the newest, as before).
let queued: { data: PeriodData; version: number } | null = null;
let draining: Promise<void> | null = null;
function drain(): Promise<void> {
  return draining ??= (async () => {
    while (queued) {
      const { data, version } = queued;
      queued = null;
      try {
        await invoke('save_period_data', { data: JSON.stringify(data) });
        if (version === revision) publish({ ...snapshot, saving: false, error: '' });
      } catch (reason) { if (version === revision) publish({ ...snapshot, saving: false, error: String(reason) }); }
    }
    draining = null;
  })();
}
export function changePeriodData(update: (current: PeriodData) => PeriodData) {
  if (!snapshot.data) return;
  const next = update(snapshot.data), version = ++revision;
  publish({ data: next, error: '', saving: true });
  queued = { data: next, version };
  writes = drain();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function flushPeriodData() { await writes; if (snapshot.error) throw new Error(snapshot.error); }
export function usePeriodData() {
  useEffect(() => { void ensure(); }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Gives every activity its tag (see activityTags); calendar entries with that tag count as the activity's time. */
export async function ensureActivityTags() {
  await loadTags();
  const linked = (data: PeriodData) => data.definitions.every(item => item.calendarTagId && currentTags().some(tag => tag.id === item.calendarTagId));
  if (!snapshot.data || linked(snapshot.data)) return;
  let tagIds = new Map<string, string>();
  await saveTags(tags => {
    const result = activityTags(tags, snapshot.data?.definitions ?? [], () => crypto.randomUUID());
    tagIds = new Map(result.definitions.map(item => [item.id, item.calendarTagId!]));
    return result.tags;
  });
  changePeriodData(current => ({ ...current, definitions: current.definitions.map(item => tagIds.has(item.id) ? { ...item, calendarTagId: tagIds.get(item.id) } : item) }));
}

/** Once: the timer used to add its time to the day's minutes as well as to the calendar. Its calendar entries now count
 *  by themselves, so that part leaves the stored minutes (typed minutes stay). */
async function moveTimerTime() {
  const data = snapshot.data;
  if (!data || data.calendarTime) return;
  const tagged = new Map(data.definitions.filter(item => item.calendarTagId).map(item => [item.calendarTagId!, item.id]));
  const dates = Object.keys(data.days).filter(date => Object.entries(data.days[date].items).some(([id, record]) => (record.minutes ?? 0) > 0 && data.definitions.some(item => item.id === id && item.calendarTagId))).sort();
  const timed: Record<string, Record<string, number>> = {};
  for (let from = dates[0]; from && from <= dates[dates.length - 1]; from = shiftDate(from, 366)) {
    const to = shiftDate(from, 365) < dates[dates.length - 1] ? shiftDate(from, 365) : dates[dates.length - 1];
    for (const day of await loadRange(from, to)) for (const entry of day.entries) {
      const id = entry.tag ? tagged.get(entry.tag) : undefined;
      if (id && entry.calendarUid?.startsWith('activity-time:')) (timed[day.date] ??= {})[id] = (timed[day.date]?.[id] ?? 0) + entryMinutes(entry);
    }
  }
  changePeriodData(current => {
    const days = { ...current.days };
    for (const [date, items] of Object.entries(timed)) {
      const day = days[date];
      if (!day) continue;
      const next = { ...day.items };
      for (const [id, minutes] of Object.entries(items)) if (next[id]?.minutes != null) next[id] = { ...next[id], minutes: Math.max(0, next[id].minutes! - minutes) };
      days[date] = { ...day, items: next };
    }
    return { ...current, days, calendarTime: true };
  });
}
