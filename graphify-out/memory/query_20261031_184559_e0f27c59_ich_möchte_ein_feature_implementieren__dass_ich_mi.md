---
type: "query"
date: "2026-10-31T18:45:59.128742+00:00"
question: "Ich möchte ein Feature implementieren, dass ich mit der App von einem Email Account, bestimmte Inhalte lesen kann und diese dann direkt in den Kalender eingetragen werden. Darunter zählt z.B. eine angekündigte Lieferung, also alles was ein Datum und/bzw. Uhrzeit hat. Was ist die beste Möglichkeit so ein Feature zu implementieren"
contributor: "graphify"
outcome: "useful"
source_nodes: ["CalendarImport", "journal", "Store", "ical.ts"]
---

# Q: Ich möchte ein Feature implementieren, dass ich mit der App von einem Email Account, bestimmte Inhalte lesen kann und diese dann direkt in den Kalender eingetragen werden. Darunter zählt z.B. eine angekündigte Lieferung, also alles was ein Datum und/bzw. Uhrzeit hat. Was ist die beste Möglichkeit so ein Feature zu implementieren

## Answer

Expanded from graph vocabulary: calendar import ical journal store. The graph identifies CalendarImport, journal.ts, ical.ts and Store. Current code verification: src-tauri/src/storage.rs import_calendar (line 98) atomically updates matching calendar_uid values and moves their dates; main.rs import_calendar (line 33) emits journal:changed; journal.ts importCalendar invalidates cached days. Entry.showInJournal supports calendar-only imports. Recommended future design: separate provider mail adapters and event extraction, preserve provenance, deduplicate deliveries by semantic delivery identity, and reuse or extend the existing transactional import path with conflict handling for user edits. No mail integration was implemented in this advice turn.

## Outcome

- Signal: useful

## Source Nodes

- CalendarImport
- journal
- Store
- ical.ts