---
type: "query"
date: "2026-10-31T22:37:20.494542+00:00"
question: "Auch wenn es mehr Arbeit ist, würde ich es wollen, einen richtigen Machine Learning Algorithmus dahinter zu packen, der es aus Kontexten erkennen kann. Ich möchte keine KI eingebaut haben im kompletten Nutzen der App."
contributor: "graphify"
outcome: "useful"
source_nodes: ["journal"]
---

# Q: Auch wenn es mehr Arbeit ist, würde ich es wollen, einen richtigen Machine Learning Algorithmus dahinter zu packen, der es aus Kontexten erkennen kann. Ich möchte keine KI eingebaut haben im kompletten Nutzen der App.

## Answer

Navigation expanded via graph vocabulary: calendar import journal. Existing journal save/merge remains the import path. Verified in current sources: src-tauri/src/mail/ml.rs runs pretrained GLiNER2.5 multilingual as an offline CPU child process of the app, initialized before Tauri and without opening journal/account databases. Pinned ONNX assets and runtime are installed only through Mail settings. src/mailMl.ts validates contextual model spans, normalizes dates using chrono-node, strips quoted history and creates reviewable proposals. src/mail.ts retains deterministic ICS/JSON-LD fast paths; no old keyword-based fallback for free text. useMailImport catches per-message model deferrals so structured messages still work while disabled. The rest of Journal never loads this model. Native worker tested with twelve synthetic German cases, including tomorrow at 17:00, multiple dates, split lines, delivery windows, cancellations, history and date-only delivery. Not a custom-trained private-mail model; real mailbox quality is not established. New code is not yet part of the existing graph.

## Outcome

- Signal: useful

## Source Nodes

- journal