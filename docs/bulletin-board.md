# Pinnwand: Notizen und Anhänge

Tages-, Monats- und Jahresansicht besitzen jeweils eine Pinnwand. Im Journal-Stil ist sie eine eigene Buchseite nach Daten beziehungsweise Aktivitäten; beim Blättern ganzer Doppelseiten liegt sie breit über beiden Seiten. In Nebula ist sie ein eigenes Panel mit denselben Fensterfunktionen wie die Tagespinnwand. Im normalen Stil folgt sie Bewertung/Checkliste beziehungsweise der Zeitraum-Auswertung. Jeder Monat und jedes Jahr hat seine eigene Zuordnung. Karten lassen sich am Griff verschieben und an der Ecke in der Größe ändern. Layout und Karteninhalte werden automatisch gespeichert.

## Inhalte

- **Neue Notiz:** Titel und Markdown direkt im Zettel bearbeiten. Zusätzlich zu Inline-Formatierung gibt es Überschriften, Listen, Checklisten, Tabellen und Codeblöcke.
- **Bestehende Notiz hinzufügen:** Einen bereits vorhandenen Zettel am Tag anzeigen. Es entsteht eine weitere Zuordnung derselben Notiz, keine unabhängige Textkopie.
- **Schwebende Notiz:** Die Pin-Aktion öffnet ein eigenes Fenster. Dessen Anpinnen hält es vor anderen Fenstern. Schließen speichert den Text und beendet nur dieses Notizfenster.
- **Bild hochladen:** AVIF-Komprimierung im Hintergrund, Qualität 55 und höchstens 2048 Pixel an der längsten Kante. Eingabedateien bis 30 MB; es wird ein Einzelbild gespeichert. Der Pixel-Schalter verändert die Anzeige, nicht die gespeicherten Bilddaten.
- **Link hinzufügen:** HTTPS-Adresse mit Seitentitel und nach Möglichkeit Beschreibung/Vorschaubild. Fehlt die Vorschau, bleibt die Karte mit bearbeitbarem Titel erhalten. Der Vorschauabruf kontaktiert die Website; Öffnen führt in den Standardbrowser.

Ein Klick auf ein Bild öffnet die große Vorschau. Zettel sind auch im [Notizblock](notebook.md) verfügbar und können dort in Ordnern verwaltet werden.

## Verbindungen und Entfernen

Den Pin zu einer anderen Karte ziehen, um einen Faden anzulegen: Bilder und Links werden zu Anhängen, verbundene Zettel zu weiteren Seiten. Per Tastatur: Karte fokussieren, **Alt+L**, mit Pfeilen wählen und mit Enter verbinden. Den Faden anklicken, um die Verbindung zu lösen.

Verbundene Karten erhalten auf der Pinnwand einen dezenten rechteckigen Rahmen. Er umfasst auch indirekt verbundene Karten und folgt Verschieben sowie Größenänderungen; Fäden und einzelne Karten bleiben wie bisher bedienbar.

Der **Drei-Balken-Button** an einer Karte öffnet „Auf Pinnwänden anzeigen“. Dort wählt man die Monats- und/oder Jahrespinnwand des angezeigten Datums. Bei verbundenen Karten stehen **Nur diese Karte** und **Gesamte Gruppe** zur Wahl. Die Gruppe wird mit ihrer Anordnung und Kartengröße übernommen, einschließlich bereits am Ziel vorhandener Gruppenmitglieder. Es entstehen Zuordnungen derselben Inhalte: Titel, Text, Bilder und Verbindungen bleiben gemeinsam, Position und Größe können danach je Pinnwand unabhängig verändert werden. Das bisherige allgemeine Kartenmenü bleibt per Rechtsklick erreichbar.

Die Auswahl ist auch im Kopf einer geöffneten Notiz im Notizblock verfügbar; dort bestimmt das Erstellungsdatum den Monat und das Jahr. Neue Karten können direkt auf Monats- und Jahrespinnwänden angelegt werden.

**Abnehmen** entfernt die Karte nur von der aktuellen Pinnwand. Ein Zettel bleibt im Notizblock beziehungsweise unter „Vorhandene“ verfügbar; Zuordnungen auf anderen Pinnwänden bleiben erhalten. Das bestätigte Löschen im Notizblock entfernt dagegen den Zettel aus allen Ansichten. Separat auf einer Monats- oder Jahrespinnwand angezeigte Anhänge bleiben dabei erhalten. Inhaltsänderungen können innerhalb der lokalen [Historie](undo-redo.md) rückgängig gemacht werden; eine Gruppenübernahme bildet einen gemeinsamen Schritt. Es gibt keinen separaten Papierkorb.

## Speicherung und Synchronisierung

Karten, Positionen, Größen, Tages-/Monats-/Jahreszuordnungen, Ordner und Verbindungen liegen in der SQLite-Datenbank des aktiven Vaults. Die optionalen Kartenfelder `boards["month:YYYY-MM"]` und `boards["year:YYYY"]` speichern das jeweilige Layout; `null` bedeutet abgenommen. Vorhandene Tageszuordnungen und deren Positionen bleiben unverändert, eine Schema-Migration ist nicht nötig. AVIF-Dateien liegen **im Vault unter `board-images/`**. Karten einschließlich der neuen Zuordnungen und referenzierte Bilder sind Teil des verschlüsselten [Drive-Abgleichs](sync-format-12.md). Externe Linkseiten selbst werden nicht als vollständige Offline-Kopie gespeichert.

Schwebende Notizfenster sind gerätelokal; nach einem App-Neustart werden sie bei Bedarf wieder über ihre Karte geöffnet. In Nebula passt sich die Pinnwand dem Panel an und kann minimiert, als Fenster über dem Desktop angezeigt oder aus der App abgedockt werden. Ein abgedocktes Pinnwandfenster folgt der ausgewählten Tages-, Monats- oder Jahresansicht. Im Pixelstil werden passende eckige Bedienelemente und Icons verwendet.

Implementierung: `src/components/BulletinBoard.tsx`, `src/components/BoardScopePicker.tsx`, `src/boardPlacement.ts`, `src/boardCards.tsx`, `src/boardImage.worker.ts`, `src-tauri/src/board.rs`. Browserprüfungen: `period-boards`, `board`, `board-free-drag`, `notebook`, `undo`.
