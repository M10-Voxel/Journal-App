import { localDate, shiftDate } from './dates.ts';
import { periodBounds } from './periods.ts';
import type { PeriodMode } from './periods.ts';

// The journal style shows the app as a book. A day has three pages (entries, data, board), an overview (week to year)
// two (note with ratings, activities). The book runs on: after the last page of a day (or period) the first page of the
// next one follows. A spread shows a page and the next one; turning moves by one page, so the right page goes left.
export type DayPage = 'entries' | 'data' | 'board';
export type PeriodPage = 'notes' | 'activities';
export type PageKind = DayPage | PeriodPage;
export interface BookPage { date: string; page: PageKind }

export const dayPages: readonly DayPage[] = ['entries', 'data', 'board'];
export const periodPages: readonly PeriodPage[] = ['notes', 'activities'];
export const pagesOf = (mode: PeriodMode): readonly PageKind[] => mode === 'day' ? dayPages : periodPages;
export const firstPage = (mode: PeriodMode): PageKind => pagesOf(mode)[0];
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

/** The page of this mode a page stands for (a day page in an overview becomes its period's note, and back). */
export function normalizePage(page: BookPage, mode: PeriodMode): BookPage {
  return pagesOf(mode).includes(page.page) ? page : { date: page.date, page: firstPage(mode) };
}
export function nextPage(page: BookPage, mode: PeriodMode): BookPage {
  const pages = pagesOf(mode), index = pages.indexOf(page.page);
  return index < pages.length - 1 ? { date: page.date, page: pages[index + 1] } : { date: shiftPeriod(page.date, mode, 1), page: pages[0] };
}
export function previousPage(page: BookPage, mode: PeriodMode): BookPage {
  const pages = pagesOf(mode), index = pages.indexOf(page.page);
  return index > 0 ? { date: page.date, page: pages[index - 1] } : { date: shiftPeriod(page.date, mode, -1), page: pages[pages.length - 1] };
}
export function turnPage(page: BookPage, mode: PeriodMode, step: 1 | -1): BookPage {
  return step > 0 ? nextPage(page, mode) : previousPage(page, mode);
}
/** The pages on screen, from the first one: a spread (`double`) or a single page. */
export function spreadOf(start: BookPage, mode: PeriodMode, double: boolean): BookPage[] {
  return double ? [start, nextPage(start, mode)] : [start];
}
/**
 * The day the app shows (and saves) for these pages: the day of the visible entries page, otherwise the first page's.
 * A spread never holds two entries pages, so this is unambiguous.
 */
export function shownDate(pages: BookPage[]): string {
  return (pages.find(page => page.page === 'entries') ?? pages[0]).date;
}
/**
 * The first page that shows `target` without leaving its day: in a spread the last page of a day (the board) is shown
 * with the page before it, so the next day's entries do not come along.
 */
export function startFor(target: BookPage, mode: PeriodMode, double: boolean): BookPage {
  const pages = pagesOf(mode);
  return double && pages.length > 1 && target.page === pages[pages.length - 1] ? previousPage(target, mode) : target;
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
/** A page number for the foot of the page, counted from the start of the year (a day has three pages, a period two). */
export function pageNumber(page: BookPage, mode: PeriodMode): number {
  const pages = pagesOf(mode), index = Math.max(0, pages.indexOf(page.page));
  const month = Number(page.date.slice(5, 7));
  const unit = mode === 'day' ? dayOfYear(page.date) - 1 : mode === 'week' ? Math.floor((dayOfYear(page.date) - 1) / 7)
    : mode === 'month' ? month - 1 : mode === 'quarter' ? Math.floor((month - 1) / 3) : 0;
  return unit * pages.length + index + 1;
}

/**
 * Turning both pages at once (`spread`): a day is the spread entries | data, then the board over both pages; an
 * overview is notes | activities. One page at a time (`page`) is the paging above.
 */
export type BookPaging = 'page' | 'spread';
/** The first page of the spread this page belongs to when both pages turn at once. */
export function spreadStart(page: BookPage, mode: PeriodMode): BookPage {
  const value = normalizePage(page, mode);
  if (mode !== 'day') return { date: value.date, page: 'notes' };
  return value.page === 'board' ? value : { date: value.date, page: 'entries' };
}
/** The pages of that spread: two, or the board alone (two pages wide). */
export function spreadPagesOf(page: BookPage, mode: PeriodMode): BookPage[] {
  const start = spreadStart(page, mode);
  return mode === 'day' && start.page === 'board' ? [start] : [start, nextPage(start, mode)];
}
/** The next (or previous) spread when both pages turn at once. */
export function turnSpread(page: BookPage, mode: PeriodMode, step: 1 | -1): BookPage {
  const start = spreadStart(page, mode);
  if (mode !== 'day') return { date: shiftPeriod(start.date, mode, step), page: 'notes' };
  if (step > 0) return start.page === 'board' ? nextPage(start, mode) : { date: start.date, page: 'board' };
  return start.page === 'board' ? { date: start.date, page: 'entries' } : previousPage(start, mode);
}
