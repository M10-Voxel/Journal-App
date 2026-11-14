# UI-Stil Journal

Journal ist eine der drei Vorlagen (Aufbau Buch + Optik Journal, siehe [Design-Achsen](design-axes.md)). Die Darstellung als Buch verändert Anordnung und Optik; Speichern, Inhalte, Tastenkürzel und Verbindungen verwenden dieselben Funktionen. Pixel kann zusätzlich eingeschaltet werden und ist kein eigenes Basisdesign.

## Optik: Sticker auf Lavendelpapier

Die Journal-Optik (`data-look='journal'`) sieht in jedem Aufbau gleich aus: Lavendelpapier mit leichter Körnung, ausgeschnittene Sticker mit weißem Rand und dunkler Tintenlinie, runde Handschrift, Violett mit Rosa- und Mint-Akzenten. Knöpfe sind kleine Sticker, Schalter Pillen mit Tintenrand, Tags Sticker-Etiketten, Häkchen handgezeichnete Kreise, Toasts und Erinnerungen Sticker-Etiketten. Die Pinnwand-Karten bleiben Zettel mit Sticker-Rand und Washi-Tape, der Kalender bleibt auf Kästchenpapier.

Die Bausteine stehen als Variablen in `src/journal-look.css`: `--ink` (Tinte für Text und Linien), `--ink-fixed` (immer dunkle Tinte, für Text auf kräftigen Sticker-Farben), `--sticker-line`, `--sticker-edge`, `--sticker`/`--sticker-sm`/`--sticker-flat` (Rand, Linie und Schatten als `box-shadow`-Kette), `--tint-base` (worauf die Sticker-Farben gemischt werden: das Papier; auf dunklem Papier ein helles Lila, damit die Sticker leuchten), `--paper-grain` (Körnung als `data:`-SVG), `--blots` (weiche Violett-Flecken mit gestuftem Rand), `--wobble` (unregelmäßige Ecken), `--pink`, `--mint`, `--violet`, `--hand`.

## Farben und Schrift

Die eigenen Paletten heißen **Lavendel** (`lavender`, hell) und **Lavendel Nacht** (`lavender-night`, dunkel); **Papier & Tinte** (`paper`) und **Leder & Kerzenlicht** (`candle`) bleiben wählbar und nehmen dieselben Formen an. Beim Wechsel zur Journal-Optik wird Lavendel gewählt, sofern noch keine Journal-Palette aktiv ist. Die vorherige Farbwahl wird beim Zurückwechseln wiederhergestellt, solange eine Journal-Palette aktiv blieb. Danach bleiben die Farben frei anpassbar, einschließlich Einband und Buchfalz.

Ohne Pixel verwendet die Journal-Optik **Gaegu** (Handschrift) für Überschriften, Knöpfe und Beschriftungen und **Nunito** (rund, gut lesbar) für Eintragstexte und Bedienelemente. Die Fonts werden lokal mitgeliefert (`@fontsource`). Pixel ersetzt die Schriften durch VT323/Pixelify und macht die Ecken eckig, die Sticker bleiben.

## Seiten und Navigation

Ein Tag besitzt Einträge-, Daten- und Pinnwand-Seiten. Monats- und Jahresübersichten besitzen Notizen, Aktivitäten und eine eigene Pinnwandseite; Woche und Quartal haben Notizen und Aktivitäten. Nach der letzten Seite folgt der nächste Tag beziehungsweise Zeitraum. Der Modus **Seite für Seite** blättert ein Blatt weiter; **beide Seiten** zeigt Einträge und Daten beziehungsweise Notizen und Aktivitäten zusammen und anschließend die breite Pinnwand, sofern die Ansicht eine besitzt. Die Pinnwand ist auch über ihr Seitenregister erreichbar. Doppel-/Einzelseite kann gewählt werden; bei weniger als 880 Pixel verfügbarer Bühnenbreite erscheint automatisch eine Seite.

Die obere Leiste enthält Navigation und Fensterfunktionen. Tag, Woche, Monat, Quartal und Jahr sind Buchregister (`Strg+1–5`), in der Journal-Optik Sticker-Laschen in Violett, Rosa und Mint; der Einband ist Leinen statt Leder, das Leseband rosa. Die Register für Einträge/Daten/Pinnwand behalten ihre Position. Das Leseband führt zu heute; die unteren äußeren Seitenecken sind dünne graue Winkel zum Blättern. Alternativen sind Wischen, Umschalt+Mausrad und `Strg+Bild↑`/`Strg+Bild↓`.

Bestehende Seiten erhalten beim Wechsel stabile Schlüssel, um Editoren, Fokus und Scrollzustand möglichst zu bewahren. Reduzierte Bewegung wird berücksichtigt. Die normale untere Statusleiste ist im Buchlayout ausgeblendet; die Tastenkürzel bleiben über `F1` erreichbar.

## Kalender, Notizen und Raster

Kalender und Notizblock öffnen über ihre Buchlaschen beziehungsweise Tastenkürzel. Das Kalenderblatt kann das Buch überlagern oder daneben liegen; die Breite ist abhängig von Buchansicht und verfügbarem Platz veränderbar. Der Kalenderreiter liegt an der Buchkante, der Notiz-Tagfilter als horizontale Lasche am Buch. Ein gewählter Journaltag schließt die offenen Ansichten wieder.

Die karierten Kalenderflächen richten sich nach dem jeweiligen Raster: In Stundenansichten folgen horizontale Linien der Stundenhöhe und dem Kalenderzoom; die vertikalen Linien passen sich der Spaltenbreite an. Monats- und Jahreszellen besitzen entsprechend angepasste Raster. Auf den Eintragsseiten wird der Schreibbereich liniiert.

## Andere Aufbauten

- **Normal:** Seitenleiste und Kopfzeile sind Papierstreifen mit Körnung, die Reiter Sticker-Etiketten, die Fläche Lavendelpapier mit weichen Violett-Flecken am Rand.
- **Desk:** keine Fenster, sondern Sticker und Papierkarten auf einem Papierbrett (`src/journal-desk.css`). `NebulaDesk.tsx` und `DetachedPanel.tsx` zeigen mit der Journal-Optik (`useLook`) statt Prompt ein Sticker-Etikett „Name klein-Zusatz“ (z. B. „Einträge Sa., 14.11.“), statt Glyphen kleine Icon-Sticker (gleiche `aria-label`s) und Hinweise im Klartext („Anordnung zurücksetzen“, „Notizen“). Das Poster ist ein großer Datums-Sticker mit Blumen- und Stern-Sticker, die Termine sind Etiketten-Sticker, die Suche ist das normale Feld im Sticker-Stil. Raster, Ziehen, Größe, Herauslösen und Kontextmenüs bleiben gleich.

Implementierung: `src/journal-look.css` (Optik), `src/journal-theme.css` (Buch), `src/journal-desk.css` (Desk), `src/colors.ts`, `src/book.ts`, `src/components/JournalBook.tsx`, `src/components/CalendarDrawer.tsx`, `src/settings.ts`. Browserbereiche: `journal`, `journal-sheet`, `journal-layout`, `journal-grid`, `journal-sticker` (alle Aufbauten in beiden Lavendel-Paletten, Popup-Varianten, Desk ohne Fenster). Aufruf: [Entwicklung](development.md).
