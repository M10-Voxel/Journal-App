# Plan: J-TerminaL – Eingabe per Tastatur für das ganze Journal

> Stand: geplant, noch nicht umgesetzt (18.11.2026). Entwickelt im Branch `J-TerminaL` (eigener Ordner per `git worktree`), mit eigenen Releases. Der Branch enthält nur J-TerminaL und wird nie mit `Windows` gemergt. Aufgaben: `docs/roadmap.md`.

## Ziel
Man soll überall eintragen und nachsehen können, ohne die App zu öffnen: Einträge, Tagesbewertung, Aktivitäten, die Kalenderübersicht und die Pinnwand.

**J-TerminaL ist ein eigenes, kleines Programm**, kein Fenster der Haupt-App:
- **Eigener Download:** Es läuft auch, wenn die Haupt-App nicht läuft oder gar nicht installiert ist.
- **Dieselben Daten:** Es schreibt in dieselbe Datenbank (`journal.sqlite3` im Vault) wie die Haupt-App.
- **Sparsam:** Es läuft im Hintergrund und wartet auf `Strg+Alt+Leertaste`. Es braucht dabei so wenig RAM wie möglich, Ziel unter 20 MB. Das Fenster ist nativ, ohne Webview.
- **Ein Fenster für beide Wege:** In der Haupt-App öffnet `Strg+Leertaste` **dasselbe** Fenster. Die App schickt nur eine Nachricht, sie hat keine eigene Oberfläche dafür.
- **Plattformen:** zuerst Windows. Der Aufbau (Rust, Slint, `global-hotkey`) läuft auch auf macOS und Linux. Unter Linux mit Wayland gibt es keine globalen Kürzel für Programme; dort startet man es über ein Systemkürzel.

Was es leisten muss:
- **Sehr clean:** keine Knöpfe, nichts Überflüssiges.
- **Sofort da:** Es lädt instant.
- **Nur Tastatur:** Bedient wird mit Schrift und Pfeiltasten.
- **Vorschläge als Lückentext:** Man nimmt einen Vorschlag an und füllt danach nur noch die Lücken, mit `Tab` von Lücke zu Lücke.

Was es aus der Haupt-App übernimmt:
- **Speicher:** `src-tauri/src/storage.rs` und `storage/` (Schema, Migrationen, Lesen) sowie die Rückgängig-Historie (`history.rs`, `history::begin`). Beides hängt nicht von Tauri ab und wird zum gemeinsamen Datenkern `journal-core`.
- **Vault:** Den Speicherort findet es über `vault.json` im App-Datenordner (`%LOCALAPPDATA%\de.journal.local`), wie `vault.rs`. Es schreibt in `<Vault>\journal.sqlite3`; die Datenbank läuft im WAL-Modus mit `busy_timeout`, zwei Programme können sie also gleichzeitig nutzen.
- **Wird nach Rust übertragen:**
  - die Wiederholungs-Erkennung `src/repeatText.ts`
  - die Wiederholungsrechnung `src/repeat.ts` (`occurrences`), damit Serien beim Anlegen ihre Termine bekommen
  - das Anlegen von Serien aus `src/planning.ts` (`repeatChange`)
- **Als Vorbild für Verhalten und Wörter:** `src/search.ts` (`@Typ`, `\Tag`), `src/periodData.ts` (Bewertung, Skalen, Aktivitäten), `src/activityTimer.ts`, `board.rs` (Pinnwand).

---

## 1. Grundprinzip: eine Zeile, die mitdenkt

Es gibt nur **eine Eingabezeile**. Darunter stehen **Vorschläge** und bei Bedarf **ein eingebettetes Bedienelement** (Kalender, Skala, Liste, Band, Pinnwand). Es gibt keine Fußzeile mit Tasten und keine Überschriften, sofern sie nicht nötig sind. Tasten-Hinweise erscheinen **nur, solange man `Strg` gedrückt hält**, als blasse Kürzel neben den Zeilen.

> **Grundregel: In keinem UI-Element dieses Features gibt es Buttons.** Das gilt für alles, was dazugehört:
> - die Zeile und die Vorschlagsliste
> - die Bedienelemente: Mini-Kalender, Uhr, Skalen, Aktivitätenliste
> - die neue Kalender-Oberfläche
> - die Pinnwand im Schnellfenster
> - den Hinweis nach dem Speichern
>
> Konkret heißt das: keine Monatspfeile, kein „Heute“, kein „OK“/„Abbrechen“, kein Schließen-Kreuz, kein „+“, keine Plus/Minus-Knöpfe an Skalen. Alles läuft über Tasten: Bereich wechseln mit `PgUp`/`PgDn`, heute mit `H`, übernehmen mit `Enter`, abbrechen mit `Esc`.
>
> Die Maus darf zusätzlich wählen: Ein Klick auf eine Zeile, einen Tag oder eine Zelle wählt sie aus. Klickbare Steuerflächen gibt es aber keine.
>
> Auch die neuen Pinnwand-Kürzel in der App bringen **keine neuen Knöpfe** mit.

### 1.1 Vorschläge als Lückentext
Jeder Vorschlag ist eine Vorlage mit **Feldern**, ähnlich wie Snippets in VS Code:

```
from▏                         →  Tab  →   from [Mo 17.11.]  to [ __ ]
                                                 ▲ Cursor       ▲ nächstes Tab
```

- `Tab` übernimmt den markierten Vorschlag und springt ins erste leere Feld. Das nächste `Tab` springt ins nächste Feld, `Shift+Tab` zurück.
- `Enter` speichert, sobald alle Pflichtfelder gefüllt sind. Leere optionale Felder fallen still weg.
- Felder erscheinen als feine Unterstriche. Gefüllte und erkannte Felder bekommen eine leichte Tönung in der Farbe der Optik, sonst nichts.

### 1.2 Felder haben einen Typ, jeder Typ hat Vorschläge und ein Bedienelement

| Feldtyp | Erkennt beim Tippen | Vorschlag gleich danach | Bedienelement (2. Option) |
|---|---|---|---|
| Datum | `Mo`, `morgen`, `19.11.`, `in 3 Tagen`, `next fri` | Nach `Mo` stehen sofort `Di`, `Mi` … als nächste Möglichkeiten in der Liste | kleiner Kalender, ←↑→↓ |
| Zeitraum | `Mo–Fr`, `from … to …` | Uhrzeit oder Wiederholung ergänzen | Kalender mit Bereich (`Shift`+Pfeile) |
| Uhrzeit | `14`, `14:30`, `2pm` | `bis 15:00` (1 h Standard) | Uhr (Verhalten wie `ClockTyping` in `planning.ts`) |
| Dauer | `30 min`, `1,5 h` | – | Skala |
| Tag | `\Ges…` | passende Tags | Tag-Liste |
| Aktivität | `Les…` | Aktivitäten aus den Definitionen | Aktivitätenliste |
| Skalenwert | `7`, `+`, `-` | – | Zellenleiste (wie `scaleCells`), ← → |
| Wiederholung | `jede Woche`, `werktags` | `completion` aus `repeatText.ts` | Wiederholungsauswahl |

Wird ein Wort erkannt, wird es **sofort als Wert gesetzt**. Die Vorschlagsliste zeigt dann das **nächste Sinnvolle**.

**Aufzählungen:** Nach `Mo` kommt als erster Vorschlag `Di`. Mit `Tab` wird daraus `Mo, Di`, danach kommt `Mi` usw. So entsteht schnell eine Liste von Tagen (z. B. für „jeden Mo, Di, Mi“). Dasselbe gilt für Daten (`17.11.` → `18.11.`), Uhrzeiten und Tags. Weitere Vorschläge darunter sind das logisch nächste Feld (`bis …`, `14:00`).

Die **2. Option ruft immer das Bedienelement auf**. Bei `from` z. B. kommt erst „`from __ to __`“ und darunter „Im Kalender wählen“. Das Element öffnet sich **in das Fenster hinein**, nicht als neues Popup. Mit den Pfeiltasten wählt man aus, `Enter` schreibt den Wert zurück in die Zeile.

### 1.3 Mehrtägig oder mehrtägige Wiederholung
Wählt man einen Zeitraum (per Text `Mo–Fr` oder im Kalender), gilt:
- **Aufgabe:** Standard ist **täglich**.
- **Termin oder Eintrag:** Standard ist **mehrtägig (durchgehend)**.
- **Hinweis auf Wiederholung** (`jede`, `täglich`, `every`, eine Aufzählung wie `Mo, Mi, Fr` …): Dann ist es immer eine **Wiederholung**.
- **Nicht eindeutig:** Dann stehen **beide** Vorschläge da, jeweils mit einem kleinen Zeichen davor (`▬` durchgehend, `┆` wiederholt). Der wahrscheinlichere steht oben, mit `Tab` übernimmt man ihn:
```
  ▬ Mo–Fr durchgehend
  ┆ Mo–Fr täglich
  ┆ werktags 9–17 …
```
Dasselbe Zeichen steht auch im erkannten Wert in der Zeile. So sieht man jederzeit, wie gespeichert wird.
Im Kalender wird das sichtbar: Ein durchgehender Zeitraum ist ein Band, eine Wiederholung sind einzelne Punkte. Mit `Leertaste` schaltet man im Kalender zwischen beiden um. Gespeichert wird als mehrtägiger Eintrag (`docs/multiday-calendar.md`) oder als `Repeat` mit Ende.

### 1.4 Sprache
Deutsche und englische Schlüsselwörter funktionieren immer beide (`von/from`, `bis/to`, `jede/every`). Vorschläge erscheinen in der App-Sprache.

---

## 2. Bereiche (alles im selben Fenster)

Ein Bereich wird durch das erste Wort gewählt (z. B. `bew`, `start`, `kal`, `pin`). Leer ist das Fenster bei „Heute“. Mit `Strg+1…5` springt man direkt in einen Bereich. Oben links steht der Bereich als einziges Wort, blass.

**a) Eintragen – Aufgabe, Termin, Notiz**
`Zahnarzt Mi 14 \Gesundheit` bzw. Vorlagen wie `termin __ am __ um __`.
- Gespeichert wird über `journal-core`, wie `save_day` der Haupt-App.
- Rechts daneben steht die Vorschau des Zieltags, den es schon gibt, mit dem neuen Eintrag an seiner Stelle.

**b) Tagesbewertung und Skalen – visuell**
- Per Text: `bew 7`, `stress 3`, `schlaf 8 gestern`.
- Visuell:
  ```
  Bewertung  ▮▮▮▮▮▮▮▯▯▯  7
  Stress     ▮▮▮▯▯▯▯▯▯▯  3
  Schlaf     ▯▯▯▯▯▯▯▯▯▯  –
  ```
  - `↑`/`↓` wählt die Skala, `←`/`→` den Wert, eine Zahl setzt ihn direkt.
  - `Alt+←/→` wechselt den Tag. `Enter` oder Verlassen speichert.
- Verhalten wie `withPeriodValues`, `clampToScale` und `scaleCells` (`periodData.ts`), gespeichert über `journal-core`.

**c) Aktivitäten**
- `start Lesen`, `stop` (bzw. `stop Lesen`), `pause`.
- `Lesen 14–15:30`, `Lesen 45 min gestern`, `Sport ✓` (nur abhaken).
- Visuell als Liste aller aktiven Aktivitäten mit Haken bzw. laufender Zeit:
  - `Leertaste` hakt ab, `Enter` startet oder stoppt.
  - Tippt man eine Zeit, wird sie in den gewählten Abschnitt eingetragen.
- Ein laufender Timer steht immer ganz oben, auch im leeren Fenster.
- Verhalten wie `activityTimer.ts` und `ActivityRecord.minutes`. Ist `calendarTime`/`calendarTagId` gesetzt, entsteht zusätzlich ein Kalendereintrag.

**d) Kalender – nächste Zeit auf einen Blick**
- **Eine neue Oberfläche, die es so noch nicht gibt.** Sie ist eigens für das Schnellfenster gedacht und keine verkleinerte vorhandene Ansicht. Den Entwurf schlage ich zu Beginn von Stufe 3 gesondert vor.
- Fest steht nur:
  - Sie fasst die nächste Zeit zusammen.
  - Sie ist komplett per Tastatur bedienbar: `←`/`→` wählt den Tag, `↑`/`↓` den Termin, `Enter` öffnet ihn.
  - Tippt man darin, legt man am gewählten Tag an. `Alt+Pfeile` verschiebt den gewählten Termin.
  - Sie ist ohne Knöpfe und lädt sofort.
- Die Rechenteile aus `dayWindow.ts` dienen als Vorbild.

**e) Pinnwand – ganz per Tastatur** (gilt auch für die Pinnwand in der App)

| Taste | Wirkung |
|---|---|
| Pfeile | Fokus zur nächsten Karte in dieser Richtung |
| `Enter` / `Esc` | Karte bearbeiten / Bearbeiten beenden |
| `Shift`+Pfeile | Karte verschieben (Raster) |
| `Strg+Shift`+Pfeile | Größe ändern |
| `N` | neue Karte neben der fokussierten (`N`+`L` Link, `N`+`B` Bild aus Zwischenablage) |
| `T` / `F` | Tag / Ordner zuweisen |
| `Entf` | entfernen (mit Undo) |
| `/` | in der Pinnwand filtern |
| `Strg+V` | Zwischenablage als neue Karte |

- Im Schnellfenster wird nur eine Pinnwand gezeigt. Ordner wählt man mit `Tab`.
- Für „nächste Karte in Richtung X“ kommt eine eigene reine Rechenfunktion mit Tests.

**f) Suchen und Befehle**
- Wie in der App-Suche (`@Typ`, `\Tag`).
- Mit `>` am Anfang kommen Befehle: Gehe zu Datum, Ansicht, Einstellungen, Widgets …

**Leeres Fenster = „Heute“:** nur, was jetzt zählt. Laufender Timer, nächste 3 Termine, offene Aufgaben und die heutige Bewertung, falls sie fehlt. Mehr nicht.

**Nach dem Speichern:** Im Fenster steht kurz und blass „Gespeichert“, dann schließt es. Wird es gleich wieder geöffnet, ist „Rückgängig“ der erste Vorschlag. In der Haupt-App wirkt `Strg+Z` wie gewohnt, weil J-TerminaL in dieselbe Historie schreibt. Mit `Shift+Enter` speichert man und bleibt im Fenster, um mehrere Dinge nacheinander einzutragen.

---

## 3. Instant und sparsam
- **Wartet im Hintergrund:** J-TerminaL startet mit Windows (Autostart über `HKCU\…\Run`, wie die Widgets der Haupt-App). Es registriert das Kürzel und tut sonst nichts. Ziel: unter 20 MB RAM im Leerlauf. Das wird ab dem Grundgerüst gemessen.
- **Das Fenster ist vorbereitet:** Es wird beim Start versteckt erzeugt, das Kürzel zeigt es nur noch an. Ziel: unter 50 ms bis zur Eingabe. Falls ein verstecktes Fenster zu viel RAM kostet, wird es erst beim ersten Öffnen gebaut und danach nur versteckt.
- **Daten im Speicher:** Folgendes liegt warm bereit, wenn das Fenster aufgeht:
  - heute bis +30 Tage
  - Tags, Aktivitäten, Skalen, laufender Timer
- Neu geladen wird nur, wenn die Datenbank sich geändert hat (`PRAGMA data_version`). Vorschläge kommen **synchron pro Tastendruck**. Nur die Suche über alles läuft verzögert und wird ohne Springen unten angefügt.
- **Keine Ladeanzeigen und keine Leerzustände, die erst nachladen.**
- **Nur eine Instanz:** Ein zweiter Start bringt das laufende Programm nach vorne.

## 4. Optik
- **Zuerst ein Design:** eine ruhige, dunkle Fläche mit einer Linie zwischen Zeile und Liste. Farben und Schrift sind angelehnt an die Haupt-App.
- Alle Farben, Abstände und Schriften liegen von Anfang an zentral in einem Slint-`global` (Theme). Weitere Designs sind später nur neue Werte dafür, keine neuen Bauteile.
- **Größe und Lage:** etwa 640 px breit. Die Höhe wächst mit dem Inhalt (nur Zeile → Zeile + Liste → Zeile + Element). Das Fenster steht oben mittig auf dem Bildschirm mit der Maus. Es hat keinen Rahmen, steht immer im Vordergrund, erscheint nicht in der Taskleiste und verschwindet bei Fokusverlust.

---

## 5. Technischer Aufbau

**Gemeinsamer Datenkern** (lebt im Branch `Windows`)
- `crates/journal-core/` im Branch `Windows`. Er wird aus `src-tauri` herausgezogen: `storage.rs`, `storage/`, der Teil von `history.rs` ohne Tauri und das Lesen von `vault.json`. `src-tauri` nutzt ihn als Pfad-Abhängigkeit, ihr Verhalten bleibt gleich.
- J-TerminaL bindet ihn ein, ohne Code zu kopieren:
  - beim Entwickeln per Pfad `../Journal-App/crates/journal-core`
  - für Releases per Git vom Branch `Windows`, festgelegt auf einen Commit
- Ändert sich das Schema in `Windows`, zieht J-TerminaL den neuen Kern nach und bekommt ein neues Release.

**Ordner im Branch `J-TerminaL`** (sonst nichts: kein Tauri, kein React)
- `j-terminal/`: das Programm selbst, mit eigenem `Cargo.toml` und eigenem `target`.
  - `src/main.rs`: Hintergrund, Kürzel (`global-hotkey`), eine Instanz, Fenster.
  - `src/engine/`: die Eingabezeile ohne Oberfläche: Erkennen, Vorschläge, Lücken und Tab. Das ist die Rust-Fassung der Regeln aus Abschnitt 1, mit vielen Unit-Tests.
  - `src/repeat/`: die übertragene Wiederholungsrechnung und -erkennung.
  - `src/snapshot.rs`: der warme Datenspeicher.
  - `ui/*.slint`: die Oberfläche. `theme.slint` enthält das eine Design.
- Für Daten und Sync gibt es **keine neuen Felder und keine Migration**. J-TerminaL nutzt die Migrationen des Datenkerns. Ist die Datenbank neuer als der Kern, schreibt es nicht, sondern meldet „Bitte J-TerminaL aktualisieren“.

**Zusammenspiel mit der Haupt-App** (Änderungen dafür direkt im Branch `Windows`)
- Die Haupt-App nutzt `journal-core`.
- Sie bemerkt Schreibvorgänge von außen: Bei `PRAGMA data_version` lädt sie die betroffenen Tage neu und meldet `journal:changed`. Ihr Tagescache (`journal.ts`) und die Revisionsprüfung beim Speichern bleiben gültig.
- `Strg+Leertaste` in der App schickt eine Nachricht an J-TerminaL, über eine lokale Pipe bzw. einen Socket. Läuft J-TerminaL nicht, startet die App es, sofern es installiert ist.
- Ob der Drive-Sync Änderungen aufgreift, die bei geschlossener App entstanden sind, wird in Stufe 0 geprüft und falls nötig angepasst.

**Stufen** (jede einzeln vorzeigbar)
0. **Datenkern (im Branch `Windows`):** `journal-core` herausziehen, Verhalten unverändert, alle Rust-Tests grün. Die App erkennt Änderungen von außen.
1. **Grundgerüst J-TerminaL:** Hintergrundprozess, `Strg+Alt+Leertaste`, eine Instanz, natives Slint-Fenster mit der Eingabezeile im einen Design, Vault und Datenbank öffnen, RAM messen.
2. **Eingabezeile:** Engine in Rust mit Lückentext und Tab-Sprüngen, Aufzählungen, ▬/┆, Anlegen über `journal-core`, Heute-Übersicht, Suche, Befehle.
3. **Eingebettete Bedienelemente:** Mini-Kalender mit Bereich und der Wahl „durchgehend/täglich“, Uhr, Skala.
4. **Kalender:** neue Oberfläche für die nächste Zeit, zuerst den Entwurf zeigen.
5. **Bewertung und Aktivitäten:** start/stop/nachtragen.
6. **Pinnwand per Tastatur:** in J-TerminaL. In der Haupt-App kommen die Kürzel im Branch `Windows` dazu (`ShortcutHelp.tsx`, `docs/bulletin-board.md`).
7. **Haupt-App-Anbindung und Release:**
   - `Strg+Leertaste` in der App
   - eigener Release-Ablauf (Workflow nur für `J-TerminaL`, eigene Versionsnummer)
   - „Made with Slint“-Logo in der README und auf der Releases-Seite

**Begleitend**
- Punkte in `docs/roadmap.md`.
- Die Bedienung kommt später in eine eigene Seite `docs/j-terminal.md`.
- Texte deutsch und englisch, als eigene Tabelle in J-TerminaL.

---

## 6. Entscheidungen (geklärt am 17.11.2026)
1. **Aufzählung:** `Mo` [Tab] `Di` [Tab] `Mi` … baut eine Liste.
2. **Zeiträume:** Aufgabe → täglich, Termin/Eintrag → mehrtägig, ein Hinweis auf Wiederholung → Wiederholung. Ist es unklar, werden beide Möglichkeiten mit Zeichen vorgeschlagen.
3. **Globales Kürzel:** `Strg+Alt+Leertaste`.
4. **Pinnwand:** Einzelbuchstaben gelten auch in der Haupt-Pinnwand. **Später** kommen deutlich mehr Funktionen dazu, z. B. Karten verbinden. Die Tastatursteuerung wird so gebaut, dass weitere Aktionen leicht hinzukommen.
5. **Reihenfolge der Stufen:** Zeile → Bedienelemente → **Kalender (neue Oberfläche)** → Bewertung und Aktivitäten → Pinnwand. Davor kommen Datenkern und Grundgerüst, siehe Abschnitt 5.

**Am 18.11.2026 dazu:**
6. **Eigenes Programm statt Webview-Fenster:** Rust mit Slint, eigener Download, läuft ohne Haupt-App, gleiche Datenbank.
7. **Kürzel:** global `Strg+Alt+Leertaste`, in der Haupt-App `Strg+Leertaste`. `Strg+K` bleibt beim Kalender.
8. **Design:** zuerst nur eines. Weitere Designs kommen, wenn die Haupt-App fertig ist.
9. **Slint-Lizenz:** freie Lizenz (Royalty-free 2.0), mit dem Hinweis nach Variante b): Das „Made with Slint“-Logo steht in der README bzw. auf der Releases-Seite auf GitHub.
10. **Branch:** `J-TerminaL`, eigener Ordner per `git worktree`, eigene Releases. Er enthält nur J-TerminaL, wird nie mit `Windows` gemergt und teilt nur `journal-core`.


## Prüfung (bei der Umsetzung)
- **Datenkern:**
  - `cargo test` in `crates/journal-core` und `src-tauri`, alle bisherigen Tests grün.
  - `npm test` und `npx tsc --noEmit` für die Haupt-App.
- **J-TerminaL:**
  - `cargo test` in `j-terminal`: Engine mit vielen de/en-Sätzen, Tab-Sprünge, Vorschlagsreihenfolge, Unterscheidung mehrtägig/Wiederholung, Wiederholungen im Vergleich mit `tests/repeat*.test.mjs`.
  - Anlegen gegen eine Test-Datenbank, nie gegen echte Daten.
- **Zusammenspiel:**
  - Mit laufender Haupt-App in J-TerminaL anlegen: Der Eintrag erscheint in der App, und `Strg+Z` in der App nimmt ihn zurück.
  - Dasselbe mit geschlossener Haupt-App, danach die App starten.
- **Von Hand:**
  - Kürzel aus einem anderen Programm: Das Fenster ist sofort mit Fokus da.
  - Alles nur per Tastatur durchspielen.
  - RAM im Leerlauf und nach dem Öffnen messen (Task-Manager, privater Arbeitssatz).
