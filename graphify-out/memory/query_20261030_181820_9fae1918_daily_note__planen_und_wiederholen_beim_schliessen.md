---
type: "query"
date: "2026-10-30T18:18:20.268652+00:00"
question: "Daily Note: Planen und Wiederholen beim Schliessen zuruecksetzen und ihre Felder und Zurueck-Buttons angleichen."
contributor: "graphify"
outcome: "useful"
source_nodes: ["PlanCalendar()", "JournalEntry.tsx", "EntryActionDock.tsx"]
---

# Q: Daily Note: Planen und Wiederholen beim Schliessen zuruecksetzen und ihre Felder und Zurueck-Buttons angleichen.

## Answer

Expanded from original query via vocab: planner planning calendar dock close. The graph locates PlanCalendar in src/components/PlanCalendar.tsx and the action lifecycle in src/components/JournalEntry.tsx and src/components/EntryActionDock.tsx. Verified against current code: JournalEntry retains plannerView unless the requested action explicitly resets it. RepeatPanel and the end picker share clock-back; calendar.css composer button positioning previously overrode its absolute position.

## Outcome

- Signal: useful

## Source Nodes

- PlanCalendar()
- JournalEntry.tsx
- EntryActionDock.tsx