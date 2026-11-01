---
type: "query"
date: "2026-11-01T18:16:07.147184+00:00"
question: "Claude hat schon an diesen fünf Aufgaben gearbeitet. Gucke, was noch nicht fertig ist."
contributor: "graphify"
outcome: "useful"
source_nodes: ["ShortcutHelp()", "CalendarComposer()"]
---

# Q: Claude hat schon an diesen fünf Aufgaben gearbeitet. Gucke, was noch nicht fertig ist.

## Answer

Graph vocabulary: CalendarComposer RepeatPanel ShortcutHelp. Direct source and browser audit found all five requested implementations present: categorized searchable shortcut pages with key chips; calendar-only default first; persistent subtle repeat input styling; faded controls and editor-style completion list; drawing and persisting ranges across midnight. Fixed the selected shortcut category tab being unreachable by Tab. 81 JS tests, 43 native tests, calendar UI and complete browser UI suite passed. Overnight drawings are limited to 24 hours duration. Release build requested after UI completion to avoid dist mutation during browser validation.

## Outcome

- Signal: useful

## Source Nodes

- ShortcutHelp()
- CalendarComposer()