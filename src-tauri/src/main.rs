#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;

use std::sync::Mutex;
use tauri::Manager;
use storage::{Day, Store};

// Async commands run on Tauri's worker pool instead of the main thread, so disk I/O never stalls the window.
#[tauri::command]
async fn load_day(date: String, store: tauri::State<'_, Mutex<Store>>) -> Result<Day, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.load(&date).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_day(day: Day, store: tauri::State<'_, Mutex<Store>>) -> Result<Day, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.save(day).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Mutex::new(Store::open(&dir.join("journal.sqlite3"))?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_day, save_day])
        .run(tauri::generate_context!()).expect("Journal konnte nicht gestartet werden");
}
