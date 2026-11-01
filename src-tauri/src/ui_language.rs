use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{Manager, menu::{Menu, MenuItem}};
use crate::storage::Store;

static ENGLISH: AtomicBool = AtomicBool::new(false);
pub fn initialize(store: &Store) { ENGLISH.store(store.interface_language().unwrap_or_default() == "en", Ordering::Relaxed); }
pub fn text<'a>(german: &'a str, english: &'a str) -> &'a str { if ENGLISH.load(Ordering::Relaxed) { english } else { german } }

#[tauri::command]
pub fn set_ui_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if !matches!(language.as_str(), "de" | "en") { return Err("Unsupported language".into()); }
    app.state::<Mutex<Store>>().lock().map_err(|e|e.to_string())?.set_interface_language(&language).map_err(|e|e.to_string())?;
    ENGLISH.store(language == "en", Ordering::Relaxed);
    if let Some(tray) = app.tray_by_id("journal") {
        let open=MenuItem::with_id(&app,"open",text("Journal öffnen","Open Journal"),true,None::<&str>).map_err(|e|e.to_string())?;
        let quit=MenuItem::with_id(&app,"quit",text("Beenden","Quit"),true,None::<&str>).map_err(|e|e.to_string())?;
        tray.set_menu(Some(Menu::with_items(&app,&[&open,&quit]).map_err(|e|e.to_string())?)).map_err(|e|e.to_string())?;
    }
    Ok(())
}
