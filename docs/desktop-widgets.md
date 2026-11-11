# Desktop-Widgets unter Windows

Unter **Einstellungen → Desktop-Widgets → Widget hinzufügen** lassen sich Tagesnotizen, Kalender, Pinnwände, Tageswerte, Aktivitäten und Notizen anlegen. Jedes Widget liegt innerhalb seiner Fläche über den Desktop-Symbolen und unter normalen Anwendungen. Es bleibt bei **Win+D** sichtbar und lässt sich mit Maus und Tastatur bearbeiten.

Die Verwaltung zeigt alle angelegten Widgets mit eigenem Namen, Sichtbarkeit und Positionssperre. Ein Widget lässt sich duplizieren, seine Position zurücksetzen oder entfernen. Das Entfernen löscht die Widget-Instanz; Notizen und Einträge bleiben erhalten. „Alle einblenden“ und „Alle ausblenden“ steuern die Gruppe. Über das Journal-Symbol im Infobereich sind Verwaltung und Gruppenumschaltung ebenfalls erreichbar.

Widgets sind bewusst ruhiger gestaltet als die App.
- **Kopfzeile:** Sie enthält nur die Navigation und den Knopf **In Journal öffnen**. Bei der Tagesnotiz sind das Zurück, Heute, Weiter und das Datum mit Kalenderauswahl; beim Kalender Zurück, Heute, Weiter, der Titel des Zeitraums (Monat, Jahr, Woche) und die Ansichten Jahr bis Tag. Wird die Kopfzeile schmal, kürzen sich die Ansichten zu „Mo–Fr“ und dann zu J M W A T.
- **Öffnen-Knopf:** Er lässt sich je Widget in der Verwaltung ausschalten.
- **Bewegen und Größe:** Der freie Teil der Kopfzeile verschiebt das Widget, die Ränder verändern die Größe.
- **Rechtsklick auf die Kopfzeile:** öffnet die Einstellungen, sperrt Position und Größe oder blendet das Widget nach dem Speichern aus. Dasselbe geht über die Verwaltung und das Journal-Symbol im Infobereich.
- **Speicherstand:** Es gibt keine Statusleiste. Ein kleiner Punkt in der Kopfzeile erscheint nur, solange etwas noch nicht gespeichert ist; bei einem Fehler wird er rot.
- **Inhalt:** Kleinere Überschriften und weniger Linien. Der Kalender hat keine eigene Leiste mehr: welche Tags und Eintragsarten (Ereignisse, Aufgaben, Notizen) er zeigt, steht in der Verwaltung unter dem Widget.

Das Tagesnotiz-Widget bietet denselben Editor wie die App: Aufgaben, Ereignisse, Notizen, Tags, Symbole, Beschreibungen, Planung, Erinnerungen, Reihenfolge und Tastenkürzel. **Enter** übernimmt den Tag des bisherigen Eintrags, **Strg+Enter** erstellt einen Eintrag ohne Tag. Maus-Seitentasten wechseln zwischen zuvor angezeigten Tagen.

Jede Tagesnotiz hat eine eigene Tagesnavigation und einen eigenen Tag-Filter. Der Tag-Filter steht in der Verwaltung unter dem Widget. Mehrere Widgets können verschiedene Tage anzeigen. Zeigen sie denselben Tag, werden Änderungen zwischen ihnen und der App synchronisiert. „Heute“ folgt dem Tageswechsel; mit den Pfeilen gewählte Tage bleiben geöffnet. Design, Pixel-Look, Farben, Sprache und Größe der Oberfläche folgen der App. Der Journal-Stil zeigt einen einzelnen Editor; Nebula verwendet seinen Terminalrahmen.

Das Kalender-Widget verwendet denselben Kalender wie die App mit **Jahr, Monat, Woche, Arbeitswoche und Tag**. Einträge lassen sich per Rechtsklick oder durch Markieren eines Bereichs mit gedrückter rechter Maustaste erstellen; bestehende Einträge können mit links verschoben und mit rechts bearbeitet oder gelöscht werden. Mehrtägige Einträge, Tags, Wiederholungen und Erinnerungen stehen ebenfalls bereit. Eine `.ics`-Datei, die auf das Widget gezogen und losgelassen wird, wird sofort importiert (bekannte Kalender-UIDs werden aktualisiert); exportiert wird im Kalender der App. Der Eintragseditor und seine Auswahldialoge können über den Widget-Rand hinaus erscheinen. Die App verarbeitet Kalenderänderungen gemeinsam mit offenen Tagesnotizen, sodass ausstehende Texte vor Kalenderänderungen gesichert werden.

Das Pinnwand-Widget zeigt die Pinnwand eines Tages, randlos unter der Kopfzeile. Die Kopfzeile enthält die Tagesnavigation wie bei der Tagesnotiz, ein **+** für Zettel, Bild, Link oder vorhandene Zettel (dasselbe Menü wie ein Rechtsklick auf die Fläche) und den Öffnen-Knopf. Überschrift, Hinweis und Leiste der App-Pinnwand entfallen; Linkfeld, Zettelsuche und Meldungen erscheinen nur bei Bedarf. Die Fläche wächst nicht mit, sondern wird durch Ziehen oder das Mausrad verschoben und mit Strg+Mausrad gezoomt. Welche Zettel nach Tag ausgeblendet sind, steht in der Verwaltung unter dem Widget. Karten werden sofort gespeichert und erscheinen live in der App und anderen Widgets.

Die Widgets **Tageswerte** und **Aktivitäten** zeigen einen Tag (Navigation wie bei der Tagesnotiz) und darunter nur die Werte: Tagesbewertung und eigene Tageswerte bzw. die Checkliste mit Notiz, Minuten und Timer. Überschriften, Hinweise und Verwalten-Knöpfe entfallen; „Tageswerte verwalten …“ bzw. „Aktivitäten verwalten …“ steht im Rechtsklick-Menü der Kopfzeile und öffnet die Einstellungen der App. Gespeicherte Werte meldet die App allen Fenstern (`period:changed` mit dem Fenster als Absender), laufende Timer gleichen sich über den Gerätespeicher ab.

Das Widget **Notizen** zeigt einen einzelnen Zettel des Notizblocks ohne Ordnerbaum, Werkzeugleiste, Tagesschalter und Fußzeile. In der Kopfzeile wechseln Pfeile zum vorigen oder nächsten Zettel; der Titel öffnet die Liste aller Zettel mit Ordner und Suche. Das **+** legt einen neuen Zettel an (nicht auf dem Tag). Ordner, Papierfarbe, „Auf dem Tag zeigen“, Bild/Link anhängen und Löschen stehen im Rechtsklick-Menü des Zettels; Anhänge erscheinen nur, wenn es welche gibt. „In Journal öffnen“ öffnet den Zettel im Notizblock der App. Jedes Notizen-Widget merkt sich seinen Zettel selbst.

**Durchsichtig:** Je Widget lässt sich ein transparenter Modus einschalten. Der Inhalt liegt über dem Desktop; für dunkle oder helle Hintergründe lässt sich helle beziehungsweise dunkle Schrift auswählen. Der Modus verwendet eine eigene Palette unabhängig vom App-Design. Popups erscheinen als getönte Glasflächen, Pinnwandkarten schweben frei. **Weichzeichnung** (0–32 px) zeichnet das Windows-Hintergrundbild hinter dem Widget weich; bei 0 wird keine Hintergrundbild-Ebene eingeblendet. **Rundung** (0–24 px) steuert die Ecken von Widget, Popups und Bedienelementen. Die Vorschau verwendet das Hintergrundbild und bildet keine anderen Fenster hinter dem Widget ab. Umsetzung: `widgetChrome.ts`, `WidgetBackdrop.tsx`, `desktop_widgets/wallpaper.rs` und `widgetGlass.css`.

Jedes Kalender-Widget speichert seine Ansicht, das gewählte Datum sowie Eintrags- und Tag-Filter getrennt. „Heute“ folgt dem Tageswechsel; ein durch Navigation gewählter Zeitraum bleibt beim erneuten Öffnen erhalten. Beim Duplizieren werden diese Einstellungen vor dem ersten Anzeigen in die neue Instanz übernommen. Die Datumsnavigation und die Auswahl in der App bleiben unabhängig voneinander.

**Mit Windows starten** ist zunächst ausgeschaltet. Bei Aktivierung startet Journal mit `--background`, zeigt das Hauptfenster nicht und stellt aktivierte Widgets wieder her. Das Schließen des Hauptfensters lässt das Widget weiterlaufen. **Beenden** im Infobereich speichert alle Fenster und schließt die gesamte App.

## Daten und Fenster

- Jedes Widget hat eine stabile ID, einen Typ und einen eigenen Zustand. Tagesnotizen starten mit 600 × 600 logischen Pixeln, Mindestgröße 360 × 260. Kalender starten mit 980 × 720, Mindestgröße 480 × 360. Pinnwände starten mit 720 × 560, Mindestgröße 360 × 300; Tageswerte 420 × 380 (300 × 200), Aktivitäten 460 × 440 (320 × 220), Notizen 560 × 640 (340 × 300). Der Bildschirmarbeitsbereich begrenzt die Wiederherstellung.
- `desktop-widgets.json` enthält in Version 2 die Widget-Liste mit Namen, Sichtbarkeit, Sperren und eigenen Monitorpositionen; Autostart gilt für die gesamte Gruppe. Die alte Einzelkonfiguration wird mit identischer Position und Größe übernommen. Vor dem ersten Schreiben bleibt sie als `desktop-widgets.v1-backup.json` erhalten. Diese Geräteeinstellungen gehören nicht in den Vault oder Drive-Abgleich. Änderungen an Monitor, Auflösung und DPI werden berücksichtigt; fehlt der gespeicherte Monitor, wird der Hauptbildschirm verwendet.
- Der Windows-Host liegt in `src-tauri/src/desktop_widgets`. Jede Instanz nutzt ein Tauri/WebView2-Fenster mit dem Label `widget-<id>`, normaler Tastatureingabe und ohne Eintrag in Taskleiste/Alt+Tab. Die Fenster bleiben unter normalen Apps; Aktivieren hebt ein Widget nur über andere Widgets. Solange Explorer keine Desktopfläche bereitstellt, bleiben sie verborgen. Der Dienst stellt ausschließlich aktivierte Instanzen wieder her.
- `DayEditor` und `JournalEntry` rendern in App und Widget denselben Editor. Die dauerhaft geladene Haupt-WebView ist der gemeinsame Schreiber für Tagesnotizen. Das Widget überträgt Feldänderungen und stabile Eintrags-IDs über Tauri-Ereignisse. Es ersetzt keine vollständigen, möglicherweise veralteten Tage.
- Vor Undo/Redo, Kalenderänderungen, Abgleich, Vault-Wechsel und Beenden werden ausstehende Änderungen gespeichert. Nach einem Neuladen der Haupt-WebView verbindet sich das Widget erneut. Konflikte am selben Text zeigen den erhaltenen lokalen Entwurf an; erst die ausdrücklich beschriftete Aktion verwirft ihn.

Linux und Android haben noch keinen Desktop-Host. Der Windows-Host ist von Editor und Datenprotokoll getrennt, damit andere Plattformen später ihre eigene Einbindung bekommen können.

Weitere Widget-Typen werden in `desktop_widgets/config.rs` und `desktopWidgets.ts` beschrieben und in `DesktopWidgetWindow` auf ihren Inhalt abgebildet. `DesktopWidgetFrame` stellt die Kopfzeile mit Navigationsplatz (`nav` oder `navRef` für Inhalte wie den Kalender, der Navigation und Titel per `headerSlot` dort hineinrendert), Öffnen-Knopf, Speicherpunkt, Rechtsklick-Menü und Randgriffe bereit. `useWidgetHost` übernimmt den gemeinsamen Ablauf: vorbereiten, „bereit“ melden, Ausblenden nach dem Speichern und Tag-Verwaltung. Was ein Widget in der Kopfzeile zeigt, liegt je Instanz auf dem Gerät (`src/widgetChrome.ts`, Schlüssel `journal.widget-chrome`) und wird beim Duplizieren übernommen. Die Verwaltung von IDs, Fenstern, Speicherpositionen, Wiederherstellung und Popup-Flächen gilt für alle Instanzen. `DesktopCalendarWidget` bindet den gemeinsamen `Calendar` mit eigenen Einstellungen und den Aktionen des Hauptfensters ein. `DesktopBoardWidget` bindet die gemeinsame `BulletinBoard` ein (`tagScope` des Widgets, `toolsSlot` für das „+“ in der Kopfzeile über `toolsRef` des Rahmens, `.board-framed` für die feste Fläche). Tagesnotiz und Pinnwand teilen sich die Kopfzeilen-Navigation `WidgetDayNav`; Pinnwand, Tageswerte und Aktivitäten zusätzlich den Tag samt Mitternachtswechsel und Tasten (`useWidgetDay`). `DesktopPeriodWidget` nutzt `PeriodNotes` mit `bare`, `DesktopNotebookWidget` den `Notebook` im kompakten Modus (`widget`: Plätze in der Kopfzeile, eigener gemerkter Zettel). Weitere Einträge im Kopfzeilen-Menü gibt ein Widget über `menu` an den Rahmen.

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
