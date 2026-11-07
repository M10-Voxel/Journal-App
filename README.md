# Journal

Eine Windows-App für Tagesnotizen, Aufgaben und Kalender. Deine Daten werden lokal gespeichert; Google Drive lässt sich optional zur Synchronisierung verbinden.

## Download

- **[Aktuelle Version](https://github.com/M10-Voxel/Journal-App/releases/latest):** EXE zum direkten Start oder Windows-Installer.
- **[Entwicklungsbuilds](https://github.com/M10-Voxel/Journal-App/actions/workflows/windows-build.yml):** EXE und Installer unter „Artifacts“ des jeweiligen Laufs. GitHub-Anmeldung erforderlich; 30 Tage verfügbar.

Updates findest du in der App unter **Einstellungen → Updates**.
Pushes auf `Windows` veröffentlichen nach erfolgreichen Prüfungen automatisch ein signiertes Update.

## Funktionen

- Tagesnotizen mit Markdown, Aufgaben, Ereignissen und Erinnerungen.
- Kalender mit Wiederholungen, mehrtägigen Einträgen sowie ICS-Import und -Export.
- Notizblock und Pinnwand mit anheftbaren Notizen, Bildern und Links.
- Aktivitäten, Zeiterfassung und Tagesbewertungen.
- Farbige Tags, Filter, anpassbare Themes und optionaler Pixelstil.
- Deutsche und englische Oberfläche, Tastenkürzel und Rückgängig/Wiederherstellen.
- Optional: Google-Drive-Synchronisierung und lokale Erkennung von Terminen in E-Mails.

**F1** öffnet die Tastenkürzelübersicht. Den Speicherort deiner Daten wählst du unter **Einstellungen → Speicherort**.

## Entwicklung

Technik: **Tauri 2 / Rust**, **React / TypeScript** und **SQLite**.

Benötigt werden Windows, Node.js 24, Rust mit MSVC-Toolchain, Microsoft C++ Build Tools mit Windows SDK und WebView2. Siehe [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

Tests und Windows-Build in einer Entwicklerumgebung mit C++ Build Tools:

```powershell
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri build
```

EXE und Installer entstehen unter `src-tauri/target/release/` bzw. `src-tauri/target/release/bundle/nsis/`.

## Dokumentation

- [Vault, Updates und automatische Releases](docs/vault-and-updates.md)
- [Google Drive](docs/google-drive.md)
- [E-Mail-Konten](docs/mail-accounts.md) und [lokale Terminerkennung](docs/mail-context-ml.md)
- [Notizblock](docs/notebook.md) und [Pinnwand](docs/bulletin-board.md)
- [Kalenderimport](docs/ics-import.md) und [mehrtägige Einträge](docs/multiday-calendar.md)
- [Journal-Stil](docs/journal-style.md), [Nebula-Stil](docs/nebula-style.md) und [Popup-Stile](docs/popup-styles.md)
