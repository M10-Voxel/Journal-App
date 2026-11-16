# Plan: iCal-Import und -Export nach Rust

Status: **umgesetzt und geprüft (16.11.2026).** Die folgenden Abschnitte dokumentieren den ursprünglichen Plan; der tatsächliche Stand und die Entscheidung aus Schritt 0 stehen hier.

**Entscheidung (User, 16.11.2026):** Nur ICS (Import, Export und der `ics`-Zweig der Regeln) geht nach Rust. Die übrige Wiederholungslogik (`occurrences`, `withStart`, `continued`, Ostern, Pausen, Monatsfilter, Anzeige) bleibt in TypeScript und damit synchron. Begründung: Die Rechnung wird in Vorschau, Planung und beim Verschieben sofort gebraucht, ein asynchroner Aufruf würde viele Aufrufer und die UI-Tests (Browser mit nachgebauten Tauri-Aufrufen) umbauen. Ein Gewinn für das Backend gäbe es nur, wenn es Serien ohne Frontend verlängern soll; dafür besteht kein Bedarf.


## Umsetzung und Entscheidung aus Schritt 0

Gewählt wurde **Lösung 1**: Import, Export und ICS-Regeln laufen in Rust (`calendar.rs`, Crates `ical`, `rrule`, `chrono-tz`). `ical.js` ist vollständig entfernt. Die normalen Journal-Regeln und Freitext-Erkennung bleiben synchron in TypeScript.

Aufrufer: `journal.ensureSeries` war bereits asynchron. Kopieren/Verschieben in `CalendarWindow` und Speichern im `CalendarComposer` ebenfalls. `EntryActionDock` verwendet beim Bestätigen jetzt `repeatChangeAsync`; native Regeln nutzen weiterhin `repeatChange`. `PlanCalendar` und `RepeatPanel` beziehen nur für ICS-Regeln asynchrone Vorschauen über `useRepeatOccurrences`; veraltete Antworten werden verworfen. Die synchronen `withStart`-Aufrufe in `PlanCalendar`/`CalendarComposer` betreffen ausschließlich neu erstellte native Regeln. ICS-Änderungen verwenden `withStartAsync`/`continuedAsync`.

Die bisherigen Import-Ergebnisse wurden vor dem Umbau als `tests/fixtures/ical-import.json` erfasst; die Export-Referenz liegt in `ical-export.json`. Rust- und Frontend-Tests verwenden dieselben Dateien. UUIDs und die textuelle Reihenfolge der ICS-Regel-Eigenschaften werden beim Vergleich normalisiert; Wiederholungsdaten werden separat verglichen. Zusätzliche synthetische Google-/Apple-/Outlook-Fälle stehen in `ical-special.json` (keine privaten Kalenderdaten). Der Vergleich läuft dauerhaft in Tests über die echten Rust-Befehle; ein temporärer Vergleichsmodus in der ausgelieferten App ist damit nicht nötig. Browserprüfungen verwenden denselben isolierten Rust-Testprozess ohne Vault-Zugriff.

Der Einstiegs-Chunk sank beim Produktionsbuild von 394,65 auf 316,46 kB (gzip 122,42 → 98,60 kB), der ICS-Chunk von 10,37 auf 0,75 kB. Der App-Chunk blieb bei 212,96 kB. Es gibt keine Datenmigration; vorhandene ICS-Regeln bleiben lesbar. Wie bisher exportiert die App angelegte einzelne Vorkommen; Serienregeln werden beim Export nicht rekonstruiert.

Abschlussprüfung: `npm test` (379 Tests), `cargo test` (117 App-Tests und 3 Kalender-Probe-Tests), `npm run build` sowie alle sieben Browserbereiche `calendar`, `calendar-actions`, `periods`, `mail`, `undo`, `language` und `multiday` erfolgreich. Der zuvor im Plan erwähnte Multiday-Fehler trat auf dem aktuellen Stand nicht auf.

## Ziel und Gewinn

- `ical.js` (rund 261 kB Quelltext) verlässt das Frontend. Heute steckt es im Einstiegs-Chunk, weil `src/repeat.ts` es statisch importiert, obwohl nur Regeln mit importiertem `ics`-Text es brauchen.
- Weniger Parsen und Speicher in jeder WebView, auch in Widgets.
- Termine, Serien, Importe und Exporte bleiben unverändert.

Nicht Ziel: schneller rechnen (nie der Engpass), Oberfläche oder Texte nach Rust verlegen, die Wiederholungsrechnung ändern.

## Was heute wo steht

| Datei | Zeilen | Rolle in diesem Plan |
| --- | --- | --- |
| `src/ical.ts` | 194 | `importCalendar` (ICS → `CalendarImport[]`), `exportCalendar` (Tage → ICS) mit `ical.js`: **geht nach Rust** |
| `src/repeat.ts` | 311 | Rechnung bleibt in TS. Nur der `ics`-Zweig nutzt `ical.js`: `occurrences` (Zeile ~121, Regel mit `rule.ics`, `EXDATE`) und `withStart` (Zeile ~274, ändert `dtstart` im gespeicherten ICS-Text) |
| `src/repeatText.ts` | 366 | Freitext → Regel: bleibt in TS, unberührt |
| `src-tauri/src/storage.rs` | – | speichert Serien und `dates`, rechnet sie nicht: unberührt |

Aufrufer von Import/Export: `CalendarTransfer.tsx`, `DesktopCalendarWidget.tsx` (beide schon per dynamischem `import('../ical')`), `mail.ts`/`mailRecognize.ts` (ebenfalls dynamisch), Tests `ical.test.mjs`, `mailMl.test.mjs`, Skript `verify-mail-ml.mjs`.

## Der heikle Punkt: der `ics`-Zweig in `repeat.ts`

Import und Export sind ohnehin Datei-/Netzvorgänge und können problemlos asynchron werden. Der `ics`-Zweig von `occurrences` und `withStart` dagegen wird synchron aufgerufen; solange er `ICAL` braucht, bleibt `ical.js` im Frontend und der Hauptgewinn entfällt. **Vor dem Code klären (Schritt 0), welche Aufrufer diesen Zweig synchron erreichen** (`journal.ts` `ensureSeries` ist bereits async; `planning.ts`, `CalendarWindow.tsx` Verschieben, `RepeatPanel`/`PlanCalendar`-Vorschau prüfen). Daraus folgt eine von drei Lösungen:

1. **Async nur für `ics`-Regeln:** Aufrufer, die schon async sind, rufen einen Rust-Befehl `calendar_occurrences(ics, from, to, limit)`; die wenigen synchronen Aufrufer bekommen für `ics`-Regeln eine eigene async-Variante. Nur wählen, wenn es höchstens zwei, drei Stellen sind.
2. **Beim Import umrechnen:** Rust liefert beim Import die Regel schon als `RepeatRule` ohne `ics`, soweit sich der ICS-Text darauf abbilden lässt (täglich/wöchentlich/monatlich/jährlich, `COUNT`/`UNTIL`, Wochentage). Regeln, die sich nicht abbilden lassen (komplexe `BYSETPOS`, `EXDATE`, `RDATE`), behalten den `ics`-Text und gehen über Lösung 1. Gespeicherte Regeln bleiben lesbar; nur neue Importe sehen anders aus.
3. **Fallback ohne Rust:** `ical.js` nur noch nachladen (`import('ical.js')`), wenn eine geladene Serie einen `ics`-Text hat; bis dahin liefert die synchrone Rechnung für diese Regeln nichts oder nutzt den Vorab-Wert. Das nimmt `ical.js` aus dem Einstiegs-Chunk, ohne Rust, und ist der kleinste Schritt, falls Lösung 1 und 2 zu viele Aufrufer berühren.

Lösung 3 ist auch der Maßstab: Wenn der Rust-Weg gegenüber dem reinen Nachladen keinen weiteren Vorteil bringt, wird nur 3 umgesetzt, und Import/Export wandern später separat.

## Vorgehen

### Schritt 0: Klären (Lesen, kein Code)

- Alle Aufrufer von `occurrences`, `withStart`, `continued` mit `rule.ics` auflisten; je Aufrufer sync oder async, und ob die Vorschau eine `ics`-Regel überhaupt zeigt.
- Entscheidung zwischen Lösung 1, 2 und 3 treffen und hier eintragen.

### Schritt 1: Vergleichsgrundlage

- Aus `tests/ical.test.mjs` (110 Zeilen) die Fälle als **JSON-Fixtures** herauslösen (`tests/fixtures/ical-import.json`, `ical-export.json`): Eingabe, erwartete Ausgabe. Dazu die `ics`-Fälle aus `tests/repeat.test.mjs`.
- Ergänzen: ICS von Google, Outlook und Apple mit `RRULE`, `EXDATE`, `RECURRENCE-ID`, ganztägig, Zeitzonen, Sommerzeitwechsel, `VALARM` (Erinnerung), `CANCEL` aus Mails.
- Die TS-Version gegen die Fixtures laufen lassen; sie ist die Referenz.

### Schritt 2: Rust-Modul neben der TS-Version

- `src-tauri/src/calendar.rs` (neu). Crates (`icalendar`, `ical`, `rrule`) zuerst gegen die Fixtures prüfen; fehlt etwas, selbst ergänzen. Keine Crate verwenden, die Fixture-Ergebnisse ändert.
- Befehle: `calendar_import(content, year) -> CalendarPreview`, `calendar_export(days, now) -> String`; bei Lösung 1/2 zusätzlich `calendar_occurrences(...)`.
- `cargo test calendar::` läuft dieselben Fixtures. Noch keine Umschaltung im Frontend.

### Schritt 3: Gegenprobe

- Verborgener Vergleichsmodus (`JOURNAL_CALENDAR_COMPARE=1`) führt beide Wege aus und meldet Abweichungen. Mit eigenen ICS-Dateien und Serien laufen lassen; jede Abweichung ist ein Fehler im Rust-Weg.

### Schritt 4: Umschalten

- `ical.ts` wird ein dünner `invoke`-Aufruf mit denselben Typen (`CalendarPreview`, `CalendarImport`); die dynamischen Importe der Aufrufer bleiben.
- `repeat.ts` verliert den `ICAL`-Import gemäß Schritt 0.
- `ical.js` aus `package.json` entfernen, Bündel neu messen (Einstiegs-Chunk, `App`-Chunk).
- Browser-Mocks in `verify-ui.mjs` für `calendar_import`/`calendar_export` ergänzen (Rückgabe aus den Fixtures), damit die UI-Bereiche weiter laufen.

### Schritt 5: Aufräumen

- Alte TS-Implementierung und Vergleichsmodus entfernen, sobald die Gegenprobe sauber ist.
- `docs/ics-import.md`, `docs/multiday-calendar.md`, `docs/development.md` (Aufbau-Tabelle) und `docs/performance.md` aktualisieren; Bündelgröße vorher/nachher eintragen.

## Abnahme

- `npm test` und `cargo test` grün, dieselben Fixtures in beiden Sprachen.
- UI-Bereiche: `calendar`, `calendar-actions`, `periods`, `mail`, `undo`, `language`, außerdem `multiday`\*. (\*`multiday` scheitert schon auf dem Stand vor der Optimierung am Test `.cal-multiday-bar`; vorher beheben oder getrennt bewerten.)
- Eine ICS-Datei mit allen Sonderfällen importieren, exportieren und erneut importieren: gleiche Einträge, gleiche Serien, gleiche Wiederholungstermine.
- Kein Datenformat ändert sich: Journal-Schema und Drive-Format bleiben unverändert (`docs/sync-format-12.md`); gespeicherte `RepeatRule`-JSONs (auch mit `ics`) bleiben lesbar.

## Nicht Teil dieses Plans

- Die Wiederholungsrechnung selbst (`occurrences` ohne `ics`, Ostern, Pausen, Monatsfilter), `repeatText.ts`, alle Anzeige- und Beschriftungsfunktionen, `RepeatPanel`.
- Eine native Rust-Oberfläche anstelle der WebView (Neubau).

## Optionale spätere Ergänzung

Weitere anonymisierte Kalenderdateien können die synthetischen Provider-Fixtures ergänzen.
