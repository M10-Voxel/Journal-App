#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod reminders;
mod drive;
mod board;
mod history;
mod storage;
mod mail;
mod ui_language;
mod vault;

use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use storage::{CalendarDay, CalendarImport, Day, LinkedChange, LinkedEntry, Reminder, SeriesExtension, SeriesInfo, Store, Tag};

/// Every window shares one WebView2 environment, so all are created with the same arguments (those of the main window in
/// tauri.conf.json): Tauri's defaults, and sound without a click first (the reminders' chime).
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";
/// The arguments for windows made here; JOURNAL_BROWSER_ARGS adds to them (only for testing, together with the same
/// addition in the main window's configuration).
pub fn browser_args() -> String { std::env::var("JOURNAL_BROWSER_ARGS").map_or_else(|_| BROWSER_ARGS.to_string(), |extra| format!("{BROWSER_ARGS} {extra}")) }
static QUITTING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn move_calendar_entry(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, id: String, from: String, to: String, time: Option<String>, end: Option<String>) -> Result<Vec<String>, String> {
    let touched=store.lock().map_err(|e|e.to_string())?.move_calendar_entry(&id,&from,&to,time,end).map_err(|e|e.to_string())?;
    let _=app.emit("journal:changed", &touched); Ok(touched)
}

#[tauri::command]
fn load_period_data(store: tauri::State<'_, Mutex<Store>>) -> Result<String, String> {
    store.lock().map_err(|e| e.to_string())?.period_data().map_err(|e| e.to_string())
}
#[tauri::command]
fn save_period_data(data: String, store: tauri::State<'_, Mutex<Store>>) -> Result<(), String> {
    store.lock().map_err(|e| e.to_string())?.save_period_data(&data).map_err(|e| e.to_string())
}

/// Brings the journal window back (from the background, minimised or behind others).
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
}
/// Ending the app: the journal window saves what is pending first and then calls `quit_app`. Asked a second time, it ends at once.
pub fn request_quit(app: &tauri::AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) || app.get_webview_window("main").is_none() { app.exit(0); return; }
    let _ = app.emit_to("main", "journal:quit", ());
}

#[tauri::command]
async fn export_calendar(store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<CalendarDay>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.export_calendar().map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_calendar(app: tauri::AppHandle, entries: Vec<CalendarImport>, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<String>, String> {
    let touched = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.import_calendar(entries).map_err(|e| e.to_string())?;
    let _ = app.emit("journal:changed", &touched);
    let tags=store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.tags().map_err(|e|e.to_string())?;
    let _=app.emit("journal:tags",tags);
    Ok(touched)
}

#[tauri::command]
async fn read_calendar_file() -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new().set_title(ui_language::text("Kalender importieren", "Import calendar")).add_filter("iCalendar", &["ics"]).pick_file().await else { return Ok(None) };
    if std::fs::metadata(file.path()).map_err(|e| e.to_string())?.len() > 5_000_000 { return Err("Die ICS-Datei ist zu groß (höchstens 5 MB)".into()); }
    String::from_utf8(file.read().await).map(Some).map_err(|_| "Die ICS-Datei muss UTF-8 enthalten".into())
}

#[tauri::command]
async fn write_calendar_file(content: String) -> Result<bool, String> {
    if content.len() > 25_000_000 || !content.starts_with("BEGIN:VCALENDAR") { return Err("Ungültige Kalenderdatei".into()); }
    let Some(file) = rfd::AsyncFileDialog::new().set_title(ui_language::text("Kalender exportieren", "Export calendar")).set_file_name("Journal.ics").add_filter("iCalendar", &["ics"]).save_file().await else { return Ok(false) };
    file.write(content.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(true)
}

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

/// Passing an edit made in the calendar on to chosen entries of its group; the calendars hear which days changed.
#[tauri::command]
async fn edit_linked(app: tauri::AppHandle, ids: Vec<String>, edit: storage::LinkedEdit, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<String>, String> {
    let touched = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.edit_linked(&ids, &edit).map_err(|e| e.to_string())?;
    let _ = app.emit("journal:changed", &touched);
    Ok(touched)
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) { app.exit(0); }

// Async like the others: on Windows, creating or closing a window from a synchronous command could deadlock.
#[tauri::command]
async fn popup_reminders(popup: tauri::State<'_, reminders::popup::Popup>) -> Result<Vec<Reminder>, String> {
    Ok(popup.items.lock().map(|items| items.clone()).unwrap_or_default())
}
#[tauri::command]
async fn fit_popup(app: tauri::AppHandle, window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    reminders::popup::fit(&app, &window, height.clamp(60.0, 900.0)).map_err(|e| e.to_string())
}
#[tauri::command]
async fn reminder_action(app: tauri::AppHandle, id: String, due: String, action: String) { reminders::popup::answer(&app, &id, &due, &action); }
/// Closing the journal window the first time, the popup says that the app keeps running (and reminding) in the background.
#[tauri::command]
async fn background_hint(app: tauri::AppHandle) -> Result<(), String> {
    let hint = Reminder { id: "background".into(), date: String::new(), kind: "info".into(), text: "Journal läuft im Hintergrund weiter und erinnert dich. Öffnen und Beenden über das Symbol im Infobereich.".into(), time: None, end: None, due: String::new(), late: false, snoozed: false };
    reminders::popup::push(&app, hint).map_err(|e| e.to_string())
}

/// Shows a reminder popped up inside the app again a little later.
#[tauri::command]
async fn snooze_reminder(id: String, due: String, store: tauri::State<'_, Mutex<Store>>) -> Result<(), String> {
    let until = chrono::Local::now().naive_local() + chrono::Duration::minutes(reminders::SNOOZE_MINUTES);
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.snooze_reminder(&id, &due, until).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_series(store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<SeriesInfo>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.series().map_err(|e| e.to_string())
}

/// Adding the occurrences of repeating series beyond their horizon; the calendars hear which days changed.
#[tauri::command]
async fn extend_series(app: tauri::AppHandle, extensions: Vec<SeriesExtension>, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<String>, String> {
    let touched = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.extend_series(&extensions).map_err(|e| e.to_string())?;
    if !touched.is_empty() { let _ = app.emit("journal:changed", &touched); }
    Ok(touched)
}

/// The search over every day (storage.rs); the board and notebook are searched in the app, where their cards are.
#[tauri::command]
async fn search_entries(words: Vec<String>, kinds: Vec<String>, tags: Vec<String>, limit: usize, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<storage::SearchHit>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.search(&words, &kinds, &tags, limit).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_tags(store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<Tag>, String> {
    store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?.tags().map_err(|e| e.to_string())
}

/// Every window hears the new list (`journal:tags`); days whose entries lost a removed tag are shown anew.
#[tauri::command]
async fn save_tags(app: tauri::AppHandle, tags: Vec<Tag>, store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<Tag>, String> {
    let (saved, touched) = {
        let mut store = store.lock().map_err(|_| "Speicher ist gesperrt".to_string())?;
        let touched = store.save_tags(&tags).map_err(|e| e.to_string())?;
        (store.tags().map_err(|e| e.to_string())?, touched)
    };
    let _ = app.emit("journal:tags", &saved);
    if !touched.is_empty() { let _ = app.emit("journal:changed", &touched); }
    Ok(saved)
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
        .title(title).inner_size(size.0, size.1).min_inner_size(min.0, min.1).additional_browser_args(&browser_args())
        .theme(Some(tauri::Theme::Dark)).background_color(tauri::window::Color(0, 0, 0, 255))
        .build().map(|_| ()).map_err(|e| e.to_string())
}

/// A window of Nebula's desk pulled out of the journal (calendar, notebook, board) as a window of its own, where the
/// pointer let go of it. It draws its own frame exactly as in the app: no system frame, transparent, and no shadow, which
/// on Windows also takes away the rounded corners. Closing it tells the journal (`nebula:panel-closed`), which takes the
/// board back into its grid.
#[tauri::command]
async fn panel_detach(app: tauri::AppHandle, kind: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !matches!(kind.as_str(), "calendar" | "notebook" | "board") { return Err("Unbekanntes Fenster".into()); }
    let label = format!("panel-{kind}");
    if let Some(window) = app.get_webview_window(&label) { let _ = window.unminimize(); return window.set_focus().map_err(|e| e.to_string()); }
    let (width, height) = (width.clamp(320.0, 2400.0), height.clamp(240.0, 1600.0));
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Journal").position(x, y).inner_size(width, height).min_inner_size(320.0, 240.0)
        .decorations(false).transparent(true).shadow(false).resizable(true).additional_browser_args(&browser_args())
        .theme(Some(tauri::Theme::Dark)).build().map_err(|e| e.to_string())?;
    let handle = app.clone();
    window.on_window_event(move |event| if let tauri::WindowEvent::Destroyed = event { let _ = handle.emit_to("main", "nebula:panel-closed", kind.clone()); });
    Ok(())
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
    if std::env::args().nth(1).as_deref() == Some("--mail-ml-worker") {
        if let Some(root) = std::env::args_os().nth(2) { if mail::ml::worker(std::path::Path::new(&root)).is_err() { std::process::exit(1); } }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_page_load(|webview, _| {
            // Disable only WebView2's built-in menus, including those inside sandboxed mail frames.
            // DOM contextmenu events still reach the app's own menus and editors.
            #[cfg(windows)]
            if let Err(error) = webview.with_webview(|platform| unsafe {
                let result = platform.controller().CoreWebView2()
                    .and_then(|view| view.Settings())
                    .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false));
                if let Err(error) = result { eprintln!("Could not disable default context menus: {error}"); }
            }) { eprintln!("Could not configure webview context menus: {error}"); }
        })
        // Started again, Journal brings back the running one instead of opening the database twice.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(reminders::popup::Popup::default())
        .manage(mail::ml::MlState::default())
        .setup(|app| {
            let vault = vault::Vault::load_or_choose(app.path().app_local_data_dir()?).map_err(std::io::Error::other)?;
            let dir = vault.path.clone();
            app.manage(vault);
            let store=Store::open(&dir.join("journal.sqlite3"))?;
            ui_language::initialize(&store);
            app.manage(Mutex::new(store));
            app.manage(mail::MailState::open(&dir.join("mail.sqlite3")).map_err(std::io::Error::other)?);
            reminders::start(app.handle().clone());
            mail::start(app.handle().clone());
            // Closing the window keeps Journal running in the background (see main.tsx); the icon in the notification area
            // opens it again (click) or ends it (menu).
            let open = MenuItem::with_id(app, "open", ui_language::text("Journal öffnen", "Open Journal"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", ui_language::text("Beenden", "Quit"), true, None::<&str>)?;
            let mut tray = TrayIconBuilder::with_id("journal").tooltip("Journal").menu(&Menu::with_items(app, &[&open, &quit])?).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() { "open" => show_main(app), "quit" => request_quit(app), _ => {} })
                .on_tray_icon_event(|tray, event| if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { show_main(tray.app_handle()); });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        // The calendars only show the journal; without its window they have nothing to open, so they close with it.
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if let tauri::WindowEvent::Focused(active) = event {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    let active = *active;
                    let _ = webview.with_webview(move |platform| unsafe {
                        use windows::core::Interface;
                        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_19,COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL};
                        if let Ok(view) = platform.controller().CoreWebView2().and_then(|view|view.cast::<ICoreWebView2_19>()) {
                            let _ = view.SetMemoryUsageTargetLevel(if active {COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL}else{COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW});
                        }
                    });
                }
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) { window.app_handle().exit(0); }
        })
        .invoke_handler(tauri::generate_handler![vault::vault_status, vault::vault_choose, vault::vault_save_preferences, vault::vault_activate, move_calendar_entry, panel_detach, history::history_step,board::board_list, board::board_patch, board::board_patch_many, board::board_image_save, board::board_image_load, board::board_link_preview, board::board_open_link, board::board_detach, board::board_remove, board::board_folders, board::board_folder_save, board::board_folder_remove,drive::drive_help, drive::drive_validate, drive::drive_restore, drive::drive_status, drive::drive_connect, drive::drive_cancel, drive::drive_disconnect, drive::drive_read, drive::drive_write, drive::drive_snapshot, drive::drive_apply,load_period_data, save_period_data, ui_language::set_ui_language, load_day, load_range, save_day, load_linked, change_linked, edit_linked, load_series, extend_series, load_tags, save_tags, search_entries, snooze_reminder, quit_app, popup_reminders, fit_popup, reminder_action, background_hint, open_window, show_day, export_calendar, import_calendar, read_calendar_file, write_calendar_file, mail::mail_drive_snapshot, mail::mail_drive_validate, mail::mail_drive_apply, mail::mail_accounts, mail::mail_save, mail::mail_cancel, mail::mail_sync, mail::mail_remove, mail::mail_pending, mail::mail_stage, mail::mail_candidates, mail::mail_resolve, mail::mail_enabled, mail::mail_notices, mail::mail_help, mail::ml::mail_ml_status, mail::ml::mail_ml_enabled, mail::ml::mail_ml_install, mail::ml::mail_ml_analyze])
        .run(tauri::generate_context!()).expect("Journal konnte nicht gestartet werden");
}
