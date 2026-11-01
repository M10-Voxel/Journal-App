---
type: "query"
date: "2026-10-31T22:57:47.975590+00:00"
question: "Scheint erstmal zu funktionieren, nur die Range nicht. Also z.B. \"20:00 Uhr bis 20:15\" oder \"20 bis 21:20\" hat nicht funktioniert"
contributor: "graphify"
outcome: "useful"
source_nodes: ["journal"]
---

# Q: Scheint erstmal zu funktionieren, nur die Range nicht. Also z.B. "20:00 Uhr bis 20:15" oder "20 bis 21:20" hat nicht funktioniert

## Answer

Navigation tokens: calendar import journal. Direct current-source verification found src/mailMl.ts kept only the first ML time span, losing separately labeled range ends. GLiNER sometimes labels only the end or no clock for bare-hour ranges. completeTimeRanges now joins explicit written ranges anchored to model time spans, or an immediately adjacent date plus nearby event in the same sentence selected by ML. Numeric costs and alternatives do not become durations. Genuine outputs for eight additional range examples are stored in tests/fixtures/mail-ml-model-output.json. 78 JS tests, 20 real offline worker cases and a mail UI test through persisted calendar end time passed. Existing pending/accepted proposals are not retroactively changed; a fresh message uses the corrected recognition.

## Outcome

- Signal: useful

## Source Nodes

- journal