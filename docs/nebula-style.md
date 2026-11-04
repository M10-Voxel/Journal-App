# UI-Stil „Nebula“

Drittes Design neben „Normal“ und „Journal“ (`Theme = 'nebula'`, `data-theme="nebula"`): Y2K, Cybercore, Web-Brutalismus und Editorial. Ein schwarzer „Desktop“ mit Glitch-Pixeln, schrägen Orbit-Linien und Wellen; hellgraue Papier-Panels mit violetten Balken, Terminal-Fenster mit Prompt-Kopfzeilen, holografische Tickets, ein Editorial-Poster mit riesiger Serife. Bedienung, Tastenkürzel und Speichern bleiben unverändert. Alle Texte sind echte Inhalte oder Funktionen.

## Farben, Schrift, Pixel-Look

- **Feste Palette** in `src/nebula-theme.css` unter `:root[data-theme='nebula']`, mit `!important`. Sie schlägt die Inline-Farben von `applyColors` (`colors.ts`), ohne die gespeicherte Farbwahl zu ändern; in Normal und Journal gilt diese wieder. Der Farben-Tab zeigt in Nebula nur einen Hinweis (`ColorSettings.tsx`). Rail, Poster und Einstellungen sind „Papier“ (`.nebula-paper`, `.shortcuts` setzen helle Tokens), Popups bleiben schwarz.
- **Schriften** (lokal über `@fontsource`): Space Mono (`--mono`, `--write`: Terminals, Einträge), Space Grotesk (`--sans`: Beschriftungen), Instrument Serif (`--display`: Ziffern, Titel, Laufband).
- **Kein Pixel-Look**: `pixelActive()` in `settings.ts` ist in Nebula immer falsch (`applyTheme` setzt kein `data-pixel`, die automatische Größe rechnet ohne Pixel-Zuschlag). Der Schalter ist ausgegraut; die gespeicherte Wahl bleibt für die anderen Designs.

## Layout (`NebulaDesk.tsx`)

Die App rendert die Bausteine (Einträge `entriesPage()`, `PeriodNotes`, `BulletinBoard`, Kalender) wie beim Buch selbst und gibt sie als Props hinein; `NebulaDesk` ordnet sie nur an.

- **Fensterleiste** (`.nebula-window-bar`): Prompt `journal@desk:~`, Einstellungen, Fensterknöpfe; sie verschiebt das Fenster (Doppelklick maximiert).
- **Rail** links: `+ ×`, Status (Einträge, offene Aufgaben, Bewertung), Tag zurück/vor und `[ HEUTE ]`, das Datum (öffnet den Mini-Kalender, `Strg+G`), die Ansichten Tag bis Jahr als Reiter mit Haken-Klammern (`Strg+1–5`), der Tag-Filter (nur Tag), unten der violette Block `./kalender` (`Strg+K`).
- **Terminals** in der Mitte: Tag = `./entries.sh`, `./data.sh`, `./board.sh`; Woche bis Jahr = `./notes.sh`, `./activities.sh`. Dazwischen ein Laufband (Tag bzw. Zeitraum und Titel). Darunter **Tickets** für die nächsten bis zu drei offenen Einträge mit einem der festen Tags *Lieferung*, *Bezahlung* oder *Termine* (die Mail-Tags aus `mailTags.ts`, per ID oder Name; jede Eintragsart, mit oder ohne Uhrzeit; 60 Tage); ein Klick öffnet den Tag.
- **Rechte Spalte**: das kompakte Poster (violette Balken, Ziffer für Tag, Kalenderwoche, Monat, Quartal oder Jahr, Wochentag/Monat, Tagestitel in `[ … ]`, Kennzahlen, kleine Orbit-Glyphe) und darunter `./cal.sh`, ein Kalender mit zwei Ansichten (gemerkt in `journal.nebulaCalendar`): **Monat** (Tage anklicken öffnet sie) und **Tag**, die echte Tagesansicht des Kalenders (`Calendar` mit `fixedView="day"`: 24 Stunden, Zoom mit Strg+Mausrad, Einträge per Ziehen anlegen, Rechtsklick bearbeiten, mehrtägige Termine wie im Kalender; die gespeicherte Ansicht des Hauptkalenders bleibt unberührt). In der Woche wählt eine Leiste mit ihren sieben Tagen den Tag (`showDate`), ohne die Übersicht zu verlassen. Ab 1121 px Breite scrollt das Poster mit weg; der Kalender darunter bleibt oben stehen (`position: sticky`) und wächst um den Platz, den das Poster freigibt (`--nb-poster-shown`, gemessen in `NebulaDesk`), immer bis 18 px über dem Fensterrand.
- **Pinnwand**: Raster auf Schwarz, eckige Karten ohne Neigung mit schwarzem Streifen und violettem Quadrat als Nadel; Zettel auf Grau, Lila, Mint und Pfirsich, Bilder im schwarzen Rahmen, Links als graue Karteikarten.
- **Kalender**: eigenes Fenster `./calendar.sh` über Terminals und Poster, Zustand über `useCalendarDrawer` (wie das Kalenderblatt im Journal, `journal.calendarDrawer`). `Strg+K`, `Esc` im Fenster oder `×` schließen es; ein geöffneter Tag schließt es ebenfalls.
- **Breiten**: unter 1120 px liegt die rechte Spalte (Poster und Kalender nebeneinander) unter den Terminals, unter 900 px wird die Rail zur Leiste oben und alles ist eine Spalte.
- **Deko** (`NebulaBackdrop`): nur CSS/SVG, `aria-hidden`, `pointer-events: none`. Orbits drehen langsam, das Laufband zieht langsam vorbei (150 s); die Glitch-Kästen stehen still. Bei `prefers-reduced-motion` steht alles still.

Kalender-, Mini- und Erinnerungsfenster übernehmen Palette und Schriften über `data-theme` (`ThemeSync`).

## Prüfung

`JOURNAL_UI_SCOPE=nebula node scripts/verify-ui.mjs` (nach `npm run build`). Screenshots `nebula-*.png` in `src-tauri/target/ui-validation`.
