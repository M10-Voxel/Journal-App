# Dokumentation

Die Dokumentation beschreibt den aktuellen Windows-Zweig `Windows`. Android ist als eigener späterer Zweig vorgesehen; ein Android-Build ist noch nicht eingerichtet. Veröffentlichte Versionen und ihre Änderungen stehen unter [GitHub Releases](https://github.com/M10-Voxel/Journal-App/releases).

## Einstieg und tägliche Nutzung

- [Erste Schritte](getting-started.md): Installation, Tagesnotizen, Kalender, Aktivitäten, Tags und Tastenkürzel.
- [Vault und Updates](vault-and-updates.md): Speicherort, Datensicherung, Installation und automatische Veröffentlichung.
- [Notizblock](notebook.md): Ordner, Suche, Mehrfachauswahl und Löschen.
- [Pinnwand](bulletin-board.md): Zettel, schwebende Notizen, Bilder, Links und Verbindungen.
- [Mehrtägige Termine](multiday-calendar.md): Zeichnen, Uhrzeiten, Serienaktionen und Kalenderansichten.
- [ICS-Import und -Export](ics-import.md): Kalenderdateien, Wiederholungen und Grenzen des Austauschs.
- [Rückgängig und Wiederherstellen](undo-redo.md): Inhaltshistorie und Editor-Verhalten.

## Verbindungen und Daten

- [Google Drive](google-drive.md): Einrichtung, Verschlüsselung, Konflikte und bewusstes Ersetzen eines Datenstands.
- [Drive-Datenformat](sync-format-12.md): Format 13, synchronisierte Inhalte und gerätelokale Daten.
- [E-Mail-Konten](mail-accounts.md): Anbieter, Anmeldung, Abruf, Vorschlagsprüfung und optionale automatische Kalenderübernahme.
- [Mailvorschau und Lieferzeiträume](mail-display-and-delivery.md): HTML-Darstellung, externe Inhalte und Werktage.
- [Kontextbezogene Mail-Erkennung](mail-context-ml.md): lokale Modelle, Training, Prüfungen und Grenzen.

## Darstellung

- [Journal-Stil](journal-style.md): Buchseiten, Register und Kalenderblatt.
- [Nebula-Stil](nebula-style.md): verschiebbare und andockbare Panels.
- [Popup-Stile](popup-styles.md): zwei Varianten je Design und Verhalten beim Schließen.

## Entwicklung

- [Entwicklung und Prüfungen](development.md): Voraussetzungen, Befehle, Architektur und Release-Ablauf.
- [Ressourcenverwaltung](performance.md): Kalender-Caches, Hintergrundfenster und lokales Mailmodell.
- [Eigenständige ML-Probe](../tools/mail-ml-probe/README.md): zusätzliches Entwicklerwerkzeug für synthetische Mailtexte.
- [Release-Archiv 0.1.1](releases/0.1.1.md): historische Versionshinweise, kein aktuelles Handbuch.

Die Beschreibungen beziehen sich auf die Implementierung. Automatisierte Prüfungen mit Beispieldaten ersetzen keine echten Anbieteranmeldungen oder einen manuellen Installations- und Gerätetest. Bei Änderungen an einer Funktion sollten die zugehörige Anleitung und bei neuen Dokumenten auch die kurze Projekt-README aktualisiert werden.
