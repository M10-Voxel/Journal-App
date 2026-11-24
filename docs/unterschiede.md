# Unterschiede zwischen Journal-App und J-TerminaL

Stand: 24.11.2026. Verglichen wurden der Branch `Windows` (Journal-App) und der Branch `J-TerminaL`. Die Liste hält nur fest, wo sich die beiden unterscheiden. Sie enthält keine Aufgaben und keine Entscheidung, was angeglichen werden soll.

Die Angaben zum Terminal stammen aus einer Stichwortsuche im Quellcode, nicht aus dem Lesen jeder Datei. Punkte mit „teilweise" oder „nicht gefunden" sind weniger sicher.

## Nur in der Journal-App

### Ansichten und Auswertung
- Wochen-, Monats-, Quartals- und Jahresansicht. Das Terminal hat die Tagesansicht, die Zeitraum-Pinnwände über Befehle und die Auswertung der Zeiträume (`/Auswertung`).
- Zeitraum-Notiz, Zeitraum-Bewertung, Zeitraum-Werte und Zeitraum-Checkliste.
- Zeitraum-Einträge (eigene Liste mit Aufgaben und Notizen je Zeitraum).
- Verwaltung der Aktivitäten und Werte: Definitionen, Skalen, Farbstufen mit Min–Max-Zeit, Palette.
- Funktionen-Schalter (`FeatureSettings`): Ansichten und ihre Bereiche einzeln ein- und ausschalten.

### Daten rein und raus
- ICS-Import und -Export (`CalendarTransfer`). Im Terminal nicht gefunden.
- Google-Drive-Synchronisierung (`DriveSettings`).
- Speicherort-Wechsel und Vault (`StorageSettings`). Das Terminal liest nur die vorhandene Datenbank.
- Update-Meldung und Update-Einstellungen (`UpdateNotice`, `UpdateSettings`).
- E-Mail-Anbindung: Konten, OAuth, Termin-Erkennung, lokales Lernen, Import-Hinweis (`MailSettings`, `MailLearningSettings`, `MailImportToast`). Das Terminal zeigt nur gespeicherte Mail-Vorschauen.

### Darstellung
- Design-Achsen: Aufbau (Normal, Buch, Desk), Optik (Journal, Nebula, Pixel …), Popup-Stile, UI-Skalierung, freie Farbeinstellungen (`ColorSettings`). Das Terminal hat ein festes Theme in `ui/theme.slint`.
- Desktop-Widgets für Kalender, Einträge, Notizblock, Zeitraum und Pinnwand mit Einstellungen und Live-Blur. Im Terminal gibt es nur den Autostart.
- Abgelöste Panels (`DetachedPanel`) und Buch-Ansicht (`JournalBook`).

### Einzelne Funktionen
- Einträge im Kalender per Drag verschieben (`useEntryDrag`). Die Roadmap des Terminals führt das als offen.
- Kalender-Zwischenablage und -Auswahl: Kopieren und Einfügen von Einträgen (`calendarClipboard`, `calendarSelection`).
- Tag-Verwaltung als eigene Einstellungsseite und Tag-Gruppen (`TagSettings`, `tagGroups`). Im Terminal gibt es Auswahl, Anlegen und Löschen.
- Tag-Filter-Leiste (`TagFilter`). Im Terminal gibt es `\Tag` in der Suche.
- Globale Tastenkürzelübersicht (`ShortcutHelp`) mit Kürzeln der App. Das Terminal hat eigene Kürzel auf F1.
- Rechtsklick-Menüs der App (Textmenü, Eintragsaktionen). Das Terminal hat Strg+K.

## Nur in J-TerminaL
- Vorlagen (`/Vorlage`, `#Name`) mit Lücken im Titel. Sie werden in `j-terminal-templates.json` gespeichert.
- Erinnerungen ohne laufende Journal-App (Karten unten rechts, Autostart im Hintergrund).
- Suchleiste mit Befehlen, Tastatur-Menü auf Strg+K und Schnellfenster per globalem Kürzel.
- Eigenständige Installation und eigener Release-Ablauf.

## Teilweise vorhanden
- **Auswertung:** dieselben Graphen wie in der App (Verlauf, Aktivitäten-Balken, -Kalender und -Heatmap), im Terminal als eigene Ansicht über das ganze Fenster mit wählbarem Zeitraum. Ausgeblendete Reihen merkt sich jedes Programm selbst, und die Einstellung „Funktionen“ der App gilt im Terminal nicht.
- **Aktivitäten und Timer:** Das Terminal zeigt sie in der Tagesansicht und liest `journal_core::timers`. Laufende Timer liegen laut `day_view.rs` im Browser-Speicher der App. Das Terminal sieht sie nur über den gemeinsamen Datenkern. In der Roadmap ist das eine offene Frage.
- **Wiederholungen:** Beide Programme haben sie, mit Löschumfang und Rückgängig. Die App rechnet über `ical.js`, das Terminal mit einer eigenen Rust-Umsetzung (`repeat/`). Ob beide in allen Fällen gleich rechnen, ist nicht geprüft.
- **Pinnwand:** Weitgehend gleich, mit Handschrift, Fäden, Gruppen und Ordnern. Die Abnahme am physischen Stift ist im Terminal offen.

## Gleichwertig
Eintragsformular, Kalender, Tagesansicht mit Bewertung und Werten, Notizblock mit Ordnern, Tags und Symbole, Suche, Rückgängig/Wiederherstellen, Deutsch/Englisch.
