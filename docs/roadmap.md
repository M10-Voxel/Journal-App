# Roadmap

Offene Aufgaben. Erledigtes mit `[x]` markieren. Pfade relativ zum Repo; Zeilennummern sind nur Orientierung und können abweichen.

## Fixes
- [x] **Rechtschreibkorrektur aus** – `src/components/entryEditor.ts:79` (`spellcheck:'true'` → `'false'`); zusätzlich `spellCheck={false}` bei Titel (`main.tsx`), `CalendarComposer.tsx` Beschreibung, `BulletinBoard.tsx` (Zettel, Suche), `PeriodNotes.tsx`, `TagPicker.tsx`.
- [x] **App-Erinnerung verschwindet direkt** – Auslieferung `src-tauri/src/reminders.rs` `deliver()` (Event ans Hauptfenster / Popup-Fenster / Toast); Hauptfenster-Handler `main.tsx` (~244, `journal:reminder`), `ReminderToasts.tsx` (Popup ~100–125, `popup::answer` schließt bei leerer Liste). Kein Auto-Dismiss-Timer gefunden → Ursache erst reproduzieren (State-Reset in `main.tsx`, Popup-Lebenszyklus/`fit_popup`).
- [x] **Suche zeigt nicht existierende Pinnwand-Einträge** – es gibt keine globale Suche, nur „Vorhandene“ in `BulletinBoard.tsx:254-255` (filtert alle Karten aus `board_list`). Verwaiste Karten (leeres `dates`, nach `board_detach` in `board.rs:68`) ausfiltern oder löschen; mit echten Daten prüfen.
- [x] **Markdown-Einrückungen bei Zetteln** – `BulletinBoard.tsx` `Note` (~54); `src/markdown.ts` kennt nur Inline-Markdown → Listen/Einrückung (Tab/Shift+Tab) ergänzen, Tests in `tests/markdown.test.mjs`.
- [x] **Mehrere Einträge eines Tages im Kalender löschen → „Dieser Tag wurde inzwischen geändert“** – Revisionsprüfung `storage.rs:~394`; `main.tsx:~423` `removeFromCalendar` lädt/speichert pro Eintrag mit veralteter `revision` bzw. kollidiert mit Autosave. Löschungen pro Tag bündeln (ein Laden, ein Speichern) oder seriell mit Neuladen; Aufrufer in `CalendarWindow.tsx`/`calendarClipboard.ts` prüfen.
- [x] **Pin im Zentrum des sichtbaren Bereichs erstellen** – `BulletinBoard.tsx` `freeSpot()` (~157): aus Scroll-Container (`scrollTop`, `clientHeight`, Breite) die Mitte berechnen, dann Überlappung vermeiden.
- [x] **Suche: Monats-/Jahres-Pinnwand einbeziehen** – hängt an „Pinnwand für Zeiträume“ (siehe Offene Fragen): `book.ts` hat für Woche…Jahr nur `notes`/`activities`; Karten (`board.rs`) kennen nur Tages-`dates`. Datenmodell: Periodenschlüssel in `dates`?
- [x] **Shortcut (z. B. Alt+G) springt direkt ins Feld** – `JournalEntry.tsx:~224` (`chooseTag`), `CalendarComposer.tsx:~215`, `TagPicker.tsx` (`.tag-picker-search`), `TagFilter.tsx`, `src/components/focus.ts`: Fokus beim Öffnen setzen, Ziffern/Pfeile nicht abfangen.

## Änderungen
- [x] **Beim Bearbeiten eines Zettels den Faden darüber ausblenden** und **Faden blasser, wenn er über einen Pin läuft** – Faden-Element in `BulletinBoard.tsx`/`bulletinBoard.css` erst lokalisieren (nur `.board-pin` css:47 gefunden); `docs/bulletin-board.md` lesen.
- [x] **Tags und Datum umdrehen (Tags immer rechts)** – `JournalEntry.tsx` (`tag`, `tagFirst`, `tagLast`), `calendarShared.tsx` `CalItem` (~115–140) und `entryTitle` (84, Präfix `${tag} · `): Tag in festen rechten Slot.

## Neu
Reihenfolge-Empfehlung: zuerst kleine/unabhängige, dann Datenmodell-Änderungen.
- [x] **Markdown in Eintragsbeschreibungen (Kalender)** – Anzeige `calendarShared.tsx:160` (Klartext `<p className="cal-details-text">`), Eingabe `CalendarComposer.tsx:~256`; wiederverwenden: `markdown.ts` `parseInline`, `EntryText.tsx`.
- [x] **Beschreibungen dezent in der Eintragsansicht** – `JournalEntry.tsx`; nach dem vorigen Punkt.
- [x] **Aktivitäten: Min–Max-Zeit für Farbstufen** – `ActivityDefinition` (`periodData.ts:1`) um `minMinutes`/`maxMinutes` erweitern, `normalizePeriodData` (:12) migriert, UI `ActivitySettings.tsx`, Logik `activityColors.ts` (`activityLevel`, Labels; bisher feste 30-min-Stufen, 7 Level), `tests/activityColors.test.mjs`.
- [x] **„Vorhandene“-Notizen einzeln oder als Gruppe kopieren** – bisher verknüpft ein Klick dieselbe Karte mit dem Tag (`patch` mit `dates`); neu: Kopie mit neuer UUID (`board_patch`/`save_card` in `board.rs`), plus Gruppenkopie.
- [x] **Tags für Notizen** (erledigt: Tag am Zettel, in Suche und Notizblock; Zettel mit im Journal ausgeblendetem Tag verschwinden von Pinnwand und Notizblock; **Ordner-Tags bewusst weggelassen**) – ~~(ggf. Ordner)~~ – `Card`-Typ (`BulletinBoard.tsx:18`) und `board.rs` brauchen `tag`; `tagStore.ts`/`tags.ts` wiederverwenden; Ordner existieren nicht → erst klären (Offene Fragen); Sync-Format prüfen.
- [x] **Erinnerungs-Vorlauf pro Ereignis (z. B. 5 min vorher)** (erledigt: Zur Uhrzeit, 5 Min., 1 Std., eigene Zeit in Min./Std./Tagen; Spalte `reminder_before`, Schema 13) – bisher nur `reminder: bool` (`storage.rs`, `planning.ts` `Schedule`, `ical.ts` `x-journal-reminder`); auf optionale Minuten umstellen (DB-Migration, `RepeatPanel`, `CalendarComposer`, iCal `VALARM TRIGGER`), `Store::due_reminders` (~91–101) zieht Offset ab.
- [x] **Flache, einfärbbare Icons für Kalendereinträge** (erledigt: Lucide, Spalte `icon`, Schema 13; siehe `docs/entry-icons.md`) – `Icon.tsx`/`PixelIcon.tsx`, Feld `icon` an `Entry` (Storage, iCal, Picker), Darstellung in `CalItem`.
- [ ] **Mehrere Bewertungen (Stress, Schlaf …)** – bisher ein `PeriodDay.rating` (`periodData.ts:3`), `RatingChart.tsx`, `PeriodNotes.tsx`; neu: Bewertungsdefinitionen (Muster `ActivityDefinition`) + Werte-Map.
- [ ] **Aufgaben-Eingabefeld bei Woche/Monat/Quartal/Jahr** – `PeriodNotes.tsx`, `periodData.ts`/`periodStore.ts` (`PeriodData.notes` ist nur Text); Struktur entscheiden (Entries-Modell wiederverwenden?).
- [ ] **Feature-Toggles** – Einträge (spezifische an/aus), Daten, Pinnwand (spezifische an/aus), Notiz: Flags in `settings.ts`, `pagesOf`/`normalizePage`/`nextPage`/`turnPage`/`pageNumber`/`spreadOf` in `src/book.ts` filtern, UI in `SettingsDialog.tsx`, `tests/book.test.mjs`. Offene Frage: was heißt „spezifische“?
- [x] **Tag-Kategorien umsortieren** – `tagStore.ts` `saveTags` speichert geordnete Liste, `tags.ts` `setTagOrder`/`tagRank`; Hoch/Runter bzw. Drag in `TagSettings.tsx`, Muster `moveActivity` (`periodData.ts:7`).
- [x] **Handschrift-Modus für Zettel** (erledigt: Text oder Zeichnung je Zettel, Füller mit Druck (abschaltbar), Teil-Radierer, „Skizze“-Knopf, keine Größenobergrenze; siehe `docs/bulletin-board.md`) – `src/ink.ts`, `src/components/InkCanvas.tsx`, `perfect-freehand`, Kartenlimit in `board.rs` 2 MB.
- [x] **Mehr Werkzeuge für den Handschrift-Modus** (erledigt: Bleistift mit Körnung, transparenter Textmarker unter der Tinte, Farbe je Stiftart, Auswahl als Rechteck oder schneidendes Lasso zum Verschieben/Skalieren/Umfärben/Stärke ändern/Löschen, Hintergrund Linien/Raster/Punkte je Zettel, kompakte Leiste mit Icon-Dropdowns; siehe `docs/bulletin-board.md`) – `src/ink.ts`, `src/inkPrefs.ts`, `src/components/InkToolbar.tsx`, `src/components/InkCanvas.tsx`; Felder `tool`/`color` am Strich und `inkPaper` an der Karte ohne Migration.

## Design: Aufbau und Optik frei kombinieren
Ziel: weitere Aufbauten, Optiken und Popup-Varianten sollen sich leicht ergänzen lassen. Beschreibung der Achsen und Anleitung: `docs/design-axes.md`.
- [x] **Stufe 1: Achsen trennen** – `data-layout` und `data-look` statt `data-theme`, `src/designs.ts`, Einstellungen „Aufbau“ und „Optik“, alle CSS-Regeln einsortiert, Bereich `combos` in `scripts/verify-ui.mjs`.
- [ ] **Stufe 2: die sechs Mischungen gestalten** – Liste im Abschnitt „Stufe 2“ von `docs/design-axes.md` (Aufbau-Komponenten lesen Optik-Variablen, Palette je Kombination, Suche trennen, Popups/Pixel/Widgets je Mischung, Vorschaubilder, Tests).

## Offene Fragen
- **Pinnwand für Zeiträume** (Woche…Jahr) – gewünscht? Blockiert „Suche: Monats-/Jahres-Pinnwand“.
- **Ordner für Notizen** – vorerst nur Zettel-Tags (User-Entscheidung); Ordner-Tags ggf. später.
- **„Spezifische an/aus“ bei Feature-Toggles** – einzelne Eintragsarten bzw. Pinnwand-Kartenarten?
