# UI-Stil Nebula

Nebula ist das dritte Basisdesign neben Normal und Journal: ein dunkler Desktop mit Terminalfenstern, Papierflächen, violetten Balken, holografischen Akzenten und einem großen Datums-Poster. Inhalte und Bedienaktionen verwenden dieselben Komponenten wie die anderen Designs.

## Farben und Schriften

Die feste Nebula-Palette überlagert die gespeicherte freie Farbwahl. Der Farbenbereich erklärt dies; nach dem Wechsel zu Normal oder Journal gelten dort wieder die eigenen Farben. Popup A ist ein schwarzes Terminal, Popup B Holo-Papier.

Space Mono wird für Schreib-/Monospace-Bereiche verwendet, Space Grotesk für UI-Beschriftungen und Instrument Serif für große Ziffern/Titel. Die Fonts sind lokal mitgeliefert. Der zusätzliche Pixel-Look ist in Nebula deaktiviert; seine gespeicherte Wahl bleibt für die anderen Designs erhalten.

## Desktop und Panels

Die Fensterelemente lassen sich im Zwölf-Spalten-Raster anordnen. Welche Fenster eine Ansicht zeigt, folgt ihren Bereichen unter [Einstellungen → Funktionen](features.md) (`panelsOf`): am Tag `entries`, `rating`, `scales`, `activities`, `notes`, `board`; in Woche … Jahr zusätzlich `checklist` (die Checkliste des Zeitraums) sowie `ratings` und `activities` (die Auswertung). Ausgeblendete Fenster behalten ihren Platz. Kalender und Notizblock können frei über dem Desktop stehen oder in das Raster eingedockt werden. Die Ausgangsanordnung steht in `defaultLayout()`; bestehende Layouts behalten ihre Anordnung und ergänzen die Zeitraum-Pinnwand automatisch. **Jede Ansicht (Tag, Woche, Monat, Quartal, Jahr) hat ihre eigene Anordnung**; eine ältere gemeinsame Anordnung wird beim ersten Start für alle Ansichten übernommen (`normalizeViewLayouts`, gespeichert als `{ views: … }` unter `journal.nebulaLayout.v1`). **layout --reset** („Anordnung zurücksetzen“) stellt die Ausgangsanordnung der gezeigten Ansicht wieder her.

**Anordnungen speichern:** „Anordnung speichern“ (`./layout --save`) legt die aktuelle Anordnung auf einen von drei Plätzen je Ansicht. Die belegten Plätze stehen als Zahlen 1–3 links neben dem Rücksetzknopf – oder an seiner Stelle, solange die Anordnung unverändert ist. Ein Klick auf eine Zahl stellt diese Anordnung her; die passende Zahl ist markiert, und eine schon gespeicherte Anordnung wird nicht noch einmal angeboten. Sind alle drei Plätze belegt, wählt man nach „Anordnung speichern“ die Zahl, die ersetzt wird. Rechtsklick auf eine Zahl: anwenden, durch die aktuelle Anordnung ersetzen oder löschen; die anderen Zahlen behalten ihre Plätze (`journal.nebulaLayout.saved`, `saveLayout`/`removeLayout`).

- Kopfzeile ziehen: verschieben beziehungsweise umordnen. Ränder und Ecken verändern die Größe.
- Fenster können minimiert, angedockt oder fokussiert werden. Eine schmale minimierte Leiste kann neben einem geöffneten Panel stehen.
- Auch Tages-/Zeitraum-Panels können frei schweben. Das Ziehen über den App-Rand kann sie als eigenes natives Fenster abtrennen; die Andockaktion holt sie zurück.
- Kalender und Notizblock liegen eingedockt direkt im Raster nebeneinander. Die eigene Größenwahl soll den Seiten-Scroll nicht allein durch Hover sperren; innere Scrollbereiche übernehmen erst, wenn ihr Inhalt tatsächlich überläuft.
- Anordnung, Größen und Fensterzustände bleiben gerätelokal. Sie gehören nicht zum synchronisierten Inhalt. Das gilt auch für gespeicherte Anordnungen. Der Layout-Rücksetzknopf entfernt die eigene Anordnung, nicht die Notizen.

Poster und kleiner Kalender bilden die ergänzende Übersicht. Der kompakte Kalender kann zwischen Monat und dem Stundenraster eines Tages wechseln; seine Ansicht ist unabhängig vom großen Kalender. Ob das Poster mitscrollt und wie die Spalten angeordnet werden, passt sich der Fensterbreite an.

Tickets zeigen je nach Fensterbreite bis zu sechs kommende offene Einträge aus den Mail-Kategorien Lieferung/Bezahlung/Termine sowie Ereignisse. Gewöhnliche Kalendereinträge und Aktivitätszeiten erscheinen dort nicht. Mail-Kategorien behalten ihre Tickets auch bei ausgeblendeter Journalanzeige. Der Ausblick umfasst 60 Tage; Klick führt zum Journaltag. Hat der Tag eines Tickets ein eigenes Icon (Einstellungen → Tags), steht es hinter dem Tagnamen statt der Striche `---`. Die Tage und Inhalte sind echte Daten, keine Demo-Platzhalter.

## Bedienung und Animationen

`./kalender` beziehungsweise `Strg+K` öffnet den großen Kalender, `./notizen` beziehungsweise `Strg+Umschalt+N` den Notizblock. Ein Journaltag schließt die geöffneten Ansichten. Kontextmenüs verwenden die zum Popupstil passende Darstellung; das native WebView-Rechtsklickmenü wird unterdrückt, wenn kein eigenes Menü vorhanden ist.

Blinkende Cursor sind für schreibbare Felder wie die Suche vorgesehen; rein dekorative Befehlsbeschriftungen blinken nicht. Dekorationen greifen nicht in Zeigeraktionen ein. Reduzierte Bewegung und inaktive Fenster pausieren die betreffenden Animationen; siehe [Ressourcenverwaltung](performance.md).

Implementierung: `src/components/NebulaDesk.tsx`, `src/nebulaLayout.ts`, `src/components/useFloatingWindow.ts`, `src/components/DetachedPanel.tsx`, `src/nebula-theme.css`. Browserbereiche: `nebula`, `nebula-sizing`, `notebook`, `context-menus`, `desk-layouts`, `desk-scroll`.

**Flüssiges Scrollen:** Die Höhe des Kalenders unter dem Plakat folgt dem Scrollen über `--nb-poster-shown`. Der Wert steht nur an der Spalte aus Plakat und Kalender und wird nur bei Änderung geschrieben – am ganzen Desk gesetzt, müsste der Browser bei jedem Bild alle Fenster neu berechnen. Die drehenden Orbits im Hintergrund sind je ein eigenes `<svg>`, das als Ganzes gedreht wird; so übernimmt der Compositor die Drehung, statt das SVG in jedem Bild neu zu berechnen und zu zeichnen. Der UI-Bereich `desk-scroll` misst Stil-, Layout- und Bildzeiten beim Scrollen in allen drei Optiken.
