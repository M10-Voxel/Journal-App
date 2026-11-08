# UI-Stil Journal

Journal ist eines der drei Basisdesigns neben Normal und Nebula. Die Darstellung als Buch verändert Anordnung und Optik; Speichern, Inhalte, Tastenkürzel und Verbindungen verwenden dieselben Funktionen. Pixel kann zusätzlich eingeschaltet werden und ist kein eigenes Basisdesign.

## Farben und Schrift

Die eigenen Paletten heißen **Papier & Tinte** (`paper`) und **Leder & Kerzenlicht** (`candle`). Beim Wechsel in Journal wird eine passende Buchpalette gewählt, sofern noch keine aktiv ist. Die vorherige Farbwahl wird beim Zurückwechseln wiederhergestellt, solange eine Journal-Palette aktiv blieb. Danach bleiben die Farben frei anpassbar, einschließlich Einband und Buchfalz.

Ohne Pixel verwendet Journal Source Serif 4 für die Schreibschrift, Fraunces für Überschriften/Datum und IBM Plex Sans für Bedienelemente. Die Fonts werden lokal mitgeliefert. Pixel ersetzt die betreffenden Schrift-/Formregeln, erhält aber das Buchlayout.

## Seiten und Navigation

Ein Tag besitzt Einträge-, Daten- und Pinnwand-Seiten. Monats- und Jahresübersichten besitzen Notizen, Aktivitäten und eine eigene Pinnwandseite; Woche und Quartal haben Notizen und Aktivitäten. Nach der letzten Seite folgt der nächste Tag beziehungsweise Zeitraum. Der Modus **Seite für Seite** blättert ein Blatt weiter; **beide Seiten** zeigt Einträge und Daten beziehungsweise Notizen und Aktivitäten zusammen und anschließend die breite Pinnwand, sofern die Ansicht eine besitzt. Die Pinnwand ist auch über ihr Seitenregister erreichbar. Doppel-/Einzelseite kann gewählt werden; bei weniger als 880 Pixel verfügbarer Bühnenbreite erscheint automatisch eine Seite.

Die obere Leiste enthält Navigation und Fensterfunktionen. Tag, Woche, Monat, Quartal und Jahr sind Buchregister (`Strg+1–5`). Die Register für Einträge/Daten/Pinnwand behalten ihre Position. Das Leseband führt zu heute; die unteren äußeren Seitenecken sind dünne graue Winkel zum Blättern. Alternativen sind Wischen, Umschalt+Mausrad und `Strg+Bild↑`/`Strg+Bild↓`.

Bestehende Seiten erhalten beim Wechsel stabile Schlüssel, um Editoren, Fokus und Scrollzustand möglichst zu bewahren. Reduzierte Bewegung wird berücksichtigt. Die normale untere Statusleiste ist im Buchlayout ausgeblendet; die Tastenkürzel bleiben über `F1` erreichbar.

## Kalender, Notizen und Raster

Kalender und Notizblock öffnen über ihre Buchlaschen beziehungsweise Tastenkürzel. Das Kalenderblatt kann das Buch überlagern oder daneben liegen; die Breite ist abhängig von Buchansicht und verfügbarem Platz veränderbar. Der Kalenderreiter liegt an der Buchkante, der Notiz-Tagfilter als horizontale Lasche am Buch. Ein gewählter Journaltag schließt die offenen Ansichten wieder.

Die karierten Kalenderflächen richten sich nach dem jeweiligen Raster: In Stundenansichten folgen horizontale Linien der Stundenhöhe und dem Kalenderzoom; die vertikalen Linien passen sich der Spaltenbreite an. Monats- und Jahreszellen besitzen entsprechend angepasste Raster. Auf den Eintragsseiten wird der Schreibbereich liniiert.

Implementierung: `src/book.ts`, `src/components/JournalBook.tsx`, `src/components/CalendarDrawer.tsx`, `src/journal-theme.css`, `src/settings.ts`. Browserbereiche: `journal`, `journal-sheet`, `journal-layout`, `journal-grid`. Aufruf: [Entwicklung](development.md).
