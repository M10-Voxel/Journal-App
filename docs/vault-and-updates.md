# Vault-Ordner und Updates

## Speicherort

Einstellungen → **Speicherort**:

- **Vault öffnen**: einen Ordner mit `journal.sqlite3` auswählen.
- **Aktuellen Stand übernehmen…**: einen leeren Zielordner auswählen. Tage, Kalender, Wiederholungen, Aktivitäten, Tags, Notizen/Ordner, Pinnwand, Bilder und Mail-Daten werden kopiert.
- **Leeren Vault anlegen**: einen leeren Zielordner auswählen und unabhängig neu anfangen.

Nach Bestätigung speichert Journal ausstehende Änderungen aus allen Fenstern und startet neu. Die Kopie wird beim Neustart erstellt; der alte Vault bleibt erhalten. SQLite wird über die Backup-API gesichert, einschließlich bestätigter WAL-Transaktionen. Ein Fehler beim Erstellen behält den alten Vault bei und wird im Journal angezeigt. Ein fehlender externer Vault wird nicht automatisch durch einen leeren ersetzt; Journal bietet einen anderen vorhandenen Vault zur Auswahl an.

Ohne Auswahl bleibt der bisherige Speicherort `%LOCALAPPDATA%/de.journal.local` aktiv. Nur die gerätelokale Datei `vault.json` dort verweist auf den gewählten Ordner. Im Vault liegen `journal.sqlite3`, `mail.sqlite3`, `board-images/` und `journal.local.json`. Letztere speichert beim Wechsel laufende Timer, Filter, Notizauswahl und verschlüsselte Cloud-Vergleichsstände. Beim Zurückwechseln werden diese wiederhergestellt.

Design, Fensterlayout, WebView-Profil, Google-Drive-Anmeldung und das Mail-Modell bleiben gerätelokal. Mail-Zugangsdaten in `mail.sqlite3` sind durch Windows-DPAPI an das bisherige Windows-Konto gebunden und müssen auf einem anderen Gerät neu eingegeben werden. Der Vault ist **keine Sammlung von Markdown-Dateien**; Obsidian kann seine SQLite-Daten nicht direkt lesen. Der Speicherortwechsel ersetzt keine geräteübergreifende Synchronisierung. Einen geöffneten SQLite-Vault nicht gleichzeitig von mehreren Geräten bearbeiten.

## Updates verwenden

Einstellungen → **Updates** → **Nach Updates suchen** → **Update herunterladen** → **Installieren und neu starten**. Die Suche erfolgt nur auf Knopfdruck. Vor Installation werden ausstehende Daten gespeichert. Windows verwendet den NSIS-Installer und startet Journal danach wieder. Eine lose EXE kann ebenfalls suchen/herunterladen; die Installation erfolgt dann über den Installer. Eine schon installierte App ist der vorgesehene Weg für weitere Updates.

Quelle: `https://github.com/M10-Voxel/Journal-App/releases/latest/download/latest.json`. Die Assets müssen öffentlich ohne Anmeldung abrufbar sein. Es wird keine Anmeldung oder ein GitHub-Token in der App benötigt. Private Repositories benötigen eine andere öffentliche Downloadquelle.

Tauri prüft sowohl die Signatur der heruntergeladenen Datei als auch die darin authentifizierte Versionsnummer (`requireSignedVersion`). Der öffentliche Schlüssel steht in `src-tauri/tauri.conf.json`. Dokumentation: https://v2.tauri.app/plugin/updater/

## Automatische Updates aus Actions

Ein Push auf `Windows` startet den Workflow **Windows builds**. Nach erfolgreichen Tests erzeugt er automatisch eine höhere Versionsnummer, baut und signiert den Windows-Installer und veröffentlicht ein reguläres Release mit EXE, Installer, Signatur und `latest.json`. Auch ein manueller Workflow-Start auf `Windows` veröffentlicht ein Update. Pull Requests mit Ziel Windows erzeugen ausschließlich Test-Downloads. Pushes auf andere Branches starten diesen Windows-Workflow nicht; ein manueller Start auf einem anderen Branch wird übersprungen.

Die App verwendet weiterhin dieselbe öffentliche Release-Adresse. Für ein neues Update genügt jetzt ein normaler Code-Push auf `Windows`; Versionsnummern, Signieren und das Anlegen des Releases müssen nicht mehr manuell erledigt werden. Es wird kein GitHub-Zugang in der App benötigt.

Die Versionsnummer wird nur im Build-Verzeichnis des Runners in npm-, Cargo- und Tauri-Dateien gesetzt, nicht zurückcommittet. Sie ist höher als bereits vergebene reguläre Release- und Entwurfsversionen. Eine bewusst erhöhte Basisversion im Quellcode wird berücksichtigt. Abgebrochene Läufe können deshalb Lücken in den Versionsnummern hinterlassen.

Der Build-Job besitzt nur Leserechte am Repository. Der getrennte Veröffentlichungsjob erhält Schreibrechte, prüft erneut die Signatur und bestätigt nach jedem Upload Größe und SHA-256. Erst wenn alle vier Dateien vollständig vorliegen, wird der Release-Entwurf öffentlich zum neuesten Update. Neuere bereits veröffentlichte Versionen werden nicht durch ältere Builds ersetzt. Windows-Läufe werden nacheinander ausgeführt, damit ein Push keine laufende Veröffentlichung unterbricht. Tags erzeugen keine neue Build-Schleife.

Für die Signierung sind im Repository die Actions-Secrets `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` eingerichtet. Der Schlüssel stimmt mit dem öffentlichen Schlüssel der bisherigen App überein. Die Secret-Werte werden nur dem Signierungsschritt vertrauenswürdiger Windows-Läufe übergeben. Sie gehören niemals in Git, Artefakte oder Logs. Der lokale, verschlüsselte Schlüssel bleibt als Sicherung erhalten.

## Späterer Android-Branch

`Windows` bleibt der feste Zweig für Windows-Updates, unabhängig davon, welcher Branch auf GitHub als Standard eingestellt ist. Ein späterer `android`-Branch startet weder den Windows-Build noch dessen Veröffentlichung und kann keine Windows-Versionsnummer vergeben.

Mit dem Android-Umbau wird ein eigener Workflow für Android eingerichtet, der installierbare APKs als Actions-Downloads bereitstellt. Android benötigt eine eigene Android-Signierung; der vorhandene Tauri-Update-Schlüssel ist für Windows-Installer vorgesehen. Android-Builds sind derzeit noch nicht eingerichtet.

Für spätere Android-Releases sind getrennte Tags wie `android-v0.1.0` vorgesehen. Diese werden mit `make_latest: false` veröffentlicht und bekommen eigene APK-Dateien. Die derzeitige Windows-Updateadresse verwendet GitHubs globales „Latest“-Release; deshalb darf ein Android-Release diesen Zeiger oder die Windows-Datei `latest.json` nicht ersetzen. Windows ignoriert Android-Tags bei der Vergabe seiner Versionsnummern.

## Ein Update manuell bereitstellen

1. Eine höhere Version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` und `package.json` eintragen, zum Beispiel `0.1.1`. Lockfiles ebenfalls aktualisieren. Gleiche oder ältere Versionen werden nicht angeboten.
2. `npm run release` aus einer Windows-Entwicklungsumgebung mit Rust/MSVC ausführen. Optional: `npm run release -- -NotesFile RELEASE_NOTES.md`.
3. In GitHub ein öffentlich abrufbares Release mit passendem Tag (zum Beispiel `v0.1.1`) am gebauten Commit anlegen und die vier Dateien aus `src-tauri/target/release/update/` anhängen: EXE, Installer, `.sig`, `latest.json`. Zuerst als Entwurf hochladen und prüfen, dann als reguläres Release veröffentlichen, damit `/releases/latest/` darauf zeigt.

Der Release-Befehl erzeugt und signiert den Installer, erstellt das Manifest und veröffentlicht **nichts**. Normale schnelle Builds und normale Installer-Builds benötigen den Schlüssel nicht. Für CI können `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` aus geschützten Secrets gesetzt werden.

Der private Schlüssel liegt **passwortverschlüsselt** in `.release-keys/journal-release.key`; sein zufälliges Passwort ist in `.release-keys/journal-release.password.dpapi` durch das aktuelle Windows-Konto geschützt. `.release-keys/` ist Git-ignoriert. Den verschlüsselten Schlüssel und das zugehörige Passwort getrennt sicher sichern: die DPAPI-Datei allein ist auf einem anderen Windows-Konto nicht entschlüsselbar. Ein früher lokaler Erzeugungsversuch (`journal-updater.*`) wird nicht verwendet.

Um das Release-Passwort selbst in einem Passwortmanager zu sichern, kann es auf diesem Windows-Konto in PowerShell in die Zwischenablage kopiert werden (nicht in Logs oder Git einfügen):

```powershell
$secure = Get-Content .release-keys/journal-release.password.dpapi -Raw | ConvertTo-SecureString
$credential = New-Object System.Management.Automation.PSCredential('updater', $secure)
Set-Clipboard -Value $credential.GetNetworkCredential().Password
```

Der private Schlüssel muss bei zukünftigen Releases derselbe bleiben, damit bereits installierte Apps die Signatur weiterhin prüfen können.

## Downloads unter GitHub Actions

Der Workflow [Windows builds](../.github/workflows/windows-build.yml) läuft bei Pushes auf Windows, Pull Requests mit Ziel Windows und manuell über **Actions → Windows builds → Run workflow**. Er prüft Frontend und Backend und baut die EXE sowie den NSIS-Installer mit WebView2-Offlinelaufzeit. Unter **Artifacts** des erfolgreichen Laufs stehen beide Downloads getrennt als ZIP bereit, mit Version und Commit im Namen. Für diese Downloads ist eine GitHub-Anmeldung nötig; die Aufbewahrungszeit beträgt 30 Tage.

Erfolgreiche Windows-Builds werden zusätzlich automatisch als signierte Updates unter **Releases** veröffentlicht. Ihr Installer-Artefakt enthält auch die Signatur und `latest.json`. Pull Requests erhalten keinen Signierschlüssel und verändern die Updatequelle nicht. Andere Plattform-Branches werden von diesem Workflow nicht gebaut. Unter **Releases** bleiben veröffentlichte Versionen unabhängig von der Aufbewahrungszeit der Actions-Artefakte abrufbar.
