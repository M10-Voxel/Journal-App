# Journal-App

Tauri + React/TypeScript Journal-App mit den Stilen klassisch, pixel und journal.
Backend: `src-tauri/src/*.rs` · Datenkern (Speicher, Schema, Historie, Sync, Vault; gemeinsam mit J-TerminaL): `crates/journal-core` · UI: `src/` · Feature-Notizen: `docs/*.md` · Tests: `tests/*.test.mjs` · UI-Prüfung: `scripts/verify-ui.mjs`.

## Arbeitsweise
- **Aufgaben stehen in `docs/roadmap.md`.** Punkt wählen, umsetzen, Kästchen auf `[x]` setzen, betroffene `docs/*.md` aktualisieren, Tests ergänzen.
- Offene Fragen am Ende der Roadmap nicht eigenmächtig entscheiden – beim User nachfragen.
- Nicht committen/pushen, außer der User bittet darum.

## Konventionen
- UI-Texte deutsch; Übersetzungen in `src/locales/en.ts`.
- Typecheck: `npx tsc --noEmit`; Tests: `npm test` (Node ≥ 20).
- Rust-Tests: `cargo test` mit `--manifest-path crates/journal-core/Cargo.toml` und `src-tauri/Cargo.toml`. Braucht die MSVC-Umgebung: in PowerShell `Enter-VsDevShell` mit den BuildTools unter `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` (der Community-Installation fehlen Header und Bibliotheken).
- J-TerminaL liegt im Branch `J-TerminaL` (Ordner `..\J-TerminaL`). Nie zwischen `Windows` und `J-TerminaL` mergen; geteilt wird nur `crates/journal-core`.
- UI-Prüfung: `npx vite build`, dann `JOURNAL_UI_SCOPE=journal node scripts/verify-ui.mjs` (braucht Edge unter `Program Files (x86)`; sonst Pfad `edge` in der Datei temporär auf Chrome setzen).
- Neue Felder in Datenbank/Sync-Format brauchen eine Migration; `docs/sync-format-12.md` prüfen.
- Design: Aufbau (`data-layout`), Optik (`data-look`), Popups (`data-popups`) und Pixel (`data-pixel`) sind getrennte Achsen (`src/designs.ts`, `docs/design-axes.md`). Neue Regeln für Standardteile gehören unter `[data-look]`, Struktur unter `[data-layout]`; kein `data-theme` mehr. Neue UI immer in allen drei Optiken prüfen (UI-Bereiche `popups`, `combos`).
- Fenster ohne Fokus gelten beim Start nicht als ruhend (`WindowActivity`): Einblend-Animationen dürfen nie bei Deckkraft 0 hängen bleiben.

## Release
`npm run tauri build` (Windows: MSVC-Toolset + Cargo im PATH nötig); danach die `.exe` bauen.
