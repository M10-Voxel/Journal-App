---
type: "query"
date: "2026-10-31T23:20:04.733478+00:00"
question: "3 Änderungen. 1. Beim Kalender soll es immer um 4 Uhr anfangen. 2. Vorgeschlagene Einträge sollen immer eingetragen werden, aber es soll unten auch ein Popup kommen mit der Info. 3. Bei Kalendereinträgen soll man eine Beschreibung hinzufügen können."
contributor: "graphify"
outcome: "useful"
source_nodes: ["journal", "Entry", "Calendar"]
---

# Q: 3 Änderungen. 1. Beim Kalender soll es immer um 4 Uhr anfangen. 2. Vorgeschlagene Einträge sollen immer eingetragen werden, aber es soll unten auch ein Popup kommen mit der Info. 3. Bei Kalendereinträgen soll man eine Beschreibung hinzufügen können.

## Answer

Expanded navigation vocabulary: calendar import journal Entry. Verified current code: CalendarWindow.tsx initializes day/week scrolling at four times the current hour height, independent of entries. useMailImport.ts imports all latest pending candidates, including ML and existing UIDs, resolves them after successful writes and emits journal:mail-imported. MailImportToast.tsx shows the saved entries at the bottom in main/calendar windows for 12 seconds without taking focus. MailSettings no longer offers an auto-import opt-out. Entry.description is a separate optional TS/defaulted Rust string. SQLite schema 9 adds description, read/save/import/export and planned/repeating templates preserve it; linked edits propagate it. CalendarComposer provides a multiline textarea; Enter adds a line and Ctrl+Enter saves. ICS DESCRIPTION is now separate from SUMMARY, with backwards-compatible old Journal text handling. 78 JS tests and 42 Rust tests passed, including schema-8 migration/reopening; mail and calendar browser scopes passed. Windows release built. Full browser run is being completed; prior failures were timing and Sunday fixture assumptions in existing tests. Current new files are not part of the existing graph.

## Outcome

- Signal: useful

## Source Nodes

- journal
- Entry
- Calendar
Final validation: complete browser UI suite passed after dismissing the new mail confirmation before pointer tests. 78 JavaScript tests, 42 Rust tests, calendar/mail UI scopes and the Windows release build passed. Release: src-tauri/target/release/journal-app.exe. No real journal database or mail account was opened for these checks.
