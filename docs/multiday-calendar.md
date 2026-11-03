# Mehrtägige Termine

Im oberen Bereich der Stundenansichten sowie in Monats- und Jahreszellen mit der linken Maustaste einen Bereich ziehen. Ein einfacher Klick behält die bestehende Navigation bzw. Erstellung ohne Uhrzeit bei. Am rechten/unteren Rand wird nach kurzer Verzögerung weitergeblättert; links zurück. Nach dem Loslassen lassen sich Startdatum, Enddatum und beide Uhrzeiten festlegen. Zeiträume bis zu 366 Tagen werden unterstützt.

Termine mit einer Dauer über 24 Stunden erscheinen in Stundenansichten als zusammenhängende Balken im oberen Bereich. Sie belegen keine Stundenblöcke. Die ursprünglichen Uhrzeiten bleiben gespeichert. Rechtsklick öffnet die Bearbeitung einschließlich Enddatum und Uhrzeiten.

SQLite-Version 12 erweitert die bestehende Endzeit-Kodierung: Stunden seit Mitternacht des Starttags, etwa `513:30` für 09:30 Uhr am 22. Tag. Startzeiten bleiben normale Uhrzeiten. Bestehende Datensätze, Verknüpfungen und Indizes werden bei der Migration erhalten. Zeitspannen werden numerisch validiert. Das vorhandene Sync-Format überträgt diese Spalte bereits; auf beteiligten Geräten wird die aktuelle App-Version benötigt. ICS exportiert das tatsächliche Enddatum; längere importierte Termine bleiben eine Einheit.
