import { t, useLanguage } from '../i18n';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { localDate, shiftDate, formatShortDate } from '../dates';
import { plainText } from '../markdown';
import { acceptSuggestion, cardItem, excerpt, highlights, parseQuery, runSearch, searchSuggestions, typeFilters } from '../search';
import type { SearchItem, SearchResult, SearchType } from '../search';
import { tagOf } from '../tags';
import { useTags } from '../tagStore';
import { useCards } from '../boardCards';
import { useCalendarData } from './calendarShared';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createRefreshQueue } from '../refreshQueue';
import { useEffect } from 'react';
import type { Entry } from '../journal';
import type { ParsedQuery } from '../search';
import { useLook } from '../popupLook';
import { Icon } from './Icon';
import { kindOfTag, kindOrder, tagKindLabel, useTagKindOrder } from '../tagKinds';
import { useActivityTagIds } from '../tagGroups';
import type { IconName } from './Icon';

/**
 * The search over everything written by hand. Words find, `@Typ` and `\Tag` filter (suggested while typed, like the
 * repeat field). Each design shows it its own way: Normal a field in the title bar with a list under it (like Zed's
 * palette), Journal an index card out of a tab at the book's edge, Nebula the prompt in the window bar with grep output.
 * Opening a result goes to where it was made (`onOpen`).
 */
export type SearchVariant = 'classic' | 'journal' | 'nebula';

const typeIcon: Record<SearchType, IconName> = { task: 'task', event: 'event', note: 'note', calendar: 'calendar', title: 'journal', board: 'pin', 'board-note': 'pencil', 'board-image': 'layout', 'board-link': 'jump', notebook: 'details' };
const sections = (): { id: string; title: string; types: SearchType[] }[] => [
  { id: 'entries', title: t('Einträge'), types: ['task', 'event', 'note'] },
  { id: 'calendar', title: t('Kalender'), types: ['calendar'] },
  { id: 'titles', title: t('Tage'), types: ['title'] },
  { id: 'board', title: t('Pinnwand'), types: ['board-note', 'board-image', 'board-link'] },
  { id: 'notebook', title: t('Notizblock'), types: ['notebook'] },
];
const shell: Record<SearchType, string> = { task: 'task', event: 'event', note: 'note', calendar: 'cal', title: 'title', board: 'board', 'board-note': 'zettel', 'board-image': 'bild', 'board-link': 'link', notebook: 'notes' };

const entryItem = (date: string, entry: Entry): SearchItem => {
  const calendar = entry.showInJournal === false;
  return { key: `entry:${entry.id}`, type: calendar ? 'calendar' : entry.kind, title: plainText(entry.text) || t('ohne Text'), snippet: entry.description ?? '', date, tag: entry.tag ?? null,
    target: { kind: 'entry', date, id: entry.id, calendar } };
};
const titleItem = (date: string, title: string): SearchItem => ({ key: `title:${date}`, type: 'title', title, snippet: '', date, tag: null, target: { kind: 'title', date } });
type Hit = { date: string; title?: string; entry?: Entry };

/**
 * Entries and day titles come from the store's search over every day (search_entries), asked again a moment after the
 * query changes. The calendar fallback is loaded only if native search is unavailable, and released on closing.
 * Board and notebook cards are searched here, where they are.
 */
function useSearchItems(parsed: ParsedQuery, active: boolean): { items: SearchItem[]; pending: boolean } {
  const today = localDate();
  const { cards } = useCards();
  const [stored, setStored] = useState<SearchItem[] | null>(null);
  const [fallback, setFallback] = useState(false), [completed, setCompleted] = useState('');
  const entryTypes = parsed.types.filter(type => ['task', 'event', 'note', 'calendar', 'title'].includes(type));
  const onlyCards = parsed.types.length > 0 && !entryTypes.length;
  const hasTerms = Boolean(parsed.rawWords.length || parsed.types.length || parsed.tags.length);
  const key = JSON.stringify([parsed.rawWords, entryTypes, parsed.tags]);
  const { days, ready } = useCalendarData(shiftDate(today, -365), shiftDate(today, 90), active && hasTerms && !onlyCards && fallback);
  useEffect(() => {
    if (!active || onlyCards || !hasTerms) { setStored(null); setFallback(false); setCompleted(''); return; }
    let started = false;
    const refresh = createRefreshQueue(async () => {
      const hits = await invoke<Hit[]>('search_entries', { words: parsed.rawWords, kinds: entryTypes, tags: parsed.tags, limit: 200 });
      if (!Array.isArray(hits)) throw new Error('Search unavailable');
      return hits;
    }, hits => {
      setStored(hits.map(hit => hit.entry ? entryItem(hit.date, hit.entry) : titleItem(hit.date, hit.title ?? '')));
      setFallback(false); setCompleted(key);
    }, () => { setStored(null); setFallback(true); setCompleted(key); });
    const timer = window.setTimeout(() => {
      started = true; void refresh.request();
    }, 140);
    const stop = listen('journal:changed', () => { if (started) void refresh.request(); });
    const restored = listen('history:restored', () => { if (started) void refresh.request(); });
    return () => { refresh.dispose(); window.clearTimeout(timer); void stop.then(fn => fn()); void restored.then(fn => fn()); };
  }, [key, active, onlyCards, hasTerms]);
  const items = useMemo(() => {
    if (!active || !hasTerms) return [];
    const items: SearchItem[] = [];
    if (stored) items.push(...stored);
    else for (const day of days.values()) {
      if (day.title.trim()) items.push(titleItem(day.date, day.title));
      for (const entry of day.entries) items.push(entryItem(day.date, entry));
    }
    for (const card of cards) { const item = cardItem(card, cards, t('Ohne Titel')); if (item) items.push(item); }
    return items;
  }, [days, cards, stored, active, hasTerms]);
  return { items, pending: active && hasTerms && !onlyCards && (completed !== key || (fallback && !ready)) };
}

function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = highlights(text, words);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], index) => { if (from > at) parts.push(text.slice(at, from)); parts.push(<mark key={index}>{text.slice(from, to)}</mark>); at = to; });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function SearchBox({ variant: place, onOpen, autoFocus = false, onClose }: { variant: SearchVariant; onOpen: (result: SearchResult) => void; autoFocus?: boolean; onClose?: () => void }) {
  const english = useLanguage() === 'en';
  // The place is the layout's (the bar, the book's card, the desk's bar), the style the look's: on the desk the grep
  // prompt belongs to the Nebula look; with another look the desk's bar holds the plain field in that look's style.
  const look = useLook();
  const variant: SearchVariant = place === 'nebula' && look !== 'nebula' ? 'classic' : place;
  const tags = useTags();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(autoFocus);
  const [active, setActive] = useState(0);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const parsed = parseQuery(query, cursor, tags);
  const { items, pending } = useSearchItems(parsed, focused);
  // Tags are offered by kind like everywhere else: your own, the checklist's, the mail import's (each kind set apart).
  const activityIds = useActivityTagIds();
  useTagKindOrder();
  const kindOf = (id?: string) => id ? kindOfTag(id, activityIds) : null;
  const suggestions = searchSuggestions(parsed, tags, english, 12)
    .map((suggestion, order) => ({ suggestion, order })).sort((a, b) => (a.suggestion.id ? kindOrder().indexOf(kindOf(a.suggestion.id)!) : 0) - (b.suggestion.id ? kindOrder().indexOf(kindOf(b.suggestion.id)!) : 0) || a.order - b.order)
    .map(({ suggestion }) => suggestion.id ? { ...suggestion, description: tagKindLabel(kindOf(suggestion.id)!) } : suggestion);
  const results = runSearch(items, parsed);
  const words = parsed.words;
  const grouped = sections().map(section => ({ ...section, results: results.filter(result => section.types.includes(result.type)) })).filter(section => section.results.length);
  const flat = grouped.flatMap(section => section.results);
  const shown = Math.min(active, Math.max(0, flat.length - 1));
  useLayoutEffect(() => { if (autoFocus) input.current?.focus(); }, []);
  useLayoutEffect(() => { document.querySelector<HTMLElement>(`.search-panel [data-result-index="${shown}"]`)?.scrollIntoView({ block: 'nearest' }); }, [shown]);

  const sync = () => setCursor(input.current?.selectionStart ?? query.length);
  const accept = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const next = acceptSuggestion(query, parsed, suggestion);
    setQuery(next.query); setCursor(next.cursor); setPick(0); setActive(0);
    requestAnimationFrame(() => { input.current?.setSelectionRange(next.cursor, next.cursor); });
  };
  const open = (result: SearchResult | undefined) => { if (!result) return; onOpen(result); setFocused(false); input.current?.blur(); onClose?.(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const listing = suggestions.length > 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (listing) setPick(value => (value + step + suggestions.length) % suggestions.length);
      else if (flat.length) setActive(value => (Math.min(value, flat.length - 1) + step + flat.length) % flat.length);
    } else if ((event.key === 'Tab' && listing) || (event.key === 'Enter' && listing)) { event.preventDefault(); accept(pick); }
    else if (event.key === 'Enter') { event.preventDefault(); open(flat[shown]); }
    else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (query) { setQuery(''); setCursor(0); } else { input.current?.blur(); setFocused(false); onClose?.(); }
    }
  };
  const placeholder = variant === 'nebula' ? t('grep …  @typ  \\tag') : variant === 'journal' || look === 'journal' ? t('Wonach suchst du? @Aufgabe, \\Tag …') : t('Suchen …  @Typ  \\Tag');
  const panelOpen = focused && (query.trim().length > 0 || suggestions.length > 0);
  const dateLabel = (date: string | null) => date ? variant === 'nebula' ? date : formatShortDate(date) : '';

  const field = <input ref={input} className="search-input" value={query} placeholder={placeholder} spellCheck={false} autoComplete="off"
    aria-label={t('Suchen')} aria-keyshortcuts="Control+F" role="combobox" aria-expanded={panelOpen} aria-controls={`search-panel-${variant}`}
    onChange={event => { setQuery(event.target.value); setCursor(event.target.selectionStart ?? event.target.value.length); setActive(0); setPick(0); }}
    onSelect={sync} onKeyUp={sync} onClick={sync} onFocus={() => setFocused(true)}
    onBlur={event => { if (!(event.relatedTarget as Element | null)?.closest('.search-panel')) setFocused(false); }} onKeyDown={onKeyDown} />;

  const suggestList = suggestions.length > 0 && <div className="search-suggest" role="listbox" aria-label={t('Vorschläge')}>
    {suggestions.map((suggestion, index) => <button key={suggestion.insert} type="button" role="option" tabIndex={-1} aria-selected={index === pick} className={`search-suggestion${index > 0 && suggestion.id && kindOf(suggestion.id) !== kindOf(suggestions[index - 1].id) ? ' is-kind-start' : ''}`}
      style={suggestion.color ? { '--tag': suggestion.color } as CSSProperties : undefined} onMouseDown={event => event.preventDefault()} onClick={() => accept(index)}>
      <span className="search-suggestion-word">{suggestion.color ? <i className="tag-dot" /> : <span className="search-sigil">{suggestion.insert[0]}</span>}
        <span>{[...suggestion.label].map((char, at) => suggestion.matches.includes(at) ? <b key={at}>{char}</b> : <Fragment key={at}>{char}</Fragment>)}</span></span>
      <span className="search-suggestion-role">{suggestion.description}</span>
    </button>)}
  </div>;

  const resultRow = (result: SearchResult, index: number) => {
    const tag = tagOf(tags, result.tag);
    const body = variant === 'nebula'
      ? <><span className="search-shell-date">[{dateLabel(result.date) || '----------'}]</span><span className="search-shell-type">{shell[result.type].padEnd(6, ' ')}</span>
        <span className="search-result-title"><Marked text={result.title} words={words} /></span>{tag && <span className="search-shell-tag">\{tagWord(tag.name)}</span>}</>
      : variant === 'journal'
      ? <><span className="search-result-title"><Marked text={result.title} words={words} /></span><span className="search-leader" aria-hidden="true" /><span className="search-result-date">{dateLabel(result.date)}</span>
        {result.snippet && <span className="search-result-snippet"><Marked text={excerpt(result.snippet, words)} words={words} /></span>}</>
      : <><Icon name={typeIcon[result.type]} /><span className="search-result-text"><span className="search-result-title"><Marked text={result.title} words={words} /></span>
        {result.snippet && <span className="search-result-snippet"><Marked text={excerpt(result.snippet, words)} words={words} /></span>}</span>
        {tag && <span className="search-result-tag"><i className="tag-dot" />{tag.name}</span>}<span className="search-result-date">{dateLabel(result.date)}</span></>;
    return <button key={result.key} type="button" role="option" tabIndex={-1} aria-selected={index === shown} data-result-index={index} className={`search-result is-${result.type}`}
      style={tag ? { '--tag': tag.color } as CSSProperties : undefined} onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => open(result)}>{body}</button>;
  };

  const filters = [...parsed.types.map(type => typeFilters.find(filter => filter.type === type)!).map(filter => `@${english ? filter.en : filter.de}`), ...parsed.tags.map(id => `\\${tagWord(tagOf(tags, id)?.name ?? '')}`)];
  const panel = panelOpen && <div id={`search-panel-${variant}`} className={`search-panel is-${variant}`} role="listbox" aria-label={t('Suchergebnisse')}>
    {variant === 'nebula' && <div className="search-shell-head">$ grep -ri {words.length ? `"${words.join(' ')}"` : '""'} {filters.join(' ')} ~/journal <span>· {results.length} {t('Treffer')}</span></div>}
    {variant === 'journal' && <div className="search-index-head"><strong>{t('Register')}</strong><span>{results.length} {results.length === 1 ? t('Fundstelle') : t('Fundstellen')}</span></div>}
    {suggestList}
    {grouped.map(section => <section key={section.id} className="search-section" aria-label={section.title}>
      <h4 className="search-section-title">{variant === 'nebula' ? `# ${section.title.toLowerCase()}` : section.title}</h4>
      {section.results.map(result => resultRow(result, flat.indexOf(result)))}
    </section>)}
    {!pending && !suggestions.length && query.trim() && !results.length && <p className="search-empty">{variant === 'nebula' ? t('grep: keine Treffer') : t('Nichts gefunden.')}</p>}
    {variant !== 'nebula' && <div className="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t('wählen')}</span><span><kbd>Enter</kbd> {t('öffnen')}</span><span><kbd>@</kbd> {t('Typ')}</span><span><kbd>\</kbd> {t('Tag')}</span></div>}
  </div>;

  if (variant === 'nebula') return <div className={`search is-nebula${focused ? ' is-focused' : ''}`}>
    {/* The blinking block sits where typing starts, only while nothing is typed and the field waits. */}
    <label className="search-prompt"><b>journal</b>@desk:~$ {!focused && !query && <span className="nebula-cursor search-cursor" aria-hidden="true">▍</span>}{field}</label>
    {panel}
  </div>;
  return <div className={`search is-${variant}${place !== variant ? ` is-on-${place}` : ''}${focused ? ' is-focused' : ''}`}>
    <label className="search-field"><Icon name="search" />{field}{variant === 'classic' && !focused && !query && <span className="search-keys" aria-hidden="true"><kbd>{t('Strg')}</kbd><kbd>F</kbd></span>}</label>
    {panel}
  </div>;
}
const tagWord = (name: string) => name.trim().replace(/\s+/g, '_');

/** The journal's tab for the search at the book's edge, under the notebook's; it opens the index card next to it. */
export function SearchTab({ onOpen }: { onOpen: (result: SearchResult) => void }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`search-tab${open ? ' is-open' : ''}`} aria-expanded={open} aria-keyshortcuts="Control+F" title={t('Suchen · Strg F')} onClick={() => setOpen(value => !value)}>
      <Icon name="search" /><span>{t('Suche')}</span>
    </button>
    {open && <div className="search-card" role="dialog" aria-label={t('Suchen')}>
      <SearchBox variant="journal" autoFocus onOpen={onOpen} onClose={() => setOpen(false)} />
    </div>}
  </>;
}
