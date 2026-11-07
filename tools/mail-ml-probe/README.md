# Lokale ML-Probe für Mailtermine

Dieses eigenständige Rust-Werkzeug prüft die rohe GLiNER2.5-Extraktion mit synthetischen JSONL-Beispielen. Es liest kein Postfach, öffnet keine Journal-Datenbank und trägt keine Termine ein. Der zusätzliche Satzklassifikator und die vollständige Kalendernormalisierung der App sind **nicht** Bestandteil dieser Probe. Für die aktuelle Gesamterkennung die [App-ML-Prüfungen](../../docs/mail-context-ml.md) verwenden.

## Artefakte und Build

Verwendet werden `fastino/gliner2.5-multi-v1`, der festgelegte ONNX-Export von `jugaadsrl/gliner2.5-multi-v1-onnx` und das CPU-Runtime-Paket ONNX Runtime 1.23.2. Herkunft, Revision und Prüfsummen stehen in `assets-manifest.json`, das auch die App bei der Modellinstallation verwendet. Die Einrichtung erfordert ungefähr 1,3 GB Download; die Probe selbst lädt nichts nach und überträgt keine Mailtexte.

Aus dem Projektverzeichnis in einer Windows-Entwicklungsumgebung:

```powershell
python tools/mail-ml-probe/download-assets.py
cargo build --release --manifest-path tools/mail-ml-probe/Cargo.toml --target-dir src-tauri/target/mail-ml-probe
```

Das Downloadskript benötigt Python, lädt die festgelegten Dateien nach `src-tauri/target/mail-ml-assets` und prüft die Hashes. Es ist ein ausdrücklich aufgerufenes Entwicklerwerkzeug, kein Python-Bestandteil der ausgelieferten App. Die Modelleinstellungen der App können denselben Ordner übernehmen oder die Dateien selbst laden.

Aufruf der Probe:

```text
journal-mail-ml-probe.exe <Verzeichnis-mit-ONNX-Dateien> <Pfad-zu-onnxruntime.dll>
```

Für die heruntergeladenen Artefakte ist das Modellverzeichnis `src-tauri/target/mail-ml-assets/fp32_25`, die DLL liegt unter `src-tauri/target/mail-ml-assets/runtime/onnxruntime.dll`. Die erzeugte EXE liegt unter `src-tauri/target/mail-ml-probe/release/`.

Die Eingabe kommt als UTF-8-JSONL über stdin, etwa aus `cases.jsonl`; die Ausgabe enthält tatsächliche Vorhersagen und Laufzeiten. `expected` sind Prüfziele, keine vorgegebenen Antworten. Eine UTF-8-fähige Shell verwenden, damit deutsche Zeichen unverändert ankommen.

## Kontextmodell und Messgrenzen

`context-training.json`, `context-cases.json`, `context-challenge.json` und `context-training-report.json` gehören zum zusätzlichen Satzklassifikator der App. Training über `npm.cmd run train:mail-context`; Live-Gesamtprüfung über `npm.cmd run check:mail-context`. Einzelheiten und die Aufteilung von Trainings-/Validierungs-/Testvorlagen stehen im [ML-Dokument](../../docs/mail-context-ml.md).

Rohe Extraktion, Satzentscheidung und fertiger Kalendereintrag sind unterschiedliche Prüfstufen. Die synthetischen Beispiele messen keine repräsentative Genauigkeit für echte Postfächer. Scores sind keine garantierten Wahrscheinlichkeiten; Absagen, Rückblicke, Servicezeiten, mehrere Ereignisse und alte Zitate müssen gesondert geprüft werden.

Quellen und Lizenzen: [Modell](https://huggingface.co/fastino/gliner2.5-multi-v1), [ONNX-Export](https://huggingface.co/jugaadsrl/gliner2.5-multi-v1-onnx), [Rust-Inferenz](https://github.com/dariofinardi/gliner25-rs), lokale Lizenztexte unter `licenses/`. Allgemeine Voraussetzungen: [Entwicklung](../../docs/development.md).
