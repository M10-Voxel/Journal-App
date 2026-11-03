# Undo / Redo

Ctrl+Z und Ctrl+Y (alternativ Ctrl+Shift+Z) bedienen außerhalb von Textfeldern die gemeinsame Inhaltshistorie. In Textfeldern bleibt die vorhandene Editor-Historie aktiv. Ist ein Eintragsfeld bereits leer, entfernt Strg+Z den Eintrag; Strg+Y stellt ihn wieder her. Andere Einträge bleiben dabei unverändert.

Erfasst werden Journal-Tage, Einträge und Kalendertermine einschließlich verknüpfter Änderungen, Wiederholungen, Tags, Aktivitäten / Periodennotizen und Pinnwandkarten (Inhalt, Position, Größe und Bildreferenzen). Die letzten 100 Schreibaktionen bleiben lokal auch nach einem Neustart verfügbar. Die Historie selbst wird nicht synchronisiert. Kontenanmeldung, Zugangsdaten, Fensterzustand, Filter und Darstellungseinstellungen sind nicht Teil der Inhaltshistorie. Undo einer Synchronisierung ändert zunächst nur die lokalen Inhalte; ein weiterer Abgleich ist für andere Geräte nötig.

## Speicherung

`history::begin` wird innerhalb der jeweiligen SQLite-Schreibtransaktion aufgerufen. Temporäre SQLite-Trigger zeichnen pro betroffenem Datensatz dessen ersten Vorher- und letzten Nachherzustand auf. Die erste tatsächliche Änderung legt die Gruppe an; unveränderte Updates und Erinnerungspolling erhalten den Redo-Zweig. Fehler rollen Daten und Historie gemeinsam zurück. Keine vollständigen Datenbank- oder Bildkopien: Bilder bleiben über ihre bestehende Datei referenziert. `period-data` ist derzeit ein gemeinsamer JSON-Datensatz und wird entsprechend als eine Einheit protokolliert.

Beim Wiederherstellen werden abhängige Zeilen zuerst entfernt und Eltern vor Kindern wiederhergestellt; Fremdschlüssel werden beim Commit geprüft. Tagesrevisionen werden erhöht, um veraltete Schreibzugriffe zurückzuweisen. Vor Undo / Redo werden ausstehende Journaländerungen und die Pinnwand-/Periodenwarteschlangen aller Fenster gespeichert. Anschließend aktualisieren die Stores und Ansichten ihre Daten im bestehenden UI. Die Seite wird nicht neu geladen; Navigation, Scrollposition und bestehende Editor-Komponenten bleiben erhalten.

Neue Inhalts-Schreibwege müssen `history::begin` innerhalb ihrer Transaktion aufrufen. Neue Tabellen müssen explizit in `history::install` und bei Bedarf in die Wiederherstellungsreihenfolge aufgenommen werden. Bei zukünftigen inkompatiblen Schemamigrationen muss die lokale Historie migriert oder geleert werden.
