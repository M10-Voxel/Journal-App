# UI-Stil „Journal“

Dritter UI-Stil neben „Klassisch“ und „Pixel“ (`Theme = 'journal'`, `data-theme="journal"`). Die App wird zum aufgeschlagenen Buch: Papierseiten, Tinte, Lesezeichen. Bedienung, Tastenkürzel und Speichern bleiben unverändert.

Eigene Paletten: `paper` („Papier & Tinte“, hell) und `candle` („Leder & Kerzenlicht“, dunkel). Beim Wechsel auf „Journal“ wird `paper` gesetzt, sofern nicht schon eine der beiden aktiv ist; die vorher gewählte Palette wird als `previousColorTheme` gemerkt und beim Zurückwechseln wiederhergestellt, sofern dann noch eine Journal-Palette aktiv ist (`withTheme` in `settings.ts`). Buchkanten und Seiten mischen ihre Farben aus der Palette, damit jede Palette passt. Die Palette bleibt danach frei wählbar. Helle Paletten setzen `color-scheme: light`. Schriften (lokal über `@fontsource`): Source Serif 4 für Text und Editor (`--write`), Fraunces für Überschriften und Datum, IBM Plex Sans für Bedienelemente. Kein Pixel-Zuschlag bei der automatischen Größe.

## Buch

Seitenmodell in `src/book.ts` (getestet in `tests/book.test.mjs`): Ein Tag hat die Seiten `entries`, `data` (Bewertung, Checkliste) und `board` (Pinnwand), eine Übersicht (Woche bis Jahr) `notes` und `activities`. Das Buch ist durchgehend: Nach der Pinnwand von Tag N folgt die Einträge-Seite von Tag N+1. Eine Doppelseite zeigt eine Seite und die nächste; Umblättern geht um eine Seite weiter, die rechte Seite wandert nach links. Eine Doppelseite enthält nie zwei Einträge-Seiten, deshalb ist das `date` der App immer der Tag der sichtbaren Einträge-Seite, sonst der linken Seite. Laden und Autosave laufen unverändert über `navigate`.

`JournalBook.tsx` hält die Seiten als Elemente mit stabilem Schlüssel (`page:date`). Die Seite, die beim Umblättern die Seite wechselt, bleibt dadurch gemountet (Fokus, Scrollposition, Editoren). Animation: 3D-Drehung um den Rücken (460 ms), bei `prefers-reduced-motion` nur Überblenden. Sprünge (Lesezeichen, Alt+←/→, Kalender, Heute) blenden kurz über. Das Buch füllt die ganze App; die Seiten wachsen mit dem Fenster. Unter 880 px Breite zeigt das Buch automatisch eine Seite; die Wahl Doppel/Einzel liegt in `localStorage` (`journal.bookView`).

Einstellung „Blättern“ (`bookPaging`): Seite für Seite oder beide Seiten auf einmal (`spreadPagesOf`/`turnSpread` in `book.ts`): Ein Tag ist dann die Doppelseite Einträge | Daten und danach die Pinnwand über beide Seiten. Wo eine Seite beim Umblättern nicht zweimal gezeichnet werden kann (die breite Pinnwand), dreht sich ein leeres Blatt für ihre Hälfte. Liegt der Kalender dabei als Blatt auf dem Buch, zeigt das Buch eine Seite, die erst an seinem Rand beginnt.

Die Einträge-Seite ist nur dort liniert, wo geschrieben wird: unter dem Titel und unter jeder Textzeile eines Eintrags (auch umbrochenen), mit Randlinie ab dem Titel.

Umblättern: Eselsohr unten außen, Wischen bzw. Shift+Mausrad, `Strg+Bild↓` / `Strg+Bild↑`. Lesezeichen am rechten Rand springen zu den Seiten des gezeigten Tages.

## Ansichten und Farben

Im Journal-Stil gibt es nur eine Kopfzeile: Blättern, Datum und Buchansicht sitzen in der Titelleiste. Tag, Woche, Monat, Quartal und Jahr sind Registerreiter an der Oberkante des Buchs (`Strg+1–5`, in allen Stilen). Die Kalenderansichten sind Reiter am rechten Rand des Kalenderblatts. Der Einband bzw. Hintergrund um das Buch ist das Farb-Token `cover` jeder Palette (Farben → Buch) und damit anpassbar.

## Kalender

Im Journal-Stil gibt es keine Seitenleiste. Ein Band oben in der Mitte (oder `Strg+K`) lässt den Kalender als Blatt herunterklappen (`CalendarDrawer.tsx`). Einstellung „Kalender im Buch“ (`calendarDock`): standardmäßig legt sich das Blatt über die linke Seite, das Buch bleibt stehen (bei einer Einzelseite mit ziehbarer Breite); ein Klick auf einen Tag klappt es dann zu. Alternativ dockt es links neben dem Buch an, das zur Seite rückt (Breite über `useSidebarWidth` ziehbar). Zuklappen per Band, `Esc` oder `Strg+K`; der Zustand liegt in `localStorage` (`journal.calendarDrawer`).

## Prüfung

`JOURNAL_UI_SCOPE=journal node scripts/verify-ui.mjs` (nach `npx vite build`).
