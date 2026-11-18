# Roadmap J-TerminaL

Offene Aufgaben. Erledigtes mit `[x]` markieren. Vollständiger Plan: `docs/plan.md`.

- [x] **Stufe 0: Datenkern (im Branch `Windows`)** – erledigt am 18.11.2026, noch nicht committet. Beschreibung in `docs/journal-core.md` im Branch `Windows`.
  - `crates/journal-core` mit den Modulen `storage`, `history`, `sync` (Drive-Snapshot), `vault` (`app_data_folder`, `active_vault`) und `watch` (`Store::watch`, `Store::external_changes`). Die App nutzt den Kern, ihr Verhalten ist unverändert (63 Tests im Kern, 56 in der App grün).
  - Die Haupt-App erkennt Schreibvorgänge von außen (`src-tauri/src/external.rs`, jede Sekunde `PRAGMA data_version`). Sie übernimmt sie in den offenen Tag und speichert nach einem abgelehnten veralteten Stand von selbst erneut.
  - Drive-Sync geprüft: Er vergleicht ganze Snapshots, Änderungen bei geschlossener App kommen also beim nächsten Abgleich mit.
  - Die Historie ist gemeinsam: Strg+Z in der App nimmt auch J-TerminaL-Einträge zurück.
- [ ] **Stufe 1: Grundgerüst**
  - `j-terminal/` mit Hintergrundprozess, `global-hotkey` (`Strg+Alt+Leertaste`), nur einer Instanz und Autostart.
  - Slint-Fenster mit Eingabezeile im einen Design (`ui/theme.slint`).
  - Vault und Datenbank über `journal-core` öffnen, RAM messen.
- [ ] **Stufe 2: Eingabezeile**
  - Engine in Rust: Lückentext und Tab, Aufzählungen (`Mo` → Tab → `Di`), ▬/┆.
  - Anlegen über `journal-core`, Heute-Übersicht, Suche, Befehle (`>`).
  - `repeat.ts` und `repeatText.ts` der App nach Rust übertragen. Viele Unit-Tests.
- [ ] **Stufe 3: eingebettete Bedienelemente** – Mini-Kalender mit Bereich und der Wahl durchgehend `▬` / wiederholt `┆`, Uhr, Skala.
- [ ] **Stufe 4: Kalender mit neuer Oberfläche** – fasst die nächste Zeit zusammen, nur per Tastatur. Zuerst den Entwurf zeigen.
- [ ] **Stufe 5: Bewertung und Aktivitäten** – Skalen mit den Pfeiltasten, Aktivitäten starten/stoppen/nachtragen.
- [ ] **Stufe 6: Pinnwand per Tastatur** – in J-TerminaL. Die Kürzel für die Pinnwand der Haupt-App kommen im Branch `Windows` dazu. Später kommen mehr Funktionen, z. B. Karten verbinden.
- [ ] **Stufe 7: Anbindung und Release**
  - `Strg+Leertaste` in der Haupt-App (im Branch `Windows`).
  - Eigener Release-Workflow für diesen Branch mit eigener Versionsnummer.
  - „Made with Slint“-Logo auch in den Release-Notizen (in der README steht es schon).

## Offene Fragen
- keine
