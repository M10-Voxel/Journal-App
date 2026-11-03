# Notizen & Anhänge

Das Board steht in der Tagesansicht unter der Checkliste. Karten am Griff ziehen oder mit den Pfeiltasten in der Kartenkopfzeile umordnen. Bei schmalen Fenstern steht nur eine Kartenspalte zur Verfügung.

- **Neue Notiz:** Titel und Markdown-Text direkt auf dem Zettel bearbeiten. Derselbe Editor und dieselben Formatkürzel wie bei den Einträgen.
- **Bestehende Notiz hinzufügen:** Nach Zetteln aus anderen Tagen oder nach vom Board entfernten Notizen suchen. Ein wiederverwendeter Zettel ist dieselbe Notiz: Textänderungen erscheinen überall.
- **Schwebende Notiz:** Mit ↗ im Notizkopf ein eigenes Fenster öffnen. Am oberen Griff verschieben. Der Pin-Knopf schaltet „immer im Vordergrund“ um. Schließen speichert ausstehende Änderungen und lässt die Karte auf dem Board.
- **Bild hochladen:** Das Bild wird lokal im Hintergrund als AVIF komprimiert (Qualität 55, längste Kante höchstens 2048 Pixel). Eingabedateien bis 30 MB; animierte Bilder werden als Einzelbild verarbeitet. Im Pixelstil wechselt der Knopf pro Karte zwischen normaler und pixeliger Darstellung. Das gespeicherte AVIF bleibt erhalten.
- **Link hinzufügen:** HTTPS-Adresse eingeben. Titel, Beschreibung und Vorschaubild werden aus den Metadaten der Seite gelesen, sofern erreichbar. Ein Klick öffnet die Seite im Standardbrowser. Vorschauabruf und externe Vorschaubilder benötigen Internet und kontaktieren die jeweilige Website. Wenn keine Vorschau verfügbar ist, bleibt der Link erhalten; sein Titel kann bearbeitet werden.

Karten und Zettel werden automatisch in der lokalen SQLite-Datenbank gespeichert, Bilddateien im lokalen App-Datenordner unter `board-images`. Die neue Board-Funktion ist derzeit **nicht Teil des Google-Drive-Abgleichs**. Bilder müssen daher noch separat gesichert werden. Zettel-Fenster werden nach einem App-Neustart über die jeweilige Karte erneut geöffnet.
