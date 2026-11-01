---
type: "query"
date: "2026-11-01T19:10:29.450450+00:00"
question: "Auswahl zwischen deutscher und englischer Anzeigesprache; Planungsvorschläge zuerst in der gewählten Sprache und nur ohne eigene Treffer in der anderen Sprache."
contributor: "graphify"
outcome: "useful"
source_nodes: ["SettingsDialog()", "dates.ts"]
---

# Q: Auswahl zwischen deutscher und englischer Anzeigesprache; Planungsvorschläge zuerst in der gewählten Sprache und nur ohne eigene Treffer in der anderen Sprache.

## Answer

Expanded graph vocabulary: SettingsDialog repeatText suggestions dates. Implemented local DE/EN setting with synchronous useSyncExternalStore-based updates, HTML lang, startup persistence, storage/events across windows, central application-owned translation catalogue src/locales/en.ts and cached locale-specific Intl formatters. Component-owned labels are translated at render time; user entry/mail text and typed repetition drafts are left untouched. Static menu metadata now uses getter functions so switching does not cache old labels. repeatText suggestions and completion use explicit/current preferred language, filter to matching preferred-language words before applying limits, and only fall back when none match; shared words are deduplicated. Parser grammar remains bilingual. English rule descriptions round-trip through the parser including pauses, month filters, weekdays, month-end and Easter. Native ui_language command persists the setting for startup tray labels, file dialogs and Windows reminder labels. 85 JS tests, 44 native tests and full browser suite passed, including language and pixel checks. Windows release build in progress. Graph not rebuilt.

## Outcome

- Signal: useful

## Source Nodes

- SettingsDialog()
- dates.ts