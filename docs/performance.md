# Ressourcenverwaltung

Die App verwendet ein Rust-Backend und WebViews. Unter Windows übernimmt WebView2 die Oberfläche mit mehreren Prozessen, unter anderem für Rendering und GPU. Die Gruppierung im Windows-Task-Manager ist kein einzelner gemeinsamer Speicherblock der App.

## Implementierte Maßnahmen

- Geschlossene Kalender-/Notizansichten und minimierte Nebula-Panels entfernen ihren Inhalt aus dem React-Baum, behalten aber nötige Fenstergeometrie beziehungsweise Layoutzustände. Gemeinsame Schreibwarteschlangen bleiben erhalten.
- Geladene Kalenderbereiche ersetzen den vorherigen Bereich, statt alle besuchten Daten dauerhaft zu sammeln.
- Der Journal-Zwischenspeicher behält höchstens 32 zuletzt angeforderte Tage. Verdrängte Tage werden bei Bedarf aus SQLite geladen.
- Fokusverlust oder ein unsichtbares Dokument pausiert CSS-Animationen, einschließlich der großen Nebula-Orbits; Fokus setzt sie fort.
- Windows WebView2 erhält bei Fokusverlust `MemoryUsageTargetLevel.Low`, bei Fokus `Normal`, soweit die installierte Laufzeit diese Schnittstelle unterstützt.
- Die WebView wird nicht vollständig suspendiert: Das Hauptfenster verarbeitet auch im Hintergrund Mailimporte und Ereignisse zwischen Fenstern.
- Der lokale Mail-Worker entlädt sein Modell nach 60 Sekunden Inaktivität. Eine eigene Prüfung läuft alle 15 Sekunden, unabhängig vom fünfminütigen Mailabruf. Eine laufende Analyse wird dabei nicht beendet; die nächste Analyse lädt das Modell neu.

Einträge, Bilder, offene Ansichten, Modellgröße und WebView2-Version bestimmen den tatsächlichen Ressourcenbedarf. Diese Maßnahmen belegen keinen festen RAM-/CPU-Verbrauch und keine gemessene Einsparung auf jedem Gerät. Ein Hintergrundfenster kann weiterhin arbeiten; vollständiges Beenden erfolgt über das Tray-Menü.

## Prüfen

Funktionale Prüfungen: native Tests, `tests/journal-cache.test.mjs`, Browserbereiche `performance`, `notebook`, `calendar-start` und `nebula-sizing`. Sie verwenden Beispieldaten und sind keine Vorher-/Nachher-Benchmarks. Für Messungen denselben Datenstand, dieselben geöffneten Panels und denselben Modellzustand vergleichen.

Implementierung: `src/components/WindowActivity.tsx`, `src/components/calendarShared.tsx`, `src/journal.ts`, `src-tauri/src/main.rs`, `src-tauri/src/mail/ml.rs`. Befehle: [Entwicklung](development.md).
