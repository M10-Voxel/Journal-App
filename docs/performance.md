# Ressourcenverwaltung

Die App verwendet ein Rust-Backend und WebViews. Unter Windows übernimmt WebView2 die Oberfläche mit mehreren Prozessen, unter anderem für Rendering und GPU. Die Gruppierung im Windows-Task-Manager ist kein einzelner gemeinsamer Speicherblock der App.

## Implementierte Maßnahmen

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

Die nativen Tests unter `src-tauri/src/storage/performance_tests.rs` verwenden ausschließlich Testdaten:

| Fall | Bisheriger Weg | Optimierter Weg |
| --- | --- | --- |
| Eine Textänderung unter 128 Einträgen | Alle 128 Einträge löschen und neu einfügen | Eine Eintragszeile aktualisieren |
| Rückgängig-Daten dieser Änderung | 128 Eintragszeilen erfassen, auch unveränderte | Eine Eintragszeile erfassen |
| Aktivitätssummen einer Mail-Testmenge | Kalender-JSON mit 326.005 Byte | Summen-JSON mit 31 Byte |
| Eintragssuche über 20 passende Tage | 61 SQLite-Anweisungen | 2 SQLite-Anweisungen |
| Voll-Export über 20 Tage | 61 SQLite-Anweisungen | 3 SQLite-Anweisungen |

Die Bytewerte messen die serialisierte JSON-Nutzlast dieses konkreten Beispiels, nicht den gesamten IPC-Umschlag oder die RAM-Ersparnis auf einem echten Gerät. Die Abfragezahlen werden über SQLite-Statement-Tracing gezählt; Suche und Export werden gegen den früheren Leseweg auf identische serialisierte Inhalte geprüft, einschließlich Serien und veralteter Planungsreferenzen. `cargo test --manifest-path src-tauri/Cargo.toml storage:: -- --nocapture` gibt diese Werte sowie den SQLite-Abfrageplan aus. Weitere Tests prüfen Kalenderkennungen, Rückgängig/Wiederherstellen, atomaren Rollback und unveränderte Inhalte nach dem Wiederöffnen einer bestehenden Datenbank.

## Weitere Ansatzpunkte

Der Graph zeigt Abhängigkeiten, keine gemessene CPU-Zeit. Weitergehende RAM-/CPU-Messungen sollten repräsentative Vaults mit identischen Ansichten vergleichen. Große tatsächlich angezeigte Kalenderbereiche und umfangreiche Exportergebnisse benötigen weiterhin Speicher für ihren Inhalt. Eine spätere Aufteilung der periodischen JSON-Daten auf Tabellen würde Datenmigration, Historie und Drive-Abgleich betreffen und braucht einen eigenen abgesicherten Umbau.

Die Oberfläche, Markdown-Bearbeitung und sprachabhängige Planervorschläge bleiben in TypeScript. Rechenarbeit mit SQLite-Bezug lässt sich sinnvoll im Backend zusammenfassen; ein pauschales Umschreiben der Oberfläche nach Rust entfernt weder WebView2 noch dessen Renderingkosten. Mail-Inferenz, Datei-/Netzwerkzugriffe und SQLite laufen bereits in Rust. Bilder werden bereits in einem Worker komprimiert.

## Prüfen

Funktionale Prüfungen: native Tests, `tests/journal-cache.test.mjs`, `tests/base64.test.mjs`, `tests/sync-crypto.test.mjs` und Browserbereiche `search`, `performance`, `notebook`, `calendar-start`, `nebula-sizing`, `drive`, `board`, `undo` und `language`. Die Suchprüfung deckt auch den Ausfall der nativen Suche und das Freigeben des Rückfallwegs ab. Verschlüsselungstests prüfen alte und neue Umschläge in beiden Richtungen sowie manipulierte Daten; der native Drive-Test prüft 320 Einträge mit Sicherung, Vorschau, Rollback und Historie. Sie verwenden Beispieldaten und sind keine Vorher-/Nachher-Benchmarks des Gesamt-RAMs. Für solche Messungen denselben Datenstand, dieselben geöffneten Panels und denselben Modellzustand vergleichen.

Implementierung: `src/components/WindowActivity.tsx`, `src/components/calendarShared.tsx`, `src/components/useCalendarMinutes.ts`, `src/refreshQueue.ts`, `src/journal.ts`, `src-tauri/src/storage/read.rs`, `src-tauri/src/storage/schema.rs`, `src-tauri/src/main.rs`, `src-tauri/src/mail/ml.rs`. Befehle: [Entwicklung](development.md). Grundlagen: [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html) und [partielle Indizes](https://www.sqlite.org/partialindex.html).
