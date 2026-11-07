# Erste Schritte

## Installieren und starten

Die [aktuelle Windows-Version](https://github.com/M10-Voxel/Journal-App/releases/latest) enthält eine EXE zum direkten Start und einen NSIS-Installer. Der Installer bringt eine WebView2-Offlinelaufzeit mit. Für die lose EXE muss WebView2 bereits verfügbar sein. Journal verwendet für dieselbe Windows-Anmeldung denselben gewählten Speicherort, unabhängig davon, ob es direkt oder nach einer Installation gestartet wird.

Updates lassen sich unter **Einstellungen → Updates** suchen, herunterladen und installieren. Die App speichert vorher ausstehende Änderungen. Ein neues Update verlangt keine neue Einrichtung des Vaults oder der Verbindungen. Details: [Vault und Updates](vault-and-updates.md).

## Tagesnotizen und Kalender

Ein Tag enthält Titel, Aufgaben, Ereignisse und Notizen. Änderungen werden automatisch gespeichert; `Strg+S` speichert sofort. Aufgaben können offen, erledigt oder abgebrochen sein. Erledigte Aufgaben werden gedämpft, abgebrochene zusätzlich durchgestrichen. Priorität und farbige Tags helfen beim Ordnen.

Der Kalender bietet Jahr, Monat, Woche, Arbeitswoche und Tag. Stundenansichten öffnen bei 04:00 Uhr. Mit **rechter Maustaste ziehen** wird ein Termin gezeichnet; ein einfacher Linksklick auf eine freie Stundenfläche erstellt keinen Termin. Linksklick auf einen Eintrag öffnet seine Details, Rechtsklick seine Bearbeitung. Zeichnen, mehrtägige Balken, Kopieren und Serienaktionen erklärt [Mehrtägige Termine](multiday-calendar.md).

Ein Eintrag kann Aufgabe, Ereignis oder **nur im Kalender** sein. Letzteres ist beim Zeichnen voreingestellt und erscheint nicht in der Tagesnotiz. Einträge können Beschreibung, Uhrzeit, Erinnerung und Wiederholung erhalten. Wiederholungen unterstützen Tage, Wochen, Monate und Jahre, Wochentage, Intervalle, Pausen und ein Ende. Eingaben in Worten werden auf Deutsch und Englisch verstanden; Vorschläge bevorzugen die Anzeigesprache.

Ein Klick auf ein Datum im Kalender öffnet den Journaltag und schließt die geöffneten Kalender-/Notizansichten. Ein Klick außerhalb eines offenen Popups schließt zunächst nur das Popup.

## Notizen, Aktivitäten und Suche

- Der [Notizblock](notebook.md) verwaltet Zettel in Ordnern. Die [Pinnwand](bulletin-board.md) zeigt Zettel, Bilder und Links am jeweiligen Tag. Beide verwenden dieselben Notizen.
- Aktivitäten besitzen Checklisten und optional Zeiterfassung. Tagesbewertungen und Zeitraum-Notizen ergänzen Tag, Woche, Monat, Quartal und Jahr. Die Übersichten zeigen Häufigkeit beziehungsweise erfasste Zeit; ein Tag im Diagramm liefert Details.
- Die Suche (`Strg+F`) findet Journalinhalte und Notizen. Tags und Eintragstypen lassen sich über die angebotenen Filter eingrenzen.
- In Journal-Einträgen stehen Inline-Markdown und Textfarben zur Verfügung. Zettel bieten zusätzlich Überschriften, Listen, Checklisten, Tabellen und Codeblöcke.

## Darstellung und Bedienung

Unter **Einstellungen → Darstellung** stehen Normal, [Journal](journal-style.md) und [Nebula](nebula-style.md) zur Wahl. Pixel ist eine zusätzliche Option für Normal und Journal; Nebula hat eigene Schriften und eine feste Palette. Popups besitzen je Design [zwei Varianten](popup-styles.md). Die UI-Größe kann automatisch gewählt oder von 75 bis 200 Prozent eingestellt werden. Farben, Markdown-Farben, Sprache und Tags haben eigene Einstellungsbereiche; in Nebula bleibt die eigene Farbpalette maßgeblich.

Die Desktop-Eintragsaktionen können als Orbit oder eingebettete Leiste erscheinen. Die im Code vorhandene Wischvariante ist auf dem Desktop nicht als normale Option angeboten.

| Tastenkürzel | Aktion |
| --- | --- |
| `F1` | Durchsuchbare Tastenkürzelübersicht mit Kategorien |
| `Strg+,` | Einstellungen |
| `Alt+←` / `Alt+→`, `Alt+H` | Voriger/nächster Tag, heute |
| `Strg+G` | Datum auswählen |
| `Strg+1–5` | Tag, Woche, Monat, Quartal, Jahr |
| `Alt+A` / `Alt+E` / `Alt+N` | Aufgabe, Ereignis, Notiz anlegen |
| `Alt+T` / `Alt+W` / `Alt+G` | Planen, Wiederholen, Tag zuweisen |
| `Strg+Umschalt+N` | Notizblock öffnen/schließen |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederherstellen |

`F1` und die Hinweise an den Bedienelementen sind die vollständige Übersicht. In Textfeldern gelten zusätzlich die Editor-Tastenkürzel; [Rückgängig](undo-redo.md) berücksichtigt diesen Kontext.

Schließen über × blendet Journal nach dem Speichern in den Infobereich aus. Erinnerungen und eingerichteter Mailabruf laufen weiter. **Beenden** im Tray-Menü beendet die App vollständig; Erinnerungen benötigen die laufende App.

## Daten und optionale Verbindungen

Den Speicherort wählst du unter **Einstellungen → Speicherort**. Für eine Sicherung Journal vollständig beenden und den ganzen Vault-Ordner kopieren; SQLite-Dateien allein während des Betriebs zu kopieren kann bestätigte WAL-Daten auslassen.

[Google Drive](google-drive.md) gleicht Geräte manuell über dasselbe Google-Konto und denselben Geräteschlüssel ab. [E-Mail-Konten](mail-accounts.md) können Termine automatisch hinzufügen. Für die normale Nutzung von Journal ist weder eine Cloud-Anmeldung noch das lokale Mailmodell erforderlich.
