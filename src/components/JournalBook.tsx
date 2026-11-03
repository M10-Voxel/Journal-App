import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, Ref, RefObject } from 'react';
import { t, useLanguage } from '../i18n';
import { formatDate, formatShortDate } from '../dates';
import { firstPage, normalizePage, pageKey, pageNumber, pagesOf, samePage, showsDate, shownDate, spreadOf, spreadPagesOf, spreadStart, startFor, turnPage, turnSpread } from '../book';
import type { BookPage, BookPaging, PageKind } from '../book';
import type { PeriodMode } from '../periods';
import { periodEyebrow, periodTitle } from './PeriodNotes';
import { useWheelSwipe } from './useWheelSwipe';

/** What the app can ask of the book: turn one page, or open a page of the shown day (bookmarks). */
export interface BookControl { turn: (step: 1 | -1) => void; open: (page: PageKind) => void }
export type BookView = 'double' | 'single';

const viewKey = 'journal.bookView';
/** Spread or single page, remembered on the device. */
export function useBookView(): [BookView, (view: BookView) => void] {
  const [view, setView] = useState<BookView>(() => { try { return localStorage.getItem(viewKey) === 'single' ? 'single' : 'double'; } catch { return 'double'; } });
  return [view, next => { setView(next); try { localStorage.setItem(viewKey, next); } catch { /* keep it for this session */ } }];
}
/** Below this width a spread would squeeze its pages; the book shows one page then. */
const doubleMinWidth = 880;
const turnTime = 460;

export const pageTitle = (page: PageKind) => ({
  entries: t('Einträge'), data: t('Daten'), board: t('Pinnwand'), notes: t('Notiz'), activities: t('Aktivitäten'),
})[page];

type Turn = { from: BookPage[]; to: BookPage[]; step: 1 | -1; kind: 'turn' | 'jump'; spreads: boolean; id: number };
type Leaf = { page: BookPage; slot: 'left' | 'right' | 'single' | 'wide'; motion: string; outgoing: boolean };

/**
 * The journal style's book. Pages are laid out as a spread (or one page) and keep their React identity by page, so the
 * page that moves from right to left while turning stays mounted (with its focus, scroll position and editors).
 * The app's day follows the book: the day of the visible entries page, else of the first page (see book.ts).
 *
 * `paging`: one page at a time, or both at once (`spread`: the board then lies over both pages). `beside` (the calendar
 * sheet lies on the book while both pages turn at once): one page, from the sheet's edge (`sheetWidth`) to the right.
 */
export function JournalBook({ mode, date, view, paging = 'page', beside = false, sheetWidth, onNavigate, renderPage, entriesScrollRef, ribbon, overlay, register, controlRef, onWideChange }: {
  mode: PeriodMode; date: string; view: BookView; paging?: BookPaging; beside?: boolean; sheetWidth?: number; onNavigate: (date: string) => void; renderPage: (page: BookPage) => ReactNode;
  entriesScrollRef: RefObject<HTMLDivElement | null>; ribbon?: ReactNode; controlRef?: Ref<BookControl>; onWideChange?: (wide: boolean) => void;
  /** Lies over the left page (the calendar sheet). */
  overlay?: ReactNode;
  /** Tabs on the book's top edge (the views: day … year). */
  register?: ReactNode;
}) {
  useLanguage();
  const stageRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const stage = stageRef.current; if (!stage) return;
    const measure = () => { const value = stage.clientWidth >= doubleMinWidth; setWide(value); onWideChange?.(value); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const double = view === 'double' && wide && !beside;
  const spreads = paging === 'spread' && double;
  const [start, setStart] = useState<BookPage>(() => ({ date, page: firstPage(mode) }));
  const layout = (page: BookPage, mode: PeriodMode, double: boolean, spreads: boolean) => spreads ? spreadPagesOf(page, mode) : spreadOf(normalizePage(page, mode), mode, double);
  const pages = layout(start, mode, double, spreads);
  const [turn, setTurn] = useState<Turn | null>(null);
  const turnId = useRef(0);
  // Days the book asked the app for that have not arrived yet (saving first can delay them).
  const requested = useRef<string[]>([]);
  const latest = useRef({ pages, mode, double, spreads, date });
  latest.current = { pages, mode, double, spreads, date };

  const go = (next: BookPage, kind: 'turn' | 'jump', step: 1 | -1) => {
    const { pages: from, mode, double, spreads, date } = latest.current;
    const to = layout(next, mode, double, spreads);
    if (samePage(from[0], to[0])) return;
    turnId.current += 1;
    setTurn({ from, to, step, kind, spreads, id: turnId.current });
    setStart(to[0]);
    const target = mode === 'day' ? shownDate(to) : to[0].date;
    if (target !== date && !(mode !== 'day' && showsDate(to, mode, date))) { requested.current.push(target); onNavigate(target); }
  };
  const step = (amount: 1 | -1) => {
    const { pages, mode, spreads } = latest.current;
    go(spreads ? turnSpread(pages[0], mode, amount) : turnPage(pages[0], mode, amount), 'turn', amount);
  };
  const open = (page: PageKind) => {
    const { pages, mode, double, spreads } = latest.current;
    const day = mode === 'day' ? shownDate(pages) : pages[0].date;
    const target = spreads ? spreadStart({ date: day, page }, mode) : startFor({ date: day, page }, mode, double);
    const order = (value: BookPage) => `${value.date}:${pagesOf(mode).indexOf(value.page)}`;
    go(target, 'jump', order(target) > order(pages[0]) ? 1 : -1);
  };
  useImperativeHandle(controlRef, () => ({ turn: step, open }));

  // The turn ends after its animation; a new turn replaces it at once.
  useEffect(() => {
    if (!turn) return;
    const timer = window.setTimeout(() => setTurn(current => current?.id === turn.id ? null : current), turnTime + 40);
    return () => window.clearTimeout(timer);
  }, [turn]);
  // A turn in progress belongs to the previous layout; it would play again on the new one. Switching to a spread (one
  // page at a time) on the last page of a day shows it with the page before, so the day stays.
  useLayoutEffect(() => {
    setTurn(null);
    const { pages, mode, date, spreads } = latest.current;
    if (spreads) setStart(pages[0]);
    else if (double && mode === 'day' && shownDate(pages) !== date && !requested.current.length) setStart(startFor(pages[0], mode, true));
  }, [double, spreads]);
  // Another view (week … year) starts at its first page.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    requested.current = [];
    setTurn(null);
    setStart({ date: latest.current.date, page: firstPage(mode) });
  }, [mode]);
  // A day chosen elsewhere (calendar, Alt ←/→, the date picker, today) opens at its entries page.
  useEffect(() => {
    const index = requested.current.indexOf(date);
    if (index >= 0) { requested.current.splice(0, index + 1); if (requested.current.length) return; }
    else requested.current = [];
    const { pages, mode } = latest.current;
    if (showsDate(pages, mode, date)) return;
    const step = date > pages[0].date ? 1 : -1;
    go({ date, page: firstPage(mode) }, 'jump', step);
  }, [date]);

  useWheelSwipe(step, { root: stageRef, ignore: '.entry-dock-shell, .planner' });

  const { leaves, ghosts } = arrange(pages, turn, mode, double, spreads);
  const shown = mode === 'day' ? shownDate(pages) : pages[0].date;
  const marks = pagesOf(mode);

  return <div className={`book-stage${double ? ' is-double' : ' is-single'}${spreads ? ' is-spreads' : ''}${beside ? ' is-beside' : ''}`} ref={stageRef}>
    {ribbon}
    <div className="book" style={sheetWidth ? { '--drawer-width': `${sheetWidth}px` } as CSSProperties : undefined}>
      <div className="book-spread">
        {leaves.map(({ page, slot, motion, outgoing }) => <article key={pageKey(page)} className={`book-page is-${slot} is-${page.page}${motion ? ` is-${motion}` : ''}${outgoing ? ' is-outgoing' : ''}`}
          inert={outgoing} aria-hidden={outgoing || undefined} data-page={page.page} data-date={page.date} aria-label={`${pageTitle(page.page)} · ${formatDate(page.date)}`}>
          <div className="book-page-scroll" ref={page.page === 'entries' && !outgoing ? entriesScrollRef : undefined}>
            <div className="book-page-content">
              {page.page !== 'entries' && <PageHead page={page} mode={mode} />}
              {renderPage(page)}
            </div>
          </div>
          <footer className="book-page-foot" aria-hidden="true"><span>{pageTitle(page.page)}</span><span className="book-page-number">{pageNumber(page, mode)}</span><span>{mode === 'day' ? formatShortDate(page.date) : periodTitle(page.date, mode)}</span></footer>
          {slot !== 'right' && <button type="button" className="book-corner is-prev" tabIndex={-1} aria-label={t('Zurückblättern')} title={t('Zurückblättern · Strg Bild↑')} onClick={() => step(-1)} />}
          {slot !== 'left' && <button type="button" className="book-corner is-next" tabIndex={-1} aria-label={t('Umblättern')} title={t('Umblättern · Strg Bild↓')} onClick={() => step(1)} />}
        </article>)}
        {/* The back of a turning leaf where its page cannot be drawn twice (the board over both pages). */}
        {ghosts.map(ghost => <div key={`${turn?.id}-${ghost}`} className={`book-ghost is-${ghost}`} aria-hidden="true" />)}
      </div>
      <nav className="book-marks" aria-label={t('Lesezeichen')}>
        {marks.map(mark => <button type="button" key={mark} className={`book-mark is-${mark}`} aria-current={pages.some(page => page.page === mark && page.date === shown) ? 'page' : undefined}
          title={pageTitle(mark)} onClick={() => open(mark)}><span>{pageTitle(mark)}</span></button>)}
      </nav>
      {register}
      {overlay}
    </div>
  </div>;
}

/**
 * What is drawn: the pages shown and, while turning, the pages that leave. One page at a time, the page shared by both
 * spreads turns about the spine. Both pages at once, the outer page of the old spread lifts and the first page of the
 * new one lies down on the other side; where one of them is the board over both pages, a blank leaf turns for it.
 */
function arrange(pages: BookPage[], turn: Turn | null, mode: PeriodMode, double: boolean, spreads: boolean): { leaves: Leaf[]; ghosts: string[] } {
  const leaves: Leaf[] = [], ghosts: string[] = [];
  const slotOf = (index: number, count: number): Leaf['slot'] => !double ? 'single' : count === 1 ? 'wide' : index === 0 ? 'left' : 'right';
  const live = turn && turn.spreads === spreads && turn.to.length === pages.length && turn.to.every((page, index) => samePage(page, pages[index])) ? turn : null;
  if (live && live.kind === 'turn' && spreads && samePage(turnSpread(live.from[0], mode, live.step), pages[0])) {
    const { from, to, step } = live, forward = step > 0, fromWide = from.length === 1, toWide = to.length === 1;
    const near = forward ? 'left' : 'right', far = forward ? 'right' : 'left';
    if (toWide) { leaves.push({ page: to[0], slot: 'wide', motion: '', outgoing: false }); ghosts.push(`land-${near}`); }
    else to.forEach((page, index) => leaves.push({ page, slot: index === 0 ? 'left' : 'right', motion: (index === 0) === forward ? `land-${near}` : '', outgoing: false }));
    if (fromWide) { leaves.push({ page: from[0], slot: 'wide', motion: `clip-to-${near}`, outgoing: true }); ghosts.push(`lift-${far}`); }
    else from.forEach((page, index) => leaves.push({ page, slot: index === 0 ? 'left' : 'right', motion: (index === 0) === forward ? (toWide ? 'beneath-fade' : 'beneath') : `lift-${far}`, outgoing: true }));
    return { leaves, ghosts };
  }
  const adjacent = live && live.kind === 'turn' && !spreads && (double
    ? live.from.length === 2 && (live.step > 0 ? samePage(live.from[1], pages[0]) : samePage(live.from[0], pages[1]))
    : live.from.length === 1 && samePage(turnPage(live.from[0], mode, live.step), pages[0]));
  pages.forEach((page, index) => {
    let motion = '';
    if (live && !adjacent) motion = live.step > 0 ? 'jump-next' : 'jump-prev';
    else if (adjacent && double && live.step > 0 && index === 0) motion = 'turn-to-left';
    else if (adjacent && double && live.step < 0 && index === 1) motion = 'turn-to-right';
    else if (adjacent && !double && live.step < 0) motion = 'lay-down';
    leaves.push({ page, slot: slotOf(index, pages.length), motion, outgoing: false });
  });
  if (adjacent) {
    if (double) leaves.push({ page: live.step > 0 ? live.from[0] : live.from[1], slot: live.step > 0 ? 'left' : 'right', motion: 'beneath', outgoing: true });
    else leaves.push({ page: live.from[0], slot: 'single', motion: live.step > 0 ? 'lift-off' : 'beneath', outgoing: true });
  }
  return { leaves, ghosts };
}

function PageHead({ page, mode }: { page: BookPage; mode: PeriodMode }) {
  const eyebrow = mode === 'day' ? (page.page === 'data' ? t('Tagesbewertung & Checkliste') : t('Pinnwand')) : `${periodEyebrow(mode)} · ${pageTitle(page.page)}`;
  return <div className="document-header book-page-head">
    <div className="eyebrow">{eyebrow}</div>
    <h1>{mode === 'day' ? formatDate(page.date) : periodTitle(page.date, mode)}</h1>
  </div>;
}

/** Spread or single page, for the toolbar. */
export function BookViewSwitch({ view, narrow = false, onChange }: { view: BookView; narrow?: boolean; onChange: (view: BookView) => void }) {
  useLanguage();
  // In a narrow window the book shows one page whatever was chosen; the choice returns when there is room again.
  const shown = narrow ? 'single' : view;
  return <div className="book-view-switch" role="radiogroup" aria-label={t('Buchansicht')}>
    {(['double', 'single'] as const).map(value => <button type="button" key={value} role="radio" aria-checked={shown === value} data-book-view={value}
      title={value === 'double' ? (narrow ? t('Doppelseite · bei breiterem Fenster') : t('Doppelseite')) : t('Einzelseite')} onClick={() => onChange(value)}>
      <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
        {value === 'double' ? <><path d="M8 4.2C6.6 3.2 4.4 2.8 2 3v9.6c2.4-.2 4.6.2 6 1.2 1.4-1 3.6-1.4 6-1.2V3c-2.4-.2-4.6.2-6 1.2Z" /><path d="M8 4.2v9.6" /></>
          : <><path d="M4 2.5h6.5l2 2v9h-8.5Z" /><path d="M6 7h4.5M6 9.5h4.5" /></>}
      </svg>
      <span>{value === 'double' ? t('Doppelseite') : t('Einzelseite')}</span>
    </button>)}
  </div>;
}
