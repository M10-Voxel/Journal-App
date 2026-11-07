# Rückgängig und Wiederherstellen

**Strg+Z** und **Strg+Y** beziehungsweise **Strg+Umschalt+Z** bedienen außerhalb schreibender Textfelder die gemeinsame Inhaltshistorie. Im Editor bleibt zunächst dessen Text-Historie zuständig. Ist ein Eintragsfeld bereits leer, kann Strg+Z auch den Eintrag entfernen; Wiederherstellen legt ihn zurück. Andere Einträge bleiben erhalten.

## Umfang

Erfasst werden Journal-Tage, Einträge und Kalendertermine einschließlich verknüpfter Änderungen, Wiederholungen, Tags, Aktivitäten und Periodennotizen sowie Pinnwand-/Notizkarten und Ordner. Das umfasst Inhalt, Zuordnungen, Verbindungen, Position, Größe und Bildreferenzen. Die letzten **100 Inhalts-Schreibaktionen** bleiben lokal auch nach einem Neustart verfügbar.

Die Historie selbst wird nicht synchronisiert. Anmeldungen, Passwörter/Tokens, Mailabruf-Zwischenstände, Filter und allgemeine Darstellungseinstellungen gehören nicht zur SQLite-Inhaltshistorie. Einzelne Ansichten besitzen zusätzlich eine lokale Navigations-/Layout-Historie. Ein Undo nach einem Drive-Import ändert zunächst nur lokale Inhalte; andere Geräte sehen es erst nach einem weiteren Abgleich.

Vor einer Wiederherstellung werden ausstehende Journaländerungen sowie Pinnwand-/Periodenwarteschlangen der offenen Fenster gespeichert. Die Stores aktualisieren danach die vorhandenen Komponenten; die Seite wird nicht neu geladen. Navigation, Scrollposition und bestehende Editoren bleiben möglichst erhalten.

## Backend

`history::begin` läuft innerhalb der jeweiligen SQLite-Schreibtransaktion. Temporäre Trigger erfassen pro Datensatz den ersten Vorher- und letzten Nachherzustand einer Gruppe. Unveränderte Updates und Erinnerungspolling verbrauchen keinen Schritt und erhalten den Redo-Zweig. Fehler rollen Daten und Historie gemeinsam zurück.

Es entstehen keine vollständigen Datenbank-/Bildkopien. Bilddateien bleiben über ihre vorhandene Referenz erhalten; `period-data` ist ein gemeinsamer JSON-Datensatz und wird als Einheit protokolliert. Wiederherstellung beachtet Fremdschlüssel und erhöht Tagesrevisionen gegen veraltete Schreibzugriffe.

Neue Inhaltsschreibwege müssen `history::begin` in ihrer Transaktion aufrufen. Neue Tabellen oder Settings-Präfixe müssen in `history::install` und gegebenenfalls in die Wiederherstellungsreihenfolge aufgenommen werden. Inkompatible Schemamigrationen benötigen eine Anpassung oder Leerung der Historie.

Implementierung: `src-tauri/src/history.rs`, `src/components/UndoShortcuts.tsx`, `src/viewHistory.ts`. Browserbereich `undo`; siehe [Entwicklung](development.md).
