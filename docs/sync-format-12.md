# Erweiterter Drive-Abgleich

Format 12 ergänzt den bisherigen Journal-, Kalender-, Tag- und Serienabgleich um:

- `period-data`: Aktivitätsdefinitionen, Checklisten, Bewertungen, erfasste Minuten, Tages- und Zeitraum-Notizen.
- `board:card:*`: sämtliche Pinnwandkarten einschließlich Inhalt, Tageszuordnung, Position, Größe, Farbe und Linkvorschau.
- Referenzierte AVIF-Bilder im verschlüsselten Cloud-Paket.
- Darstellungseinstellungen aus `journal.settings`, einschließlich Themes, Farben und Sprache.

Beide Geräte müssen aktualisiert werden. Format 11 wird beim Lesen auf Format 12 angehoben. Alte Apps verweigern die Übernahme des neuen Formats. Unabhängige Änderungen an Objekten werden zusammengeführt; widersprüchliche Änderungen werden wie bisher zur Auswahl angeboten.

Das Paket bleibt ein vollständiger, verschlüsselter Snapshot. Die Obergrenze beträgt jetzt 250 MB verschlüsselte Daten. Bilder werden bei jedem Abgleich übertragen, nicht inkrementell. Der lokale Vergleichsstand enthält keine Bilddaten, damit diese nicht zusätzlich den WebView-localStorage belegen. Die AVIF-Dateien bleiben im App-Datenordner.

Format 13 ergänzt Mailkonten ohne Zugangsdaten. Für jedes übernommene Konto ist auf dem jeweiligen Gerät eine Anmeldung nötig. Der Mailabruf und seine lokalen Zwischenstände bleiben gerätespezifisch; übernommene Mailtermine einschließlich ihrer gespeicherten Inhalte werden als Kalendereinträge synchronisiert. Google-/Mail-Zugangsdaten, der Geräteschlüssel, laufende lokale Timer, Fensterpositionen und technische Caches werden nicht übertragen.

Geprüft mit lokalen Datenbanktests, Zusammenführung alter/neuer Snapshots und simuliertem Drive-Transport. Der echte Transfer zwischen zwei Google-Drive-Geräten ist separat zu prüfen.
