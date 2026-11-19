# Datenkern `journal-core`

`crates/journal-core` enthält alles, was die Daten des Journals ausmacht. Er weiß nichts von Fenstern oder Tauri. Die App (`src-tauri`) nutzt ihn als Pfad-Abhängigkeit, ebenso das eigenständige Programm J-TerminaL (Branch `J-TerminaL`, siehe dessen `docs/plan.md`). So schreiben beide mit derselben Logik und denselben Migrationen in dieselbe Datenbank.

## Inhalt

| Modul | Aufgabe |
| --- | --- |
| `storage.rs`, `storage/` | Modelle, Schreiben, Lesen, Schema und Migrationen (`Store`) |
| `history.rs` | Rückgängig-Historie: `install`, `begin`, `step` (siehe [Rückgängig](undo-redo.md)) |
| `sync.rs` | Drive-Snapshot und das Übernehmen eines Snapshots (`sync_snapshot`, `sync_apply`) |
| `vault.rs` | Wo der Vault liegt: `vault.json` im App-Datenordner (`%LOCALAPPDATA%\de.journal.local`), `active_vault`, `validate` |
| `watch.rs` | Was andere Programme in dieselbe Datenbank geschrieben haben (`Store::watch`, `Store::external_changes`) |
| `timers.rs` | Aktivitäts-Timer in der Datenbank: Starten, Pausieren, Stoppen (in den Kalender), gemeinsam für alle Fenster und J-TerminaL |

Vault wählen, anlegen und umziehen bleibt in der App (`src-tauri/src/vault.rs`). Andere Programme folgen nur dem Zeiger. Ist der eingestellte Vault nicht erreichbar, melden sie einen Fehler und nehmen nie stillschweigend einen anderen.

Schema 15 ergänzt die Herkunft einer Zeitspanne: `Entry.time_grid`/`timeGrid` ist bei im Stundenraster gezogenen Bereichen wahr; traditionelle mehrtägige Einträge bleiben falsch. Der Standardwert der Migration erhält die vorhandene Darstellung. Die 66 Kern-Tests prüfen unter anderem Speicherung, Kalenderexport, Verschieben, geplante Kopien, Serienfortsetzung, Historie einschließlich alter Zeilen und das Übernehmen älterer Sync-Snapshots. J-TerminaL und Haupt-App benötigen denselben aktualisierten Kern.

## Aktivitäts-Timer (19.11.2026)

Die Timer lagen bisher im Browser-Speicher eines App-Fensters (`journal.activityTimers.v1`). Jetzt stehen sie in der Einstellung `activity-timers` als `{ "stamp": n, "timers": { "<Datum>:<Aktivität>": … } }`. Das Format eines Timers ist unverändert (`id`, `startedAt`, `elapsedMs`, `segments`, `tagId`).

- **Atomar:** `start_activity_timer`, `pause_activity_timer` und `stop_activity_timer` sind je eine Transaktion. Zwei Programme können sich die Timer also nicht überschreiben. Starten hakt die Aktivität in `period-data` ab. Ein laufender Timer bleibt beim erneuten Start unverändert.
- **Stoppen** macht, was die App-Komponente bisher selbst tat:
  - Die Abschnitte werden zu Kalendereinträgen mit dem Tag der Aktivität. Sie sind an lokaler Mitternacht geteilt und nach außen auf Minuten gerundet.
  - Die IDs sind wie bisher aus dem SHA-256 der Sitzung abgeleitet. Ein wiederholter Stopp aktualisiert also nur.
  - Der Tag wird angelegt oder umgefärbt, die Aktivität merkt sich ihn (`calendarTagId`), dann verschwindet der Timer.
  - Bei einem Fehler bleibt der Timer pausiert stehen.
- **Nicht in Historie und Drive-Sync:** Ein laufender Timer gehört zu diesem Rechner. `stamp` wächst mit jedem Schreiben. Daran erkennt `external_changes` Timer-Änderungen anderer Programme (`Changes::timers`), die App meldet sie als `timers:changed`.
- **Übernahme:** Beim ersten Laden übergibt jedes Fenster seine alten Timer aus dem Browser-Speicher einmalig (`adopt_activity_timers`) und löscht sie dort.
- **App:** `src/activityTimerStore.ts` liest über `load_activity_timers` und lädt bei `timers:changed` neu. `ActivityTimer.tsx` ruft die Befehle `start_/pause_/stop_activity_timer` auf (`src-tauri/src/main.rs`).

Neue Abhängigkeit des Kerns: `sha2` (für dieselben IDs wie bisher).

## Mehrere Programme auf einer Datenbank

Die Datenbank läuft im WAL-Modus mit `busy_timeout`. Die App und J-TerminaL können sie also gleichzeitig offen haben.

- **Erkennen:** `PRAGMA data_version` ändert sich nur, wenn eine *andere* Verbindung etwas festschreibt. Die App fragt das einmal pro Sekunde ab (`src-tauri/src/external.rs`), das ist eine Abfrage, solange nichts passiert.
- **Was sich geändert hat:** Das liest der Kern aus der Historie. Jeder Schreibvorgang legt dort eine Gruppe an, mit Tabelle und Zeile. So kennt die App die betroffenen Tage, Tags, Bewertungen/Aktivitäten (`period-data`) und Pinnwand-Daten. Die Aktivitäts-Timer stehen nicht in der Historie, sie werden an ihrem `stamp` erkannt. Ein Rückgängig oder Wiederherstellen in einem anderen Programm legt keine Gruppe an, verschiebt aber den Zeiger der Historie. Das gilt als „alles neu lesen“.
- **Melden:** Die App meldet die Änderungen mit denselben Ereignissen wie eigene Schreibvorgänge: `journal:changed`, `journal:tags`, `period:changed`, `timers:changed`, `board:reset` bzw. `history:restored`. Kalender, Suche, Widgets und der Drive-Sync reagieren darauf wie gewohnt. Der Drive-Sync vergleicht ganze Snapshots. Was bei geschlossener App geschrieben wurde, kommt also beim nächsten Abgleich mit.
- **Der offene Tag:** Zusätzlich bekommt das Hauptfenster `journal:external`. Betrifft es den gerade offenen Tag, werden die gespeicherten Einträge übernommen wie bei einem Import (`mergeCalendarImport`). Was dort gerade getippt wird, bleibt erhalten und wird danach mit der neuen Revision gespeichert. Speichert die App in der Sekunde, bevor sie den fremden Schreibvorgang bemerkt, lehnt die Datenbank den veralteten Stand ab. Die App übernimmt dann den fremden Stand und speichert von selbst erneut, ohne Fehlermeldung.

## Prüfen

- `cargo test --locked --manifest-path crates/journal-core/Cargo.toml`: Speicher, Migrationen, Historie, Snapshot, Vault-Zeiger, Änderungen von außen (zwei Verbindungen auf eine Datei)
- `JOURNAL_UI_SCOPE=external-writes node scripts/verify-ui.mjs` (nach `npx vite build`): offener Tag, ungespeichertes Tippen, abgelehnter veralteter Stand
