# Graph Report - Journal-App  (2026-10-30)

## Corpus Check
- 66 files · ~55,327 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 599 nodes · 1513 edges · 17 communities (15 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.91)
- Token cost: host-agent usage not exposed; unmeasured (AST extraction uses no LLM).

## Community Hubs (Navigation)
- Rust storage and database
- Calendar components and navigation
- Calendar views and time grid
- Documentation and product concepts
- Settings and interaction hooks
- CodeMirror and text input
- Entry actions and focus
- Frontend package dependencies
- Browser verification and fixtures
- Planning and clock controls
- Tauri commands and windows
- Desktop application configuration
- ICS exchange and tests
- TypeScript compiler settings
- Window permissions
- Project metadata

## God Nodes (most connected - your core abstractions)
1. `Journal Windows application` - 55 edges
2. `Icon()` - 27 edges
3. `PlanCalendar()` - 24 edges
4. `react` - 24 edges
5. `Store` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Blue J on dark background: 128x128@2x.png` --semantically_similar_to--> `Blue J on dark background: icon-source.png`  [INFERRED] [semantically similar]
  src-tauri/icons/128x128@2x.png → icon-source.png
- `Blue J on dark background: 128x128.png` --semantically_similar_to--> `Blue J on dark background: icon-source.png`  [INFERRED] [semantically similar]
  src-tauri/icons/128x128.png → icon-source.png
- `Blue J on dark background: 32x32.png` --semantically_similar_to--> `Blue J on dark background: icon-source.png`  [INFERRED] [semantically similar]
  src-tauri/icons/32x32.png → icon-source.png

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Calendar interchange with retained Journal storage** — readme_ics_exchange, readme_sqlite, readme_calendar_uid, readme_atomic_calendar_import, readme_export_scope [EXTRACTED 1.00]
- **Safe daily persistence** — readme_autosave, readme_revision, readme_planning, readme_touched [EXTRACTED 1.00]

## Communities (17 total, 2 thin omitted)

### Community 0 - "Rust storage and database"
Cohesion: 0.10
Nodes (42): change_linked(), calendar_import_updates_uids_moves_dates_and_preserves_notes(), calendar_only_entries_survive_daily_saves_and_planning(), CalendarDay, CalendarImport, changes_reach_chosen_linked_entries_and_mark_their_days(), data_survives_closing_and_reopening_database(), Day (+34 more)

### Community 1 - "Calendar components and navigation"
Cohesion: 0.08
Nodes (54): CalendarItem(), CompactMonth(), move(), onKeyDown(), DayDots(), dayLabel(), EditInCalendar, entrySymbol() (+46 more)

### Community 2 - "Calendar views and time grid"
Cohesion: 0.08
Nodes (52): CalendarView, calendarViews, daysInMonth(), dayTitle, durationOf(), formatDuration(), formatMonthName(), formatWeekdayLong() (+44 more)

### Community 3 - "Documentation and product concepts"
Cohesion: 0.06
Nodes (45): Blue J on dark background: icon-source.png, Journal HTML bootstrap, Orbit inline and swipe actions, Kalender in der Seitenleiste, Nur im Kalender entry choice, Calendar UID identity, CodeMirror-6, Daily notes (+37 more)

### Community 4 - "Settings and interaction hooks"
Cohesion: 0.06
Nodes (39): CalendarWindow(), ActionLayout, EntryChange, entryLabels, layouts, Preview(), SettingsDialog(), shortcutGroups (+31 more)

### Community 5 - "CodeMirror and text input"
Cohesion: 0.07
Nodes (42): react, colorMarker(), colorValue, createEntryEditor(), EntryEditor, external, hidden, livePreview (+34 more)

### Community 6 - "Entry actions and focus"
Cohesion: 0.09
Nodes (43): ActionItem, EntryActionDock(), EntryPreview, kindActions, navigationKeys, onOrbit(), PlanUpdate, statusActions (+35 more)

### Community 7 - "Frontend package dependencies"
Cohesion: 0.06
Nodes (41): dependencies, @codemirror/commands@^6.11.1, @codemirror/state@^6.7.6, @codemirror/view@^6.43.15, @fontsource/ibm-plex-sans@^5.3.0, @fontsource/lilex@^5.3.0, ical.js@^2.2.1, react@^19.0.0 (+33 more)

### Community 8 - "Browser verification and fixtures"
Cohesion: 0.11
Nodes (25): artifacts, browser, checkCalendars(), closeDock(), command(), dist, dragRow(), edge (+17 more)

### Community 9 - "Planning and clock controls"
Cohesion: 0.15
Nodes (24): ClockDial(), onKey(), pick(), switchMode(), quickTimes, LinkedEntry, clockAngle(), ClockMode (+16 more)

### Community 10 - "Tauri commands and windows"
Cohesion: 0.17
Nodes (8): export_calendar(), import_calendar(), load_day(), load_linked(), load_range(), open_window(), save_day(), show_day()

### Community 11 - "Desktop application configuration"
Cohesion: 0.09
Nodes (21): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+13 more)

### Community 12 - "ICS exchange and tests"
Cohesion: 0.17
Nodes (11): RFC-5545, CalendarTransfer(), CalendarPreview, clock(), exportCalendar(), fold(), importCalendar(), localTime() (+3 more)

### Community 13 - "TypeScript compiler settings"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+8 more)

### Community 14 - "Window permissions"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

## Knowledge Gaps
- **14 isolated node(s):** `Journal HTML bootstrap`, `journal-app`, `RFC-5545`, `React`, `TypeScript` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 175 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Journal Windows application` connect `Documentation and product concepts` to `Rust storage and database`, `Calendar components and navigation`, `Calendar views and time grid`, `Settings and interaction hooks`, `CodeMirror and text input`, `Planning and clock controls`, `Tauri commands and windows`?**
  _High betweenness centrality (0.373) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `Journal Windows application` (e.g. with `Blue J on dark background: icon-source.png` and `Blue J on dark background: 128x128@2x.png`) actually correct?**
  _`Journal Windows application` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Journal HTML bootstrap`, `journal-app`, `RFC-5545` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._

## Update integrity and limitations
Updated 22 source files. Raw changed-source extraction: 122 dangling endpoints, 0 self-loops, 34 same-endpoint edge collapses. Changed-source references may resolve against unchanged graph nodes; graph.json is post-build. See update_health.json for both diagnostics.
Merged graph health: 0 dangling endpoints, 0 missing endpoints, 4 self-loops. The self-loops are retained and should be reviewed when interpreting the graph.
Cargo.toml yielded no AST symbols. CSS and binary icon formats are not parsed. Semantic token counts are not available from the host tooling; zeros in cost.json are placeholders.
`graphify-out/` is in the Git working tree and is not currently ignored.
