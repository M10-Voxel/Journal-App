---
type: "query"
date: "2026-11-01T00:15:00.933161+00:00"
question: "Wenn ich die Ansicht öffne startet es immer noch bei 00:00 statt 04:00."
contributor: "graphify"
outcome: "corrected"
correction: "Initialize and retain the intended start hour through measurement and async layout changes; do not preserve a scrollTop that was clamped to zero by the temporary grid dimensions."
source_nodes: ["TimeGrid()", "Calendar"]
---

# Q: Wenn ich die Ansicht öffne startet es immer noch bei 00:00 statt 04:00.

## Answer

Navigation tokens: Calendar TimeGrid. Prior one-shot scrollTop=4*hourHeight was insufficient. Reproduced before the fix in a fresh 2160px workweek window: the initial 48px grid fit the viewport, clamping scrollTop to zero; ResizeObserver then preserved zero while enlarging hours. Current TimeGrid keeps a pending 04:00 anchor until the final grid can scroll, retries when layout becomes measurable, and rounds hour height upwards so 20 visible hours fit. CSS overflow-anchor:none prevents async all-day entries from moving the chosen hour. A new browser regression opens fresh day/week/workweek at tall size, checks 04:00, preserves manual 02:00 when shrinking, then checks reset to 04:00 after date navigation. This test failed before and passes after. Existing calendar browser scope including the new regression passed; Windows release built at src-tauri/target/release/journal-app.exe. A transient combined-test failure was caused by rebuilding dist concurrently with the test server, so build and UI validation were then serialized.

## Outcome

- Signal: corrected
- Correction: Initialize and retain the intended start hour through measurement and async layout changes; do not preserve a scrollTop that was clamped to zero by the temporary grid dimensions.

## Source Nodes

- TimeGrid()
- Calendar