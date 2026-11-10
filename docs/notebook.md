# Notizblock

Mit **Strg+Umschalt+N** öffnen und schließen. Klassisch bietet den Notizen-Tab, Journal eine Buchlasche und Nebula `./notizen`. Notizblock und Pinnwand verwenden dieselben Zettel: Änderungen werden überall sichtbar.

## Ordner, Suche und Auswahl

- Ordner und Unterordner lassen sich anlegen, mit F2 oder Doppelklick umbenennen und per Ziehen verschieben. Beim Löschen eines Ordners wird sein Inhalt eine Ebene höher eingeordnet.
- Ein ausgewählter Ordner zeigt **nur seine eigenen Notizen**, nicht die Inhalte der Unterordner. „Alle“ zeigt sämtliche Zettel, „Ohne Ordner“ auch verwaiste Zuordnungen.
- Die Textsuche durchsucht Titel und Markdown aller Notizen unabhängig vom ausgewählten Ordner. Sortierung ist nach Titel, Erstellungsdatum oder letzter Bearbeitung möglich; Tags können zusätzlich gefiltert werden.
- **Strg+Klick** wählt mehrere Notizen, **Umschalt+Klick** den Bereich ab dem Auswahlanker. Die Auswahlleiste verschiebt sie gemeinsam in einen Ordner oder löscht sie über das Papierkorb-Symbol. Eine ausgewählte Notiz kann geöffnet werden, ohne die übrige Auswahl zu verlieren.
- **Entf** und das Kontextmenü bieten das Löschen einzelner beziehungsweise ausgewählter Zettel. In einem schreibenden Textfeld gelten die Editor-Tasten; die Sammellöschung verlangt eine Bestätigung. Zettel verschwinden dabei auch von den Pinnwänden ihrer Tage.

## Tagesbezug und Anhänge

Neue Notizen bleiben zunächst nur im Notizblock. **Auf dem Tag zeigen** legt einen Zettel auf die Pinnwand seines Erstellungsdatums. Ist der Tagesbezug aktiv, öffnen das anklickbare Datum und die Kontextmenü-Aktion den Journaltag und schließen den Notizblock. Ausschalten nimmt den Zettel von den Tagen, löscht aber nicht seinen Text.

Über den Drei-Balken-Button im Notizkopf lässt sich der Zettel zusätzlich auf der Monats- oder Jahrespinnwand seines Erstellungsdatums anzeigen. Bei verknüpften Karten kann die gesamte Gruppe mit ihrer Anordnung übernommen werden. Inhalte bleiben gemeinsam; die Positionen können auf jeder Pinnwand unabhängig geändert werden.

Bilder werden als AVIF angehängt; HTTPS-Links erhalten nach Möglichkeit eine Vorschau. Verbundene Zettel bilden zusätzliche Seiten. Bild↑/Bild↓ blättert; mit Strg funktioniert dies auch während des Schreibens. Verknüpfen und Lösen beschreibt die [Pinnwand](bulletin-board.md).

Verbundene Notizen erscheinen immer als ein Heft. Die gerichteten Fäden bestimmen ihre Reihenfolge: Pin der vorherigen Notiz zur nächsten ziehen; ein kleiner Pfeil auf dem Faden zeigt die Richtung. Im Fadenmenü lässt sie sich umkehren. „Hauptnotiz setzen“ entfällt. Bilder und Links bleiben richtungslose Anhänge. Links steht der erste Zettel des Hefts mit den weiteren Seiten darunter als schmale, untergeordnete Zeilen. Ordnerzähler berücksichtigen das Heft einmal; maßgeblich ist der Ordner seiner ersten Seite. Die Suche findet auch Text aus weiteren Seiten. Direkte Aufrufe wählen das Heft aus und öffnen die angeforderte Seite.

Alte Verbindungen ohne Richtung werden aus einer früheren Hauptnotiz-Markierung beziehungsweise der stabilen gespeicherten Reihenfolge abgeleitet; ihre Daten müssen dafür nicht umgeschrieben werden. Auch verzweigte oder zyklische Verbindungen zeigen jede Seite nur einmal. Eigenständige Notizblock-Zettel bleiben immer verfügbar. Alte Pinnwand-Zettel ohne verbleibende Pinnwand-Zuordnung werden nicht mehr als selbstständige Notizblock-Einträge oder Suchtreffer angeboten; ihre gespeicherten Inhalte bleiben erhalten. Der Mülleimer auf der Pinnwand löscht eine Karte dagegen tatsächlich aus allen Ansichten und ist rückgängig machbar.

Löschen entfernt auch ausschließlich an diesem Zettel hängende Anhänge. Geteilte oder weiterhin auf einer Pinnwand liegende Anhänge bleiben bestehen. Verbindungen, Ordneränderungen und Löschungen gehören zur lokalen [Rückgängig-Historie](undo-redo.md); Bilddateien bleiben für Wiederherstellung verfügbar.

Ordner, Karteninhalte und Verbindungen werden mit [Google Drive](google-drive.md) synchronisiert. Geöffnete Fenster speichern vor dem Abgleich. Auswahl, eingeklappte Ordner und Sortierung bleiben lokale, vaultbezogene Zustände.

Implementierung: `src/components/Notebook.tsx`, `src/notebook.ts`. Browserprüfungen: `notebook`, `context-menus` und `undo`; Aufruf unter [Entwicklung](development.md).
