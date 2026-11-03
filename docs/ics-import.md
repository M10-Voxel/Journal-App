# ICS import

The import preview preserves daily, weekly, monthly and yearly RRULEs (including BYDAY/BYSETPOS and EXDATE), and RDATE sets. Expanded occurrences are linked in SQLite's existing series table. A compact original recurrence component stays in the rule JSON so future horizon extensions use the same pattern. Editing the recurrence controls explicitly replaces the imported rule with the app's selected native pattern. Reimport reuses the external UID and series identity.

Initial occurrences cover the previous year through two years ahead. Future dates are generated when needed. The preview reports this horizon. Exceptions with RECURRENCE-ID preserve their overridden date, time and text as standalone entries; their original occurrence is excluded from future generation. The preview discloses this. Hourly and smaller rules remain unsupported; expansion and file-size limits protect the app.

All-day multi-day events use their exclusive DTEND, so a Friday-to-Monday event covers Friday through Sunday as one span. Timed overnight and multi-day entries also stay one entry. Multi-day spans use the app's existing hours-since-start-day end format, preserving both actual clock times.

CATEGORIES supplies a tag name (first category because entries currently have one tag). Calendar-level X-WR-CALNAME is the fallback. COLOR and common Apple/calendar color extensions supply hex or supported named colors; absent color uses blue. Existing tags match case-insensitively and retain their customized color. New tags and all imported entries commit atomically together; views receive the updated tag list immediately. Missing categories never remove a local tag.
