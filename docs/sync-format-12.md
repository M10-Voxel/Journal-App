# Drive-Datenformat: aktuell Format 13

Diese technische Übersicht ergänzt die [Einrichtung und Bedienung von Google Drive](google-drive.md). Die Zahl im Dateinamen ist historisch; das aktuelle Cloud-Paket verwendet **Format 13**. Das Journal-SQLite-Schema steht unabhängig davon bei Version 12.

## Enthaltene Daten

| Bestandteil | Inhalt |
| --- | --- |
| `tables.days`, `entries`, `tags`, `series` | Tagesdaten, Einträge und Kalender, Beschreibungen, Status, Tags, Planungsverknüpfungen und Wiederholungen |
| `settings.period-data` | Aktivitäten, Checklisten, Bewertungen, erfasste Zeit sowie Tages-/Zeitraum-Notizen |
| `settings.board:card:*`, `board:folder:*` | Pinnwand-/Notizkarten, Ordner, Inhalt, Anhänge/Verbindungen, Tagesbezug, Positionen, Größen, Farben und Linkvorschauen |
| `images` | Referenzierte AVIF-Dateien, im Paket als Base64 |
| `preferences` | Allgemeine Darstellungseinstellungen aus `journal.settings`, einschließlich Design, Farben, Sprache und UI-Größe |
| `mailAccounts` | Kontometadaten und Abrufeinstellungen ohne Passwörter, Client-Secrets oder Anmeldetokens |

Übernommene Mailtermine enthalten ihre gespeicherte Mailbeschreibung einschließlich begrenztem HTML-/Textinhalt und werden über die normalen Kalendereinträge übertragen. Mailkonten müssen auf jedem Gerät erneut angemeldet werden.

## Nicht enthalten

- Zugangsdaten für Google Drive oder Mailkonten und der Geräteschlüssel.
- Lokale Mailabruf-Zwischenstände, Modellgewichte und technische Caches.
- Rückgängig-Historie und lokaler Sicherungsstand vor einem Abgleich.
- Vault-Pfad, Fenstergeometrie und Nebula-Layout, lokale Auswahl-/Filterzustände sowie laufende Timer.

Bereits gespeicherte Aktivitätsminuten sind Inhalt und werden synchronisiert; der Zustand einer gerade laufenden Stoppuhr ist gerätelokal. Allgemeine Darstellungseinstellungen werden bewusst übertragen, obwohl sie außerhalb eines Syncs lokal im WebView gespeichert sind.

## Transport und Kompatibilität

Das Paket ist ein vollständiger, mit AES-GCM verschlüsselter Snapshot, kein inkrementeller Dateisync. Bilder werden mit jedem Abgleich übertragen. Die Grenze beträgt 250.000.000 Bytes für den verschlüsselten Transport; Base64 und JSON erzeugen zusätzlichen Platzbedarf. Der lokale verschlüsselte Vergleichsstand enthält keine Bilddaten.

Format 12 ergänzte Aktivitäten, Karten, Bilder und Darstellungseinstellungen; Format 13 ergänzte die Mailkonten. Die aktuelle App kann Formate 11, 12 und 13 lesen und hebt sie beim Vergleich an. Beide Geräte sollten trotzdem denselben aktuellen Stand verwenden: Alte Pakete besitzen die später ergänzten Daten nicht, und ältere Apps akzeptieren das neue Format nicht vollständig.

Für das Journal-Backend entfernt `databaseSnapshot()` Bilder, Darstellungspräferenzen und Mailkonten und übergibt eine Schema-12-Struktur. Journal-Inhalte und Mailkonten werden vorab geprüft, aber in getrennten SQLite-Datenbanken angewendet. Eine einzelne gemeinsame Transaktion über beide Datenbanken ist nicht implementiert.

Implementierung: `src/sync/snapshot.ts`, `src/sync/merge.ts`, `src/components/DriveSettings.tsx`, `src-tauri/src/drive.rs`, `src-tauri/src/mail/mod.rs`.
