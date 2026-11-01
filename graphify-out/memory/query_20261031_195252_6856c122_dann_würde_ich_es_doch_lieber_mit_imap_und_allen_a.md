---
type: "query"
date: "2026-10-31T19:52:52.105699+00:00"
question: "Dann würde ich es doch lieber mit IMAP und allen anderen möglichen Verbindungs Optionen machen -> so wie in der Samsung Mail App, wo ich anbieter hinzufügen kann"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Store", "journal"]
---

# Q: Dann würde ich es doch lieber mit IMAP und allen anderen möglichen Verbindungs Optionen machen -> so wie in der Samsung Mail App, wo ich anbieter hinzufügen kann

## Answer

Navigation expanded using existing graph vocabulary: calendar import journal store. Existing import_calendar and the editor save/merge path are reused. New implementation verified directly in current files: src-tauri/src/mail/{mod,transport,oauth,secrets}.rs provides accounts in mail.sqlite3, DPAPI secrets, read-only IMAP and POP3, Gmail and Microsoft OAuth/PKCE APIs, and background polling. src/components/MailSettings.tsx supplies provider selection and editable calendar proposals; useMailImport.ts coordinates extraction with the existing import callback. src/mail.ts recognizes ICS, structured events/parcels and selected date text. Google/Microsoft require configured client registrations, Proton needs paid Bridge. 70 JS tests, 37 Rust tests, full synthetic browser checks and native Windows release build passed. Real mailbox authentication remains untested. The graph itself was not rebuilt.

## Outcome

- Signal: useful

## Source Nodes

- Store
- journal