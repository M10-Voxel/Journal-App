# ICS-Import und -Export

Die Transfer-Aktion beim Kalender öffnet Import und Export über einen nativen Dateidialog. Kalenderdateien sind ein Austauschformat; SQLite bleibt der maßgebliche Speicher. Ein Import ist kein laufender Abgleich mit einem anderen Kalenderdienst.

## Import

Vor dem Speichern erscheint eine Vorschau. Unterstützt werden ganztägige und zeitgebundene Ereignisse sowie datierte Aufgaben, UTC, lokale Zeiten und IANA-Zeitzonen beziehungsweise eingebettete `VTIMEZONE`-Definitionen. Die Grenzen sind 5 MB Dateigröße und 5.000 importierte Einträge.

Gleiche Kalender-UIDs aktualisieren vorhandene Vorkommen. Andere Journalinhalte bleiben bestehen; bereits weitergeplante Einträge werden nicht einfach verschoben. Aus der Quelldatei entfernte Termine werden nicht automatisch lokal gelöscht.

Tägliche, wöchentliche, monatliche und jährliche `RRULE`s einschließlich `BYDAY`, `BYSETPOS`, `EXDATE` sowie `RDATE`-Mengen werden als Wiederholungszusammenhang übernommen. Der anfängliche Horizont reicht vom Vorjahr bis zum Ende des übernächsten Jahres; spätere Vorkommen werden bei Bedarf ergänzt. Eine kompakte Ursprungsregel bleibt für diese Erweiterung gespeichert. Eine bewusste Änderung in den Wiederholungsfeldern ersetzt sie durch die gewählte native Regel.

Ausnahmen mit `RECURRENCE-ID` behalten ihre abweichenden Daten/Uhrzeiten als eigenständige Einträge; das ursprüngliche Vorkommen wird ausgeschlossen. Stündliche und kleinere Wiederholungsintervalle werden nicht unterstützt. Die Vorschau nennt Umwandlungen und Grenzen.

Mehrtägige Ereignisse bleiben **ein Eintrag**. Bei ganztägigen Terminen ist `DTEND` exklusiv: Freitag bis Montag umfasst Freitag, Samstag und Sonntag. Zeitgebundene Spannen behalten ihre tatsächlichen Uhrzeiten und ihr Enddatum.

## Tags und Farben

`CATEGORIES` liefert den Tag-Namen; bei mehreren Kategorien wird die erste verwendet, weil ein Eintrag derzeit einen Tag besitzt. Als Rückfall dient `X-WR-CALNAME`. `COLOR` und verbreitete Kalender-/Apple-Erweiterungen liefern Hexwerte oder unterstützte Farbnamen, sonst wird Blau verwendet.

Vorhandene Tags werden unabhängig von Groß-/Kleinschreibung wiederverwendet und behalten ihre angepasste Farbe. Neue Tags und importierte Einträge werden gemeinsam gespeichert. Fehlende Kategorien entfernen eine vorhandene lokale Zuordnung nicht.

## Export

Exportiert werden Aufgaben und Ereignisse einschließlich reiner Kalendereinträge. Journal-Notizen, Tagestitel, Pinnwand-/Notizblockinhalte und Planungsspuren gehören nicht dazu. Journal-spezifische Zusatzfelder bewahren unter anderem Eintragsart, Sichtbarkeit, Status, Priorität und Erinnerung; andere Kalenderprogramme müssen diese Zusatzfelder nicht verstehen. Für Mailbeschreibungen wird die gespeicherte Textalternative exportiert, nicht die HTML-Vorschau.

**Wiederholungen werden beim Export derzeit als angelegte einzelne Vorkommen geschrieben.** Die ursprüngliche `RRULE` wird nicht rekonstruiert; der Export ist deshalb kein vollständiger Serien-Rundlauf. Mehrtägige Einträge erhalten ihr tatsächliches Start-/Enddatum.

Implementierung: `src/ical.ts`, `src/components/CalendarTransfer.tsx`, Importbefehle in `src-tauri/src/storage.rs`. Logiktests: `tests/ical.test.mjs`; Browserbereich `calendar`.
