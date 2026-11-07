# Vault, Sicherung und Updates

## Speicherort wählen

Unter **Einstellungen → Speicherort**:

| Aktion | Verhalten |
| --- | --- |
| **Vault öffnen** | Einen vorhandenen Ordner mit `journal.sqlite3` auswählen |
| **Aktuellen Stand übernehmen…** | Journal, Kalender, Serien, Tags, Aktivitäten, Notizblock, Pinnwand/Bilder und Maildaten in einen leeren Zielordner kopieren |
| **Leeren Vault anlegen** | Einen leeren Zielordner wählen und unabhängig neu anfangen |

Vor dem Wechsel werden ausstehende Änderungen der offenen Fenster gespeichert. Nach Bestätigung speichert Journal den Auftrag und startet neu. SQLite wird bei der Übernahme über die Backup-API gesichert, einschließlich bestätigter WAL-Daten. Die alte Kopie wird **nicht automatisch gelöscht**. Ein fehlender benutzerdefinierter Vault führt zu einer Auswahlhilfe statt zu einem stillen Wechsel auf leere Daten.

Der aktive Vault enthält:

- `journal.sqlite3`: Inhalte und lokale Rückgängig-Historie.
- `mail.sqlite3`: Mailkonten, lokal geschützte Zugangsdaten und Abruf-/Vorschlagsdaten.
- `board-images/`: AVIF-Dateien der Karten und Anhänge.
- `journal.local.json`: beim Wechsel gesicherte vaultbezogene Browserzustände, etwa Timer, Notizauswahl und verschlüsselte Drive-Vergleichsstände.

SQLite-WAL-/SHM-Dateien können während des Betriebs danebenliegen. Ohne eigene Auswahl ist `%LOCALAPPDATA%/de.journal.local` der bisherige Windows-Speicherort. Die gerätelokale Datei `vault.json` dort merkt sich aktiven und gegebenenfalls angeforderten Vault-Pfad.

Darstellung, Fenstergeometrie, WebView-Profil, Modellartefakte und Google-Drive-Anmeldung werden beim Vault-Wechsel nicht in den Zielordner kopiert. Allgemeine Darstellungseinstellungen können separat durch einen bewusst ausgeführten Drive-Abgleich übertragen werden. Die Drive-Zugangsdaten liegen DPAPI-geschützt in `drive.credentials` im gerätelokalen Tauri-`app_data_dir`; sie sind von der Vault-Zeigerdatei im lokalen Datenverzeichnis getrennt.

Die Inhalte sind keine frei editierbare Sammlung von Markdown-Dateien. Journalinhalte liegen als SQLite-Daten vor; nur Zugangsdaten sind lokal gezielt mit DPAPI geschützt. Auf einem anderen Gerät müssen kopierte Mailkonten erneut angemeldet werden. Der Speicherortwechsel ersetzt keine [Gerätesynchronisierung](google-drive.md).

## Sichern und wieder öffnen

Für eine normale Dateisicherung Journal über das Tray-Menü vollständig **beenden**, dann den gesamten Vault-Ordner kopieren. Eine laufende SQLite-Datenbank nicht nur als einzelne Hauptdatei sichern und nicht gleichzeitig von mehreren Geräten bearbeiten. Ein Cloud-Dateiclient auf dem geöffneten Vault ist kein Ersatz für den eingebauten Abgleich.

Eine Sicherung wird über **Vault öffnen** wieder ausgewählt. Die App prüft Datenbank und Schema; beschädigte oder nicht unterstützte Datenbanken werden nicht still als neuer Vault geöffnet. Den alten AppData-Ordner erst löschen, wenn die Übernahme geprüft wurde; dort liegen auch weiterhin benötigte gerätelokale Dateien. Für mehrere unabhängige Journale separate Vaults verwenden.

## Updates in der App

**Einstellungen → Updates → Nach Updates suchen → Update herunterladen → Installieren und neu starten.** Die Suche erfolgt auf Knopfdruck. Vor der Installation werden ausstehende Inhalte und vaultbezogene Zustände gespeichert. Vault und Verbindungen bleiben beim Update erhalten; ein normales Versionsupdate verlangt keine erneute Einrichtung.

Quelle: `https://github.com/M10-Voxel/Journal-App/releases/latest/download/latest.json`. Die Release-Dateien sind öffentlich ohne GitHub-Anmeldung abrufbar. Tauri prüft die Dateisignatur und die darin authentifizierte Versionsnummer (`requireSignedVersion`). Die Windows-Installation erfolgt über NSIS im passiven Modus. Eine lose EXE kann Updates suchen/herunterladen; für das Einspielen wird ebenfalls der Installer verwendet.

Die Quellcode-Version ist eine Basisversion. Die installierte Version steht in der App; der aktuell veröffentlichte Stand unter [Releases](https://github.com/M10-Voxel/Journal-App/releases/latest). Neue Versionen können Datenbanken migrieren; ein beliebiges Zurückgehen auf ältere EXEs wird nicht garantiert.

## Automatische Veröffentlichung

Ein Push auf `Windows` startet **Windows builds**. Nach erfolgreichen Tests vergibt CI eine höhere Versionsnummer, baut EXE und Installer, signiert den Installer und lädt EXE, Installer, `.sig` und `latest.json` in ein Release. Ein manueller Workflow-Start auf `Windows` ist ebenfalls möglich. Für ein neues App-Update sind keine manuellen Versions-Commits oder Release-Klicks nötig.

Versionen werden nur im Runner gemeinsam in npm-, Cargo- und Tauri-Dateien gesetzt, nicht zurückcommittet. Bereits vergebene reguläre Versionen und Entwürfe werden berücksichtigt; eine bewusst erhöhte Basisversion gilt ebenfalls. Abgebrochene Läufe können Nummern auslassen.

Der Build-Job besitzt Repository-Leserechte. Ein eigener Veröffentlichungsjob erhält begrenzte Schreibrechte, prüft die Signatur erneut und vergleicht Größe und SHA-256 aller Uploads. Erst ein vollständiger Entwurf wird zum öffentlichen neuesten Release. Ein älterer Build darf keine bereits neuere Version ersetzen. Windows-Läufe werden zur Veröffentlichung nacheinander abgearbeitet; Release-Tags starten keine weitere Build-Schleife.

Die Actions-Secrets `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` sind eingerichtet. Sie werden nur dem Signierungsschritt vertrauenswürdiger Windows-Läufe übergeben und gehören weder in Quellcode noch in Artefakte/Logs. Der öffentliche Schlüssel bleibt in der App-Konfiguration, damit bisherige Installationen neue Updates akzeptieren.

## Actions-Downloads und spätere Android-Version

Unter **Actions → Windows builds → erfolgreicher Lauf → Artifacts** stehen EXE und Installer getrennt als ZIP, benannt nach Version und Commit. Diese Downloads benötigen eine GitHub-Anmeldung und bleiben 30 Tage verfügbar. Veröffentlichte Releases sind unabhängig davon dauerhaft abrufbar. Der Installer-Download eines signierten Builds enthält auch Signatur und Manifest.

Pull Requests mit Ziel `Windows` erzeugen ausschließlich unsignierte Test-Downloads. Andere Branches starten den Windows-Workflow nicht; ein manueller Start auf einem anderen Branch wird übersprungen. `Windows` ist fest gewählt und folgt nicht automatisch einem später geänderten Standardbranch.

Ein späterer `android`-Branch benötigt einen eigenen Android-Umbau, APK-Workflow und Android-Signierschlüssel. Solche Builds sind derzeit nicht eingerichtet. Für Android-Releases sind eigene Tags wie `android-v0.1.0` mit `make_latest: false` vorgesehen: Die derzeitige Windows-Adresse verwendet das globale „Latest“-Release, das ein Android-Release deshalb nicht ersetzen darf. Windows ignoriert diese Android-Tags bei der Versionsvergabe.

## Manuell signieren und Schlüssel sichern

In einer Windows-Entwicklungsumgebung kann `npm.cmd run release` weiterhin ein signiertes Paket unter `src-tauri/target/release/update/` erstellen; optional mit `-- -NotesFile DATEI.md`. Dieser Befehl veröffentlicht selbst nichts. Bei manueller Veröffentlichung müssen alle Versionsdateien zu einer noch nicht vergebenen höheren Version passen und EXE, Installer, Signatur sowie Manifest zum gebauten Commit gehören.

Der lokale private Schlüssel liegt passwortverschlüsselt in `.release-keys/journal-release.key`; das zugehörige Passwort ist mit dem Windows-Konto in `.release-keys/journal-release.password.dpapi` geschützt. Beide sind Git-ignoriert. Den verschlüsselten Schlüssel und das Passwort getrennt sicher sichern: Eine DPAPI-Datei allein lässt sich auf einem anderen Windows-Konto nicht entschlüsseln. Den privaten Schlüssel nicht einfach austauschen, da vorhandene Apps die neue Signatur sonst nicht akzeptieren.

Quellen und Implementierung: [Tauri Updater](https://v2.tauri.app/plugin/updater/), `.github/workflows/windows-build.yml`, `scripts/ci-release.mjs`, `scripts/build-release.ps1`, `scripts/verify-update.mjs`, `src-tauri/src/vault.rs`. Weitere Befehle und Testgrenzen: [Entwicklung](development.md).
