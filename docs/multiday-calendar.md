# Kalender und mehrtägige Termine

## Anlegen und Bearbeiten

Neue Zeitbereiche werden mit **rechter Maustaste gezogen**. Das gilt für das Stundenraster, den oberen Bereich „ohne Zeit“ sowie Monats- und Jahreszellen. Ein einfacher Linksklick auf eine freie Stundenfläche erstellt keinen Eintrag. Ein Linksklick auf eine freie Tageszelle behält die Datumsnavigation bei. Mit der linken Maustaste können vorhandene Einträge verschoben oder per Auswahlrahmen gemeinsam ausgewählt werden.

Beim Zeichnen über Tagesgrenzen bleibt der Zusammenhang erhalten. Im oberen Bereich und in Monats-/Jahresrastern wird nahe dem Rand nach kurzer Verzögerung weitergeblättert, sodass auch mehrere Wochen markiert werden können. Nach dem Loslassen lassen sich Startdatum, Enddatum und beide Uhrzeiten festlegen. Unterstützt werden Zeitspannen bis zu 366 Tagen.

Voreingestellt ist **nur im Kalender**. Aufgabe und Ereignis sind die weiteren Eintragsarten. Beschreibungen, Tags, Erinnerungen und Wiederholungen werden im Editor bearbeitet. Ein Linksklick auf einen vorhandenen Eintrag öffnet die Detailkarte, ein Rechtsklick die Bearbeitung. Ein Klick außerhalb eines Popups schließt zunächst nur dieses Popup.

## Darstellung und Aktionen

- Stundenansichten öffnen bei 04:00 Uhr; frühere Stunden bleiben durch Scrollen erreichbar. **Strg+Mausrad** verändert den Stundenabstand und hält die Zeit unter dem Zeiger fest. Der Kalenderzoom ist unabhängig von der allgemeinen UI-Größe und wird lokal gemerkt. Die Ansicht „Tage“ (früher Tagesansicht) ist ein seitwärts scrollendes Band aus Tagen, davon 1–5 offen; Bedienung in [days-view.md](days-view.md). Dort behält das Band beim Verschieben seine Stunden, statt wieder bei 04:00 zu öffnen.
- Mehrtägige Ereignisse aus Tages-/Monatsflächen oder aus der Uhrzeiteingabe behalten ihren zusammenhängenden oberen Balken. Im Stundenraster gezogene Zeitspannen speichern dagegen `timeGrid: true` und laufen dort über alle betroffenen Tage: Mi 14 Uhr bis Fr 16 Uhr zeigt Mi 14–24, Do 0–24 und Fr 0–16 Uhr. Auch Vorschau, Randverschiebung und Bearbeitung einer Fortsetzung behalten den vollständigen Zeitraum und den Ursprungseintrag. Bestehende Einträge wechseln ihre Darstellung nicht.
- Monats- und Jahresansichten zeigen zusammenhängende Bereiche; kompakte Monatsansichten markieren die abgedeckten Tage. Fortsetzungen verweisen auf denselben Ursprungseintrag und erzeugen keine Datenkopien.
- **Entf** löscht den Eintrag unter der Maus beziehungsweise im geöffneten Detailkontext, wenn gerade kein Textfeld bearbeitet wird. Bei Serien oder verknüpften Vorkommen wird nach dem Löschumfang gefragt.
- **Strg+C** kopiert im Detail-/Bearbeitungskontext, **Strg+V** fügt am Tag unter der Maus ein. Bei Wiederholungen kann ein einzelnes Vorkommen oder die Wiederholungslogik übernommen werden; eine kleine Meldung bestätigt das Kopieren.
- Erledigte Aufgaben sind gedämpft, abgebrochene zusätzlich durchgestrichen. Tags färben die Einträge; Tage mit Journalinhalt erhalten eine dezente Kontur, in Stundenansichten im Datumsbereich.

## Speicherung

Die Endzeit kodiert Stunden seit Mitternacht des Starttags, etwa `513:30` für 09:30 Uhr am 22. Tag. Startzeiten bleiben normale Uhrzeiten. SQLite-Schema 12 unterstützt diese erweiterten Spannen; Validierung und Layout rechnen numerisch. Ein Ende genau um Mitternacht ist exklusiv und belegt nicht zusätzlich den folgenden Tag.

Schema 15 ergänzt `entries.time_grid`, im Datenaustausch `timeGrid`. Standard ist `false`; nur das Zeichnen im Stundenraster setzt das Merkmal. J-TerminaL und die Haupt-App verwenden denselben Kern und dieselbe Unterscheidung. Kopien, Serien, Historie und Sync erhalten das Merkmal. Beim Verschieben in einen Bereich ohne Uhrzeit wird es zurückgesetzt. Beide Programme benötigen eine Version mit diesem Datenkern.

[ICS](ics-import.md) exportiert das tatsächliche Enddatum; der Import behält mehrtägige Termine als Einheit. [Drive](sync-format-12.md) überträgt die gespeicherten Endzeiten. Auf beiden Geräten wird eine aktuelle App-Version benötigt.

Implementierung: `src/components/CalendarWindow.tsx`, `src/components/CalendarComposer.tsx`, `src/calendarSpans.ts`, `src/calendarClipboard.ts`. Browserprüfungen: `multiday`, `calendar-actions`, `calendar-drag`, `calendar-connected-spans`, `calendar-start`, `mail-view-zoom`.

ICS-Import und -Export sowie importierte Serienregeln werden in `src-tauri/src/calendar.rs` verarbeitet. Die Zeitspanne bleibt ein Eintrag; ein Export mit anschließendem Reimport wird in `tests/ical.test.mjs` geprüft.
