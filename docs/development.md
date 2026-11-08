# Entwicklung und Prüfungen

## Voraussetzungen und Start

Der gepflegte Desktop-Zweig heißt `Windows`. Ein eigener Android-Zweig und APK-Workflow sind für später vorgesehen. Der vorhandene Windows-Workflow baut keine Android-App.

Benötigt werden Node.js 24 mit npm, aktuelles Rust Stable mit `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools mit Windows SDK und WebView2. Unter Windows eine Developer PowerShell beziehungsweise Developer Command Prompt der installierten C++ Build Tools verwenden, falls Cargo den Compiler nicht findet. Die [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/) erläutern die Systeminstallation.

Im Projektverzeichnis:

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

`npm.cmd` umgeht die PowerShell-Ausführungsrichtlinie für die gleichnamige npm-PS1-Datei, ohne die Richtlinie zu verändern. `npm.cmd run dev` startet nur Vite; für das native Backend ist `tauri dev` erforderlich. Auch die Entwicklungs-App verwendet reguläre App-Daten. Für manuelle Versuche einen eigenen Test-Vault verwenden.

## Befehle

| Befehl | Ergebnis |
| --- | --- |
| `npm.cmd test` | Frontend-/Logiktests und Tests der Release-Automatik |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Native Tests mit temporären Beispieldatenbanken |
| `npm.cmd run build` | TypeScript-Prüfung und Frontend in `dist/` |
| `npm.cmd run check:ui` | Browserprüfung des gebauten Frontends mit Edge und synthetischen Tauri-IPC-Daten |
| `npm.cmd run tauri build -- --no-bundle` | Release-EXE ohne Installer |
| `npm.cmd run tauri build` | Release-EXE und NSIS-Installer mit WebView2-Offlinelaufzeit |
| `npm.cmd run release` | Lokal signiertes Updatepaket; veröffentlicht selbst nichts |

Die EXE liegt unter `src-tauri/target/release/journal-app.exe`, der Installer unter `src-tauri/target/release/bundle/nsis/`. Ein erstmaliger Build lädt Compiler-/Paket- und Bundler-Abhängigkeiten herunter. Normale EXE-/Installer-Builds benötigen keinen privaten Update-Schlüssel.

Die vollständige Browserprüfung benötigt vorher `npm.cmd run build`. `period-boards` prüft die Monats-/Jahrespinnwände einschließlich Gruppenübernahme und eigenständiger Positionen in sechs Theme-Varianten. Ein gezielter Bereich wird in PowerShell so geprüft:

```powershell
$env:JOURNAL_UI_SCOPE = 'notebook'
npm.cmd run check:ui
Remove-Item Env:JOURNAL_UI_SCOPE
```

Für eine vollständige Browserprüfung darf `JOURNAL_UI_SCOPE` nicht gesetzt sein. Die vorhandenen Bereiche stehen in `scripts/verify-ui.mjs`; Beispiele sind `calendar-actions`, `multiday`, `journal-grid`, `nebula-sizing`, `drive`, `undo`, `vault-updates`, `startup-notices`, `mail`, `popup-dismissal`, `mail-header-themes` und `activity-sizes`. `startup-notices` prüft die einmalige Update-Suche, verspätete Antworten, Offline-Starts und Meldungen in allen Themes. `mail` prüft die manuelle Vorschlagsprüfung und den Schalter zur automatischen Übernahme. Screenshots und Berichte landen unter `src-tauri/target/`.

Browser-Mocks prüfen weder echte Anbieteranmeldungen noch eine native Installation. Ein erfolgreicher Vite-Build allein belegt keinen erfolgreichen Rust-Build. Live-ML-Prüfungen benötigen zusätzlich die festgelegten Modellartefakte; siehe [Mail-Erkennung](mail-context-ml.md). Funktionsprüfungen sind keine RAM-/CPU-Messung, siehe [Ressourcenverwaltung](performance.md).

## Aufbau

| Bereich | Einstieg |
| --- | --- |
| Fenster, Navigation, Tagesdaten | `src/main.tsx`, `src/bootstrap.ts`, `src/journal.ts` |
| Kalender und Planung | `src/components/CalendarWindow.tsx`, `CalendarComposer.tsx`, `src/calendar.ts`, `src/repeat.ts`, `src/ical.ts` |
| Buch und Nebula-Layout | `src/components/JournalBook.tsx`, `NebulaDesk.tsx`, `src/book.ts`, `src/nebulaLayout.ts` |
| Aktivitäten und Pinnwand | `src/periodStore.ts`, `src/boardCards.tsx`, `src/components/BulletinBoard.tsx` |
| Notizblock | `src/components/Notebook.tsx`, `src/notebook.ts` |
| Mail-Erkennung | `src/mail.ts`, `src/mailMl.ts`, `src/mailContext.ts`, `src-tauri/src/mail/` |
| Drive und Zusammenführung | `src/components/DriveSettings.tsx`, `src/sync/`, `src-tauri/src/drive.rs` |
| Datenbank, Vault, Historie | `src-tauri/src/storage.rs` (Modelle/Schreiben), `src-tauri/src/storage/schema.rs` (Öffnen/Migrationen), `src-tauri/src/storage/read.rs` (Lesen/Aktivitätssummen), `vault.rs`, `history.rs` |
| Darstellung | `src/settings.ts`, `src/colors.ts`, `src/i18n.ts`, Theme-CSS |

Das Frontend spricht über typisierte Tauri-Aufrufe mit dem Rust-Backend. SQLite ist maßgeblich für Inhalte; `localStorage` hält ergänzende UI-/Vergleichszustände. Journal-Schema 12 und Drive-Paketformat 13 sind unterschiedliche Versionsnummern. Inhalte sind keine frei bearbeitbare Sammlung von Markdown-Dateien. Neue inhaltliche SQLite-Schreibwege müssen die [Historie](undo-redo.md) und gegebenenfalls den [Drive-Snapshot](sync-format-12.md) berücksichtigen.

Aktivitätssummen werden über `load_activity_minutes` als kleine Rust/SQLite-Projektion geladen; die Wiederholungshorizonte werden vorher wie beim Kalender erweitert. `src/refreshQueue.ts` bündelt konkurrierende Aktualisierungen pro Ansicht, ohne Daten über Änderungen hinweg zwischenzuspeichern. Messgrenzen, Regressionen und weitere Ansatzpunkte stehen unter [Ressourcenverwaltung](performance.md).

## Builds, Versionen und Veröffentlichung

Ein Push auf `Windows` startet Tests, einen signierten Build und danach einen getrennten Veröffentlichungsjob. Pull Requests mit Ziel `Windows` erzeugen Test-Downloads; andere Branches werden vom Windows-Workflow nicht gebaut. Details und die Regeln für einen späteren Android-Kanal stehen unter [Vault und Updates](vault-and-updates.md).

Die Version im Quellcode ist eine Basisversion. CI erzeugt im Runner eine höhere Version aus den bereits vergebenen Release-/Entwurfsversionen und setzt npm-, Cargo- und Tauri-Dateien gemeinsam. Diese Änderung wird nicht zurückcommittet. Die installierte Versionsnummer steht in der App und beim jeweiligen Release.

`scripts/ci-release.mjs` bereitet Version und Downloads vor und veröffentlicht erst nach Signatur- und Upload-Prüfung. `scripts/build-release.ps1` erstellt das signierte Paket; `scripts/verify-update.mjs` prüft es gegen den öffentlichen App-Schlüssel. Die zwei Actions-Secrets sind nur im Signierungsschritt vertrauenswürdiger Windows-Läufe eingebunden. Private Schlüssel, Passwörter, Vault-Daten, `dist/` und `src-tauri/target/` gehören nicht ins Repository.

Reine Dokumentations-Commits können mit `[skip ci]` im Committext hochgeladen werden, um kein neues App-Update auszulösen. Neue Dokumente in der Dokumentationsübersicht und der kurzen Projekt-README verlinken; historische Release-Notizen als Archiv behandeln.
