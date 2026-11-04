# Popup-Stile

Einstellungen → Darstellung → **Popups**: zwei Varianten pro Design (`Settings.popupStyle`, `'a' | 'b'`, Standard `a`). `applyTheme` setzt `data-popups` auf dem Wurzelelement; über `journal:theme` übernehmen Kalender-, Mini- und Erinnerungsfenster die Wahl.

Betroffen sind die Popups für Einträge und Kalendereinträge: der Planer (`.planner` mit Uhr, Wiederholung, Enddatum), der Composer beim Anlegen/Bearbeiten im Kalender (`.cal-composer`) und die kleinen Karten und Auswahlen (`.popover`: Tags, Details, Auswahlen). Die Regeln stehen in `src/popup-styles.css`; fast alles läuft über Farb-Tokens, die auf dem Popup selbst gesetzt werden.

| Design | A | B |
|---|---|---|
| Normal | **Karte** (Basis aus popups.css/styles.css/calendar.css) | **Glas**: durchscheinend mit Unschärfe, heller Rand, runde Felder, leuchtende Auswahl |
| Journal | **Karteikarte**: glattes Papier, roter Strich oben, unterstrichene Felder, umkringelte Tage | **Notizblock**: gelbliches Blatt mit Ringbindung, Textmarker für die Auswahl |
| Nebula | **Terminal**: schwarzes Fenster, graue Prompt-Leiste (`./plan.sh`, `./entry.sh --new/--edit`, `./pick.sh`), violetter Versatzschatten | **Holo-Papier**: graues Papier mit violettem Balken, schwarze Konturen, holografische Auswahl |

Die Pfeile (`::before`) entfallen dort, wo das Blatt eine eigene Kante hat (Bindung, Prompt-Leiste, Balken); der Tag-Streifen des Composers wird dann als Rand gezeigt. Die Karten in den Einstellungen zeichnen je ein kleines Popup (`settings.css`, `.popup-sample`).

Prüfung: `JOURNAL_UI_SCOPE=popups node scripts/verify-ui.mjs` öffnet in allen sechs Varianten den Planer (Alt+T) und den Composer (Rechtsklick auf einen Kalendereintrag) und legt `popups-<design>-<a|b>-<planner|composer>.png` ab.

## Wischen

Die Aktionsart „Wischen“ (`actionLayout: 'swipe'`) bleibt im Code für Touch-Geräte (Android), wird auf dem Desktop aber nicht mehr angeboten (`swipeAvailable()` in `settings.ts`); ein gespeichertes `swipe` gilt dort als Orbit. Die UI-Prüfung schaltet sie mit `window.__journalSwipeLayout = true` frei.
