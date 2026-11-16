import { localDate, shiftDate } from './dates.ts';
import { periodBounds } from './periods.ts';
import type { PeriodMode } from './periods.ts';
import { defaultFeatures } from './features.ts';
import type { Module } from './features.ts';

// The pages of a day or period follow from its modules (Einstellungen → Funktionen, features.ts): its entries, its data
// (rating, values, checklist), its note with the evaluation's chart (`notes`), the evaluation's activities (`activities`),
// its board. The book runs on: after the last page of a day (or period) the first page of the next one follows. A spread
// shows a page and the next one; turning moves by one page, so the right page goes left.
// Every function takes the pages of the view (`kinds`, see bookPages); without them the pages of the default modules.
export type DayPage = 'entries' | 'data' | 'notes' | 'board';
export type PeriodPage = 'entries' | 'data' | 'notes' | 'activities' | 'board';
export type PageKind = DayPage | PeriodPage;
export interface BookPage { date: string; page: PageKind }
export type Kinds = readonly PageKind[];

/** The pages of a view with these modules, in their order (never none: a view without modules shows its entries page). */
export function bookPages(modules: ReadonlySet<Module>, mode: PeriodMode): PageKind[] {
  const pages: PageKind[] = [];
  if (modules.has('entries')) pages.push('entries');
  if (modules.has('rating') || modules.has('scales') || modules.has('activities')) pages.push('data');
  if (modules.has('note') || (mode !== 'day' && modules.has('evaluation'))) pages.push('notes');
  if (mode !== 'day' && modules.has('evaluation')) pages.push('activities');
  if (modules.has('board')) pages.push('board');
  return pages.length ? pages : ['entries'];
}
const defaults = Object.fromEntries((['day', 'week', 'month', 'quarter', 'year'] as const)
  .map(mode => [mode, bookPages(new Set(defaultFeatures().views[mode].modules), mode)])) as Record<PeriodMode, PageKind[]>;
export const dayPages: Kinds = defaults.day;
export const pagesOf = (mode: PeriodMode, kinds?: Kinds): Kinds => kinds?.length ? kinds : defaults[mode];
export const firstPage = (mode: PeriodMode, kinds?: Kinds): PageKind => pagesOf(mode, kinds)[0];
export const pageKey = (page: BookPage) => `${page.page}:${page.date}`;
export const samePage = (a: BookPage, b: BookPage) => a.date === b.date && a.page === b.page;

/** A day, week, month, quarter or year on (`amount` > 0) or back; months keep the day where it exists. */
export function shiftPeriod(date: string, mode: PeriodMode, amount: number): string {
  if (mode === 'day') return shiftDate(date, amount);
  if (mode === 'week') return shiftDate(date, amount * 7);
  const [year, month, day] = date.split('-').map(Number);
  const count = mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12;
  const first = new Date(year, month - 1 + amount * count, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  return localDate(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last), 12));
}

/** The page of this mode a page stands for (a day page in an overview becomes its period's first page, and back). */
export function normalizePage(page: BookPage, mode: PeriodMode, kinds?: Kinds): BookPage {
  return pagesOf(mode, kinds).includes(page.page) ? page : { date: page.date, page: firstPage(mode, kinds) };
}
export function nextPage(page: BookPage, mode: PeriodMode, kinds?: Kinds): BookPage {
  const pages = pagesOf(mode, kinds), index = pages.indexOf(page.page);
  return index < pages.length - 1 ? { date: page.date, page: pages[index + 1] } : { date: shiftPeriod(page.date, mode, 1), page: pages[0] };
}
export function previousPage(page: BookPage, mode: PeriodMode, kinds?: Kinds): BookPage {
  const pages = pagesOf(mode, kinds), index = pages.indexOf(page.page);
  return index > 0 ? { date: page.date, page: pages[index - 1] } : { date: shiftPeriod(page.date, mode, -1), page: pages[pages.length - 1] };
}
export function turnPage(page: BookPage, mode: PeriodMode, step: 1 | -1, kinds?: Kinds): BookPage {
  return step > 0 ? nextPage(page, mode, kinds) : previousPage(page, mode, kinds);
}
/** The pages on screen, from the first one: a spread (`double`) or a single page. */
export function spreadOf(start: BookPage, mode: PeriodMode, double: boolean, kinds?: Kinds): BookPage[] {
  return double ? [start, nextPage(start, mode, kinds)] : [start];
}
/**
 * The day the app shows (and saves) for these pages: the day of the visible entries page, otherwise the first page's.
 * A spread never holds two entries pages of days, so this is unambiguous.
 */
export function shownDate(pages: BookPage[]): string {
  return (pages.find(page => page.page === 'entries') ?? pages[0]).date;
}
/**
 * The first page that shows `target` without leaving its day: in a spread the last page of a day (the board) is shown
 * with the page before it, so the next day's entries do not come along.
 */
export function startFor(target: BookPage, mode: PeriodMode, double: boolean, kinds?: Kinds): BookPage {
  const pages = pagesOf(mode, kinds);
  return double && pages.length > 1 && target.page === pages[pages.length - 1] ? previousPage(target, mode, kinds) : target;
}
/** Whether the pages already show the given date in this mode (a date inside the shown period counts). */
export function showsDate(pages: BookPage[], mode: PeriodMode, date: string): boolean {
  if (mode === 'day') return shownDate(pages) === date;
  const [start, end] = periodBounds(pages[0].date, mode);
  return date >= start && date <= end;
}

const dayOfYear = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
};
/** A page number for the foot of the page, counted from the start of the year. */
export function pageNumber(page: BookPage, mode: PeriodMode, kinds?: Kinds): number {
  const pages = pagesOf(mode, kinds), index = Math.max(0, pages.indexOf(page.page));
  const month = Number(page.date.slice(5, 7));
  const unit = mode === 'day' ? dayOfYear(page.date) - 1 : mode === 'week' ? Math.floor((dayOfYear(page.date) - 1) / 7)
    : mode === 'month' ? month - 1 : mode === 'quarter' ? Math.floor((month - 1) / 3) : 0;
  return unit * pages.length + index + 1;
}

/**
 * Turning both pages at once (`spread`): the pages of a day or period two by two (entries | data, notes | activities),
 * the board over both pages; a page left over lies alone over both. One page at a time (`page`) is the paging above.
 */
export type BookPaging = 'page' | 'spread';
/** The spreads of a view: pairs of pages, the board alone. */
export function spreadGroups(mode: PeriodMode, kinds?: Kinds): PageKind[][] {
  const groups: PageKind[][] = [];
  for (const kind of pagesOf(mode, kinds)) {
    const last = groups[groups.length - 1];
    if (kind !== 'board' && last && last.length < 2 && last[0] !== 'board') last.push(kind); else groups.push([kind]);
  }
  return groups;
}
function groupOf(page: BookPage, mode: PeriodMode, kinds?: Kinds) {
  const groups = spreadGroups(mode, kinds), value = normalizePage(page, mode, kinds);
  return { groups, index: groups.findIndex(group => group.includes(value.page)), date: value.date };
}
/** The first page of the spread this page belongs to when both pages turn at once. */
export function spreadStart(page: BookPage, mode: PeriodMode, kinds?: Kinds): BookPage {
  const { groups, index, date } = groupOf(page, mode, kinds);
  return { date, page: groups[index][0] };
}
/** The pages of that spread: two, or one alone (two pages wide). */
export function spreadPagesOf(page: BookPage, mode: PeriodMode, kinds?: Kinds): BookPage[] {
  const { groups, index, date } = groupOf(page, mode, kinds);
  return groups[index].map(kind => ({ date, page: kind }));
}
/** The next (or previous) spread when both pages turn at once. */
export function turnSpread(page: BookPage, mode: PeriodMode, step: 1 | -1, kinds?: Kinds): BookPage {
  const { groups, index, date } = groupOf(page, mode, kinds), target = index + step;
  if (target >= 0 && target < groups.length) return { date, page: groups[target][0] };
  return { date: shiftPeriod(date, mode, step), page: (step > 0 ? groups[0] : groups[groups.length - 1])[0] };
}
