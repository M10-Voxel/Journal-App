# Ressourcenverwaltung

## Bündel, Fenster und Speicherpfade (16.11.2026)

Ausgangspunkt war der Graphify-Graph (`graphify-out/GRAPH_REPORT.md`): `main.tsx` hing an fast allen Communities, jedes Fenster lud dasselbe Bündel.

- **Ein Chunk je Fenster.** `main.tsx` ist nur noch Einstieg (Design, Sprache, Stylesheets, Fensterwahl); das Journal steht in `App.tsx`. Widgets, Kalender-, Mini-Kalender-, Erinnerungs- und herausgelöste Fenster laden per `React.lazy` nur ihren Code. Der Einstiegs-Chunk sank von 1,43 MB auf rund 0,39 MB (minifiziert); CodeMirror, Pinnwand und Tinte lädt nur, wer sie zeigt. Das erzeugte Stylesheet ist bis auf die ausgelagerte Gaegu-Schrift bytegleich zum vorherigen (geprüft per Vergleich der Build-Ausgabe).
- **Gaegu bei Bedarf.** Die englische Handschrift der Journal-Optik brachte 178 `@font-face`-Regeln (rund 300 kB CSS, meist Koreanisch). `src/lookFonts.ts` lädt sie erst, wenn `data-look="journal"` und `lang="en"` gesetzt sind; das Haupt-Stylesheet sank von 1,02 MB auf 0,71 MB.
- **Mail-Erkennung bei Bedarf.** `recognizeMail` und `deliveryWorkdayWindow` stehen in `src/mailRecognize.ts` und laden mit dem Satzmodell (`mailContextModel.json`, 150 kB) erst, wenn eine Mail zu lesen ist. Der Mailstatus behält seine Identität, wenn sich nichts ändert (kein Neuzeichnen des Journals pro Minute).
- **Nebula-Raster.** Beim Ziehen eines Fensters folgt es dem Zeiger höchstens einmal pro Bild per DOM-Transform; der Desk rendert nur, wenn sich der Landeplatz ändert (vorher bei jeder Mausbewegung samt Messung aller Fenster). Vergleiche mit Standard- und gespeicherten Anordnungen laufen einmal pro Anordnung.
- **Kalenderdaten.** Nach einem Speichern lädt `useCalendarData` nur noch die Spanne der geänderten Tage nach (vorher den ganzen, rund ein Jahr langen Bereich) und behält unveränderte Tage als dieselben Objekte. Einträge pro Tag werden je Datenstand einmal gefiltert und sortiert; der Bearbeitungskontext der Kalendereinträge bleibt stabil, ihre Tastatur-Listener werden nicht bei jedem Render neu angelegt.
- **Schreibwarteschlangen.** Zeitraumdaten (`periodStore.ts`) schreiben höchstens einen Stand gleichzeitig; Änderungen während eines Schreibvorgangs werden zum nächsten, neuesten Stand zusammengefasst. Kartenänderungen (`patchCard`) schließen sich einer noch nicht gesendeten Änderung derselben Karte an, solange nichts anderes dazwischen eingereiht wurde. Der zuletzt gespeicherte Stand ist in beiden Fällen der neueste.
- **Neuzeichnen.** `PeriodNotes`, `Notebook` und `SearchBox` sind memoisiert und erhalten stabile Props; `useLanguage` und weitere Stores nutzen eine feste Abo-Funktion; englische Texte werden je Schlüssel einmal übersetzt.
- **Rust.** Der Desktop-Icon-Host für Widgets wird zwischengespeichert und nur neu gesucht, wenn er nicht mehr gültig ist (vorher eine vollständige Fensteraufzählung mehrmals pro Wartungsdurchlauf, alle 250 ms). Zeitraum-, Pinnwand-, Undo- und Mailbefehle laufen `async` statt auf dem UI-Thread. Ein partieller Index `entries_plans` (zusätzlich, ohne Schemaänderung) deckt die Herkunftssuche bei jedem Laden/Speichern eines Tages ab; Test `origin_lookup_reads_only_planned_entries`. Der Statement-Cache fasst 64 statt 16 Anweisungen; Pinnwand-Schlüssel werden per Bereichsabfrage gelesen; Live-Blur-Bilder werden ohne vorher genullten Puffer gebaut.

- **Live Blur bei verdecktem Widget.** `desktop_widget_covered` (`desktop_widgets/surface.rs`) geht in `host.rs` die Fenster oberhalb des Widgets in der Z-Reihenfolge durch (sichtbar, nicht minimiert, nicht „cloaked“, nicht klickdurchlässig oder geschichtet; eigene Hilfsfenster mit Besitzer zählen nicht) und zieht deren Rechtecke von der Widget-Fläche ab (`geometry::fully_covered`, getestet). Bleibt nichts sichtbar, fragt `WidgetLiveBackdrop` keine Bilder mehr ab (keine GPU-Auslese, kein BMP, kein IPC, kein Dekodieren); das letzte Bild bleibt stehen. Die Prüfung läuft zweimal pro Sekunde, beim Wieder-Sichtbarwerden folgt das nächste Bild sofort. Die Bildrate bei sichtbarem Widget ist unverändert (50 ms). Grenzen: abgerundete Fensterecken werden als Rechtecke gezählt; geschichtete (`WS_EX_LAYERED`) Fenster zählen nie als verdeckend, dann wird wie bisher gezeichnet.
- **Live-Blur-Quellenwahl** (`desktop_widget_live_blur`, erkennt Start/Ende/Monitorwechsel des Wallpaper-Renderers) alle 10 s statt jede Sekunde; sie beeinflusst die Bildrate nicht.

Bewusst nicht geändert: die Undo-Trigger und `PRAGMA synchronous` (Abwägung bei Dauerhaftigkeit) – siehe „Weitere Ansatzpunkte“.

## Fenster und Pinnwand (November 2026)

- Pan und Zoom behalten die berechneten Kartenpositionen, Gruppenrahmen, Pinpositionen und Fadenkurven sowie den unveränderten SVG-Baum. Verschieben und Größenänderungen einer Karte aktualisieren diese Geometrie weiterhin; Sprache, Tags und Fadenmenüs bleiben aktuell.
- Die Pinnwand verbindet ihre Größenbeobachter nur beim Wechsel der sichtbaren Karten neu. Größenänderungen übernehmen die gemeldeten Rahmenhöhen der betroffenen Karten statt erneut alle Kartenhöhen aus dem DOM zu lesen. Neue oder wieder eingeblendete Karten werden zunächst vollständig gemessen.
- Kopier-Synchronisierungsschalter werden in einem linearen Durchlauf ermittelt. Ketten, gemischte Zweige, Zyklen und fehlende Originale behalten ihre bisherige Anzeige; ein Regressionstest vergleicht sie mit dem bisherigen Suchverfahren. Bei 1.500 synthetischen Karten betrug der Median aus fünf lokalen Durchläufen etwa 29,4 ms für das bisherige Verfahren und 0,26 ms für den neuen Durchlauf. Dies misst nur diese Hilfsfunktion.
- Schwebende Fenster ändern während des Ziehens nur ihre DOM-Geometrie, höchstens einmal pro Bild. React-Zustand, gespeicherte Position und Ansichtshistorie werden beim Loslassen übernommen. Ausstehende Bewegungen werden vor dem Andocken verarbeitet und Listener beim Entfernen des Fensters freigegeben. Höhenänderungen im Raster werden ebenfalls pro Bild gebündelt.

Prüfung: `npm.cmd run build`, `npm.cmd test` (369 Tests), Browserbereiche `nebula`, `nebula-sizing`, `board`, `period-boards`, `board-widget`, `journal-grid`, `journal-layout` und `looks`. Der Browserbereich `perf` misst dieselben Interaktionen mit zwölf verbundenen Testnotizen in vier Kombinationen aus Layout und Design; `JOURNAL_PERF_JSON` speichert die Messwerte. Die lokalen Vergleichsdateien liegen unter `src-tauri/target/perf-before-codex.json` und `src-tauri/target/perf-after-codex.json`. Gemessen wird in Chrome mit deaktivierter GPU, nicht in der nativen WebView2. Einzelne Durchläufe schwanken; insbesondere horizontales Skalieren im Journal-Design verursacht weiterhin längere Frames. Eine versuchsweise Rasterisierung der Papiertextur brachte keinen verlässlichen Zusatzgewinn und ist nicht Teil der Änderung.

Die App verwendet ein Rust-Backend und WebViews. Unter Windows übernimmt WebView2 die Oberfläche mit mehreren Prozessen, unter anderem für Rendering und GPU. Die Gruppierung im Windows-Task-Manager ist kein einzelner gemeinsamer Speicherblock der App.

## Implementierte Maßnahmen

- Notizblock und Pinnwand behalten abgeleitete Ordnerbäume, Buchgruppen, Verbindungsrichtungen und Kartenlayouts, solange deren Eingabedaten gleich bleiben. Lokale Auswahl-, Popup- und Pan-/Drag-Änderungen bauen diese Strukturen nicht erneut auf. Ordnerzähler werden gesammelt statt pro Ordner durch die Kartenliste ermittelt.
- Der Ordnerbaum verwendet einen Index nach Elternordner; eingeklappte Bereiche werden in einem Durchlauf ermittelt. Sortierung, verwaiste Ordner und zyklische Altbestände behalten ihr bisheriges Verhalten.
- Gleichzeitig geöffnete Bildansichten (Pinnwand, Notizblock, Großansicht) teilen pro Bilddatei dieselbe Ladeanfrage und denselben Datenstring. Nach Schließen des letzten Nutzers wird der gemeinsame Eintrag freigegeben; es entsteht kein unbegrenzter Bildcache.

- Bild-Blur-Widgets geben Bild-Blobs und zugehörige Lade-Caches beim Ausschalten, beim Wechsel zu Live Blur und beim Entfernen der letzten Bild-Blur-Fläche frei. Verspätete Bildantworten aus einem älteren Cache-Zustand werden verworfen.
- Widget-Bewegungen auf demselben Bildschirm lösen keine erneuten Hintergrund-/Fensterpositionsabfragen pro Frame aus. Bildschirmwechsel und die fünfsekündige Hintergrundprüfung bleiben erhalten. Die native Widget-Wartung liest die gemeinsame Bildschirmkonfiguration einmal pro Durchlauf statt erneut pro Widget; ihr Intervall bleibt unverändert.
- Jede erfolgreiche COM-Initialisierung beim Lesen der Windows-Hintergründe wird nach Freigabe der COM-Objekte wieder ausgeglichen, auch bei Fehlern.

- Tagesänderungen aktualisieren nur tatsächlich veränderte Eintragszeilen. Entfernte Einträge werden gezielt gelöscht; unveränderte Einträge werden nicht mehr gelöscht und erneut angelegt. Das reduziert Schreibarbeit, WAL-Daten und Eintragskopien in der Rückgängig-Historie.
- Aktivitätsauswertungen erhalten Minuten pro Tag und Tag-ID aus Rust/SQLite. Mail-HTML, Beschreibung und übrige Kalenderdaten werden dafür nicht mehr in die WebView übertragen. Gezählt werden dieselben Zeitspannen wie zuvor, einschließlich mehrtägiger Endzeiten; abgebrochene Einträge und Planungsspuren zählen weiterhin nicht mit.
- Ein zusätzlicher partieller SQLite-Index unterstützt diese Zeitabfrage. Er ergänzt die vorhandene Datenbank, ohne Inhaltszeilen, Tabellenformat, Journal-Schema 12 oder Drive-Format 13 umzuschreiben. Das Wiederöffnen bestehender Datenbanken samt Undo/Redo wird getestet.
- Kalender und Aktivitätsauswertungen bündeln Änderungsereignisse während einer laufenden Abfrage. Je Ansicht ist höchstens eine Aktualisierung gleichzeitig aktiv; neuere Änderungen werden anschließend abgefragt. Überholte Antworten und Antworten geschlossener Ansichten werden verworfen.
- Die native Suche liest nur die passenden Eintragszeilen. Der Voll-Export lädt Metadaten und exportierbare Einträge gesammelt. Planungsherkünfte werden je Ergebnismenge einmal ermittelt; Reihenfolge, Serien, Status, Unicode-Inhalte und Sichtbarkeit bleiben erhalten. Ein gemeinsamer Zeilendecoder hält die Eintragsfelder von Tagesansicht, Kalender, Suche und Export konsistent.
- Die unbenutzte Suche lädt keine Kalenderhistorie vor. Während der Suche werden native Treffer nachgeladen und bei Änderungen aktualisiert. Die bisherige Kalenderhistorie dient nur noch als Rückfallweg bei nicht verfügbarer nativer Suche und wird beim Schließen freigegeben. Ein leerer Trefferhinweis erscheint erst nach abgeschlossener Abfrage.
- Der Drive-Import verwendet den bereits geprüften lokalen Snapshot auch als Sicherung, statt den gesamten Bestand erneut zu lesen. Einfügeanweisungen werden einmal pro Tabelle beziehungsweise für die Zusatzdaten vorbereitet und wiederverwendet; bereits verarbeitete Eingabe-Snapshots werden vor der Sicherungsserialisierung freigegeben. Versionsprüfung, Vorschau ohne Übernahme und atomarer Rollback bleiben erhalten.
- Weitere Fenster schreiben eine unveränderte Anzeigesprache nicht erneut in SQLite und bauen das Tray-Menü nur bei einem Sprachwechsel neu auf.
- Bilder, Geräteschlüssel und verschlüsselte Drive-Daten verwenden dieselbe Base64-Konvertierung. Große Binärdaten werden blockweise statt über einzelne Zeichenverkettungen kodiert; das bestehende Datei- und Verschlüsselungsformat bleibt kompatibel. Die Verschlüsselung liegt getrennt vom Einstellungsdialog, und Speichervorgänge greifen direkt auf den gemeinsamen Pinnwand-Store zu.
- Geschlossene Kalender-/Notizansichten und minimierte Nebula-Panels entfernen ihren Inhalt aus dem React-Baum, behalten aber nötige Fenstergeometrie beziehungsweise Layoutzustände. Gemeinsame Schreibwarteschlangen bleiben erhalten.
- Geladene Kalenderbereiche ersetzen den vorherigen Bereich, statt alle besuchten Daten dauerhaft zu sammeln.
- Der Journal-Zwischenspeicher behält höchstens 32 zuletzt angeforderte Tage und berücksichtigt zusätzlich ein Budget von 16 MiB geschätztem UTF-16-Text aus Titeln, Freitext und Eintragsbeschreibungen. Große ältere Tage werden früher verdrängt und bei Bedarf unverändert aus SQLite geladen. Ein einzelner übergroßer jüngster Tag bleibt vollständig verfügbar. Das Budget ist keine harte Grenze des gesamten WebView-RAMs; laufende Anfragen und Objekt-/Renderingkosten kommen hinzu.
- Fokusverlust oder ein unsichtbares Dokument pausiert CSS-Animationen, einschließlich der großen Nebula-Orbits; Fokus setzt sie fort.
- Windows WebView2 erhält bei Fokusverlust `MemoryUsageTargetLevel.Low`, bei Fokus `Normal`, soweit die installierte Laufzeit diese Schnittstelle unterstützt.
- Die WebView wird nicht vollständig suspendiert: Das Hauptfenster verarbeitet auch im Hintergrund Mailimporte und Ereignisse zwischen Fenstern.
- Der lokale Mail-Worker entlädt sein Modell nach 60 Sekunden Inaktivität. Eine eigene Prüfung läuft alle 15 Sekunden, unabhängig vom fünfminütigen Mailabruf. Eine laufende Analyse wird dabei nicht beendet; die nächste Analyse lädt das Modell neu.

Einträge, Bilder, offene Ansichten, Modellgröße und WebView2-Version bestimmen den tatsächlichen Ressourcenbedarf. Diese Maßnahmen belegen keinen festen RAM-/CPU-Verbrauch und keine gemessene Einsparung auf jedem Gerät. Ein Hintergrundfenster kann weiterhin arbeiten; vollständiges Beenden erfolgt über das Tray-Menü.

## Reproduzierbare Regressionen

Die nativen Tests unter `crates/journal-core/src/storage/performance_tests.rs` verwenden ausschließlich Testdaten:

| Fall | Bisheriger Weg | Optimierter Weg |
| --- | --- | --- |
| Eine Textänderung unter 128 Einträgen | Alle 128 Einträge löschen und neu einfügen | Eine Eintragszeile aktualisieren |
| Rückgängig-Daten dieser Änderung | 128 Eintragszeilen erfassen, auch unveränderte | Eine Eintragszeile erfassen |
| Aktivitätssummen einer Mail-Testmenge | Kalender-JSON mit 326.005 Byte | Summen-JSON mit 31 Byte |
| Eintragssuche über 20 passende Tage | 61 SQLite-Anweisungen | 2 SQLite-Anweisungen |
| Voll-Export über 20 Tage | 61 SQLite-Anweisungen | 3 SQLite-Anweisungen |

Die Bytewerte messen die serialisierte JSON-Nutzlast dieses konkreten Beispiels, nicht den gesamten IPC-Umschlag oder die RAM-Ersparnis auf einem echten Gerät. Die Abfragezahlen werden über SQLite-Statement-Tracing gezählt; Suche und Export werden gegen den früheren Leseweg auf identische serialisierte Inhalte geprüft, einschließlich Serien und veralteter Planungsreferenzen. `cargo test --manifest-path src-tauri/Cargo.toml storage:: -- --nocapture` gibt diese Werte sowie den SQLite-Abfrageplan aus. Weitere Tests prüfen Kalenderkennungen, Rückgängig/Wiederherstellen, atomaren Rollback und unveränderte Inhalte nach dem Wiederöffnen einer bestehenden Datenbank.

## Weitere Ansatzpunkte

Offen aus der Prüfung vom 16.11.2026: `desktop_widget_live_blur` läuft noch synchron (Fensteraufzählung, gemeinsame Sperre mit der GPU-Auslese); die Undo-Trigger vergleichen ganze Zeilen per `json_object`; `desktop_wallpaper_info` wird von Backend und Widget getrennt abgefragt; `import_calendar` liest Tags und Serien pro Eintrag. Jede dieser Stellen braucht eine native Prüfung auf Windows.

Der Graph zeigt Abhängigkeiten, keine gemessene CPU-Zeit. Weitergehende RAM-/CPU-Messungen sollten repräsentative Vaults mit identischen Ansichten vergleichen. Große tatsächlich angezeigte Kalenderbereiche und umfangreiche Exportergebnisse benötigen weiterhin Speicher für ihren Inhalt. Eine spätere Aufteilung der periodischen JSON-Daten auf Tabellen würde Datenmigration, Historie und Drive-Abgleich betreffen und braucht einen eigenen abgesicherten Umbau.

Die Oberfläche, Markdown-Bearbeitung und sprachabhängige Planervorschläge bleiben in TypeScript. Rechenarbeit mit SQLite-Bezug lässt sich sinnvoll im Backend zusammenfassen; ein pauschales Umschreiben der Oberfläche nach Rust entfernt weder WebView2 noch dessen Renderingkosten. Mail-Inferenz, Datei-/Netzwerkzugriffe und SQLite laufen bereits in Rust. Bilder werden bereits in einem Worker komprimiert.

## Prüfen

Funktionale Prüfungen: native Tests, `tests/journal-cache.test.mjs`, `tests/base64.test.mjs`, `tests/sync-crypto.test.mjs` und Browserbereiche `search`, `performance`, `notebook`, `calendar-start`, `nebula-sizing`, `drive`, `board`, `undo` und `language`. Die Suchprüfung deckt auch den Ausfall der nativen Suche und das Freigeben des Rückfallwegs ab. Verschlüsselungstests prüfen alte und neue Umschläge in beiden Richtungen sowie manipulierte Daten; der native Drive-Test prüft 320 Einträge mit Sicherung, Vorschau, Rollback und Historie. Sie verwenden Beispieldaten und sind keine Vorher-/Nachher-Benchmarks des Gesamt-RAMs. Für solche Messungen denselben Datenstand, dieselben geöffneten Panels und denselben Modellzustand vergleichen.

Implementierung: `src/components/WindowActivity.tsx`, `src/components/calendarShared.tsx`, `src/components/useCalendarMinutes.ts`, `src/refreshQueue.ts`, `src/journal.ts`, `src-tauri/src/storage/read.rs`, `src-tauri/src/storage/schema.rs`, `src-tauri/src/main.rs`, `src-tauri/src/mail/ml.rs`. Befehle: [Entwicklung](development.md). Grundlagen: [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html) und [partielle Indizes](https://www.sqlite.org/partialindex.html).

## ICS nach Rust

`ical.js` wurde vollständig aus dem Frontend entfernt. Import, Export sowie Berechnung und Startänderung importierter ICS-Regeln laufen in `src-tauri/src/calendar.rs`. Normale Wiederholungen bleiben synchron in TypeScript. Produktionsbuild vom 16.11.2026, identische Vite-Konfiguration:

| Chunk | Vorher | Nachher | gzip vorher → nachher |
| --- | --- | --- | --- |
| Einstieg (`main`) | 394,65 kB | 316,46 kB | 122,42 → 98,60 kB |
| ICS (dynamisch) | 10,37 kB | 0,75 kB | 4,11 → 0,43 kB |
| App | 212,96 kB | 212,96 kB | 67,12 → 67,12 kB |

Dies sind Bündelgrößen, keine RAM-Messungen. Gemeinsame Import-/Export-Fixtures vergleichen die Rust-Befehle mit den erfassten bisherigen Ergebnissen; zusätzliche Fälle prüfen Sommerzeit, eingebettete Zeitzonen und Serienausnahmen. Details: [Umsetzungsplan](plan-ical-repeat-rust.md).
