# Funktionen ein- und ausschalten

Unter **Einstellungen → Funktionen** wird festgelegt, was die App zeigt. Der **Kalender** ist immer an. Der **Notizblock** und jede Ansicht (**Tag, Woche, Monat, Quartal, Jahr**) lassen sich ausschalten; für jede eingeschaltete Ansicht wird gewählt, welche Bereiche sie zeigt. Ausgeschaltetes wird nur ausgeblendet – alle Daten bleiben gespeichert und erscheinen beim Einschalten wieder.

Implementierung: `src/features.ts` (Modell, Regeln), `src/featureStore.ts` (für Fenster außerhalb der App), `src/components/FeatureSettings.tsx` (Einstellungen). Gespeichert in `journal.settings` als `features` und über Google Drive als Darstellungseinstellung synchronisiert.

## Bereiche je Ansicht

| Bereich | Tag | Woche … Jahr |
| --- | --- | --- |
| **Einträge** | Die Tageseinträge (Aufgaben, Ereignisse, Notizen) mit Kalender, Erinnerungen und Planung. | Eine **eigene Liste** mit Aufgaben und Notizen für den Zeitraum. Sie steht nicht im Kalender. Enter legt den nächsten Eintrag an, Rücktaste im leeren Eintrag löscht ihn, Alt ↑/↓ verschiebt ihn, Alt A / Alt N legt eine Aufgabe/Notiz an. |
| **Notiz** | Freier Text zum Tag. | Freier Text zum Zeitraum (wie bisher). |
| **Bewertung** | Tagesbewertung. | Eine **eigene Bewertung** des Zeitraums (Wochen-, Monats- … bewertung), unabhängig von den Tagen. |
| **Tageswerte / Werte** | Eigene Werte wie Stress oder Schlaf für den Tag. | **Eigene Werte** für den Zeitraum mit denselben Definitionen, unabhängig von den Tagen. |
| **Checkliste** | Aktivitäten mit Haken, Notiz, Minuten und Timer. | Zählt die **Zeit und die Aktivitätstage aller Tage** des Zeitraums zusammen (getippte Minuten und Kalenderzeit). Liegt heute im Zeitraum, gelten Haken und Timer für **heute**. |
| **Auswertung** | – (für einen einzelnen Tag nicht angeboten) | Verlauf der Tagesbewertung und Tageswerte, Aktivitäten im Überblick (wie bisher). |
| **Pinnwand** | Pinnwand des Tages. | Eine **eigene Pinnwand** – jetzt auch für Woche und Quartal. |

Standard (wie vor dieser Einstellung): Tag mit Einträgen, Bewertung, Tageswerten, Checkliste und Pinnwand; Woche und Quartal mit Notiz und Auswertung; Monat und Jahr zusätzlich mit Pinnwand; Notizblock an.

## Regeln und Zusammenhänge

- **Mindestens eine Ansicht** bleibt an, und eine eingeschaltete Ansicht hat **mindestens einen Bereich**. Eine Ansicht ohne gespeicherte Bereiche gilt als aus; sind alle aus, kommt der Tag zurück.
- **Ansicht ausgeschaltet:** Ihr Reiter verschwindet (Normal: Titelleiste, Buch: Register, Desk: Leiste). Strg 1 … zählt nur die eingeschalteten Ansichten. Zeigt die App gerade eine ausgeschaltete Ansicht (auch aus dem Verlauf), wechselt sie zur nächstgelegenen eingeschalteten.
- **Tag aus oder Tageseinträge aus:** „Im Journal öffnen“ aus Kalender, Widgets und Erinnerungen wechselt nur zum Tag, wenn die Tagesansicht an ist; sonst bleibt die Ansicht und zeigt den Zeitraum dieses Tages. Suchtreffer von Einträgen und Tagestiteln öffnen dann im Kalender. Alt A/E/N legen nur dort Tageseinträge an, wo sie zu sehen sind.
- **Timer in Woche … Jahr:** Der Timer läuft unter dem Tag, an dem er gestartet wurde (heute); seine Kalendereinträge werden – auch über Mitternacht – auf die Tage gelegt, an denen die Zeit lief (`activityTimer.ts`). Ein schon laufender Timer eines Tages im Zeitraum (z. B. in der Tagesansicht gestartet) wird in der Zeitraum-Checkliste angezeigt und dort gestoppt. Die Summe des Zeitraums zählt die Zeit aller seiner Tage.
- **Mehrere Pinnwände:** „Auf Pinnwänden anzeigen“ (die drei Striche an einer Karte, auch im Notizblock) bietet genau die eingeschalteten Zeitraum-Pinnwände an (Woche, Monat, Quartal, Jahr). Ist keine an, fehlt die Aktion. Jede Pinnwand behält ihre eigene Anordnung. Pinnwand-Schlüssel: Tag `2026-11-16`, Woche `week:<Montag>`, Monat `month:2026-11`, Quartal `quarter:2026-Q4`, Jahr `year:2026`.
- **Pinnwand ausgeschaltet:** Karten bleiben gespeichert. Die Suche bietet eine Karte nur auf eingeschalteten Pinnwänden an (die kleinste zuerst: Tag, Woche, Monat, Quartal, Jahr) bzw. im Notizblock, wenn er an ist.
- **Notizblock aus:** Reiter, Strg ⇧ N, „Im Notizblock öffnen“ an Karten und Suchtreffer, die nur im Notizblock liegen, entfallen.
- **Buch:** Die Seiten einer Ansicht folgen ihren Bereichen: Einträge · Daten (Bewertung, Werte, Checkliste) · Notiz (Notiz und Verlaufsdiagramm; ohne Notiz „Auswertung“) · Überblick (Aktivitäten der Auswertung) · Pinnwand. Beim Umblättern „Beide auf einmal“ liegen je zwei Seiten nebeneinander, die Pinnwand und eine übrig bleibende Seite allein über beiden Seiten (`src/book.ts` `bookPages`, `spreadGroups`).
- **Desk:** Jeder Bereich ist ein eigenes Fenster (`nebulaLayout.ts` `panelsOf`); in Woche … Jahr heißt die Checkliste `checklist`, die Auswertung sind die Fenster `ratings` und `activities`. Ausgeblendete Fenster behalten ihren Platz in der Anordnung.
- **Desktop-Widgets** werden bewusst einzeln hinzugefügt und bleiben von diesen Einstellungen unberührt.

## Daten

Zeitraum-Werte und Zeitraum-Einträge liegen in den Periodendaten (`src/periodData.ts`) unter dem Schlüssel `<Ansicht>:<erster Tag>` (z. B. `week:2026-11-16`, wie die Zeitraum-Notizen):

- `periods[<Schlüssel>] = { rating?, scales? }`
- `entries[<Schlüssel>][<id>] = { kind: 'task' | 'note', text, done?, order }`

Beides sind Objekte statt Listen, damit ein Drive-Abgleich Einträge einzeln zusammenführt. Ältere Datenstände haben diese Felder nicht; `normalizePeriodData` ergänzt nichts und verwirft ungültige Werte. Eine Datenbank-Migration ist nicht nötig, weil die Periodendaten als JSON gespeichert werden.

Prüfungen: `tests/features.test.mjs`, `tests/featureViews.test.mjs`, `tests/nebulaLayout.test.mjs`; UI-Bereich `features` in `scripts/verify-ui.mjs` (alle neun Kombinationen aus Aufbau und Optik).

## Rechtsklick

Das Browser-Menü (Zurück, Neu laden, Speichern unter, Drucken …) erscheint nie: WebView2s eigene Menüs sind abgeschaltet (`main.rs`), und jeder Rechtsklick, den kein App-Menü nimmt, landet in `appContextMenu` (`ContextMenu.tsx`):
- in Textfeldern (Eingaben, Textbereiche, Editoren ohne Auswahl) das App-Textmenü im Popup-Stil: Ausschneiden, Kopieren, Einfügen, Alles auswählen (Einfügen liest die Zwischenablage; für die eigenen Seiten ohne WebView2-Abfrage erlaubt);
- auf einem Eintrag (außerhalb seines Textes) öffnen sich dessen Aktionen;
- überall sonst passiert nichts.
Eigene Menüs gibt es weiterhin für Fensterköpfe, Pinnwand, Notizen, Kalender, Widgets und markierten Text (Formatieren). Prüfung: `JOURNAL_UI_SCOPE=context-menus-all`.

Die Hauptansicht veröffentlicht die eingeschalteten Pinnwand-Zeiträume beim Start und bei Änderungen in `board-scopes.json` im lokalen App-Datenordner. J-TerminaL übernimmt diese Auswahl für seine Zeitraum-Befehle.
