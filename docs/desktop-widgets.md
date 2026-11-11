# Desktop-Widgets unter Windows

Unter **Einstellungen → Desktop-Widgets → Widget hinzufügen** lassen sich Tagesnotizen und Kalender anlegen. Jedes Widget liegt innerhalb seiner Fläche über den Desktop-Symbolen und unter normalen Anwendungen. Es bleibt bei **Win+D** sichtbar und lässt sich mit Maus und Tastatur bearbeiten.

Die Verwaltung zeigt alle angelegten Widgets mit eigenem Namen, Sichtbarkeit und Positionssperre. Ein Widget lässt sich duplizieren, seine Position zurücksetzen oder entfernen. Das Entfernen löscht die Widget-Instanz; Notizen und Einträge bleiben erhalten. „Alle einblenden“ und „Alle ausblenden“ steuern die Gruppe. Über das Journal-Symbol im Infobereich sind Verwaltung und Gruppenumschaltung ebenfalls erreichbar.

Die Kopfzeile verschiebt das Widget, seine Ränder verändern die Größe. Die Pinnadel sperrt Position und Größe. Das Symbol zum Öffnen bringt den gewählten Tag in die Haupt-App; × blendet das Widget nach dem Speichern aus. Ein- und Ausblenden sowie die Einstellungen sind auch über das Journal-Symbol im Infobereich erreichbar.

Das Tagesnotiz-Widget bietet denselben Editor wie die App: Aufgaben, Ereignisse, Notizen, Tags, Symbole, Beschreibungen, Planung, Erinnerungen, Reihenfolge und Tastenkürzel. **Enter** übernimmt den Tag des bisherigen Eintrags, **Strg+Enter** erstellt einen Eintrag ohne Tag. Maus-Seitentasten wechseln zwischen zuvor angezeigten Tagen.

Jede Tagesnotiz hat eine eigene Tagesnavigation und einen eigenen Tag-Filter. Mehrere Widgets können verschiedene Tage anzeigen. Zeigen sie denselben Tag, werden Änderungen zwischen ihnen und der App synchronisiert. „Heute“ folgt dem Tageswechsel; mit den Pfeilen gewählte Tage bleiben geöffnet. Design, Pixel-Look, Farben, Sprache und Größe der Oberfläche folgen der App. Der Journal-Stil zeigt einen einzelnen Editor; Nebula verwendet seinen Terminalrahmen.

Das Kalender-Widget verwendet denselben Kalender wie die App mit **Jahr, Monat, Woche, Arbeitswoche und Tag**. Einträge lassen sich per Rechtsklick oder durch Markieren eines Bereichs mit gedrückter rechter Maustaste erstellen; bestehende Einträge können mit links verschoben und mit rechts bearbeitet oder gelöscht werden. Mehrtägige Einträge, Tags, Wiederholungen, Erinnerungen sowie ICS-Import und -Export stehen ebenfalls bereit. Der Eintragseditor und seine Auswahldialoge können über den Widget-Rand hinaus erscheinen. Die App verarbeitet Kalenderänderungen gemeinsam mit offenen Tagesnotizen, sodass ausstehende Texte vor Kalenderänderungen gesichert werden.

Jedes Kalender-Widget speichert seine Ansicht, das gewählte Datum sowie Eintrags- und Tag-Filter getrennt. „Heute“ folgt dem Tageswechsel; ein durch Navigation gewählter Zeitraum bleibt beim erneuten Öffnen erhalten. Beim Duplizieren werden diese Einstellungen vor dem ersten Anzeigen in die neue Instanz übernommen. Die Datumsnavigation und die Auswahl in der App bleiben unabhängig voneinander.

**Mit Windows starten** ist zunächst ausgeschaltet. Bei Aktivierung startet Journal mit `--background`, zeigt das Hauptfenster nicht und stellt aktivierte Widgets wieder her. Das Schließen des Hauptfensters lässt das Widget weiterlaufen. **Beenden** im Infobereich speichert alle Fenster und schließt die gesamte App.

## Daten und Fenster

- Jedes Widget hat eine stabile ID, einen Typ und einen eigenen Zustand. Tagesnotizen starten mit 600 × 600 logischen Pixeln, Mindestgröße 360 × 260. Kalender starten mit 980 × 720, Mindestgröße 480 × 360. Der Bildschirmarbeitsbereich begrenzt die Wiederherstellung.
- `desktop-widgets.json` enthält in Version 2 die Widget-Liste mit Namen, Sichtbarkeit, Sperren und eigenen Monitorpositionen; Autostart gilt für die gesamte Gruppe. Die alte Einzelkonfiguration wird mit identischer Position und Größe übernommen. Vor dem ersten Schreiben bleibt sie als `desktop-widgets.v1-backup.json` erhalten. Diese Geräteeinstellungen gehören nicht in den Vault oder Drive-Abgleich. Änderungen an Monitor, Auflösung und DPI werden berücksichtigt; fehlt der gespeicherte Monitor, wird der Hauptbildschirm verwendet.
- Der Windows-Host liegt in `src-tauri/src/desktop_widgets`. Jede Instanz nutzt ein Tauri/WebView2-Fenster mit dem Label `widget-<id>`, normaler Tastatureingabe und ohne Eintrag in Taskleiste/Alt+Tab. Die Fenster bleiben unter normalen Apps; Aktivieren hebt ein Widget nur über andere Widgets. Solange Explorer keine Desktopfläche bereitstellt, bleiben sie verborgen. Der Dienst stellt ausschließlich aktivierte Instanzen wieder her.
- `DayEditor` und `JournalEntry` rendern in App und Widget denselben Editor. Die dauerhaft geladene Haupt-WebView ist der gemeinsame Schreiber für Tagesnotizen. Das Widget überträgt Feldänderungen und stabile Eintrags-IDs über Tauri-Ereignisse. Es ersetzt keine vollständigen, möglicherweise veralteten Tage.
- Vor Undo/Redo, Kalenderänderungen, Abgleich, Vault-Wechsel und Beenden werden ausstehende Änderungen gespeichert. Nach einem Neuladen der Haupt-WebView verbindet sich das Widget erneut. Konflikte am selben Text zeigen den erhaltenen lokalen Entwurf an; erst die ausdrücklich beschriftete Aktion verwirft ihn.

Linux und Android haben noch keinen Desktop-Host. Der Windows-Host ist von Editor und Datenprotokoll getrennt, damit andere Plattformen später ihre eigene Einbindung bekommen können.

Weitere Widget-Typen werden in `desktop_widgets/config.rs` und `desktopWidgets.ts` beschrieben und in `DesktopWidgetWindow` auf ihren Inhalt abgebildet. `DesktopWidgetFrame` stellt Kopfzeile, Sperre, Einstellungen, Schließen und Randgriffe bereit. Die Verwaltung von IDs, Fenstern, Speicherpositionen, Wiederherstellung und Popup-Flächen gilt für alle Instanzen. `DesktopCalendarWidget` bindet den gemeinsamen `Calendar` mit eigenen Einstellungen und den Aktionen des Hauptfensters ein.

Schwebende Aktionsmenüs, Planer und Auswahldialoge liegen außerhalb des scrollenden Editors. Der Windows-Host bereitet vor dem Anzeigen eine feste transparente Zeichenfläche über den Desktop-Arbeitsbereichen vor. Beim Öffnen und Schließen ändert sich ausschließlich der native Fensterbereich, der das sichtbare Widget und die Popups umfasst. Dadurch bleiben Viewport, Editor und Position auch bei schnellen Klickfolgen unverändert; der Desktop dazwischen bleibt bedienbar. Verschieben und Größenänderungen nutzen Pointer-Capture auf dem sichtbaren Widget. Gespeichert wird dessen Position relativ zu seinem Monitor und dessen Größe, unabhängig von der Zeichenfläche.

## Prüfungen

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml --bin journal-app
npm run tauri -- build --debug --no-bundle
node scripts/verify-widget-native.mjs

# Mehrere native Instanzen, Migration, Synchronisierung, eigene Positionen, Duplizieren und Entfernen.
$env:JOURNAL_WIDGET_SCOPE = 'manager'
node scripts/verify-widget-native.mjs
Remove-Item Env:JOURNAL_WIDGET_SCOPE

# Kalenderansichten, native Popups, echte SQLite-Änderungen, eigene Einstellungen und Duplizieren.
$env:JOURNAL_WIDGET_SCOPE = 'calendar'
node scripts/verify-widget-native.mjs
Remove-Item Env:JOURNAL_WIDGET_SCOPE

# Popup außerhalb, schnelle Klickfolgen ohne verschobene Zwischenframes, nativer Eingabebereich und Größen-Griffe.
$env:JOURNAL_WIDGET_SCOPE = 'popups'
node scripts/verify-widget-native.mjs
Remove-Item Env:JOURNAL_WIDGET_SCOPE

# Zusätzlich echte Maus-/Tastatureingabe, Win+D und Fensterpositionierung.
# Benötigt einen entsperrten Windows-Desktop; stellt Fokus und Mausposition anschließend wieder her.
$env:JOURNAL_WIDGET_SHELL_CHECK = '1'
node scripts/verify-widget-native.mjs
```

Die native Prüfung legt unter `src-tauri/target/widget-native` einen markierten Testordner mit eigener SQLite-Datenbank und eigenem WebView-Profil an. Sie öffnet den Benutzer-Vault nicht und ändert den Windows-Autostart nicht. Screenshots und Ergebnisse bleiben dort zur Kontrolle liegen. Der Zugriff für die Teststeuerung ist nur in einem isolierten Debug-Build verfügbar; Release-Builds akzeptieren den Testmodus nicht.
