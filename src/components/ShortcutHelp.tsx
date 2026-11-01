import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

// One place for all shortcuts, on pages the way the UI is: days, entries, the entry in focus, swiping, text, the
// planner, repeating, the calendar. Mnemonics: Alt + first letter of the German word (Aufgabe, Ereignis, Notiz, Heute,
// Priorität, Morgen, Termin, Uhrzeit, Wiederholen), D for done, X for crossing out. Alt moves things, Ctrl moves the
// cursor; Ctrl formats text like in any editor.
//
// Keys are written as `Alt+⇧+T` (pressed together) and `← / →` (either); `~Klick` marks a mouse or touch gesture.
export const shortcutGroups: { id: string; title: string; icon: IconName; items: [keys: string, label: string][] }[] = [
  { id: 'days', title: 'Tage', icon: 'journal', items: [
    ['Alt+←', 'Vorheriger Tag'], ['Alt+→', 'Nächster Tag'], ['Alt+H', 'Heute'], ['Strg+G', 'Gehe zu Datum (Mini-Kalender)'],
    ['~Wischen / ⇧+~Mausrad', 'Tag zurück / weiter'], ['Strg+S', 'Sofort speichern (sonst von selbst)'], ['Strg+,', 'Einstellungen'], ['F1 / ?', 'Diese Übersicht'],
  ] },
  { id: 'entries', title: 'Einträge', icon: 'task', items: [
    ['Alt+A', 'Neue Aufgabe'], ['Alt+E', 'Neues Ereignis'], ['Alt+N', 'Neue Notiz'],
    ['Enter', 'Neuer Eintrag darunter'], ['⇧+Enter', 'Zeilenumbruch'], ['⌫', 'Leeren Eintrag löschen'],
    ['Strg+↑ / Strg+↓', 'Zum Eintrag darüber / darunter'], ['Alt+↑ / Alt+↓', 'Eintrag verschieben'],
  ] },
  { id: 'entry', title: 'Aktueller Eintrag', icon: 'event', items: [
    ['Alt+D', 'Erledigt'], ['Alt+X', 'Abbrechen'], ['Alt+P', 'Priorität'], ['Alt+M', 'Auf morgen'],
    ['Alt+T', 'Planen · bei einer Spur: zum Tag springen'], ['Alt+⇧+T', 'Mehrere Tage planen'], ['Alt+U', 'Uhrzeit'], ['Alt+W', 'Wiederholen'],
    ['Alt+⇧+E', 'Als Ereignis'], ['Alt+⇧+A', 'Als Aufgabe'], ['Alt+⇧+N', 'Als Notiz'],
    ['Alt+Enter', 'Aktionen öffnen'], ['Alt+Entf', 'Löschen (verknüpfte: ← / → und Enter wählen)'],
  ] },
  { id: 'swipe', title: 'Wischen', icon: 'right', items: [
    ['→', 'Auf morgen'], ['⇧+→', 'Planen'], ['Strg+⇧+→', 'Mehrere Tage'], ['↓', 'Erledigt'], ['⇧+↓', 'Abbrechen'],
    ['↑', 'Priorität'], ['⇧+←', 'Löschen'], ['~Antippen', 'Aufgabe weiterschalten'],
  ] },
  { id: 'text', title: 'Text', icon: 'pencil', items: [
    ['Strg+B', '**Fett**'], ['Strg+I', '*Kursiv*'], ['Strg+⇧+X', '~~Durchgestrichen~~'], ['Strg+⇧+H', '==Markiert=='],
    ['Alt+1–8', 'Farbe: [Text]{rot} …'], ['Alt+0', 'Farbe entfernen'], ['~Rechtsklick', 'Format-Menü (mit Auswahl)'], ['Strg+Z', 'Rückgängig'],
  ] },
  { id: 'planner', title: 'Planen & Uhr', icon: 'calendar', items: [
    ['← / → / ↑ / ↓', 'Tag wählen'], ['Bild↑ / Bild↓', 'Monat'], ['H', 'Heute'], ['U', 'Kalender ⇄ Uhr'], ['W', 'Wiederholen'], ['E', 'Erinnern'],
    ['Enter', 'Planen'], ['Esc', 'Zurück'],
    ['0–9', 'Uhr: Uhrzeit tippen'], ['Tab', 'Uhr: Stunden ⇄ Minuten'], ['↑ / ↓', 'Uhr: Stunde/Minute ändern'], ['Entf', 'Uhrzeit entfernen'],
    ['~Klick / Leertaste', 'Mehrere Tage: Bereich von – bis'], ['~Rechtsklick / ⇧+Leertaste', 'Mehrere Tage: Tag heraus / dazu'],
  ] },
  { id: 'repeat', title: 'Wiederholen', icon: 'repeat', items: [
    ['← / →', 'Tag · Woche · Monat · Jahr'], ['↑ / ↓', 'Alle n'], ['1–7', 'Wochentage Mo – So'], ['P', 'Pause (z. B. 3 an, 1 aus)'],
    ['/', 'In Worten schreiben (Deutsch oder Englisch)'], ['↑ / ↓', 'Beim Schreiben: Vorschlag wählen'], ['Tab / Enter', 'Beim Schreiben: Vorschlag übernehmen'],
    ['Entf', 'Nicht wiederholen'], ['Enter', 'Übernehmen'], ['Esc', 'Zurück'],
  ] },
  { id: 'calendar', title: 'Kalender', icon: 'month', items: [
    ['J / M / W / A / T', 'Jahr · Monat · Woche · Mo–Fr · Tag'], ['1–5', 'Ansicht'], ['← / → / ~Wischen', 'Zurück / weiter'], ['H', 'Heute'],
    ['~Klick', 'Tag oder Eintrag im Journal zeigen'], ['~Rand ziehen', 'Breite (Doppelklick: zurücksetzen)'],
    ['~Ziehen im Raster', 'Termin eintragen – auch über Mitternacht in den nächsten Tag'], ['~Rechtsklick', 'Eintrag bearbeiten'], ['Alt+Entf', 'Eintrag löschen'],
    ['↑ / ↓', 'Termin verschieben'], ['⇧+↑ / ⇧+↓', 'Ende verschieben'],
    ['Alt+K', 'Als Kalendereintrag'], ['Alt+E', 'Als Ereignis'], ['Alt+A', 'Als Aufgabe'], ['Alt+P', 'Priorität'],
  ] },
];

/** `Alt+⇧+T / Strg+G`: chips for keys pressed together, "oder" between alternatives, gestures in their own look. */
function Keys({ keys }: { keys: string }) {
  return <span className="shortcut-keys">{keys.split(' / ').map((combo, index) => <Fragment key={combo}>
    {index > 0 && <span className="shortcut-or">oder</span>}
    <span className="shortcut-combo">{combo.split('+').map(key => key.startsWith('~')
      ? <span key={key} className="shortcut-gesture">{key.slice(1)}</span>
      : <kbd key={key}>{key}</kbd>)}</span>
  </Fragment>)}</span>;
}

// Like the settings (and Zed's keymap): pages on the left, each shortcut as a row – what it does, then its keys.
// Typing searches all pages; ↑/↓ change the page.
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(shortcutGroups[0].id);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = (keys: string, label: string) => words.every(word => `${label} ${keys}`.toLowerCase().replace(/~/g, '').includes(word));
  const shown = words.length ? shortcutGroups.map(group => ({ ...group, items: group.items.filter(([keys, label]) => matching(keys, label)) })).filter(group => group.items.length)
    : shortcutGroups.filter(group => group.id === page);
  function turn(step: number) {
    const index = shortcutGroups.findIndex(group => group.id === page);
    setPage(shortcutGroups[(index + step + shortcutGroups.length) % shortcutGroups.length].id);
    setQuery('');
  }
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts dialog-panes" role="dialog" aria-modal="true" aria-label="Tastenkürzel" tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
        else if (event.key === 'Escape' || event.key === 'F1') { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !query) { event.preventDefault(); turn(event.key === 'ArrowDown' ? 1 : -1); }
      }}>
      <div className="settings-head">
        <Icon name="settings" /><strong>Tastenkürzel</strong>
        <label className="shortcut-search"><Icon name="search" /><input ref={searchRef} value={query} placeholder="Suchen … (z. B. Uhr, Alt T)" aria-label="Tastenkürzel suchen"
          onChange={event => setQuery(event.target.value)} /></label>
        <span className="settings-keys"><kbd>F1</kbd></span>
        <button type="button" className="settings-close" aria-label="Tastenkürzel schließen" title="Schließen · Esc" onClick={onClose}><Icon name="done" /></button>
      </div>
      <div className="settings-body">
        <div className="settings-tabs" role="tablist" aria-label="Bereich" aria-orientation="vertical">
          {shortcutGroups.map(group => <button key={group.id} type="button" role="tab" aria-selected={!words.length && group.id === page} tabIndex={group.id === page ? 0 : -1}
            onClick={() => { setPage(group.id); setQuery(''); searchRef.current?.focus(); }}><Icon name={group.icon} />{group.title}</button>)}
        </div>
        <div className="settings-panel shortcut-pages" role="tabpanel" aria-label={words.length ? 'Suchergebnisse' : shortcutGroups.find(group => group.id === page)!.title}>
          {shown.length ? shown.map(group => <section key={group.id}>
            {words.length > 0 && <h3>{group.title}</h3>}
            {group.items.map(([keys, label]) => <div className="shortcut" key={`${keys}-${label}`}><span className="shortcut-label">{label}</span><Keys keys={keys} /></div>)}
          </section>) : <p className="settings-hint">Kein Kürzel passt zu „{query}“.</p>}
        </div>
      </div>
    </div>
  </div>;
}
