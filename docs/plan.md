# Plan: J-TerminaL – Eingabe per Tastatur für das ganze Journal

> Stand: Suchleiste, kompaktes Eintragsformular und Kalender umgesetzt (18.11.2026); Oberfläche an das Standarddesign der Journal-App angepasst. Entwickelt im Branch `J-TerminaL` (eigener Ordner per `git worktree`), mit eigenen Releases. Der Branch enthält nur J-TerminaL und wird nie mit `Windows` gemergt. Aufgaben: `docs/roadmap.md`.

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
- **Tastatur und Maus:** vollständig mit Schrift und Pfeiltasten bedienbar; Felder, Auswahlflächen und kompakte Aktionen zusätzlich mit der Maus.
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

## 0. Umbau am 18.11.2026: Formular statt „Zeile, die mitdenkt“

> **Dieser Abschnitt und seine Ergänzungen 0b/0c gelten vor den älteren Entwürfen.** Die Abschnitte 1.1 bis 1.3 und die „Stand“-Absätze zur Eingabezeile, den Blöcken, den Vorlagen und den Vorschlägen beschreiben das frühere Modell. Es ist ersetzt. Erhalten bleiben: die schlichte Gestaltung, der Parser, die Wiederholungsrechnung, der Wiederholungseditor, Kalender, Uhr und Dauer, Speichern über `journal-core`, die gemeinsame Historie, Instanz, Kürzel, Platzierung und Autostart. Die ergänzte Mausbedienung steht in Abschnitt 0c.

**Warum:** Der Praxistest zeigte, dass die Eingabe unintuitiv war. Es gab zu viele Modi (Text, Blöcke, Vorlagen, Vorschläge, Popups). Eine Information ließ sich auf mehreren Wegen ändern. Enter hatte je nach Zustand verschiedene Bedeutungen, und schon ein einfacher Eintrag brauchte viele Schritte.

**Neues Modell:** Ein Formular mit festen Zeilen, **eine Zeile pro Information eines Eintrags**, alles per Tastatur:
- Typ · Titel · Datum · Zeit · Wiederholung · Tag · Beschreibung · Wichtig · Erinnerung · Symbol · Im Journal. Das sind alle Felder eines Eintrags der Haupt-App (`journal-core::Entry`) bis auf „Planen auf andere Tage“, das mit dem Bearbeiten bestehender Einträge folgt.
- **Eine Stelle pro Wert:** ↑/↓/Tab wechseln die Zeile. Der Text einer Zeile ist beim Betreten markiert, Tippen ersetzt ihn. Auswahlzeilen (Typ, Tag, Erinnerung, Schalter) ändern sich mit ←/→. Kalender, Uhr, Dauer und Wiederholungseditor öffnen sich auf Wunsch mit Alt+↓ oder mit Enter auf einer leeren Zeile.
- **Enter erstellt nie.** Es bestätigt die Zeile. Shift+Enter erstellt und lässt das Fenster offen, Strg+Enter erstellt und schließt. Ein Eintrag aus reinem Titel ist eine Aufgabe für heute; das Formular zeigt den Typ aber immer sichtbar an.
- **Schnell in einem Zug:** Im Titel erkannte Wörter (`Zahnarzt Do 14 \Gesundheit`) wandern beim Verlassen der Zeile in ihre Zeilen. Die Felder sind die einzige Wahrheit, im Text bleiben keine Blöcke.
- **Ruhige Vorschau** unten: Zieltag mit seinen Einträgen, der neue hervorgehoben, bei Serien die nächsten fünf Termine, offene Probleme blass.
- Unverändert: Fenster 640 px breit, keine Buttons, Hinweise nur beim Halten von Strg, alle Maße im Theme.

**Code:** `form.rs` (Modell ohne Fenster, `form_tests.rs`), `ui/bar.slint` (nur Darstellung, ein Eingabefeld über der aktiven Zeile), `save.rs` (`Extras` für die Felder jenseits von `Outcome`). Entfernt: `app.rs`, `spin.rs`, `draft_preview.rs`, `engine/{suggest,fields,blocks}.rs`.

**Offen (Stufe „bestehende Einträge“):** Suche und Bearbeiten (derselbe Formularaufbau lädt einen Eintrag), Tag ansehen, Planen, Tagestitel/Journaltext. Befehle in der Zeile (`>`) entfielen; Rückgängig/Wiederherstellen/Beenden liegen auf Strg+Z/Strg+Y/Strg+Q.

---

## 0b. Kalender (18.11.2026)

Rechts neben dem Formular steht dauerhaft der Kalender als „Zeitgewebe“ (`calendar.rs`, `ui/calendar.slint`): Tage untereinander, endlos; jeder Tag ein Band über 24 Stunden mit Zeitstücken in Tag-Farbe; Überschneidungen in Reihen; Tage per Linksklick aufklappbar; Mehrtägiges als Spur an der Seite; farbige Wochenlinie So/Mo; Monatskopfzeilen. Der entstehende Eintrag erscheint live (aus `Form::outcome()`). Anlegen per Rechtsklick wie in der App (ganztägig, mehrtägig, Zeitspanne über Tage), das Ergebnis landet im Formular. Linksklick auf Einträge ist für ihre Details vorgemerkt. Fenster 1501 px (Formular 600, Kalender 900), alle Maße im Theme. Bedienung: `docs/input.md`.

**Stundenraster und Zeitpunkte (18.11.2026):** Wo eine mehrtägige Spanne angelegt wurde, bestimmt ihre Darstellung. Links oder über Formularfelder angelegt bleibt sie eine seitliche Spur. Im Stundenraster gezogen, belegt sie auf dem ersten Tag den Beginn bis Mitternacht, auf Zwischentagen alle 24 Stunden und am letzten Tag die Zeit bis zum Ende. Das Merkmal `timeGrid` wird in Schema 15 des gemeinsamen Kerns gespeichert und auch von der Haupt-App ausgewertet. Bestehende Einträge erhalten `false`, ihre Darstellung ändert sich nicht. Einträge mit Beginn ohne Ende sind echte Zeitpunkte: dicke Linie an der exakten Minute und schmaler Beschriftungsbalken; dessen Breite ist unabhängig vom Stundenzoom und seine Trefferfläche wird für Überschneidungen mitgerechnet. Liegt darunter eine horizontal überlappende Terminreihe, sitzt die Beschriftung oben an der Zeitmarke, sonst unten; Text und Symbol wandern gemeinsam. Getrennte Reihen schützen die Beschriftungen vor fremden Zeitmarken. Die Balkenenden sind nur leicht gerundet (Radius im Theme).

## 0c. Geplante Erweiterungen: Tagesansicht, Notizblock und Maus

**Dieser Abschnitt ergänzt den aktuellen Formular-/Kalenderaufbau und hat Vorrang vor älteren Beschreibungen zur leeren linken Fläche, reinen Tastaturbedienung und nicht klickbaren Steuerflächen. Die Funktionen sind geplant, noch nicht umgesetzt.**

- **Kompakte Vorschau beim Hover:** Über Einträgen im Kalender, in der Tagesansicht und in Suchtreffern erscheinen der vollständige Name und, falls vorhanden, die Beschreibung in einer kleinen Vorschau. Das gilt auch für schmale Zeitstücke, reine Symbolanzeigen und mehrtägige Spuren. Die Vorschau bleibt innerhalb des Fensters, ist in der Größe begrenzt und verändert weder Auswahl noch Eintrag. Dieselben Informationen müssen auch beim Tastaturfokus erreichbar sein.
- **Alle Felder und Aktionen mit der Maus:** Ein Klick fokussiert und bearbeitet Felder, öffnet Auswahlflächen und betätigt vorhandene Aktionsflächen (die bisherigen „Buttons“), z. B. Typwahl, „Mehr“, Optionen und Suchtreffer. Kompakte Aktionen dürfen direkt auslösen; zusätzliche Buttonleisten sind nicht vorgesehen. Alle Funktionen bleiben vollständig per Tastatur bedienbar, Tastenhinweise erscheinen weiterhin nur beim Halten von Strg.
- **Linke Fläche als Tagesansicht:** Unter der oberen Leiste steht statt der momentan leeren Fläche eine kompakte Zusammenfassung des gewählten Tages: Datum, Termine, offene Aufgaben, Notizen, Bewertungen und Aktivitäten. Standard ist heute. Wird im Kalender ein anderer Tag für die Tagesansicht gewählt, folgt die linke Ansicht diesem Tag; als Mausgeste ist z. B. ein Mittelklick vorgesehen, zusätzlich eine Tastaturwahl. Tageswahl und Auf-/Zuklappen eines Kalenderbands bleiben getrennte Aktionen. Das angezeigte Datum und ein Weg zurück zu heute sind sichtbar. Ein geöffnetes Eintragsformular nutzt denselben linken Bereich; nach dem Schließen kehrt die Tagesansicht zurück.
- **Eigenständiger Notizblock:** Der Notizblock bekommt einen eigenen, separat aufrufbaren Bereich und wird nicht in der Tagesansicht angezeigt. Dort lassen sich Tagestitel und Journaltext ansehen und bearbeiten. Der Text bleibt dem jeweiligen Tag zugeordnet und verwendet dieselben Daten wie die Haupt-App. Die separat geplante Pinnwand bleibt ebenfalls erhalten.
- **Bewertungen als runde Dials:** Vorhandene Tagesbewertung und eigene Skalen werden als platzsparende runde Regler mit Bezeichnung und lesbarem Wert dargestellt. Sie lassen sich mit der Maus sowie mit Pfeiltasten und direkter Zahleneingabe bedienen. Grenzen, Schrittweite und fehlende Werte folgen den vorhandenen Skalen; gespeichert wird für den angezeigten Tag.
- **Aktivitäten in der Tagesansicht:** Aktivitäten starten/stoppen, laufende Zeit sehen, Aktivitäten abhaken und Zeiten nachtragen. Laufende Timer bleiben unabhängig vom betrachteten Tag sichtbar. Vorhandene Aktivitätsdefinitionen und die Logik der Haupt-App bleiben die Grundlage.
- **Suche und Quick-Actions in der oberen Leiste:** Die vorhandene Leiste wird zur gemeinsamen Suche und Befehlsauswahl ausgebaut. Journal durchsuchen, Treffer ansehen und im bestehenden Formular bearbeiten; Filter wie `@Typ` und `\Tag` erhalten. Neben `/Entry` sind Aktionen für Tageswahl/Heute, Rückgängig/Wiederherstellen, Notizblock, Bewertung, Aktivitäten und später Pinnwand vorgesehen. Treffer und Aktionen lassen sich per Tastatur und Maus ausführen.

**Bereits vorgemerkt und weiterhin offen:** bestehende Einträge bearbeiten, „Planen auf andere Tage“, Kalenderdetails per Linksklick, Einträge im Kalender verschieben/ändern, Pinnwand samt Tastatursteuerung, Haupt-App-Kürzel und eigener Release-Ablauf. Diese Punkte werden durch die Tagesansicht nicht ersetzt.

**Bei der Umsetzung prüfen:** Hover mit und ohne Beschreibung, schmale Einträge und Fensterränder; gleiche Aktionen per Maus und Tastatur; Wechsel heute/anderer Tag ohne falsch zugeordnete Bewertungen; separaten Aufruf des Notizblocks und Zuordnung seines Journaltexts zum jeweiligen Tag; Speichern von Journaltext und Skalen sowie Start/Stop/Nachtragen von Aktivitäten gegen Test-Datenbanken. Gestaltung bleibt im Theme, Texte deutsch/englisch, vorhandene Rust-/Slint-Bausteine bevorzugen und RAM-/Startzeitziele beibehalten.

---

## 1. Grundprinzip (früheres Modell, ersetzt durch Abschnitt 0)

Es gibt nur **eine Eingabezeile**. Darunter stehen **Vorschläge** und bei Bedarf **ein eingebettetes Bedienelement** (Kalender, Skala, Liste, Band, Pinnwand). Es gibt keine Fußzeile mit Tasten und keine Überschriften, sofern sie nicht nötig sind. Tasten-Hinweise erscheinen **nur, solange man `Strg` gedrückt hält**, als blasse Kürzel neben den Zeilen.

> **Bedienungsregel, aktualisiert durch Abschnitt 0c:** Alle Funktionen bleiben vollständig per Tastatur bedienbar. Die Maus darf Felder bearbeiten, Optionen wählen und kompakte Aktionsflächen direkt auslösen. Das gilt auch für Kalender, Bewertungs-Dials, Aktivitäten und die spätere Pinnwand. Zusätzliche Buttonleisten sind nicht vorgesehen; Hinweise erscheinen weiterhin nur beim Halten von Strg.

### 1.1 Vorschläge als Lückentext
Jeder Vorschlag ist eine Vorlage mit **Feldern**, ähnlich wie Snippets in VS Code:

```
from▏                         →  Tab  →   from [Mo 17.11.]  to [ __ ]
                                                 ▲ Cursor       ▲ nächstes Tab
```

- `Tab` übernimmt den markierten Vorschlag und springt ins erste leere Feld. Das nächste `Tab` springt ins nächste Feld, `Shift+Tab` zurück.
- `Enter` übernimmt Vorschläge oder bestätigt das aktive Feld. `Shift+Enter` erstellt den Eintrag, sobald alle Pflichtfelder gefüllt sind, und hält das Fenster offen. Leere optionale Felder fallen still weg.
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
- Aktuelle Darstellung: platzsparende runde Dials in der linken Tagesansicht (Abschnitt 0c); die Balkenskizze unten beschreibt den älteren Entwurf.
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
- **Eine neue Oberfläche, die es so noch nicht gibt.** Sie ist eigens für das Schnellfenster gedacht und keine verkleinerte vorhandene Ansicht. Den Entwurf schlage ich zu Beginn von Stufe 4 gesondert vor.
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
- Aktuell sind `/`-Befehle in der oberen Leiste vorgesehen, ausgehend vom vorhandenen `/Entry`; der frühere `>`-Einstieg entfällt. Suche, Tageswahl und weitere Quick-Actions siehe Abschnitt 0c.

**Linker Bereich ohne Formular = Tagesansicht:** Standard ist heute; die Kalenderwahl kann einen anderen Tag setzen. Kompakte Zusammenfassung, Bewertungs-Dials und Aktivitäten siehe Abschnitt 0c. Der Notizblock ist als eigener Bereich separat aufrufbar. Die frühere Beschränkung auf drei Termine und eine fehlende Bewertung entfällt.

**Nach dem Speichern:** Shift+Enter erstellt den Eintrag und zeigt blass „Gespeichert“; das Fenster bleibt offen. Im leeren Fenster ist „Rückgängig“ der erste Vorschlag. In der Haupt-App wirkt `Strg+Z` wie gewohnt, weil J-TerminaL in dieselbe Historie schreibt. Mit `Shift+Enter` speichert man und bleibt im Fenster, um mehrere Dinge nacheinander einzutragen.

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
- **Ein Design, wie die Standardansicht der Haupt-App:** Look `classic`, Palette `original` aus `Journal-App/src/colors.ts` und `styles.css`; Formularfelder nach dem Kalender-Composer in `calendar.css`. Graue Oberfläche (`#292929`), schwarze Eingabefelder und Kalenderfläche, blaue Akzente (`#569eff`), abgerundete Felder und dezente Fokuslinien. Auswahlkarten verwenden die dunklen Panels und die Ereignisfarben der App.
- **Schriften:** IBM Plex Sans für die Oberfläche, Lilex für Titel, Beschreibung und Datum/Uhrzeit. Die vorhandenen TTF-Dateien sind mit ihren OFL-Lizenzen eingebettet; auch gedrehte Kalendertexte verwenden IBM Plex Sans. `ab_glyph::FontRef` liest dabei direkt die eingebetteten Bytes statt eine Systemschrift in einen eigenen Puffer zu laden.
- **Icons:** vorhandener Lucide-Satz und vorhandene Rust-Rasterung (`icons.rs`, `zeno`), auch an Suchleiste, Befehlen und im Kalender. Einträge verwenden ihr eigenes Symbol, sonst das ihres Tags; unbekannte Symbole fallen auf den Farbpunkt zurück. Tag-Optionen zeigen ebenfalls ihre Symbole und Farben. Bilder werden nach Name und Größe zwischengespeichert. Keine zusätzlichen Rust-Abhängigkeiten und kein anderer Renderer.
- **Icon-Qualität und „Mehr“:** Rasterung mit achtfacher physischer Auflösung und flächengewichteter Verkleinerung; der große Arbeitspuffer wird sofort freigegeben, nur die fertige Maske bleibt im Cache. Ein Wechsel der Windows-Skalierung löst eine erneute Zeichnung aus. Die zusätzliche Formulargruppe hat eine einzelne Zeile mit Aufklapppfeil, Linie und Zusammenfassung. Alle Gestaltungswerte bleiben im Theme.
- **Darstellungskorrekturen nach Praxistest:** `zeno` 0.3 bricht beim Lesen implizit wiederholter SVG-Kreisbögen ab. In 219 eingebetteten Lucide-Pfaden sind diese Bögen deshalb ausdrücklich mit `a`/`A` eingeleitet; Geometrie und Renderer bleiben gleich. Nach einer neuen Icon-Übernahme bereitet `python scripts/normalize_icon_arcs.py` die Datei erneut auf (ohne Laufzeitkosten). Ein Test liest jeden Pfad vollständig und prüft zusätzlich den Gitarrenkörper. Aktive Eingaben und markierter Text sind explizit hell. Ein Kalender-Icon erscheint unabhängig vom Titel, wenn Breite und Höhe ausreichen. Monatstrenner haben eine deckende graue Fläche und eine helle obere Linie, die auch über Stundenlinien und mehrtägigen Spuren sichtbar bleiben. Tests prüfen diese drei UI-Fälle direkt im Software-Renderer; insgesamt 104 Tests grün.
- Alle Farben, Abstände und Schriften liegen von Anfang an zentral in einem Slint-`global` (Theme). Weitere Designs sind später nur neue Werte dafür, keine neuen Bauteile.
- **Größe und Lage:** 1501 px breit (Formular 600, Trennlinie 1, Kalender 900), mindestens 600 px hoch; die Höhe wächst mit den offenen Optionen. Das Fenster steht oben mittig auf dem Bildschirm mit der Maus. Es hat keinen Rahmen, steht immer im Vordergrund, erscheint nicht in der Taskleiste und verschwindet bei Fokusverlust. Keine Buttons; auch Hinweise in offenen Auswahlkarten erscheinen nur beim Halten von Strg.
- **Aktuelle Prüfung am 18.11.2026:** 109 Terminal-Tests, 66 Kern-Tests, 56 Backend-Tests der Haupt-App und 402 Frontend-Tests grün. Browserprüfung mit echter Mausgeste über drei Tage und anschließendem Speichern erfolgreich. Slint-Ansichten bei 100/125/150/200 Prozent und die Zeitpunkt-Markierung geprüft; Beschriftungen oben/unten mit mitwanderndem Symbol und kleinem Eckenradius zusätzlich im Layout und gerendert geprüft. Beide Release-EXEs gebaut. Privater Arbeitssatz von J-TerminaL mit Test-Datenbank: 2,98 MiB im Hintergrund, 12,17 MiB geöffnet; gesamter Arbeitssatz 25,14/38,41 MiB (Windows-Leistungszähler). Die Werte hängen vom Datenumfang ab; die frühere Latenzmessung wurde dabei nicht wiederholt. Testansichten und Messung unter `j-terminal/target/ui-check/`.

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
- J-TerminaL nutzt das Schema und die Migrationen des gemeinsamen Datenkerns. Die vom Nutzer gewünschte Unterscheidung der Rasterspannen ergänzt in Schema 15 `entries.time_grid` (im Datenaustausch `timeGrid`), voreingestellt auf `false`. Das Merkmal bleibt bei Wiederholungen, geplanten Kopien, Historie und Sync erhalten; ältere Snapshots erhalten den Standardwert. Ist die Datenbank neuer als der eingebundene Kern, schreibt J-TerminaL nicht, sondern meldet „Bitte J-TerminaL aktualisieren“. Beide Programme benötigen den Kern mit Schema 15.

**Stand des Grundgerüsts (Stufe 1)**
- `src/main.rs`: Argumente (`--background` beim Autostart, `--data <Ordner>` für einen Test-Datenordner statt `%LOCALAPPDATA%\de.journal.local`), Fenster, Kürzel. Das Fenster wird beim Start versteckt erzeugt.
- `src/instance.rs`: eine Instanz über den lokalen Socket `j-terminal.sock` (Named Pipe). Die Nachricht `show` holt das Fenster nach vorne. Darüber meldet sich in Stufe 7 auch die Haupt-App.
- `src/journal.rs`: Vault über `vault.json` finden und die Datenbank über `journal-core` öffnen. Die Version wird vorher schreibgeschützt gelesen.
- `src/placement.rs`: Lage oben mittig auf dem Bildschirm mit der Maus, in physischen Pixeln über winit.
- `src/autostart.rs`, `src/texts.rs` (Texttabelle de/en, Sprache aus der App-Einstellung `ui-language`).
- Slint nur mit Software-Renderer und winit: am wenigsten RAM. Gemessen: 2,5 MB privater Arbeitssatz im Leerlauf, ca. 5 MB nach dem Öffnen.
- Schriften seit der Design-Anpassung als kleine TTF-Dateien eingebettet: IBM Plex Sans und Lilex wie in der Haupt-App (siehe Abschnitt 4).

**Stand der Eingabezeile (Stufe 2)**
- `src/app.rs` verarbeitet Text, Cursor und Tasten ohne Oberfläche. Die `View` enthält Vorschläge, erkannte Werte, Felder und die Tagesvorschau; `Effect` beschreibt Textauswahl, Speichern und Schließen.
- `src/main.rs` verbindet dieses Modell mit Slint. Cursorpositionen und Auswahl werden zwischen UTF-8-Bytes (Slint) und Zeichen (Engine) umgerechnet. Cursor-Rückmeldungen werden verzögert verarbeitet, damit programmgesteuerte Auswahl nicht erneut in denselben Zustand eingreift.
- `ui/bar.slint` zeigt Vorschläge unter der Zeile und die Vorschau rechts. Das Fenster wächst von 640 auf 1000 logische Pixel und bleibt auf dem Bildschirm zentriert. Felder werden unterstrichen, erkannte Werte getönt; Hinweise erscheinen beim Halten von Strg.
- Die Suche startet 180 ms nach der letzten Änderung und ergänzt bis zu fünf Treffer unter den Vorschlägen. Pfeiltasten wählen Treffer zur Tagesvorschau aus. Befehle: `> Tag`/`> Day`, Rückgängig/Undo, Wiederherstellen/Redo und Beenden/Quit.
- `src/save.rs` speichert über den gemeinsamen Kern einschließlich Serien und Historie; `src/snapshot.rs` hält heute bis +30 Tage und Tags bereit und prüft beim Öffnen externe Änderungen.
- Enter übernimmt Vorschläge; Shift+Enter erstellt den Eintrag, zeigt „Gespeichert“ und hält das Fenster offen. Im leeren Fenster stehen Rückgängig, die nächsten drei Termine und bis zu fünf offene Aufgaben. Aktivitäten und Bewertung kommen in Stufe 5.
- Prüfung: 76 Tests einschließlich eines Slint-Tastaturtests ohne natives Fenster. Natives Fokusverhalten, Zusammenspiel mit der Haupt-App und erneute Leistungswerte sind noch manuell zu prüfen.

**Stand der eingebetteten Bedienelemente (Stufe 3)**
- `src/picker.rs` hält Kalender-, Uhr- und Dauerentwürfe getrennt von der Eingabe und vom Speicher. Die zweite Vorschlagszeile öffnet Kalender/Uhr; nach einer Startzeit wird zusätzlich die Dauer-Skala angeboten. Die Vorschlagsliste weicht dem Element, die Tagesvorschau bleibt rechts.
- Der Mini-Kalender zeigt sechs Wochen ab Montag. Pfeile wählen Tage, Shift+Pfeile erweitern den Bereich, PgUp/PgDn wechseln Monate mit korrekter Begrenzung am Monatsende, H wählt heute. Leertaste schaltet zwischen Band (`▬`) und Punkten (`┆`) um. Aufgaben beginnen mit Wiederholung, andere Einträge mit durchgehendem Bereich. Explizite Kalenderdaten enthalten das Jahr, damit auch vergangene Tage eindeutig bleiben.
- Die digitale Uhr markiert Stunde oder Minute. Links/Rechts und Tab wechseln den Teil, Hoch/Runter ändern ihn. Ziffern verhalten sich wie `planning.ts::typeDigit`, einschließlich einer zweiten Stundenziffer, die bei Überschreiten von 23 zur Minute wird.
- Die Dauer-Skala arbeitet ab einer vorhandenen Startzeit. Pfeile ändern um fünf Minuten, PgUp/PgDn um eine Stunde; Ziffern geben Minuten direkt ein (1 bis 1440). Enter ersetzt die vorhandene Endzeit oder ergänzt sie mit `bis`/`to`; der bestehende Parser speichert Zeiträume über Mitternacht korrekt. Skalen für Bewertungen und Aktivitäten folgen weiterhin in Stufe 5.
- Enter übernimmt nur in die Zeile, auch in Tab-Felder und von/bis-Vorlagen. Shift+Enter erstellt den Eintrag und hält das Fenster offen. Esc verwirft den Entwurf des Elements und erhält den ursprünglichen Text; erst das nächste Esc versteckt das Fenster.
- Die Uhr und der Kalender öffnen sich ohne zusätzliche Fenster oder Buttons. Alle Farben und Maße liegen in `theme.slint`; Wochentage, Monate und Hinweise folgen der App-Sprache. Hinweise bleiben auf das Halten von Strg beschränkt.
- Prüfung: 85 Tests, einschließlich Tastaturereignissen an allen drei Slint-Elementen, Bereichswechseln, Abbrechen, Schaltjahr/Monatsende, Vorlagen und Speicherung über Mitternacht. Native Darstellung und Fokus sind noch manuell zu prüfen.

**Überarbeitung nach dem Praxistest (18.11.2026)**
- Die frühere Einzelspanne im Kalender wird durch eine Tagesmenge ersetzt. Ein einzelnes Datum folgt zunächst dem Cursor; nach einer Bereichs- oder expliziten Tagesauswahl bleiben die gewählten Tage beim Navigieren bestehen. Neue Shift-Bereiche werden hinzugefügt, Einfg schaltet Tage um, Entf schneidet den aktuellen Tag/Shift-Bereich aus. Benachbarte Tage werden zu Bereichen zusammengefasst. `Draft.spans` und `Outcome.additional` erhalten getrennte Bereiche bis zur Speicherung; jeder kontinuierliche Teil ist ein eigener mehrtägiger Eintrag mit gemeinsamer Rückgängig-Aktion in J-TerminaL.
- `engine/blocks.rs` gruppiert Metadaten einschließlich ihrer verbindenden Wörter. Die Blöcke liegen direkt in der Schreibzeile. Hoch/Runter wählt beim normalen Schreiben immer Vorschläge. Strg+Enter öffnet die bewusste Bearbeitung von Typ/Datum/Zeit, Alt+Links/Rechts wählt einen Block, Strg+Entf entfernt ihn vollständig. Texte in Anführungszeichen bleiben Titel. Bekannte unvollständige Angaben werden als solche behandelt, statt still im Namen zu landen.
- Vorschläge sind nicht mehr auf sechs begrenzt; die Liste scrollt innerhalb einer begrenzten Höhe. Startvorlagen und explizite Typwechsel machen Aufgabe, Termin/Kalendereintrag und Notiz auffindbar. `from`/`von` bietet sowohl Datum als auch Zeit. Vorlagen und angehängte Fragmente erhalten notwendige Leerzeichen.
- Wiederholungs-Enddaten sind ein eigener Kontext: Der Kalender ersetzt den vorhandenen oder unvollständigen Wert nach `until`/`bis`. Er fügt dafür keine neue Datumsklausel hinzu. Datumswerte werden einschließlich Jahr geschrieben.
- `repeat_editor.rs` bildet die nativen Funktionen des RepeatPanel aus der Journal-App ab: Einheit, Abstand, Wochentage/Monatsposition, Monate, Pause und Endbedingungen samt nächster Termine. Der Enddatum-Kalender ist ein verschachtelter Entwurf; Esc verwirft nur diese Änderung. Der Textparser bleibt für freie de/en-Eingaben verfügbar. Ein Problem bei Monatseinschränkungen vor Pause/Anzahl wurde in der Rust-Portierung korrigiert.
- 96 Tests prüfen unter anderem die vollständige Nutzereingabe mit drei Wochentagen und Ende am 04.12.2026 bis zu den gespeicherten Terminen, ausgeschnittene Mehrtagesbereiche, Undo, geschützte Titel und den Slint-Tastaturweg durch Block- und Wiederholungsbearbeitung. Bedienungsbeispiele stehen in `docs/input.md`. Native Darstellung, Fokus und das Zusammenspiel mit der Haupt-App sind weiterhin manuell zu prüfen.

**Inline-Feldbearbeitung und Tastenfolge (18.11.2026)**
- `src/spin.rs` beschreibt Typ-, Datums- und Zeitkomponenten ohne Oberfläche. `app.rs` hält dazu einen abbrechbaren Entwurf einschließlich des ursprünglichen Texts, Cursors und der Tab-Felder. Änderungen erscheinen sofort in der Schreibzeile; Esc stellt den ursprünglichen Stand wieder her.
- Typen wechseln per Hoch/Runter. Bei Daten führt Tab durch Tag, Monat und Jahr, bei Bereichen anschließend durch die Teile des Enddatums; Uhrzeiten verwenden Stunde und Minute. Tagesänderungen rechnen über Monats-/Jahresgrenzen hinweg, Monats-/Jahresänderungen begrenzen den Tag einschließlich Schaltjahr. An einer Feldgrenze führt Tab zum nächsten vorhandenen Block weiter.
- `bar.slint` zeichnet die Blockflächen hinter dem tatsächlichen Text, gemessen in derselben Schrift und mit derselben horizontalen Verschiebung wie die Eingabe. Die zusätzliche Blockzeile ist entfernt. Die vertikale Wertauswahl steht unter der aktuellen Komponente. Alle Maße und Farben kommen weiterhin aus dem Theme.
- Alt+Pfeile übernimmt die Blocknavigation. Strg+Pfeile wird an den nativen Texteditor durchgereicht. Vor der Verarbeitung einer Aktion synchronisiert `main.rs` die Cursorposition, damit auch eine unmittelbar vorausgegangene native Wortbewegung berücksichtigt wird.
- Enter übernimmt Vorschläge oder bestätigt den aktuellen Editor. Shift+Enter erstellt den Eintrag und lässt das Popup offen, auch aus einem Kalender oder Feldeditor heraus.
- Für die zweite Datumslücke einer von/bis-Vorlage hält der Kalender den bestehenden Start fest und wählt das Bereichsende. Der Wiederholungs-Enddatum-Kalender bleibt eine einzelne Datumswahl.
- 104 Tests einschließlich des vollständigen Slint-Tastaturwegs prüfen diese Regeln. Native Darstellung und Fokus sind weiterhin manuell zu prüfen. Bedienung: `docs/input.md`.

**Geführte Eingabe und Live-Vorschau (18.11.2026)**
- Die ersten drei Vorschläge beschreiben den gewünschten Ablauf: heute ohne Zeit, mit Datum und Uhrzeit, wiederkehrend. Sie erzeugen vollständige Vorlagengerüste mit Typ- und Titelfeld sowie den jeweiligen Metadatenfeldern. Ein bereits geschriebener Titel bleibt erhalten. Pflichtfelder verhindern unvollständige Speicherung; ein Serienende ist ausdrücklich optional und wird im gemeinsamen Wiederholungseditor eingestellt.
- `engine/fields.rs` hält getrennt fest, welche Textteile zur Vorlage gehören und welche Anfangswerte unverändert geblieben sind. `bar.slint` stellt diese blass dar; native Auswahl und Cursor bleiben sichtbar. Tab erreicht die Lücken, Pflicht-Datum/-Uhrzeit öffnen direkt die vorhandenen Bedienelemente.
- `repeat_editor.rs` und `ui/repeat-panel.slint` sind die einzige Wiederholungsoberfläche für Vorlagen, Vorschläge und vorhandene Blöcke. Sie folgen dem `RepeatPanel.tsx` der Journal-App: Rhythmus, Abstand, Wochentage/gültige Monatsmuster, Monate, Pause, Ende. Der Beginn ist zusätzlich visuell wählbar. Zusammenfassung und Wortvorschläge sind Teil desselben Editors; Fehler sperren die Bestätigung. Die frühere separate Kurzauswahl entfällt.
- `draft_preview.rs` berechnet eine Eintragskarte und eine auf einen angefragten Zeitraum begrenzte Tagesmenge. Die Vorschau verwendet temporär angewandte Picker-Werte und ignoriert leere optionale Felder. Das ist ausschließlich eine Projektion; Datenbank und Historie werden dabei nicht verändert.
- Die Karte zeigt Titel, Typ, Zieldatum/-zeit, Wiederholungsregel, nächste fünf Termine und offene Pflichtfelder, auch ohne Vault. Die Tagesvorschau darunter bleibt als Kontext erhalten. Der Mini-Kalender zeigt Entwurfstage; für die kommende Kalenderübersicht liegt damit dieselbe Projektion bereit, ohne deren Oberfläche vorwegzunehmen.
- Serienenden vor dem ersten möglichen Termin werden als Regel ohne Termine behandelt. Sie werden nicht mehr still auf einen späteren Tag verlängert.
- 110 Tests prüfen die neuen Abläufe einschließlich echter Slint-Tastaturereignisse und Vorschau ohne Schreibzugriffe. Bedienung: `docs/input.md`; native visuelle Prüfung bleibt offen.

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
5. **Tagesansicht, Bewertung und Aktivitäten; eigenständiger Notizblock:** linker Bereich für heute oder den gewählten Tag mit runden Bewertungs-Dials und start/stop/nachtragen; Notizblock mit Tagestitel/Journaltext als separat aufrufbarer Bereich. Begleitend Hover-Vorschauen, vollständige Mausbedienung sowie Suche und Quick-Actions in der oberen Leiste (Abschnitt 0c und Roadmap).
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

### Vorschläge und Wiederholung vereinheitlicht (18.11.2026)
- `engine/suggest.rs`: ein geordneter Ablauf für das aktive Feld, Befehle, Tags, Wiederholungswörter/-ende, Datum/Zeit, `from`-Mehrdeutigkeit und Titelvorlagen. Keine überlagerten Vorschlagsgeneratoren. `Mo` bietet die Wiederholung direkt als zweite Alternative; Navigation verändert keine Eingabe.
- Alle Wiederholungseinstiege verwenden denselben Picker und dieselbe Slint-Komponente. Keine Buttons, klickbare Werte und Tastatursteuerung mit bedingten Strg-Hinweisen. Vorlagen haben ein vollständiges Wiederholungsfeld, ohne zusätzliche Enddatum-Lücke.
- Serialisierung erhält den absoluten Serienbeginn, inklusive Jahreszahl. Textparser versteht dafür `ab` / `starting`. Beim Ändern von Wochentagen wird der Beginn auf den ersten gewählten Tag angepasst; abgewählte Tage erzeugen keinen erzwungenen Auftakttermin. Editor, Vorschau und gespeicherte Termine werden gemeinsam getestet.
- UI-Tests verwenden zusätzlich den Software-Renderer. `J_TERMINAL_UI_CAPTURE=1 cargo test keyboard_edits_tab_selection_and_saving_reach_the_real_ui` legt gerenderte PPM-Aufnahmen unter `j-terminal/target/ui-check` ab. Es werden ausschließlich temporäre Test-Datenbanken verwendet.
