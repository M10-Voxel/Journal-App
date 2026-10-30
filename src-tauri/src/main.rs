#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use storage::{CalendarDay, Day, LinkedChange, LinkedEntry, Store};

// Async commands run on Tauri's worker pool instead of the main thread, so disk I/O never stalls the window.
// (Creating windows from a synchronous command would even deadlock on Windows.)
#[tauri::command]
async fn load_day(date: String, store: tauri::State<'_, Mutex<Store>>) -> Result<Day, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.load(&date).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_range(from: String, to: String, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<CalendarDay>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.load_range(&from, &to).map_err(|e| e.to_string())
}

/// Saving also tells the calendar windows which days changed, so they can show them anew.
#[tauri::command]
async fn save_day(app: tauri::AppHandle, day: Day, store: tauri::State<'_, Mutex<Store>>) -> Result<Day, String> {
    let saved = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.save(day).map_err(|e| e.to_string())?;
    let changed: Vec<&String> = std::iter::once(&saved.date).chain(&saved.touched).collect();
    let _ = app.emit("journal:changed", changed);
    Ok(saved)
}

#[tauri::command]
async fn load_linked(id: String, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<LinkedEntry>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.linked(&id).map_err(|e| e.to_string())
}

/// Removing or finishing linked entries on other days; like saving, it tells the calendars which days changed.
#[tauri::command]
async fn change_linked(app: tauri::AppHandle, changes: Vec<LinkedChange>, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<String>, String> {
    let touched = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.change_linked(&changes).map_err(|e| e.to_string())?;
    let _ = app.emit("journal:changed", &touched);
    Ok(touched)
}

/// Opens (or brings back) the calendar window or the compact month window. Each exists at most once.
#[tauri::command]
async fn open_window(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&kind) {
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let (title, size, min) = match kind.as_str() {
        "calendar" => ("Kalender", (1120.0, 760.0), (640.0, 460.0)),
        "mini" => ("Monat", (292.0, 330.0), (252.0, 300.0)),
        _ => return Err("Unbekanntes Fenster".into()),
    };
    WebviewWindowBuilder::new(&app, &kind, WebviewUrl::App("index.html".into()))
        .title(title).inner_size(size.0, size.1).min_inner_size(min.0, min.1)
        .theme(Some(tauri::Theme::Dark)).background_color(tauri::window::Color(0, 0, 0, 255))
        .build().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows a day (and optionally one of its entries) in the journal window and brings that window to the front.
#[tauri::command]
async fn show_day(app: tauri::AppHandle, date: String, entry: Option<String>) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Das Journal-Fenster ist geschlossen")?;
    app.emit_to("main", "journal:navigate", serde_json::json!({ "date": date, "entry": entry })).map_err(|e| e.to_string())?;
    let _ = main.unminimize();
    main.set_focus().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Mutex::new(Store::open(&dir.join("journal.sqlite3"))?));
            Ok(())
        })
        // The calendars only show the journal; without its window they have nothing to open, so they close with it.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) { window.app_handle().exit(0); }
        })
        .invoke_handler(tauri::generate_handler![load_day, load_range, save_day, load_linked, change_linked, open_window, show_day])
        .run(tauri::generate_context!()).expect("Journal konnte nicht gestartet werden");
}
