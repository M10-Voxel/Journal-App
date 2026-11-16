import type { PeriodMode } from './periods.ts';

/**
 * Which parts of the app are on (Einstellungen → Funktionen). The calendar is always there; the notebook and each view
 * (day … year) can be switched off, and every view shows the modules chosen for it:
 * - `entries`: the day's entries, or a list of its own for a week … year (periodData `entries`).
 * - `note`: a free text for the day or period.
 * - `rating`, `scales`: the rating and the own values (Tageswerte); in a week … year values of the period itself,
 *   unrelated to its days (periodData `periods`).
 * - `activities`: the checklist. In a week … year it adds up the days: the time recorded on them, and a timer that records
 *   on the day it runs (see activityCalendar.ts).
 * - `evaluation`: the chart of the days' values and the activities' overview (not offered for a single day).
 * - `board`: a pinboard of its own for this day or period (boardPlacement.ts `boardKey`).
 */
export type Module = 'entries' | 'note' | 'rating' | 'scales' | 'activities' | 'evaluation' | 'board';
export const modes: readonly PeriodMode[] = ['day', 'week', 'month', 'quarter', 'year'];
/** Every module in the order a view shows them. */
export const moduleOrder: readonly Module[] = ['entries', 'rating', 'scales', 'activities', 'note', 'evaluation', 'board'];
export const modulesOf = (mode: PeriodMode): readonly Module[] => mode === 'day' ? moduleOrder.filter(item => item !== 'evaluation') : moduleOrder;

export interface ViewFeatures { on: boolean; modules: Module[] }
export interface Features { notebook: boolean; views: Record<PeriodMode, ViewFeatures> }

/** What the app showed before the views could be chosen: a day's entries, values and board; a period's note and
 *  evaluation, with a board for months and years. */
export const defaultFeatures = (): Features => ({
  notebook: true,
  views: {
    day: { on: true, modules: ['entries', 'rating', 'scales', 'activities', 'board'] },
    week: { on: true, modules: ['note', 'evaluation'] },
    month: { on: true, modules: ['note', 'evaluation', 'board'] },
    quarter: { on: true, modules: ['note', 'evaluation'] },
    year: { on: true, modules: ['note', 'evaluation', 'board'] },
  },
});

/**
 * Stored features made valid: known modules only, in their order. A view without any module is off; with every view
 * off the day comes back (something has to be shown beside the calendar).
 */
export function normalizeFeatures(raw: unknown): Features {
  const base = defaultFeatures();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as { notebook?: unknown; views?: Record<string, unknown> };
  const views = {} as Features['views'];
  for (const mode of modes) {
    const stored = value.views?.[mode] as { on?: unknown; modules?: unknown } | undefined;
    if (!stored || typeof stored !== 'object') { views[mode] = base.views[mode]; continue; }
    const wanted = Array.isArray(stored.modules) ? new Set(stored.modules) : new Set(base.views[mode].modules);
    const modules = modulesOf(mode).filter(item => wanted.has(item));
    views[mode] = { on: stored.on !== false && modules.length > 0, modules };
  }
  if (!modes.some(mode => views[mode].on)) views.day = { on: true, modules: views.day.modules.length ? views.day.modules : base.views.day.modules };
  return { notebook: value.notebook !== false, views };
}

/** The views on, in their order (never empty after normalizeFeatures). */
export const enabledModes = (features: Features): PeriodMode[] => modes.filter(mode => features.views[mode].on);
export const isModeOn = (features: Features, mode: PeriodMode) => features.views[mode].on;
export const hasModule = (features: Features, mode: PeriodMode, module: Module) => features.views[mode].on && features.views[mode].modules.includes(module);
export const modulesShown = (features: Features, mode: PeriodMode): ReadonlySet<Module> => new Set(features.views[mode].on ? features.views[mode].modules : []);
/** The view to show instead of one switched off: the nearest one on (a smaller one first). */
export function availableMode(features: Features, mode: PeriodMode): PeriodMode {
  if (isModeOn(features, mode)) return mode;
  const index = modes.indexOf(mode);
  const near = [...modes].sort((a, b) => Math.abs(modes.indexOf(a) - index) - Math.abs(modes.indexOf(b) - index) || modes.indexOf(a) - modes.indexOf(b));
  return near.find(item => isModeOn(features, item)) ?? 'day';
}
/** The period boards (week … year) shown somewhere: only these are offered when pinning a card to another board. */
export const periodBoards = (features: Features): Exclude<PeriodMode, 'day'>[] =>
  modes.filter((mode): mode is Exclude<PeriodMode, 'day'> => mode !== 'day' && hasModule(features, mode, 'board'));

/** Switching a view on or off; the last view on stays on. */
export function withView(features: Features, mode: PeriodMode, on: boolean): Features {
  if (!on && enabledModes(features).every(item => item === mode)) return features;
  const view = features.views[mode];
  // A view switched on without modules gets the ones it had by default.
  const modules = on && !view.modules.length ? defaultFeatures().views[mode].modules : view.modules;
  return { ...features, views: { ...features.views, [mode]: { on, modules } } };
}
/** Switching a module of a view on or off; the last module of a view stays (switch the view off instead). */
export function withModule(features: Features, mode: PeriodMode, module: Module, on: boolean): Features {
  const view = features.views[mode];
  if (!modulesOf(mode).includes(module)) return features;
  const wanted = new Set(view.modules);
  if (on) wanted.add(module); else wanted.delete(module);
  const modules = modulesOf(mode).filter(item => wanted.has(item));
  if (!modules.length) return features;
  return { ...features, views: { ...features.views, [mode]: { ...view, modules } } };
}
