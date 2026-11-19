import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ActivityTimerState } from './activityTimer';

/**
 * The activity timers live in the database (journal-core `timers`), shared by every window of the app and by J-TerminaL.
 * Starting, pausing and stopping are single commands there; this module keeps the last known state for React and reads
 * it again when anything (another window, J-TerminaL) changed it (`timers:changed`).
 */
const legacyKey = 'journal.activityTimers.v1';
let timers: Record<string, ActivityTimerState> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (next: Record<string, ActivityTimerState>) => { timers = next ?? {}; listeners.forEach(listener => listener()); };
export const activityTimerKey = (date: string,id: string) => `${date}:${id}`;
export const getActivityTimer = (date: string,id: string): ActivityTimerState | undefined => timers[activityTimerKey(date,id)];

/** Timers an older version kept in this window's local storage (per vault): handed to the database once, then gone. */
function legacyTimers(): Record<string, ActivityTimerState> | null {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw), found: Record<string, ActivityTimerState> = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      const t = value as ActivityTimerState;
      if (t && typeof t.id === 'string' && typeof t.tagId === 'string' && Number.isFinite(t.elapsedMs) && t.elapsedMs >= 0 && (t.startedAt === null || Number.isFinite(t.startedAt)) && Array.isArray(t.segments))
        found[key] = { ...t, elapsedMs: Math.round(t.elapsedMs), startedAt: t.startedAt == null ? null : Math.round(t.startedAt), segments: t.segments.map(s => ({ start: Math.round(s.start), end: Math.round(s.end) })) };
    }
    return found;
  } catch { return {}; }
}

async function load() {
  const legacy = legacyTimers();
  if (legacy) {
    publish(await invoke<Record<string, ActivityTimerState>>('adopt_activity_timers', { timers: legacy }));
    try { localStorage.removeItem(legacyKey); } catch { /* nothing to remove */ }
  } else publish(await invoke<Record<string, ActivityTimerState>>('load_activity_timers'));
}

export function ensureActivityTimers(): Promise<void> {
  if (!loading) {
    loading = load().catch(() => { loading = null; });
    void listen('timers:changed', () => { void invoke<Record<string, ActivityTimerState>>('load_activity_timers').then(publish).catch(() => {}); });
  }
  return loading;
}

export const startActivityTimer = async (date: string, activity: string, calendarTagId?: string) =>
  publish(await invoke<Record<string, ActivityTimerState>>('start_activity_timer', { date, activity, calendarTagId: calendarTagId ?? null }));
export const pauseActivityTimer = async (date: string, activity: string) =>
  publish(await invoke<Record<string, ActivityTimerState>>('pause_activity_timer', { date, activity }));
/** Stops and saves the time in the calendar (with the activity's tag); throws when that failed (the timer stays paused). */
export async function stopActivityTimer(date: string, activity: { id: string; name: string; color: string; calendarTagId?: string }, description: string, fallbackName: string) {
  try {
    publish(await invoke<Record<string, ActivityTimerState>>('stop_activity_timer', { date, activity: activity.id, name: activity.name, color: activity.color,
      calendarTagId: activity.calendarTagId ?? null, description, fallbackName }));
  } catch (reason) {
    void invoke<Record<string, ActivityTimerState>>('load_activity_timers').then(publish).catch(() => {});
    throw reason;
  }
}

/** One subscribe function for every reader (an inline one would make React subscribe anew on each render). */
const subscribeStore = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useActivityTimers() {
  useEffect(() => { void ensureActivityTimers(); }, []);
  return useSyncExternalStore(subscribeStore, () => timers);
}
