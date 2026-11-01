//! Offline evaluation against synthetic German mail examples, before using a model in the app.
use gliner25_rs::{BoundaryConfig, BoundaryEngine, ExecutionMode, SchemaTask};
use serde_json::json;
use std::{error::Error, io::{self, BufRead}, path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let model = PathBuf::from(args.next().ok_or("Usage: probe <model-directory> <onnxruntime.dll>")?);
    let runtime = PathBuf::from(args.next().ok_or("Missing ONNX Runtime library path")?);
    if !model.is_dir() || !runtime.is_file() { return Err("Model directory and runtime must exist locally; this probe never downloads them".into()); }
    ort::init_from(runtime)?.with_name("journal-mail-ml-probe").with_telemetry(false).commit();
    let mut engine = BoundaryEngine::new(BoundaryConfig::new(model).with_execution(ExecutionMode::Standard))?;
    let tasks = [
        SchemaTask::Entities(vec!["event".into(), "date".into(), "time".into(), "location".into()]),
        SchemaTask::classification("event_status", vec![
            "a future appointment, invitation or announced delivery".into(),
            "a cancelled appointment or delivery".into(),
            "a past event or retrospective statement".into(),
            "a hypothetical event or unrelated information".into(),
        ]),
    ];
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let sample: serde_json::Value = serde_json::from_str(&line)?;
        let text = sample["text"].as_str().ok_or("Sample requires text")?;
        let start = Instant::now();
        let output = engine.extract_long(text, &tasks)?;
        println!("{}", json!({
            "id": sample["id"], "text": text, "milliseconds":start.elapsed().as_millis(),
            "mentions":output.mentions.iter().map(|mention| json!({"text":mention.text,"field":mention.field,"score":mention.score,"start":text[..mention.char_start].encode_utf16().count(),"end":text[..mention.char_end].encode_utf16().count()})).collect::<Vec<_>>(),
            "classifications":output.classifications.iter().map(|label| json!({"task":label.task,"label":label.label,"score":label.score})).collect::<Vec<_>>(),
        }));
    }
    Ok(())
}
