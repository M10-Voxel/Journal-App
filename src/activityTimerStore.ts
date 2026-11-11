import { useSyncExternalStore } from 'react';
import type { ActivityTimerState } from './activityTimer';
const key = 'journal.activityTimers.v1';
let timers: Record<string, ActivityTimerState> = {};
try { const parsed = JSON.parse(localStorage.getItem(key) ?? '{}'); for (const [id,value] of Object.entries(parsed)) { const t = value as ActivityTimerState; if (t && typeof t.id === 'string' && typeof t.tagId === 'string' && Number.isFinite(t.elapsedMs) && t.elapsedMs >= 0 && (t.startedAt === null || Number.isFinite(t.startedAt)) && Array.isArray(t.segments)) timers[id] = t; } } catch { /* no saved timers */ }
const listeners = new Set<() => void>();
export const activityTimerKey = (date: string,id: string) => `${date}:${id}`;
export const getActivityTimer = (date: string,id: string) => timers[activityTimerKey(date,id)];
export function writeActivityTimer(date: string,id: string,timer: ActivityTimerState | null) {
  const next = { ...timers }; if (timer) next[activityTimerKey(date,id)] = timer; else delete next[activityTimerKey(date,id)];
  localStorage.setItem(key,JSON.stringify(next)); timers = next; listeners.forEach(listener => listener());
}
// Another window (the app, a widget) started or stopped a timer.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== key && event.key !== null) return;
  try { const parsed = JSON.parse(localStorage.getItem(key) ?? '{}'); timers = parsed && typeof parsed === 'object' ? parsed : {}; } catch { timers = {}; }
  listeners.forEach(listener => listener());
});
export function useActivityTimers() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => timers); }
