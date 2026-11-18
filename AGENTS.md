# J-TerminaL

Eigenes Rust-Programm (Slint-Oberfläche) zum schnellen Eintragen und Nachsehen im Journal, nur per Tastatur. Plan: `docs/plan.md` · Aufgaben: `docs/roadmap.md`.

## Branches
- Dieser Branch `J-TerminaL` enthält **nur** J-TerminaL. Hier gibt es kein Tauri und kein React.
- Die Journal-App liegt im Branch `Windows`, lokal im Ordner `..\Journal-App`. Ihr Code darf zum Nachlesen benutzt werden, z. B. `src-tauri/src/storage.rs` oder `src/repeatText.ts`.
- **Nie zwischen den Branches mergen.** Gemeinsam ist nur der Datenkern `journal-core`. Er lebt im Branch `Windows` (`crates/journal-core`) und wird hier als Abhängigkeit eingebunden: lokal per Pfad `../Journal-App/crates/journal-core`, für Releases per Git vom Branch `Windows`.

## Arbeitsweise
- **Aufgaben stehen in `docs/roadmap.md`.** Punkt wählen, umsetzen, Kästchen auf `[x]` setzen, `docs/plan.md` aktualisieren, Tests ergänzen.
- Offene Fragen nicht eigenmächtig entscheiden – beim User nachfragen.
- Nicht committen/pushen, außer der User bittet darum.

## Konventionen
- UI-Texte deutsch, englische Übersetzung in der eigenen Texttabelle.
- **Bedienung:** alles vollständig per Tastatur, zusätzlich per Maus. Felder, Optionen und kompakte Aktionsflächen dürfen direkt anklickbar sein; keine zusätzlichen Buttonleisten. Die vollständige Mausbedienung ist in `docs/plan.md`, Abschnitt 0c, vorgemerkt. Hinweise nur beim Halten von `Strg`.
- Sofort da und sparsam: Ziel unter 20 MB RAM im Leerlauf, unter 50 ms bis zur Eingabe.
- Farben, Abstände und Schriften nur im Theme (`ui/theme.slint`), nie direkt in Bauteilen.
- Nie gegen echte Journal-Daten testen, nur gegen eine Test-Datenbank.
- Tests: `cargo test`.
