# Journal

Ein erster, lokaler Windows-Prototyp mit Tauri 2, React, TypeScript und SQLite. Er verwendet keine Daten aus dem Obsidian-Vault. Es werden beim ersten Start keine persönlichen oder vorgefertigten Einträge importiert; Beispiele können selbst eingegeben werden.

## Umfang der ersten Etappe

- Tagesansicht mit Datumsnavigation, Titel und Aufgaben, Ereignissen und Notizen. Kompakte Seiten-, Werkzeug- und Statusleisten in den Clean-Farben; der frühere Bereich „Zusätzliches“ ist aus der Oberfläche entfernt.
- Ein Klick auf „Aufgabe“, „Notiz“ oder „Ereignis“ legt unmittelbar eine beschreibbare Zeile an. Ein Klick auf deren Symbol klappt eine Aktionsleiste direkt unter der Zeile auf. Aufgaben haben einen Statusschalter für offen, erledigt und abgebrochen; die Änderung greift sofort. Nur abgebrochene Aufgaben werden durchgestrichen. Einträge können entfernt werden. Speichern erfolgt ausdrücklich über **Speichern**; währenddessen kann ohne Fokusverlust weitergeschrieben werden, solche Änderungen bleiben als ungespeichert markiert. Ungespeicherte Änderungen werden beim Tagwechsel und beim Schließen abgefragt. Erledigte Aufgaben werden gedämpft, abgebrochene zusätzlich durchgestrichen dargestellt.
- Einträge sind fest als Ereignisse, Aufgaben und Notizen gruppiert. Innerhalb eines Typs lassen sie sich am Ziehgriff, mit Alt+↑/↓ direkt beim Schreiben oder über die Pfeile in der Aktionsleiste umordnen. Cursor und Textauswahl bleiben beim Verschieben im Text erhalten. Zwischen unterschiedlichen Typen ist mehr Abstand. Die Reihenfolge wird beim Speichern mitgesichert.
- Die Aktionsleiste zeigt deaktivierte Planungsplatzhalter mit „Demnächst“: Datum und mehrere Tage für Aufgaben und Ereignisse, zusätzlich „Morgen“ ausschließlich für Aufgaben.
- Die Datenbank liegt im lokalen Tauri-Anwendungsdatenverzeichnis, unter Windows normalerweise `%LOCALAPPDATA%\de.journal.local\journal.sqlite3`. Sie ist unabhängig vom Vault und diesem Repository.
- Noch keine Planung oder Verschiebung von Einträgen, kein Import, Backup, Kalender, Erinnerungen oder Synchronisierung. Diese frühe Version ist vorläufig für eigene Testdaten gedacht.

`Strg+S` speichert die Tagesnotiz. Benachbarte Tage und die angezeigte Woche werden im Leerlauf vorab geladen; der Wechsel dorthin erfolgt ohne Ladezustand. Eintragsaktionen lassen sich mit den Pfeiltasten bedienen und mit Escape schließen. Neue Einträge, Aktionsleisten und Statussymbole haben kurze Animationen; die Windows-Einstellung für reduzierte Bewegung wird berücksichtigt. Beim Schreiben bleiben Hintergrund und Fokus stabil.

Für einen ersten Test eignen sich beispielsweise der Titel „Ein ruhiger Tag“, die Aufgabe „Spaziergang machen“, das Ereignis „Kaffee um drei“ und die Notiz „Ein guter Gedanke“. Nach dem Hinzufügen **Speichern** wählen.

## Entwicklung unter Windows

Voraussetzungen: Node.js (für das installierte Vite mindestens 20.19 oder 22.12), npm, Rust/Cargo mit `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools mit Windows SDK und WebView2 Runtime. Siehe [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

In PowerShell im Projektordner:

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

`npm.cmd` umgeht eine gegebenenfalls für PowerShell-Skripte gesperrte Ausführung, ohne die Ausführungsrichtlinie zu ändern. Für den Frontend-Build: `npm.cmd run build`. Für die Rust-Datenbanktests: `cargo test --manifest-path src-tauri/Cargo.toml`.

Auf diesem Rechner wählt Cargo außerhalb einer Entwicklerumgebung derzeit eine unvollständige Community-Installation. Deshalb zunächst eine **Eingabeaufforderung** öffnen und die installierten Build Tools für diese Sitzung aktivieren:

```cmd
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
cd /d C:\Users\marvi\Privat\Programming\Journal-App
npm.cmd run tauri dev
```

Falls Cargo direkt nach der Rust-Installation nicht gefunden wird, die Eingabeaufforderung neu öffnen oder für diese Sitzung `set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"` ausführen. In derselben Entwicklerumgebung funktionieren auch die Test- und Build-Befehle.

Einen Windows-Installer erstellt `npm.cmd run tauri build`. Das NSIS-Bundle ist auf Deutsch und mit dem Offline-WebView2-Installer konfiguriert; für den ersten Build werden Paket- und Installer-Abhängigkeiten aus dem Netz benötigt. Die spätere Nutzung der App benötigt keine Internetverbindung. Der erste Build hat `src-tauri\target\release\bundle\nsis\Journal_0.1.0_x64-setup.exe` erzeugt; dieser Installer enthält noch den Stand vor der überarbeiteten Tagesansicht und wurde nicht manuell getestet.

## Architektur und Daten

`src/main.tsx` enthält das Anwendungsfenster; `src/components` enthält Eintragszeilen, Textdarstellung und gemeinsame Icons. `src/journal.ts` definiert die typisierte Verbindung zum Tauri-Backend und Datumsfunktionen. `src-tauri/src/storage.rs` verwaltet Validierung, Migration und SQLite-Transaktionen; `main.rs` bindet die Datenbank an Tauri. Die Schema-Version steht in SQLite `user_version`. Die Datenbank läuft im WAL-Modus; die Tauri-Befehle sind asynchron und blockieren das Fenster nicht. Eintragszeilen sind memoisiert, sodass beim Tippen nur die bearbeitete Zeile neu gerendert wird.

Tage werden durch ein lokales Kalenderdatum identifiziert, nicht durch UTC-Zeitstempel. Neue Einträge erhalten einmalig eine UUID; bestehende IDs und Typen werden validiert. Eine Revision verhindert, dass ein veralteter Stand eine neuere Speicherung überschreibt. Speichern ersetzt die Einträge des jeweiligen Tages innerhalb einer Transaktion. Das ist noch keine Konfliktstrategie für Synchronisierung: Vor deren Einführung müssen insbesondere Löschungen, Versionen und Konflikte explizit modelliert werden.

## Prüfungen

`npm.cmd test` prüft die feste Gruppierung und das Umordnen innerhalb eines Typs, einschließlich der Gruppengrenzen und unveränderter IDs und Statuswerte. Die sieben Rust-Tests decken Lesen und Speichern, Trennung von Tagen, stabile IDs, Löschen, ungültige Daten, Typänderungen, veraltete Schreibstände, das erneute Öffnen einer Datenbankdatei, gespeicherte Reihenfolgen sowie die Migration und Validierung der Aufgabenstatus ab.

Nach `npm.cmd run build` führt `npm.cmd run check:ui` unter Windows eine Browserprüfung mit dem installierten Edge aus. Sie verwendet die offizielle Tauri-IPC-Testanbindung und eigene Beispieldaten im Arbeitsspeicher. Geprüft werden direktes Schreiben ohne Fokusverlust, transparenter Zeilenhintergrund, Textumbruch bei verschiedenen Fensterbreiten, durchgehende Abbruchlinien, Tastaturbedienung der Menüs, Speichern per Strg+S ohne Fokusverlust, Tageswechsel aus dem Zwischenspeicher ohne Ladezustand, Datumswechsel und reduzierte Bewegung. Die echte SQLite-Datenbank wird dabei nicht geöffnet. Lokale Vorschaubilder liegen anschließend unter `src-tauri/target/ui-validation`. Diese Prüfung ersetzt keinen manuellen Test des nativen Fensters oder des Installers.

Der Release-Prozess wurde kurz gestartet und hat die leere Datenbank mit Schema-Version 1 im lokalen Anwendungsdatenverzeichnis angelegt. Die Oberfläche, die Schließen-Abfrage und ein Neustart mit über die Oberfläche gespeicherten Daten sind damit noch nicht manuell geprüft. Bei diesem Starttest verwendete Windows trotz einer für den Prozess gesetzten `LOCALAPPDATA`-Umgebungsvariable den regulären Benutzerordner.

Manueller Test nach einem erfolgreichen nativen Build: Für zwei verschiedene Tage unterschiedliche Testinhalte speichern, die Anwendung schließen und neu starten und beide Tage prüfen; anschließend Datumswechsel und Schließen mit ungespeicherten Änderungen, Tastaturfokus sowie Erledigen und Entfernen testen. Ein Fensterstart oder Installation sind nicht allein durch einen erfolgreichen Frontend-Build belegt.
