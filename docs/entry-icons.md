# Icons und Erinnerungs-Vorlauf für Einträge

## Icons

Ein Kalendereintrag kann wie eine Notion-Seite ein Icon tragen: im Kalender-Popup über den Smiley-Knopf oder **Alt+I**. Die Auswahl zeigt zuerst häufige Icons; die Suche findet alle rund 2.000 Icons über ihren englischen Namen oder deutsche Stichwörter (z. B. „Arzt“, „Geburtstag“, „Sport“). Pfeile bewegen die Auswahl, Enter übernimmt, „Kein Icon“ entfernt es.

Das Icon steht unten rechts am Eintrag in der Farbe seines Tags (ohne Tag in der Akzentfarbe). Ist der Eintrag zu klein für seinen Text – kurzer Zeitblock, schmale Spalte oder Monatszelle –, steht das Icon statt des Texts; Titel und Bedienhilfen nennen den Eintrag weiterhin. Die Beschreibung im Detail-Popup nennt Icon und Erinnerung.

Gestaltung je Design: Normal mit 2-px-Linien, Journal als Tinte (dünnere Linie), Nebula dünn mit leichtem Leuchten und eckigen Auswahlfeldern, Pixel in eckigen Stufen ohne Kantenglättung. Planung, Wiederholung und verknüpfte Einträge übernehmen das Icon wie den Tag; iCal-Export/-Import nutzt `X-JOURNAL-ICON`.

Quelle: [Lucide](https://lucide.dev) (ISC-Lizenz), geladen als eigener Chunk erst bei Bedarf (`src/lucideSet.ts`). Gespeichert wird der Lucide-Name (`stethoscope`), Spalte `entries.icon`.

## Erinnerungs-Vorlauf

Die Glocke im Kalender-Popup und im Planer öffnet die Auswahl: keine Erinnerung, zur Uhrzeit (ohne Uhrzeit um 9:00), 5 Min. vorher, 1 Std. vorher oder eine eigene Zeit – Zahl mit Pfeilen bzw. ↑/↓ und Einheit Min./Std./Tage (höchstens 30 Tage). Im Planer schaltet **E** die Erinnerung weiterhin nur an und aus. Der Eintrag im Journal zeigt den Vorlauf neben der Glocke.

Die Fälligkeit rechnet `Store::due_reminders` aus Uhrzeit minus Vorlauf (Spalte `entries.reminder_before`, Minuten); dafür werden auch Einträge der kommenden Tage geprüft. Geplante und wiederholte Kopien übernehmen den Vorlauf. iCal exportiert `X-JOURNAL-REMINDER-BEFORE`; beim Import gilt sonst der `TRIGGER` des ersten `VALARM`.

## Tags an Zetteln

Zettel bekommen über den Punkt neben dem Titel ein Tag. Ist das Tag im Tag-Filter des Journals ausgeblendet, verschwinden diese Zettel von der Pinnwand (mit Hinweis „n Zettel ausgeblendet“) und aus der Notizblock-Liste; die Suche findet sie weiterhin. Ordner haben keine Tags.

Implementierung: `src/entryIcons.ts`, `src/lucideSet.ts`, `src/components/EntryIcon.tsx`, `src/components/ReminderChoice.tsx`, `src/entryIcons.css`, `src-tauri/src/storage.rs`, `src-tauri/src/storage/schema.rs`. Prüfungen: `tests/entryIcons.test.mjs`, `tests/ical.test.mjs`, Rust-Tests in `storage.rs`/`drive.rs`, UI-Bereiche `popups` und `board`.
