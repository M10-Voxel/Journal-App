# Notizblock

Mit **Strg+Umschalt+N** öffnen und schließen. Im normalen Design gibt es den Tab
„Notizen“, im Journal eine Buchlasche, in Nebula den Eintrag `./notizen`.

- Alle Zettel der Pinnwand sind auch hier verfügbar. Ordner und Unterordner lassen
  sich anlegen, mit F2 umbenennen und per Ziehen verschieben. Beim Löschen eines
  Ordners rückt sein Inhalt eine Ebene nach oben.
- Die Suche durchsucht Titel und Markdown aller Zettel. Ein Ordner zeigt auch die
  Zettel seiner Unterordner. „Ohne Ordner“ umfasst verwaiste Zuordnungen.
- Neue Zettel bleiben zunächst im Notizblock. „Auf dem Tag zeigen“ legt sie auf die
  Pinnwand ihres Erstellungsdatums. Bearbeitungen gelten überall für denselben Zettel.
- Bilder werden als AVIF angehängt; HTTPS-Links erhalten nach Möglichkeit eine
  Titelvorschau. Auf der Pinnwand verbindet ein gezogener Pin zwei Karten.
  Tastatur: Karte fokussieren, Alt+L, Pfeile, Enter. Ein Bild/Link wird zum Anhang,
  ein anderer Zettel zur zusätzlichen Seite. Bild auf/ab blättert, mit Strg auch
  während des Schreibens. Über den Faden lässt sich die Verbindung lösen.
- Dauerhaftes Löschen im Notizblock entfernt den Zettel und seine ausschließlich
  dort verwendeten Anhänge. Geteilte oder auf einem Tag liegende Anhänge bleiben.
  Verknüpfen, Lösen und Löschen sind jeweils eine Datenbanktransaktion und ein
  Rückgängig-Schritt. Die Bilddateien bleiben für die Wiederherstellung erhalten.
- Ordner und sämtliche Kartenfelder werden im Drive-Abgleich berücksichtigt.
  Offene Fenster speichern vor dem Abgleich; schwebende Zettel erhalten danach
  die aktualisierten Karten. Auswahl und eingeklappte Ordner bleiben gerätelokal.

Prüfung: `npm test`, native Tests und nach `npm run build` der Browsertest
`JOURNAL_UI_SCOPE=notebook npm run check:ui` (synthetische Daten, keine Nutzerdaten).
Die Bereiche `board` und `undo` prüfen die gemeinsame Pinnwand und Rückgängig.
