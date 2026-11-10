# Pinnwand: Notizen und Anhänge

Tages-, Monats- und Jahresansicht besitzen jeweils eine Pinnwand. Im Journal-Stil ist sie eine eigene Buchseite nach Daten beziehungsweise Aktivitäten; beim Blättern ganzer Doppelseiten liegt sie breit über beiden Seiten. In Nebula ist sie ein eigenes Panel mit denselben Fensterfunktionen wie die Tagespinnwand. Im normalen Stil folgt sie Bewertung/Checkliste beziehungsweise der Zeitraum-Auswertung. Jeder Monat und jedes Jahr hat seine eigene Zuordnung. Karten lassen sich am Griff verschieben und an der Ecke in der Größe ändern. Layout und Karteninhalte werden automatisch gespeichert.

## Inhalte

- **Neue Notiz:** Titel und Markdown direkt im Zettel bearbeiten. Zusätzlich zu Inline-Formatierung gibt es Überschriften, Listen, Checklisten, Tabellen und Codeblöcke.
- **Bestehende Notiz hinzufügen:** Anklicken erstellt eine unabhängige Einzelkopie mit optionaler Synchronisation; „Gruppe kopieren“ übernimmt die verbundenen Karten einschließlich Anordnung und Fadenrichtungen.
- **Schwebende Notiz:** Die Pin-Aktion öffnet ein eigenes Fenster. Dessen Anpinnen hält es vor anderen Fenstern. Schließen speichert den Text und beendet nur dieses Notizfenster.
- **Bild hochladen:** AVIF-Komprimierung im Hintergrund, Qualität 55 und höchstens 2048 Pixel an der längsten Kante. Eingabedateien bis 30 MB; es wird ein Einzelbild gespeichert. Der Pixel-Schalter verändert die Anzeige, nicht die gespeicherten Bilddaten.
- **Link hinzufügen:** HTTPS-Adresse mit Seitentitel und nach Möglichkeit Beschreibung/Vorschaubild. Fehlt die Vorschau, bleibt die Karte mit bearbeitbarem Titel erhalten. Der Vorschauabruf kontaktiert die Website; Öffnen führt in den Standardbrowser.

Ein Klick auf ein Bild öffnet die große Vorschau. Zettel sind auch im [Notizblock](notebook.md) verfügbar und können dort in Ordnern verwaltet werden.

## Verbindungen und Entfernen

Den Pin zu einer anderen Karte ziehen, um einen Faden anzulegen: Bilder und Links werden zu Anhängen, verbundene Zettel zu weiteren Seiten. Zwischen Notizen zeigt ein kleines Chevron auf dem Faden von der Ausgangsnotiz zur nächsten Seite. Diese Richtung bestimmt die Heftreihenfolge im Notizblock. Bilder und Links behalten richtungslose Fäden. Per Tastatur: Karte fokussieren, **Alt+L**, mit Pfeilen wählen und mit Enter verbinden. Den Faden anklicken, um seine Richtung umzukehren oder die Verbindung zu lösen. Eine Hauptnotiz-Markierung ist nicht mehr nötig.

Verbundene Karten erhalten auf der Pinnwand einen dezenten rechteckigen Rahmen. Er umfasst auch indirekt verbundene Karten und folgt Verschieben sowie Größenänderungen; Fäden und einzelne Karten bleiben wie bisher bedienbar.

Am Rand lässt sich die gesamte Gruppe ziehen. Relative Kartenpositionen und Größen bleiben erhalten; auch auf dieser Pinnwand per Tag-Filter ausgeblendete Mitglieder werden mit verschoben. Der freie Innenbereich bleibt für die normale Pinnwandbedienung verfügbar. Der fokussierte Rahmen unterstützt Pfeiltasten (Shift: größere Schritte), Escape bricht eine laufende Gruppenbewegung ab, Entf löscht die Gruppe. Eine Bewegung wird am Ende gemeinsam gespeichert und ist ein Undo-Schritt.

Oben links am Rahmen steht ein dezentes Namensfeld. Enter oder Verlassen speichert, Escape verwirft die aktuelle Eingabe. Der Name wird auf den verbundenen Karten als `groupName` gespeichert und bleibt nach Neuladen, Kopieren, Drive-Synchronisation und beim Aufteilen einer Gruppe erhalten. Bei eingeschalteter Kopiensynchronisation wird auch der Gruppenname abgeglichen.

Rechts am Rahmen löscht der Mülleimer sämtliche verbundenen Karten der Gruppe aus Pinnwänden und Notizblock, einschließlich ausgeblendeter Mitglieder. Unabhängige Originale oder Kopien gehören nicht zu dieser Löschung. Das Rechtsklick-Menü benennt die Aktion ausdrücklich als „Alle Karten der Gruppe dauerhaft löschen“. Die Löschung verwendet die vorhandene Undo-Speicherung.

Fäden verblassen über der gesamten Fläche jeder sichtbaren Karte, unabhängig von ihrer Gruppe. Das gilt auch während des Verbindens. Pins bleiben klar erkennbar; über einer gerade bearbeiteten Karte wird der Faden vollständig ausgeblendet. Eine gemeinsame SVG-Maske folgt Position, Größe und Drehung der Karten, auch beim Zoomen der Pinnwand.

Ein kurzer Linksklick auf freie Pinnwandfläche verlässt die aktive Karte und entfernt ihren Textcursor. Halten und Ziehen verschiebt weiterhin die Pinnwand. Über „Vorhandene → Gruppe“ angelegte unabhängige Kopien behalten ihre Positionen und Kartengrößen; die Gruppe samt Fäden lässt sich mit einem Undo-Schritt rückgängig machen. Bei mehreren Quellpinnwänden wird die erste Tageszuordnung, sonst die erste Periodenzuordnung der gewählten Karte verwendet. Einzelkopien behalten ihre Größe und werden an einem freien Platz angelegt.

„Vorhandene“ zeigt jede Notiz nur einmal: Ein Original und seine Kopien (`copyOf`) bilden einen Eintrag, ebenso ältere inhaltsgleiche Kopien ohne gespeicherte Herkunft. Karten, die schon auf dieser Pinnwand liegen, und abgenommene Kopien ohne Pinnwand oder Notizblock erscheinen nicht (`libraryNotes` in `src/boardPlacement.ts`). Unter „Vorhandene“ erstellt ein normaler Klick auf eine Notiz eine eigenständige Einzelkopie mit gespeicherter Original-Zuordnung. Es gibt keinen zusätzlichen Einzelkopie-Knopf mehr. Der größere Knopf „Gruppe kopieren“ daneben übernimmt alle kopierbaren Gruppenmitglieder. Die Originalnotiz und ihre Pinnwand-Zuordnungen bleiben erhalten. Synchronisation startet ausgeschaltet und lässt sich anschließend am neuen Zettel aktivieren.

## Bedienelemente je Design

Die Bedienelemente sollen sich unauffällig ins jeweilige Design einfügen und wenig Platz belegen:
- **Hinzufügen-Leiste** (Zettel, Bild, Link, Vorhandene):
  - Normal: schmale Segmentleiste.
  - Journal: geschriebene Wörter zwischen feinen Strichen, beim Zeigen mit Tinte unterstrichen.
  - Nebula: eckige Terminal-Knöpfe. Im Holo-Papier-Look bekommen die erstellenden Knöpfe beim Zeigen die grüne Foil, „Vorhandene“ die lila Foil.
  - Pixel: harte Kanten.
- **Karten-Werkzeuge** (Tag, Papier, schwebend, Pinnwände, Löschen): Sie erscheinen beim Zeigen oder bei Fokus über dem Ende des Titels, auf der Papierfarbe. Im Ruhezustand hat der Titel die volle Breite. Während man im Titel tippt, treten sie zurück.
- **Gruppenrahmen:** Der Name steht wie eine Legende in der oberen Rahmenlinie. Unbenannt zeigt das Feld seinen Platzhalter erst beim Zeigen auf den Rahmen. Die Aktionen rechts oben bleiben gedämpft, bis man auf den Rahmen zeigt.
  - Journal: gestrichelte Bleistiftlinie, Name in Handschrift.
  - Nebula: gestrichelter violetter Rahmen, Name in kleinen Großbuchstaben. Im Holo-Papier-Look bekommt der Mülleimer beim Zeigen die orange Foil.
  - Pixel: gestrichelt, eckig.
- **Sync-Schalter einer Karte:** Er hängt als kleiner Reiter am oberen Kartenrand. Das Wort „Sync“ erscheint beim Zeigen auf die Karte.
  - Journal: Papieretikett links (rechts sitzt der Klebestreifen).
  - Nebula: eingeschaltet violett, im Holo-Papier-Look lila Foil.

Neu angelegte Kopien merken sich ihr Original (`copyOf`). Ihr Synchronisationsschalter ist zunächst aus. Er sitzt bei einer Einzelkopie als kleiner Reiter oben am Kartenrand („Sync“), bei verbundenen Kopien als kleiner Symbolschalter rechts am Gruppenrahmen. Auch Originale mit zugeordneten Kopien zeigen den Schalter. Einschalten übernimmt den aktuellen Inhalt und die Größe des jeweiligen Originals; danach werden Titel, Markdown-Text, Papierfarbe, Tag, Linkziel, Pixel-Darstellung und Größe beidseitig synchronisiert. Einzelkarten behalten immer ihre eigene Position. Bei Gruppen werden interne Bewegungen als relative Änderung auf die jeweilige Kopiengruppe übertragen; das Verschieben der gesamten Gruppe bleibt lokal. Beim Einschalten wird die Anordnung am bestehenden Gruppenanker ausgerichtet, sodass die Gruppe ihre Platzierung behält. Das gilt auch für Monats- und Jahrespinnwände. Ausschalten behält den letzten Stand und macht weitere Bearbeitungen unabhängig. Pinnwand-Zuordnung, Ordner, Fäden und Löschen bleiben unabhängig. Gruppenschalter betreffen die kopierten Mitglieder ihrer Gruppe und zugehörige Kopien ihrer Originale.

Die zentrale Kartenablage erweitert Änderungen für eingeschaltete Kopien und speichert sie gemeinsam als einen rückgängig machbaren Vorgang. Das gilt auch für Bearbeitungen im Notizblock und in abgetrennten Notizfenstern. Die optionalen JSON-Felder `copyOf`/`copySync` werden mit der bestehenden Speicherung und Drive-Synchronisation übertragen; es ist keine Datenbankmigration nötig. Ältere Kopien ohne gespeicherte Herkunft bleiben unabhängig, ebenso Kopien nach dem Löschen ihres Originals. Gewöhnliche Verbindungsfäden aktivieren keine Inhaltssynchronisation.

Das Umschalten der Synchronisation speichert ohne vorübergehende Statuszeile über der Pinnwand. Karten bleiben eingehängt und die Ansicht wird dafür nicht verschoben oder neu skaliert. Beim Einschalten können sich Karteninhalt und Geometrie entsprechend dem Original ändern.

Der **Drei-Balken-Button** an einer Karte öffnet „Auf Pinnwänden anzeigen“. Dort wählt man die Monats- und/oder Jahrespinnwand des angezeigten Datums. Bei verbundenen Karten stehen **Nur diese Karte** und **Gesamte Gruppe** zur Wahl. Die Gruppe wird mit ihrer Anordnung und Kartengröße übernommen, einschließlich bereits am Ziel vorhandener Gruppenmitglieder. Es entstehen Zuordnungen derselben Inhalte: Titel, Text, Bilder und Verbindungen bleiben gemeinsam, Position und Größe können danach je Pinnwand unabhängig verändert werden. Das bisherige allgemeine Kartenmenü bleibt per Rechtsklick erreichbar.

Die Auswahl ist auch im Kopf einer geöffneten Notiz im Notizblock verfügbar; dort bestimmt das Erstellungsdatum den Monat und das Jahr. Neue Karten können direkt auf Monats- und Jahrespinnwänden angelegt werden.

**Löschen** über den Mülleimer entfernt die Karte aus allen Pinnwänden und dem Notizblock. Die übrigen Notizseiten bleiben erhalten, ihre Verbindungen werden bereinigt und ihre Reihenfolge neu bestimmt. Ausschließlich an einer gelöschten Notiz hängende private Anhänge werden mit entfernt; separat gepinnte oder anderweitig verwendete Anhänge bleiben bestehen. Unabhängige Originale/Kopien werden nicht mit gelöscht. Die lokale [Historie](undo-redo.md) stellt Karten und Fadenrichtungen gemeinsam wieder her; eine Gruppenlöschung bildet einen gemeinsamen Schritt. Über die Pinnwand-Zuordnung im Drei-Balken-Menü lässt sich weiterhin nur eine einzelne Zuordnung ausschalten. Alte, bereits früher abgenommene Pinnwand-Kopien werden aus der normalen Notizblock-Liste ausgeblendet, nicht nachträglich gelöscht.

## Speicherung und Synchronisierung

Karten, Positionen, Größen, Tages-/Monats-/Jahreszuordnungen, Ordner und Verbindungen liegen in der SQLite-Datenbank des aktiven Vaults. Die optionalen Kartenfelder `boards["month:YYYY-MM"]` und `boards["year:YYYY"]` speichern das jeweilige Layout; `null` bedeutet abgenommen. Vorhandene Tageszuordnungen und deren Positionen bleiben unverändert, eine Schema-Migration ist nicht nötig. AVIF-Dateien liegen **im Vault unter `board-images/`**. Karten einschließlich der neuen Zuordnungen und referenzierte Bilder sind Teil des verschlüsselten [Drive-Abgleichs](sync-format-12.md). Externe Linkseiten selbst werden nicht als vollständige Offline-Kopie gespeichert.

`links` hält die beidseitige Gruppenzugehörigkeit, `pageLinks` die ausgehenden Notizrichtungen. Bei fehlenden alten Richtungsdaten wird eine stabile Reihenfolge abgeleitet. Kopieren übersetzt diese Richtungen auf die neuen Karten-IDs; Löschen und Undo berücksichtigen sie ebenfalls. Die optionalen JSON-Felder werden mit dem bestehenden Drive-Abgleich übertragen und benötigen keine Datenbankmigration.

Schwebende Notizfenster sind gerätelokal; nach einem App-Neustart werden sie bei Bedarf wieder über ihre Karte geöffnet. In Nebula passt sich die Pinnwand dem Panel an und kann minimiert, als Fenster über dem Desktop angezeigt oder aus der App abgedockt werden. Ein abgedocktes Pinnwandfenster folgt der ausgewählten Tages-, Monats- oder Jahresansicht. Im Pixelstil werden passende eckige Bedienelemente und Icons verwendet.

Implementierung: `src/components/BulletinBoard.tsx`, `src/components/BoardScopePicker.tsx`, `src/boardPlacement.ts`, `src/boardCards.tsx`, `src/boardImage.worker.ts`, `src-tauri/src/board.rs`. Browserprüfungen: `period-boards`, `board`, `board-free-drag`, `notebook`, `undo`.
