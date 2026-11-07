# Pinnwand: Notizen und Anhänge

Die Pinnwand gehört zur Tagesansicht und folgt Bewertung/Checkliste; im Journal-Stil hat sie eine eigene Buchseite, in Nebula ein eigenes Panel. Karten lassen sich am Griff verschieben und an der Ecke in der Größe ändern. Layout und Karteninhalte werden automatisch gespeichert.

## Inhalte

- **Neue Notiz:** Titel und Markdown direkt im Zettel bearbeiten. Zusätzlich zu Inline-Formatierung gibt es Überschriften, Listen, Checklisten, Tabellen und Codeblöcke.
- **Bestehende Notiz hinzufügen:** Einen bereits vorhandenen Zettel am Tag anzeigen. Es entsteht eine weitere Zuordnung derselben Notiz, keine unabhängige Textkopie.
- **Schwebende Notiz:** Die Pin-Aktion öffnet ein eigenes Fenster. Dessen Anpinnen hält es vor anderen Fenstern. Schließen speichert den Text und beendet nur dieses Notizfenster.
- **Bild hochladen:** AVIF-Komprimierung im Hintergrund, Qualität 55 und höchstens 2048 Pixel an der längsten Kante. Eingabedateien bis 30 MB; es wird ein Einzelbild gespeichert. Der Pixel-Schalter verändert die Anzeige, nicht die gespeicherten Bilddaten.
- **Link hinzufügen:** HTTPS-Adresse mit Seitentitel und nach Möglichkeit Beschreibung/Vorschaubild. Fehlt die Vorschau, bleibt die Karte mit bearbeitbarem Titel erhalten. Der Vorschauabruf kontaktiert die Website; Öffnen führt in den Standardbrowser.

Ein Klick auf ein Bild öffnet die große Vorschau. Zettel sind auch im [Notizblock](notebook.md) verfügbar und können dort in Ordnern verwaltet werden.

## Verbindungen und Entfernen

Den Pin zu einer anderen Karte ziehen, um einen Faden anzulegen: Bilder und Links werden zu Anhängen, verbundene Zettel zu weiteren Seiten. Per Tastatur: Karte fokussieren, **Alt+L**, mit Pfeilen wählen und mit Enter verbinden. Den Faden anklicken, um die Verbindung zu lösen.

**Abnehmen** entfernt die Karte vom aktuellen Tag. Ein Zettel bleibt im Notizblock beziehungsweise unter „Vorhandene“ verfügbar. Das bestätigte Löschen im Notizblock entfernt dagegen den Zettel aus allen Ansichten. Beide Inhaltsänderungen können innerhalb der lokalen [Historie](undo-redo.md) rückgängig gemacht werden; es gibt keinen separaten Papierkorb.

## Speicherung und Synchronisierung

Karten, Positionen, Größen, Tageszuordnungen, Ordner und Verbindungen liegen in der SQLite-Datenbank des aktiven Vaults. AVIF-Dateien liegen **im Vault unter `board-images/`**. Karten und referenzierte Bilder sind Teil des verschlüsselten [Drive-Abgleichs](sync-format-12.md). Externe Linkseiten selbst werden nicht als vollständige Offline-Kopie gespeichert.

Schwebende Notizfenster sind gerätelokal; nach einem App-Neustart werden sie bei Bedarf wieder über ihre Karte geöffnet. In Nebula passt sich die Pinnwand dem Panel an, im Pixelstil werden passende eckige Bedienelemente und Icons verwendet.

Implementierung: `src/components/BulletinBoard.tsx`, `src/boardCards.tsx`, `src/boardImage.worker.ts`, `src-tauri/src/board.rs`. Browserprüfungen: `board`, `board-free-drag`, `notebook`, `undo`.
