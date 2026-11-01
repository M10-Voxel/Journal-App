# Lokale ML-Evaluierung für Mailtermine

Dieses eigenständige Prüfprogramm bewertet GLiNER2.5 mit synthetischen deutschen Mailbeispielen. Nach dieser Prüfung wurde dieselbe Extraktion als isolierter Mailprozess in die App eingebunden; der übrige Journalbetrieb lädt kein Modell.

Der Kandidat ist `fastino/gliner2.5-multi-v1`, als ONNX-Export von `jugaadsrl/gliner2.5-multi-v1-onnx`. Der CPU-Export benötigt ungefähr 1,1 GB Modellgewichte sowie ONNX Runtime 1.23 oder neuer. Beide Artefakte müssen separat vorhanden sein; das Programm lädt nichts automatisch herunter und überträgt keine Mailtexte.

Die Ausgabe enthält echte Modellvorhersagen und Laufzeiten, keine vorgegebenen Antworten. `expected` in `cases.jsonl` sind Prüfziele, keine bereits nachgewiesenen Fähigkeiten des Modells. Insbesondere Absagen, Rückblicke, Alternativen, mehrere Ereignisse und zitierte alte Nachrichten müssen geprüft werden. Modellscores sind keine garantierten Wahrscheinlichkeiten für korrekte Kalenderdaten.

Aufruf nach dem Bauen: `journal-mail-ml-probe.exe <Modellordner> <onnxruntime.dll>`, Eingabe über stdin aus `cases.jsonl`. Der Prototyp liest keine echten Konten und verändert keine Kalenderdaten.

Die Umrechnung extrahierter Angaben wie „morgen“ in ein Kalenderdatum benötigt weiterhin Maildatum und Zeitzone. Erkannte Termine werden von der App automatisch übernommen und bleiben im Kalender bearbeitbar. `node scripts/verify-mail-ml.mjs` prüft den tatsächlichen App-Modellprozess einschließlich dieser Datumsnormalisierung mit zwanzig synthetischen Beispielen, ohne ein echtes Konto oder eine Journal-Datenbank zu öffnen. Ergebnisse liegen unter `src-tauri/target/mail-ml-live-report.json`. Dies ist keine repräsentative Qualitätsmessung für beliebige Mails. Die Klassifikation ist bei kurzen Texten teilweise unsicher.

`download-assets.py` lädt die festgelegten Dateien in `src-tauri/target/mail-ml-assets` und prüft deren Herkunftshashes. `assets-manifest.json` wird auch vom Installer der App verwendet. Die App kann den vorhandenen Ordner über ihre Modelleinstellungen übernehmen; alternativ lädt sie die Dateien selbst. CPU-Modus und Standardausführung sind ausdrücklich gesetzt.

Quellen: [Modell](https://huggingface.co/fastino/gliner2.5-multi-v1), [ONNX-Export](https://huggingface.co/jugaadsrl/gliner2.5-multi-v1-onnx), [Rust-Inferenz](https://github.com/dariofinardi/gliner25-rs). Gewichte und Bibliothek stehen laut ihren Projektangaben unter Apache-2.0.
