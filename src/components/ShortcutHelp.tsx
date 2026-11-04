import { t, useLanguage } from '../i18n';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

// One place for all shortcuts, on pages the way the UI is: days, entries, the entry in focus, swiping, text, the
// planner, repeating, the calendar. Mnemonics: Alt + first letter of the German word (Aufgabe, Ereignis, Notiz, Heute,
// Priorität, Morgen, Termin, Uhrzeit, Wiederholen), D for done, X for crossing out. Alt moves things, Ctrl moves the
// cursor; Ctrl formats text like in any editor.
//
// Keys are written as `Alt+⇧+T` (pressed together) and `← / →` (either); `~Klick` marks a mouse or touch gesture.
export const shortcutGroups = (): { id: string; title: string; icon: IconName; items: [keys: string, label: string][] }[] => ([
  { id: 'days', title: t("Tage"), icon: 'journal', items: [
    ['Alt+←', t("Vorheriger Tag")], ['Alt+→', t("Nächster Tag")], ['Alt+H', t("Heute")], ['Strg+G', t("Gehe zu Datum (Mini-Kalender)")], ['Strg+1–5', t("Tag · Woche · Monat · Quartal · Jahr")],
    [t("~Wischen / ⇧+~Mausrad"), t("Tag zurück / weiter")], ['Strg+Z', t("Rückgängig")], ['Strg+Y / Strg+⇧+Z', t("Wiederherstellen")], ['Strg+,', t("Einstellungen")], ['Strg+⇧+N', t("Notizen")], ['F1 / ?', t("Diese Übersicht")],
  ] },
  { id: 'book', title: t("Buch"), icon: 'journal', items: [
    ['Strg+Bild↓ / Strg+Bild↑', t("Umblättern / zurückblättern")], [t("~Eselsohr / ~Wischen / ⇧+~Mausrad"), t("Eine Seite weiter / zurück")],
    ['Alt+← / Alt+→', t("Ganzen Tag zurück / weiter (Einträge-Seite)")], [t("~Lesezeichen"), t("Zu Einträgen, Daten oder Pinnwand springen")],
    [t("~Doppelseite / ~Einzelseite"), t("Zwei Seiten oder eine (schmale Fenster: eine)")], ['Strg+K', t("Kalender herunterklappen / zuklappen")], ['Esc', t("Kalender zuklappen")],
  ] },
  { id: 'entries', title: t("Einträge"), icon: 'task', items: [
    ['Alt+A', t("Neue Aufgabe")], ['Alt+E', t("Neues Ereignis")], ['Alt+N', t("Neue Notiz")],
    ['Enter', t("Neuer Eintrag darunter")], ['⇧+Enter', 'Zeilenumbruch'], ['⌫', t("Leeren Eintrag löschen")],
    ['Strg+↑ / Strg+↓', t("Zum Eintrag darüber / darunter")], ['Alt+↑ / Alt+↓', t("Eintrag verschieben")],
  ] },
  { id: 'entry', title: t("Aktueller Eintrag"), icon: 'event', items: [
    ['Alt+D', t("Erledigt")], ['Alt+X', t("Abbrechen")], ['Alt+P', t("Priorität")], ['Alt+M', t("Auf morgen")],
    ['Alt+T', t("Planen · bei einer Spur: zum Tag springen")], ['Alt+⇧+T', t("Mehrere Tage planen")], ['Alt+U', t("Uhrzeit")], ['Alt+W', t("Wiederholen")],
    ['Alt+G', t("Tag zuweisen (0–9 direkt, tippen: suchen oder neu)")],
    ['Alt+⇧+E', t("Als Ereignis")], ['Alt+⇧+A', t("Als Aufgabe")], ['Alt+⇧+N', t("Als Notiz")],
    ['Alt+Enter', t("Aktionen öffnen")], ['Alt+Entf', t("Löschen (verknüpfte: ← / → und Enter wählen)")],
  ] },
  { id: 'swipe', title: t("Wischen"), icon: 'right', items: [
    ['→', t("Auf morgen")], ['⇧+→', t("Planen")], ['Strg+⇧+→', t("Mehrere Tage")], ['↓', t("Erledigt")], ['⇧+↓', t("Abbrechen")],
    ['↑', t("Priorität")], ['⇧+←', t("Löschen")], ['~Antippen', t("Aufgabe weiterschalten")],
  ] },
  { id: 'tags', title: t("Tags"), icon: 'tag', items: [
    ['Alt+G', t("Tag zuweisen")], ['1–9', t("Tag nehmen oder ein-/ausblenden (in der Liste)")], ['0', t("Kein Tag / Einträge ohne Tag")],
    ['A', t("Filter: alle Tags zeigen")], ['Alt+~Klick / ⇧+Enter', t("Filter: nur diesen Tag zeigen")], ['Enter', t("Tippen und Enter: neuen Tag anlegen")],
  ] },
  { id: 'board', title: t("Pinnwand"), icon: 'pin', items: [
    ['Strg+. / ⇧+F10', t("Format-Menü an der Schreibmarke (Pfeile, Enter, Esc)")],
    ['Strg+Alt+1 / Strg+Alt+2 / Strg+Alt+3', t("Überschrift 1 · 2 · 3")], ['Strg+⇧+8', t("Stichpunkte")], ['Strg+⇧+9', t("Checkliste")], ['Strg+⇧+7', t("Nummeriert")],
    ['Strg+Alt+C', t("Codeblock")], ['Strg+Alt+T', t("Tabelle")], ['Tab / ⇧+Tab', t("Tabelle: nächste / vorige Zelle · Liste: ein- / ausrücken")],
    ['Enter', t("Liste fortsetzen · Tabelle: neue Zeile")], ['← / → / ↑ / ↓', t("Karte verschieben (⇧: weiter)")], ['Alt+⇧+← / Alt+⇧+→', t("Karte schmaler / breiter")], ['Alt+⇧+↑ / Alt+⇧+↓', t("Zettel kürzer / länger")],
    [t("~Ecke ziehen"), t("Größe ändern (Doppelklick: zurücksetzen)")], [t("~Klick aufs Bild"), t("Groß öffnen")],
    [t("~Pin ziehen"), t("Faden zu einer anderen Karte: Bild/Link wird Anhang, Zettel wird Seite")], ['Alt+L', t("Faden per Tastatur (Pfeile wählen, Enter verbindet, Esc bricht ab)")],
    [t("~Klick auf den Faden"), t("Faden lösen")],
  ] },
  { id: 'notebook', title: t("Notizen"), icon: 'note', items: [
    ['Strg+⇧+N', t("Notizblock öffnen / schließen")], ['Esc', t("Notizblock schließen")],
    ['Bild↑ / Bild↓', t("Vorige / nächste Seite (verbundene Zettel)")], ['Strg+Bild↑ / Strg+Bild↓', t("Seite wechseln, auch beim Schreiben")],
    ['F2', t("Ordner umbenennen")], ['← / →', t("Ordner zu- / aufklappen")], [t("~Ziehen auf einen Ordner"), t("Zettel oder Ordner hineinlegen")],
    [t("~Doppelklick auf einen Ordner"), t("Umbenennen")],
  ] },
  { id: 'text', title: t("Text"), icon: 'pencil', items: [
    ['Strg+B', '**Fett**'], ['Strg+I', '*Kursiv*'], ['Strg+⇧+X', '~~Durchgestrichen~~'], ['Strg+⇧+H', '==Markiert=='],
    ['Alt+1–8', 'Farbe: [Text]{rot} …'], ['Alt+0', t("Farbe entfernen")], ['~Rechtsklick / ⇧+F10', t("Format-Menü (mit Auswahl)")], ['Strg+Z', t("Rückgängig")],
  ] },
  { id: 'planner', title: t("Planen & Uhr"), icon: 'calendar', items: [
    ['← / → / ↑ / ↓', t("Tag wählen")], ['Bild↑ / Bild↓', t("Monat")], ['H', t("Heute")], ['U', t("Kalender ⇄ Uhr")], ['W', t("Wiederholen")], ['E', t("Erinnern")],
    ['Enter', t("Planen")], ['Esc', t("Zurück")],
    ['0–9', t("Uhr: Uhrzeit tippen")], ['Tab', t("Uhr: Stunden ⇄ Minuten")], ['↑ / ↓', t("Uhr: Stunde/Minute ändern")], [t("Entf"), t("Uhrzeit entfernen")],
    [t("~Klick / Leertaste"), t("Mehrere Tage: Bereich von – bis")], [t("~Rechtsklick / ⇧+Leertaste"), t("Mehrere Tage: Tag heraus / dazu")],
  ] },
  { id: 'repeat', title: t("Wiederholen"), icon: 'repeat', items: [
    ['← / →', t("Tag · Woche · Monat · Jahr")], ['↑ / ↓', t("Alle n")], ['1–7', t("Wochentage Mo – So")], ['P', t("Pause (z. B. 3 an, 1 aus)")],
    ['/', t("In Worten schreiben (Deutsch oder Englisch)")], ['↑ / ↓', t("Beim Schreiben: Vorschlag wählen")], ['Tab / Enter', t("Beim Schreiben: Vorschlag übernehmen")],
    [t("Entf"), t("Nicht wiederholen")], ['Enter', t("Übernehmen")], ['Esc', t("Zurück")],
  ] },
  { id: 'calendar', title: t("Kalender"), icon: 'month', items: [
    ['Strg+~Mausrad', t("Stundenraster vergrößern / verkleinern")],
    ['J / M / W / A / T', t("Jahr · Monat · Woche · Mo–Fr · Tag")], ['1–5', 'Ansicht'], [t("← / → / ~Wischen"), t("Zurück / weiter")], ['H', t("Heute")],
    ['~Klick', t("Tag im Journal zeigen / Eintragsdetails öffnen")], [t("~Rand ziehen"), t("Breite (Doppelklick: zurücksetzen)")],
    [t("~Ziehen im Raster"), t("Termin eintragen – auch über Mitternacht in den nächsten Tag")], ['~Rechtsklick', t("Eintrag bearbeiten")], ['Alt+Entf', t("Eintrag löschen")], ['Entf', t("Eintrag unter der Maus löschen")], ['Strg+C', t("Kalendereintrag kopieren")], ['Strg+V', t("Kalendereintrag am Tag unter der Maus einfügen")],
    ['↑ / ↓', t("Termin verschieben")], ['⇧+↑ / ⇧+↓', t("Ende verschieben")],
    ['Alt+K', t("Als Kalendereintrag")], ['Alt+E', t("Als Ereignis")], ['Alt+A', t("Als Aufgabe")], ['Alt+P', t("Priorität")], ['Alt+G', t("Tag zuweisen")],
  ] },
]);

/** `Alt+⇧+T / Strg+G`: chips for keys pressed together, "oder" between alternatives, gestures in their own look. */
function Keys({ keys }: { keys: string }) {
  useLanguage();
  return <span className="shortcut-keys">{keys.split(' / ').map((combo, index) => <Fragment key={combo}>
    {index > 0 && <span className="shortcut-or">{t("oder")}</span>}
    <span className="shortcut-combo">{combo.split('+').map(key => key.startsWith('~')
      ? <span key={key} className="shortcut-gesture">{key.slice(1)}</span>
      : <kbd key={key}>{t(key)}</kbd>)}</span>
  </Fragment>)}</span>;
}

// Like the settings (and Zed's keymap): pages on the left, each shortcut as a row – what it does, then its keys.
// Typing searches all pages; ↑/↓ change the page.
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(shortcutGroups()[0].id);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = (keys: string, label: string) => words.every(word => `${label} ${t(keys)}`.toLowerCase().replace(/~/g, '').includes(word));
  const shown = words.length ? shortcutGroups().map(group => ({ ...group, items: group.items.filter(([keys, label]) => matching(keys, label)) })).filter(group => group.items.length)
    : shortcutGroups().filter(group => group.id === page);
  function turn(step: number) {
    const index = shortcutGroups().findIndex(group => group.id === page);
    setPage(shortcutGroups()[(index + step + shortcutGroups().length) % shortcutGroups().length].id);
    setQuery('');
  }
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts dialog-panes" role="dialog" aria-modal="true" aria-label={t("Tastenkürzel")} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
        else if (event.key === 'Escape' || event.key === 'F1') { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !query) { event.preventDefault(); turn(event.key === 'ArrowDown' ? 1 : -1); }
      }}>
      <div className="settings-head">
        <Icon name="settings" /><strong>{t("Tastenkürzel")}</strong>
        <label className="shortcut-search"><Icon name="search" /><input ref={searchRef} value={query} placeholder={t("Suchen … (z. B. Uhr, Alt T)")} aria-label={t("Tastenkürzel suchen")}
          onChange={event => setQuery(event.target.value)} /></label>
        <span className="settings-keys"><kbd>F1</kbd></span>
        <button type="button" className="settings-close" aria-label={t("Tastenkürzel schließen")} title={t("Schließen · Esc")} onClick={onClose}><Icon name="done" /></button>
      </div>
      <div className="settings-body">
        <div className="settings-tabs" role="tablist" aria-label={t("Bereich")} aria-orientation="vertical">
          {shortcutGroups().map(group => <button key={group.id} type="button" role="tab" aria-selected={!words.length && group.id === page} tabIndex={group.id === page ? 0 : -1}
            onClick={() => { setPage(group.id); setQuery(''); searchRef.current?.focus(); }}><Icon name={group.icon} />{group.title}</button>)}
        </div>
        <div className="settings-panel shortcut-pages" role="tabpanel" aria-label={words.length ? t("Suchergebnisse") : shortcutGroups().find(group => group.id === page)!.title}>
          {shown.length ? shown.map(group => <section key={group.id}>
            {words.length > 0 && <h3>{group.title}</h3>}
            {group.items.map(([keys, label]) => <div className="shortcut" key={`${keys}-${label}`}><span className="shortcut-label">{label}</span><Keys keys={keys} /></div>)}
          </section>) : <p className="settings-hint">{t("Kein Kürzel passt zu „")}{query}“.</p>}
        </div>
      </div>
    </div>
  </div>;
}
