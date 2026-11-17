# Plan: Schnellfenster – Eingabe per Tastatur für das ganze Journal

> Stand: geplant, noch nicht umgesetzt (17.11.2026). Aufgaben stehen in `docs/roadmap.md` unter „Schnellfenster“.

## Ziel
Man soll überall eintragen und nachsehen können, ohne die App zu öffnen: Einträge, Tagesbewertung, Aktivitäten, die Kalenderübersicht und die Pinnwand. Das Fenster geht über ein globales Kürzel auf, in der App über `Strg+K`.

Was es leisten muss:
- **Sehr clean:** keine Knöpfe, nichts Überflüssiges.
- **Sofort da:** Es lädt instant.
- **Nur Tastatur:** Bedient wird mit Schrift und Pfeiltasten.
- **Vorschläge als Lückentext:** Man nimmt einen Vorschlag an und füllt danach nur noch die Lücken, mit `Tab` von Lücke zu Lücke.

Was es schon gibt und wiederverwendet wird:
- **Suche:** `src/search.ts` (`parseQuery`, `searchSuggestions`, `runSearch`, `@Typ`/`\Tag`), `Search.tsx` (`useSearchItems`) und `search_entries`.
- **Texte verstehen:** `chrono-node` (de/en, bisher nur in `mailMl.ts`). Dazu `src/repeatText.ts` mit `parseRepeat`, `suggestions` und `completion`; das ist bereits ein Vorschlagssystem für Wiederholungen. Außerdem `src/planning.ts` mit `parseTime` und `ClockTyping` (Uhrzeit tippen).
- **Speichern:** `applyDayOperation` (`src/dayOperations.ts`) mit `save_day`. Aus anderen Fenstern schreibt man nach dem Muster von `calendarRequests.ts`.
- **Bewertung und Aktivitäten:** `src/periodData.ts` (`ScaleDefinition`, `PeriodDay.rating/scales/items`, `withPeriodValues`, `clampToScale`, `scaleCells`) und `src/activityTimer.ts` (`ActivityTimerState`, `pauseTimer`, `elapsedTimer`). Gespeichert wird mit `save_period_data`.
- **Kalender:** `src/dayWindow.ts` hat Rechenhilfen für Zeiträume. Die Oberfläche im Schnellfenster wird aber neu entworfen.
- **Pinnwand:** `board.rs` (`board_list`, `board_patch` …) und `src/notebook.ts` (`Card`, `Folder`).
- **Optik:** `PopupChrome.tsx`, `popupLook.ts` und `useDismissLayer.ts`.
- **Fenster:** Vorlage ist das Erinnerungsfenster (`reminders.rs:83`). Tray und Hintergrundstart gibt es schon.

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
| Uhrzeit | `14`, `14:30`, `2pm` | `bis 15:00` (1 h Standard) | Uhr (`ClockTyping`) |
| Dauer | `30 min`, `1,5 h` | – | Skala |
| Tag | `\Ges…` | passende Tags | Tag-Liste |
| Aktivität | `Les…` | Aktivitäten aus den Definitionen | Aktivitätenliste |
| Skalenwert | `7`, `+`, `-` | – | Zellenleiste (`scaleCells`), ← → |
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
- Gespeichert wird über `applyDayOperation`.
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
- Nutzt `withPeriodValues`, `clampToScale` und `scaleCells`.

**c) Aktivitäten**
- `start Lesen`, `stop` (bzw. `stop Lesen`), `pause`.
- `Lesen 14–15:30`, `Lesen 45 min gestern`, `Sport ✓` (nur abhaken).
- Visuell als Liste aller aktiven Aktivitäten mit Haken bzw. laufender Zeit:
  - `Leertaste` hakt ab, `Enter` startet oder stoppt.
  - Tippt man eine Zeit, wird sie in den gewählten Abschnitt eingetragen.
- Ein laufender Timer steht immer ganz oben, auch im leeren Fenster.
- Nutzt `activityTimer.ts` und `ActivityRecord.minutes`. Ist `calendarTime`/`calendarTagId` gesetzt, entsteht zusätzlich ein Kalendereintrag.

**d) Kalender – nächste Zeit auf einen Blick**
- **Eine neue Oberfläche, die es so noch nicht gibt.** Sie ist eigens für das Schnellfenster gedacht und keine verkleinerte vorhandene Ansicht. Den Entwurf schlage ich zu Beginn von Stufe 3 gesondert vor.
- Fest steht nur:
  - Sie fasst die nächste Zeit zusammen.
  - Sie ist komplett per Tastatur bedienbar: `←`/`→` wählt den Tag, `↑`/`↓` den Termin, `Enter` öffnet ihn.
  - Tippt man darin, legt man am gewählten Tag an. `Alt+Pfeile` verschiebt den gewählten Termin.
  - Sie ist ohne Knöpfe und lädt sofort.
- Rechenteile aus `dayWindow.ts` (z. B. `windowDates`, `datesBetween`) können weiterverwendet werden, wo es passt.

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

**Nach dem Speichern:** Das Fenster schließt. Unten blendet kurz und blass „Gespeichert · Strg+Z“ ein, ohne Knopf. Mit `Shift+Enter` speichert man und bleibt im Fenster, um mehrere Dinge nacheinander einzutragen.

---

## 3. Instant: So lädt es sofort
- **Vorbereitet beim Start:** Das Fenster `quick` wird beim App-Start versteckt erzeugt. React ist schon gemountet, das Kürzel macht es nur noch sichtbar. Ziel: unter 50 ms bis zur Eingabe.
- **Daten im Speicher:** Folgendes liegt warm bereit:
  - heute bis +30 Tage (`load_range`)
  - Period-Daten, Tags, Aktivitäten, Timer
  - Pinnwand-Karten
- Die Daten werden über `journal:changed` aktuell gehalten. So kommen Vorschläge **synchron pro Tastendruck**. Nur die Volltextsuche über alles läuft verzögert (`search_entries`) und wird ohne Springen unten angefügt.
- **Keine Ladeanzeigen und keine Leerzustände, die erst nachladen.**
- **Animation:** kurzes Einblenden mit leichter Vergrößerung. Beim Start ohne Fokus darf sie nie bei Deckkraft 0 hängen bleiben (`WindowActivity`).

## 4. Optik
Die drei Optiken laufen über `data-look`/`data-popups`/`data-pixel`; die Struktur ist überall gleich, nur die Haut ändert sich:

| Optik | Aussehen |
|---|---|
| klassisch | Glasfläche, eine Linie zwischen Zeile und Liste |
| journal | ein Papierstreifen; erkannte Werte als kleine Sticker |
| nebula | Prompt-Zeile `›` wie `nebula-a`, Vorschläge als Terminal-Ausgabe |

Größe: etwa 640 px breit. Die Höhe wächst mit dem Inhalt (nur Zeile → Zeile + Liste → Zeile + Element). Das Fenster steht oben mittig auf dem Bildschirm mit der Maus.

---

## 5. Technischer Aufbau

**Neue Module (Frontend, ohne UI, testbar)**
- `src/quick/grammar.ts`: Befehle und Vorlagen deklarativ, z. B. `{ id, words:{de,en}, template:'from {start:date} to {end:date}', apply }`.
- `src/quick/fields.ts`: Feldtypen mit `parse`, `suggest` und `picker`. Nutzt `chrono-node`, `parseRepeat`/`suggestions`, `parseTime` und `searchSuggestions`.
- `src/quick/engine.ts`: aus Text und Cursor werden erkannte Teile, aktuelles Feld, Vorschläge und Aktion. Hier liegt die Logik für Tab-Sprünge.
- `src/quick/snapshot.ts`: der warme Datenspeicher.
- `src/boardNavigation.ts`: räumliche Navigation auf der Pinnwand.

**UI**
- `QuickBar.tsx`: Zeile, Liste, Bereich.
- Eingebettete Elemente: `QuickCalendar` (Datum und Bereich), `QuickScales`, `QuickActivities`, `QuickAgenda` (neue Kalender-Oberfläche), `QuickBoard`.
- Wo vorhanden, werden bestehende Komponenten genutzt (Uhr).

**Rust**
- `tauri-plugin-global-shortcut`.
- Fenster `quick`: ohne Rahmen, transparent, immer im Vordergrund, nicht in der Taskleiste, **nimmt den Fokus**. Wird beim Start vorbereitet.
- Bei Fokusverlust wird es versteckt.
- Eintrag `quick` in `capabilities/default.json` und in `src/main.tsx:119`.
- Im Tray-Menü kommt ein Eintrag dazu. In den Einstellungen: Kürzel und an/aus.
- Für Daten und Sync: **keine neuen Felder**. Ausnahme: Falls der Bereich „zuletzt genutzt“ gespeichert werden soll, nur als Setting.

**Stufen** (jede einzeln vorzeigbar, Frontend zuerst)
1. Engine und Zeile in der App (`Strg+K`): Eintragen mit Lückentext und Tab-Sprüngen, Suche, Befehle, alle drei Optiken.
2. Eingebettete Elemente: Kalender mit Bereich und der Wahl „durchgehend/täglich“, Uhr, Skala.
3. Kalender: neue Oberfläche für die nächste Zeit, zuerst den Entwurf zeigen.
4. Bewertung und Aktivitäten (start/stop/nachtragen).
5. Pinnwand per Tastatur, in der App und im Schnellfenster, mit neuen Kürzeln in `ShortcutHelp.tsx`.
6. Globales Fenster, Kürzel, Vorbereitung beim Start, Tray.

**Begleitend**
- Punkte in `docs/roadmap.md`, neue Seite `docs/quick-bar.md`.
- Pinnwand-Kürzel in `docs/bulletin-board.md`.
- Übersetzungen in `src/locales/en.ts`.

---

## 6. Entscheidungen (geklärt am 17.11.2026)
1. **Aufzählung:** `Mo` [Tab] `Di` [Tab] `Mi` … baut eine Liste.
2. **Zeiträume:** Aufgabe → täglich, Termin/Eintrag → mehrtägig, ein Hinweis auf Wiederholung → Wiederholung. Ist es unklar, werden beide Möglichkeiten mit Zeichen vorgeschlagen.
3. **Globales Kürzel:** `Strg+Alt+Leertaste`.
4. **Pinnwand:** Einzelbuchstaben gelten auch in der Haupt-Pinnwand. **Später** kommen deutlich mehr Funktionen dazu, z. B. Karten verbinden. Die Tastatursteuerung wird so gebaut, dass weitere Aktionen leicht hinzukommen.
5. **Reihenfolge der Stufen:** Zeile → Bedienelemente → **Kalender (neue Oberfläche)** → Bewertung und Aktivitäten → Pinnwand → global.

## Prüfung (bei der Umsetzung)
- **Automatische Tests:** `npx tsc --noEmit` und `npm test`. Neue Tests:
  - `tests/quickEngine.test.mjs`: viele de/en-Sätze, Tab-Sprünge, Vorschlagsreihenfolge, Unterscheidung mehrtägig/Wiederholung.
  - `tests/boardNavigation.test.mjs`
- **UI-Prüfung:** `npx vite build`, dann `JOURNAL_UI_SCOPE=quick node scripts/verify-ui.mjs`. Dafür kommt ein neuer Bereich dazu: jeder Bereich in allen drei Optiken plus Pixel.
- **Von Hand** (`npm run tauri dev`):
  - Kürzel aus einem anderen Programm: Das Fenster ist sofort mit Fokus da.
  - Alles nur per Tastatur durchspielen.
  - Speichern und `Strg+Z`.
  - Mit Hauptfenster im Tray testen.
