//! JSON-lines harness for testing the real calendar commands without a WebView or vault.
#[path = "../calendar.rs"]
mod calendar;
use serde_json::{json, Value};
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let result = (|| -> Result<Value, String> {
            let v: Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let s = |k: &str| v[k].as_str().unwrap_or("").to_owned();
            match s("cmd").as_str() {
                "calendar_import" => calendar::calendar_import(
                    s("content"),
                    v["year"].as_i64().unwrap_or(2026) as i32,
                    s("timezone"),
                    v.get("labels").cloned(),
                ),
                "calendar_export" => calendar::calendar_export(
                    v["days"].as_array().cloned().unwrap_or_default(),
                    s("now"),
                    s("timezone"),
                    s("untitled"),
                )
                .map(Value::String),
                "calendar_occurrences" => calendar::calendar_occurrences(
                    s("ics"),
                    s("from"),
                    s("to"),
                    v["limit"].as_u64().unwrap_or(5000) as usize,
                    v["until"].as_str().map(str::to_owned),
                )
                .map(|v| json!(v)),
                "calendar_with_start" => {
                    calendar::calendar_with_start(s("ics"), s("start")).map(Value::String)
                }
                _ => Err("Unknown command".into()),
            }
        })();
        println!(
            "{}",
            match result {
                Ok(value) => json!({"value":value}),
                Err(error) => json!({"error":error}),
            }
        );
    }
}
