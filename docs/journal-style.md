# UI-Stil „Journal“

Dritter UI-Stil neben „Klassisch“ und „Pixel“ (`Theme = 'journal'`, `data-theme="journal"`). Die App wird zum aufgeschlagenen Buch: Papierseiten, Tinte, Lesezeichen. Bedienung, Tastenkürzel und Speichern bleiben unverändert.

Eigene Paletten: `paper` („Papier & Tinte“, hell) und `candle` („Leder & Kerzenlicht“, dunkel). Beim Wechsel auf „Journal“ wird `paper` gesetzt, sofern nicht schon eine der beiden aktiv ist; die vorher gewählte Palette wird als `previousColorTheme` gemerkt und beim Zurückwechseln wiederhergestellt, sofern dann noch eine Journal-Palette aktiv ist (`withTheme` in `settings.ts`). Buchkanten und Seiten mischen ihre Farben aus der Palette, damit jede Palette passt. Die Palette bleibt danach frei wählbar. Helle Paletten setzen `color-scheme: light`. Schriften (lokal über `@fontsource`): Source Serif 4 für Text und Editor (`--write`), Fraunces für Überschriften und Datum, IBM Plex Sans für Bedienelemente. Kein Pixel-Zuschlag bei der automatischen Größe.

## Buch

Seitenmodell in `src/book.ts` (getestet in `tests/book.test.mjs`): Ein Tag hat die Seiten `entries`, `data` (Bewertung, Checkliste) und `board` (Pinnwand), eine Übersicht (Woche bis Jahr) `notes` und `activities`. Das Buch ist durchgehend: Nach der Pinnwand von Tag N folgt die Einträge-Seite von Tag N+1. Eine Doppelseite zeigt eine Seite und die nächste; Umblättern geht um eine Seite weiter, die rechte Seite wandert nach links. Eine Doppelseite enthält nie zwei Einträge-Seiten, deshalb ist das `date` der App immer der Tag der sichtbaren Einträge-Seite, sonst der linken Seite. Laden und Autosave laufen unverändert über `navigate`.

`JournalBook.tsx` hält die Seiten als Elemente mit stabilem Schlüssel (`page:date`). Die Seite, die beim Umblättern die Seite wechselt, bleibt dadurch gemountet (Fokus, Scrollposition, Editoren). Animation: 3D-Drehung um den Rücken (320 ms), bei `prefers-reduced-motion` nur Überblenden. Sprünge (Alt+←/→, Kalender, Heute) blenden kurz über. Das Buch füllt die ganze App; die Seiten wachsen mit dem Fenster. Unter 880 px Breite zeigt das Buch automatisch eine Seite; die Wahl Doppel/Einzel steht in den Einstellungen (Darstellung → Buchansicht) und liegt in `localStorage` (`journal.bookView`).

Einstellung „Blättern“ (`bookPaging`): Seite für Seite oder beide Seiten auf einmal (`spreadPagesOf`/`turnSpread` in `book.ts`): Ein Tag ist dann die Doppelseite Einträge | Daten und danach die Pinnwand über beide Seiten. Wo eine Seite beim Umblättern nicht zweimal gezeichnet werden kann (die breite Pinnwand), dreht sich ein leeres Blatt für ihre Hälfte. Liegt der Kalender dabei als Blatt auf dem Buch, zeigt das Buch eine Seite, die erst an seinem Rand beginnt.

Die Einträge-Seite ist nur dort liniert, wo geschrieben wird: unter dem Titel und unter jeder Textzeile eines Eintrags (auch umbrochenen), mit Randlinie ab dem Titel.

Umblättern: Eselsohr unten außen, Wischen bzw. Shift+Mausrad, `Strg+Bild↓` / `Strg+Bild↑`. Das Register am rechten Rand zeigt immer alle Seitenarten des Tages (bzw. Zeitraums), jede auf fester Höhe und in fester Breite; der Reiter der äußeren Seite gehört zum Papier der Seite, ebenso ist der Reiter der zweiten sichtbaren Seite desselben Tages papierfarben. Liegt die Pinnwand über beide Seiten, blenden Falzschatten und Leseband unterhalb der Oberkante aus. Ein Klick blättert mit derselben Animation wie das Eselsohr zur Seite, auch über mehrere Seiten. Das Leseband ist flach: Am heutigen Tag liegt es über den Seiten und ist oben über die Buchkante umgeschlagen, sonst ragt nur sein Ende unten heraus und schlägt heute auf.

## Ansichten und Farben

Im Journal-Stil gibt es keine Titelleiste: Der Einband um das Buch verschiebt das Fenster (Doppelklick maximiert), Einstellungen und Fensterknöpfe sitzen oben rechts auf dem Einband neben den Registerreitern. Tag und Datum werden auf der Seite geblättert. Der F1-Hinweis entfällt (F1 öffnet die Tastenkürzel weiterhin). Tag, Woche, Monat, Quartal und Jahr sind Registerreiter an der Oberkante des Buchs (`Strg+1–5`, in allen Stilen). Die Kalenderansichten sind Reiter am rechten Rand des Kalenderblatts. Der Einband bzw. Hintergrund um das Buch ist das Farb-Token `cover` jeder Palette (Farben → Buch) und damit anpassbar. Ebenso der Schatten im Buchfalz (Token `spine`). Liegt der Kalender beim Blättern beider Seiten auf dem Buch, läuft der Falz samt Schatten und Leseband an der Kante des Blatts; das Buch legt seine Doppelseite erst wieder an, wenn das Blatt weggeglitten ist. Die Scrollleiste einer Seite beginnt unter den Registerreitern.

## Kalender

Im Journal-Stil gibt es keine Seitenleiste. Der Reiter „Kalender“ am linken Buchrand (oder `Strg+K`) zieht den Kalender als Blatt auf das Buch (`CalendarDrawer.tsx`): Bei einer Doppelseite liegt es über der linken Seite, das Buch bleibt stehen; bei einer Einzelseite hat es eine ziehbare Breite. Ein Klick auf einen Tag legt es zurück. Blättern beide Seiten auf einmal, zeigt das Buch daneben eine Seite. Zurücklegen per Reiter, `Esc` oder `Strg+K`; das Blatt gleitet dabei als eigene Animation zurück (eine Transition startet nach der Öffnungs-Animation nicht). Der Zustand liegt in `localStorage` (`journal.calendarDrawer`).

## Prüfung

`JOURNAL_UI_SCOPE=journal node scripts/verify-ui.mjs` (nach `npx vite build`).
