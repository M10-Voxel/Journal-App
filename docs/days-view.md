# Kalenderansicht „Tage“

„Tage“ (englisch „Days“) ersetzt die frühere Tagesansicht des Kalenders: in der Seitenleiste, im Kalenderfenster, im Kalender-Widget und im Kalender-Panel des Desk-Aufbaus (Umschalter Monat / Tage). Ein im Wochenstreifen des Desks gewählter Tag wird der erste offene Tag.

## Aufbau

- **Ein langes Band aus Tagen**, das seitwärts scrollt. Die Stundenspalte und die Ecken bleiben links stehen, die Tage laufen darunter durch.
- **Offene Tage (1–5)** haben Stunden, Zeitkörper mit Titel und den Wochentag im Kopf. Voreingestellt sind drei Tage: heute und die zwei folgenden. Sie stehen immer in der **Mitte** des sichtbaren Bereichs. Werden sie verschoben, gleitet das Band mit (kein Springen an Wochengrenzen).
- **Desk-Panel:** Dort entfällt die Spalte mit KW-Nummer und „ohne Zeit“ (`nebula-theme.css`, Null-Breite statt ausgeblendet, damit die Tage ihre Gitterplätze behalten). Die Tage bekommen die ganze Breite. Die Uhrzeiten sind keine Spalte, sondern blasse Beschriftungen über dem linken Rand der Tage (8,5 px, halbtransparent, für den Mauszeiger durchlässig); die aktuelle Uhrzeit bleibt als kleine Marke sichtbar.
- **Breiten:** Gefaltete Tage sind 8 px breit. Die offenen Tage teilen sich den Platz, den die gefalteten Tage der sichtbaren Wochen übrig lassen: mindestens 72 px, in einem schmalen Panel (z. B. dem Desk-Kalender) bis hinunter auf 44 px, damit mindestens zwei Wochen zu sehen sind. Höchstens sechs Wochen sind sichtbar. In der Seitenleiste sind es etwa vier.
- **Gefaltete Tage** sind bewusst zurückhaltend: kein Raster, keine Trennlinien, das Datum klein, senkrecht und blass. Termine erscheinen als dünne Striche (3 px) zur richtigen Uhrzeit, halbtransparent in der Farbe ihres Tags. Ganztägige Einträge sind Punkte. Ein belegter Tag sieht so nie leer aus. Journalinhalt zeigt eine feine Linie unter dem Datum, heute einen Punkt.
- **Wochenanfänge** haben eine feine Linie und die KW-Nummer oben im Kopf.
- **Mehrtägige Einträge** laufen als ein durchgehender Balken über offene und gefaltete Tage. Sie teilen sich eine Zeile, solange sie sich nicht überschneiden; ein Eintrag, der beginnt, während ein anderer noch läuft, sitzt eine Zeile darunter. Die Zeilen sind schlank (17 px), der Bereich „ohne Zeit“ ist im Band kompakt.
- Wechseln die offenen Tage, gleiten die Spaltenbreiten in 200 ms auf ihre neue Breite. Bei reduzierter Bewegung entfällt das.

## Bedienung

| Eingabe | Wirkung |
|---|---|
| Mausrad | Uhrzeit scrollen |
| Strg + Mausrad | Stundenabstand zoomen (wie bisher) |
| Umschalt + Mausrad / Wischen zur Seite | Zeitachse scrollen (eine Raste = 3 Tage): Tage kommen auf einer Seite herein und gehen auf der anderen hinaus, auch die offenen. Was offen ist, ändert sich nicht. |
| Alt + Mausrad | offene Tage um einen Tag verschieben |
| Strg + Alt + Mausrad | offene Tage um ihre Anzahl verschieben (Mo–Mi → Do–Sa) |
| ← / → und Pfeilknöpfe | offene Tage um eine Woche verschieben |
| Klick auf gefalteten Tag (Kopf oder Spalte) | nur dieser Tag ist offen (und rückt in die Mitte) |
| Klick auf offenen Tag (Kopf) | Tag im Journal öffnen |
| Ziehen über die Tagesköpfe | genau diese Tage öffnen (höchstens fünf); ihre Anzahl wird zum neuen Fenster |
| Umschalt + Klick auf einen Kopf | offene Tage bis zu diesem Tag erweitern (höchstens fünf) |
| Maustaste „Zurück“ / „Vor“ | zu den vorher offenen Tagen (Ansichtsverlauf) |
| „Heute“ / H | wieder heute und die zwei folgenden Tage |

Anlegen (Rechtsklick ziehen), Verschieben und Auswahlrahmen funktionieren wie im übrigen Zeitraster, auch in gefalteten Spalten. Die Anzahl offener Tage wird je Kalender in `openDays` gespeichert (`calendarPreferences.ts`).

Das Band selbst wird nicht gespeichert. Es enthält die offenen Tage und 42 Tage auf jeder Seite. Wird es nahe an ein Ende gescrollt, wächst es um vier Wochen; links bleibt die Ansicht dabei stehen. Es wird nie verkleinert, solange die Ansicht offen bleibt.

## Umsetzung

- Rechnen ohne UI: `src/dayWindow.ts` (Bereich, Band, Breiten, Mitte). Tests: `tests/dayWindow.test.mjs`.
- `Calendar` in `src/components/CalendarWindow.tsx` hält die offenen Tage, das Band und die Alt-Mausrad-Kürzel. `TimeGrid` zeichnet das Band, wenn `band` übergeben wird: Spaltenbreiten in px (`bandColumns`), Scrollen zur Mitte (`centeredScroll`), Umschalt + Mausrad, Wachsen an den Enden. Klassen: `.cal-time.is-band`, `.is-open`, `.is-folded`, `.is-week-start`. Die aktuelle Uhrzeit steht im Band in der Stundenspalte (`.cal-now-label`).
- Styles: Abschnitt „Tage“ am Ende von `src/calendar.css`. Er gilt für alle Optiken, weil er Variablen der jeweiligen Optik nutzt.
- UI-Prüfung: `JOURNAL_UI_SCOPE=days-view node scripts/verify-ui.mjs`, Screenshots `days-classic.png`, `days-journal.png`, `days-classic-pixel.png`, `days-scrolled.png`, `days-one-open.png`, `days-five-open.png`.
