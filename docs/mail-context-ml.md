# Kontextbezogene Mail-Erkennung

Einrichtung und Konten: [E-Mail-Konten](mail-accounts.md). Gespeicherte HTML-Inhalte und Lieferzeiträume: [Mailvorschau](mail-display-and-delivery.md). Allgemeine Test- und Build-Befehle: [Entwicklung](development.md).

Die Erkennung kombiniert zwei lokale Modelle:

1. Das vorhandene **GLiNER2.5 multilingual** erkennt Datums-, Uhrzeit-, Termin- und Ortsangaben. Seine ONNX-Gewichte bleiben unverändert.
2. Ein neu trainierter **Satzklassifikator** bewertet, ob ein ganzer Satz einen konkreten Termin oder eine Lieferung beschreibt. Er verwendet Wort-, Wortfolgen- und Zeichenmerkmale sowie schwächer gewichteten Betreff und vorherigen Satz. Eine L2-regularisierte logistische Regression lernt deren Gewichte aus synthetischen Beispielen. Dies ist ein zusätzliches, kleines ML-Modell, kein erneutes Training des großen neuronalen Encoders.

Allgemeine Support-/Öffnungszeiten, Erstellungsdaten von Rechnungen, Status-Zeitstempel, Werbung, Beispiele und Absagen sollen keine Termine erzeugen. Persönlich gebuchte Support-Rückrufe bleiben Termine. Bei knappen Satzentscheidungen kann eine übereinstimmende neuronale Termin-, Datums- und Uhrzeiterkennung im selben Satz helfen. Eine Absage in einem Satz verhindert nicht mehr pauschal die Übernahme eines neu genannten Termins im nächsten Satz.

Die Zuordnung erfolgt innerhalb des Satzes. Ein kurzer passender Folgesatz kann die Uhrzeit ergänzen; ein Service-Footer kann das nicht allein durch seine räumliche Nähe. Kurze Datums-/Zeitzeilen einer Tabelle werden zusammengeführt. Enthält der Betreff das konkrete Datum und der passende Text nur das Lieferzeitfenster, können sie gemeinsam einen Termin ergeben. Betreff und Text erzeugen nicht mehr zusätzlich dieselbe Ankündigung als ganztägigen Eintrag.

`chrono-node` normalisiert nur die ausgewählten Kontexte. Deutsch und Englisch funktionieren unabhängig von der Anzeigesprache. Relative Tage beziehen sich auf das Versanddatum der Mail. Unterstützt werden beispielsweise `Heute zwischen 10 und 12 Uhr`, `20:00 Uhr bis 20:15`, `20 bis 21:20`, `10.30–12.45 Uhr`, `between 2 and 4 pm` und ein Zeitfenster über Mitternacht. Numerische deutsche Daten werden nicht gleichzeitig als amerikanisches Datum übernommen. Werktagsspannen müssen in ihrem eigenen Satz eine Lieferung beschreiben; ein Hinweis auf die Bearbeitung einer Support-Anfrage genügt nicht.

## Training und Messung

`npm.cmd run train:mail-context` trainiert auf der CPU in wenigen Sekunden. Keine zusätzlichen Trainingsbibliotheken, GPU, API oder privaten Mails sind nötig. Die Gewichte liegen in `src/mailContextModel.json` (rund 150 KB). Trainingsgrundlage und generierte Kontrastpaare stehen in `tools/mail-ml-probe/context-training.json` und `scripts/train-mail-context.mjs`. Dieselben Service-Begriffe kommen sowohl bei allgemeinen Erreichbarkeiten als auch bei gebuchten persönlichen Rückrufen vor, damit die Entscheidung vom Satz und nicht nur vom Wort „Support“ abhängt.

Die Ausgabe nennt getrennt Trainings-, Validierungs- und Testwerte. Varianten derselben Vorlage bleiben im selben Teil. Der Entscheidungsschwellwert wird anhand der Validierung gewählt; die Schwelle wird nicht anhand der Testwerte optimiert. Rund 5.500 Trainingsbeispiele entstehen aus gut 230 Vorlagen, nicht aus Tausenden unabhängig verfasster echter Mails. Die isolierten Klassifikatorwerte im vollständigen `context-training-report.json` sind ausdrücklich keine Genauigkeitsmessung des gesamten Kalendereintrags.

Die Erkennung hat außerdem 36 synthetische Regressionsmails und 20 weitere Formulierungsfälle. Diese wurden zur Entwicklung und Fehlerkorrektur verwendet; sie sind **kein verblindeter, repräsentativer Qualitätstest**. `tests/fixtures/mail-context-model-output.json` enthält tatsächliche Offline-Vorhersagen des festgelegten GLiNER-Modells für diese Mails, keine manuell erfundenen Modellantworten. `npm.cmd test` prüft darauf die gesamte Erkennung einschließlich der erwarteten Daten und Zeitfenster.

Live mit installiertem Modell prüfen:

```powershell
npm.cmd run check:mail-context -- src-tauri/target/release/journal-app.exe src-tauri/target/mail-ml-assets
node scripts/evaluate-mail-context.mjs src-tauri/target/release/journal-app.exe src-tauri/target/mail-ml-assets src-tauri/target/mail-context-challenge.json tools/mail-ml-probe/context-challenge.json
node scripts/verify-mail-ml.mjs src-tauri/target/release/journal-app.exe src-tauri/target/mail-ml-assets
```

Der Modellordner kann alternativ der vorhandene Ordner `%LOCALAPPDATA%/de.journal.local/mail-ml` sein. Diese Programme starten ausschließlich den isolierten Modellprozess, ohne Fenster, Mailkonto oder Journal-Datenbank zu öffnen. Berichte liegen unter `src-tauri/target/`.

## Update-Verhalten und Grenzen

Es ist kein erneuter Download von GLiNER nötig. Nach einem Erkennungsupdate werden bereits ergebnislos verarbeitete Mails bei aktivierter ML-Erkennung einmal im eingestellten Abrufzeitraum erneut geprüft. Bereits übernommene oder ignorierte Vorschläge werden nicht zurückgesetzt; vorhandene fehlerhafte Kalendertermine werden nicht automatisch gelöscht. Wird die Erkennung erst später aktiviert, erfolgt die Umstellung dann.

Die neuen Modelle bleiben ausschließlich Teil des Mail-Imports und laufen lokal. Es werden keine privaten Mails für Training oder Telemetrie übertragen. Der zusätzliche Klassifikator ist klein; die aufwendige neuronale Inferenz bleibt im vorhandenen, nach Inaktivität entladenen Worker. Nicht erkannte Formulierungen und Fehlentscheidungen bleiben möglich, insbesondere bei seltenen Sprachen, komplizierten Bedingungen, mehreren vermischten Vorgängen und ungewöhnlichem Tabellenaufbau. Die synthetischen Tests sind keine Zusicherung vollständiger Erkennung beliebiger Postfächer.

Hintergrund zum vorhandenen Encoder: Die Rust-Bibliothek beschreibt die globale Klassifikation bei langen Texten als ein Auftreten irgendwo im Text, nicht als Aussage zu jedem Satz. Deshalb reicht dieser Score allein nicht aus, um etwa Supportzeiten in einem Lieferbrief zu beurteilen: [gliner25-rs](https://github.com/dariofinardi/gliner25-rs).
