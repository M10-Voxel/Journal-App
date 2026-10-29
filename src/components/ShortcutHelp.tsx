import { useEffect, useRef } from 'react';

// One place for all shortcuts, grouped the way the UI is: days, entries, the selected entry, the planner.
// Mnemonics: Alt + first letter of the German word (Aufgabe, Ereignis, Notiz, Heute, Priorität, Morgen, Termin, Uhrzeit),
// D for done, X for crossing out. Alt moves things, Ctrl moves the cursor; Ctrl formats text like in any editor.
export const shortcutGroups: { title: string; items: [keys: string[], label: string][] }[] = [
  { title: 'Tage', items: [
    [['Alt', '←'], 'Vorheriger Tag'], [['Alt', '→'], 'Nächster Tag'], [['Alt', 'H'], 'Heute'],
    [['Strg', 'G'], 'Gehe zu Datum'], [['Strg', 'S'], 'Speichern'],
  ] },
  { title: 'Einträge', items: [
    [['Alt', 'A'], 'Neue Aufgabe'], [['Alt', 'E'], 'Neues Ereignis'], [['Alt', 'N'], 'Neue Notiz'],
    [['Enter'], 'Neuer Eintrag darunter'], [['⇧', 'Enter'], 'Zeilenumbruch'], [['⌫'], 'Leeren Eintrag löschen'],
    [['Strg', '↑ ↓'], 'Zum Eintrag darüber / darunter'], [['Alt', '↑ ↓'], 'Eintrag verschieben'],
  ] },
  { title: 'Aktueller Eintrag', items: [
    [['Alt', 'D'], 'Erledigt'], [['Alt', 'X'], 'Abbrechen'], [['Alt', 'P'], 'Priorität'],
    [['Alt', 'M'], 'Auf morgen'], [['Alt', 'T'], 'Planen · zur Spur springen'], [['Alt', 'U'], 'Uhrzeit'],
    [['Alt', 'Enter'], 'Aktionsleiste'], [['Alt', 'Entf'], 'Löschen'],
  ] },
  { title: 'Text', items: [
    [['Strg', 'B'], '**Fett**'], [['Strg', 'I'], '*Kursiv*'], [['Strg', '⇧', 'X'], '~~Durchgestrichen~~'], [['Strg', '⇧', 'H'], '==Markiert=='],
    [['Alt', '1–8'], '[Farbe]{rot} …'], [['Alt', '0'], 'Farbe entfernen'], [['Rechtsklick'], 'Format-Menü (mit Auswahl)'], [['Strg', 'Z'], 'Rückgängig'],
  ] },
  { title: 'Kalender & Uhr', items: [
    [['←↑↓→'], 'Tag · Stunde/Minute'], [['Bild ↑↓'], 'Monat'], [['H'], 'Heute'], [['U'], 'Kalender ⇄ Uhr'],
    [['0–9'], 'Uhrzeit tippen'], [['Tab'], 'Stunden ⇄ Minuten'], [['E'], 'Erinnern'], [['Entf'], 'Uhrzeit entfernen'],
    [['Enter'], 'Planen'], [['Esc'], 'Zurück'],
  ] },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts" role="dialog" aria-modal="true" aria-label="Tastenkürzel" tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape' || event.key === 'F1') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="shortcuts-head"><strong>Tastenkürzel</strong><span><kbd>F1</kbd></span></div>
      <div className="shortcuts-grid">
        {shortcutGroups.map(group => <section key={group.title}>
          <h3>{group.title}</h3>
          {group.items.map(([keys, label]) => <div className="shortcut" key={label}>
            <span className="shortcut-keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span><span>{label}</span>
          </div>)}
        </section>)}
      </div>
    </div>
  </div>;
}
