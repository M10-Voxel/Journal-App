//! Reminders. A background thread asks the store at every full minute which reminders are due (see `Store::due_reminders`).
//! With the journal window in front they pop up inside the app (event `journal:reminder`, see ReminderToasts.tsx).
//! Otherwise – the window behind others, minimised or closed into the background – they come in a popup of the app's
//! own: a small borderless window above everything at the bottom right of the screen, with the same cards and the same
//! chime (`popup` below). Only if that cannot be shown does Windows show them as a notification (`toast`).
//! Finishing goes through the journal window (`journal:reminder-action`), which may hold unsaved edits of that day.
use crate::storage::{Reminder, Store};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Windows knows the app by this ID (registered for the current user, see `toast::register`).
pub const APP_ID: &str = "de.journal.local";
pub const SNOOZE_MINUTES: i64 = 10;
/// Cards shown at once; more missed reminders are counted in one note.
const MAX_CARDS: usize = 3;

pub fn start(app: AppHandle) {
    #[cfg(windows)]
    if let Err(error) = toast::register(&app) { eprintln!("Windows-Benachrichtigungen nicht verfügbar: {error}"); }
    std::thread::spawn(move || loop {
        let now = chrono::Local::now().naive_local();
        let due = app.state::<Mutex<Store>>().lock().ok().and_then(|mut store| store.due_reminders(now).ok()).unwrap_or_default();
        // Many at once (after days away): the newest few as cards, the rest in one note.
        let shown = due.len().min(MAX_CARDS);
        let rest = due.len() - shown;
        for reminder in due.into_iter().skip(rest) { deliver(&app, reminder); }
        if rest > 0 { deliver(&app, Reminder { id: "missed".into(), date: String::new(), kind: "info".into(), text: format!("Noch {rest} weitere verpasste Erinnerung{} – im Journal an ihren Tagen.", if rest == 1 { "" } else { "en" }), time: None, end: None, due: String::new(), late: true, snoozed: false }); }
        // Just after the next full minute, as reminders are set to the minute.
        let second = u64::from(chrono::Timelike::second(&chrono::Local::now()));
        std::thread::sleep(std::time::Duration::from_secs(61 - second.min(59)));
    });
}

/// The journal window is the one in front: focused, shown and not minimized.
fn in_front(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|window| window.is_focused().unwrap_or(false) && window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true))
}

fn deliver(app: &AppHandle, reminder: Reminder) {
    if in_front(app) { let _ = app.emit_to("main", "journal:reminder", &reminder); return; }
    if popup::push(app, reminder.clone()).is_ok() { return; }
    #[cfg(windows)]
    if toast::show(app, &reminder).is_ok() { return; }
    let _ = app.emit_to("main", "journal:reminder", &reminder);
}

/// What a reminder's buttons do: `snooze` shows it again later, `done` / `cancelled` set the task's state, anything else
/// opens its day.
pub fn act(app: &AppHandle, reminder: &Reminder, action: &str) {
    match action {
        "snooze" => {
            let until = chrono::Local::now().naive_local() + chrono::Duration::minutes(SNOOZE_MINUTES);
            if let Ok(mut store) = app.state::<Mutex<Store>>().lock() { let _ = store.snooze_reminder(&reminder.id, &reminder.due, until); }
        }
        "done" | "cancelled" => { let _ = app.emit_to("main", "journal:reminder-action", serde_json::json!({ "id": reminder.id, "date": reminder.date, "action": action })); }
        _ => {
            if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
            if !reminder.date.is_empty() { let _ = app.emit_to("main", "journal:navigate", serde_json::json!({ "date": reminder.date, "entry": reminder.id })); }
        }
    }
}

/// The popup outside the app: its cards (reminders, or the hint that the app keeps running), in the order they came.
pub mod popup {
    use super::*;
    pub const LABEL: &str = "reminder";
    const WIDTH: f64 = 360.0;
    const MARGIN: f64 = 12.0;
    #[derive(Default)]
    pub struct Popup { pub items: Mutex<Vec<Reminder>> }

    pub fn push(app: &AppHandle, item: Reminder) -> tauri::Result<()> {
        let items = {
            let state = app.state::<Popup>();
            let mut items = state.items.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            items.retain(|other| other.id != item.id);
            items.push(item);
            if items.len() > 4 { items.remove(0); }
            items.clone()
        };
        if let Some(window) = app.get_webview_window(LABEL) { return window.emit("journal:popup", &items); }
        // Created shown but without focus, so typing elsewhere goes on; its page sizes it to the cards (`fit`).
        let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
            .title("Journal – Erinnerung").inner_size(WIDTH, 150.0).decorations(false).transparent(true).shadow(false)
            .always_on_top(true).skip_taskbar(true).focused(false).resizable(false).maximizable(false).minimizable(false)
            .background_color(tauri::window::Color(0, 0, 0, 0)).additional_browser_args(&crate::browser_args()).build()?;
        fit(app, &window, 150.0)
    }
    /// The popup's size follows its cards; it sits at the bottom right of the work area (above the taskbar) of the
    /// screen the journal window is on.
    pub fn fit(app: &AppHandle, window: &tauri::WebviewWindow, height: f64) -> tauri::Result<()> {
        let monitor = app.get_webview_window("main").and_then(|main| main.current_monitor().ok().flatten()).or(window.primary_monitor()?);
        window.set_size(tauri::LogicalSize::new(WIDTH, height))?;
        if let Some(monitor) = monitor {
            let (area, scale) = (monitor.work_area(), monitor.scale_factor());
            let x = area.position.x + area.size.width as i32 - ((WIDTH + MARGIN) * scale) as i32;
            let y = area.position.y + area.size.height as i32 - ((height + MARGIN) * scale) as i32;
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
        Ok(())
    }
    /// A card's button: the reminder's action (see `act`), or `dismiss`; `quit` ends the app. The last card closes the popup.
    pub fn answer(app: &AppHandle, id: &str, due: &str, action: &str) {
        let (item, rest) = {
            let state = app.state::<Popup>();
            let mut items = state.items.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let index = items.iter().position(|item| item.id == id && item.due == due);
            (index.map(|index| items.remove(index)), items.clone())
        };
        match app.get_webview_window(LABEL) {
            Some(window) if rest.is_empty() => { let _ = window.close(); }
            Some(window) => { let _ = window.emit("journal:popup", &rest); }
            None => {}
        }
        match (item, action) {
            (_, "quit") => crate::request_quit(app),
            (Some(item), "open") => act(app, &item, "open"),
            (Some(item), action) if action != "dismiss" && item.kind != "info" => act(app, &item, action),
            _ => {}
        }
    }
}

/// The entry's first line without Markdown marks (`**`, `*`, `~~`, `==`, `[text]{colour}`).
pub fn plain(text: &str) -> String {
    let line = text.lines().find(|line| !line.trim().is_empty()).unwrap_or("").trim();
    let mut result = String::new();
    let mut chars = line.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '\\' => { if let Some(next) = chars.next() { result.push(next); } }
            '*' | '~' | '=' | '[' => {}
            ']' if chars.peek() == Some(&'{') => { for skipped in chars.by_ref() { if skipped == '}' { break; } } }
            ']' => {}
            _ => result.push(char),
        }
    }
    let result = result.split_whitespace().collect::<Vec<_>>().join(" ");
    if result.is_empty() { "Ohne Text".into() } else { result }
}

/// "Aufgabe · 14:15–15:00 · Sa., 31.10. · verpasst".
pub fn describe(reminder: &Reminder, today: &str) -> String {
    let mut parts = vec![if reminder.kind == "task" { crate::ui_language::text("Aufgabe","Task").to_string() } else { crate::ui_language::text("Ereignis","Event").to_string() }];
    if let Some(time) = &reminder.time { parts.push(match &reminder.end { Some(end) => format!("{time}–{end}"), None => time.clone() }); }
    if reminder.date != today {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(&reminder.date, "%Y-%m-%d") {
            let days = if crate::ui_language::text("de","en")=="en" { ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] } else { ["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."] };
            parts.push(format!("{} {}", days[chrono::Datelike::weekday(&date).num_days_from_monday() as usize], date.format("%d.%m.")));
        }
    }
    if reminder.snoozed { parts.push(crate::ui_language::text("erneut","again").into()); } else if reminder.late { parts.push(crate::ui_language::text("verpasst","missed").into()); }
    parts.join(" · ")
}

#[cfg(windows)]
mod toast {
    use super::{act, describe, plain, APP_ID, SNOOZE_MINUTES};
    use crate::storage::Reminder;
    use std::{path::PathBuf, sync::Mutex};
    use tauri::{AppHandle, Manager};
    use windows::{core::{IInspectable, Interface, HSTRING}, Data::Xml::Dom::XmlDocument, Foundation::TypedEventHandler, UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager}};

    const ICONS: [(&str, &[u8]); 3] = [
        ("journal.png", include_bytes!("../icons/128x128@2x.png")),
        ("reminder-task.png", include_bytes!("../icons/reminders/reminder-task.png")),
        ("reminder-event.png", include_bytes!("../icons/reminders/reminder-event.png")),
    ];
    /// Where the icons lie, and the notifications on screen: their buttons only answer while they are kept alive.
    struct Toasts { icons: PathBuf, shown: Mutex<Vec<ToastNotification>> }

    /// Windows shows notifications of an app that is not installed from a package under the name and icon registered for
    /// its ID (HKCU\Software\Classes\AppUserModelId); without that they would come from "Windows PowerShell".
    pub fn register(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let icons = app.path().app_local_data_dir()?.join("notifications");
        std::fs::create_dir_all(&icons)?;
        for (name, bytes) in ICONS {
            let path = icons.join(name);
            if std::fs::read(&path).ok().as_deref() != Some(bytes) { std::fs::write(&path, bytes)?; }
        }
        let (key, _) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).create_subkey(format!("Software\\Classes\\AppUserModelId\\{APP_ID}"))?;
        key.set_value("DisplayName", &"Journal")?;
        key.set_value("IconUri", &icons.join("journal.png").to_string_lossy().to_string())?;
        key.set_value("IconBackgroundColor", &"FF252525")?;
        app.manage(Toasts { icons, shown: Mutex::new(Vec::new()) });
        Ok(())
    }

    fn escape(text: &str) -> String { text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }

    pub fn show(app: &AppHandle, reminder: &Reminder) -> windows::core::Result<()> {
        let toasts = app.try_state::<Toasts>().ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(0x8000_4005_u32 as i32)))?;
        let today = chrono::Local::now().date_naive().to_string();
        let icon = toasts.icons.join(if reminder.kind == "task" { "reminder-task.png" } else { "reminder-event.png" });
        let done = if reminder.kind == "task" { format!(r#"<action content="{}" arguments="done" activationType="foreground"/>"#,crate::ui_language::text("Erledigt","Completed")) } else { String::new() };
        let attribution=crate::ui_language::text("Erinnerung","Reminder");
        let later=crate::ui_language::text("Min. später","min later");
        let open=crate::ui_language::text("Öffnen","Open");
        // "reminder" keeps it on screen until answered, with the reminder sound.
        let xml = format!(r#"<toast scenario="reminder" launch="open" activationType="foreground">
            <visual><binding template="ToastGeneric">
              <text hint-maxLines="2">{title}</text><text>{line}</text><text placement="attribution">{attribution}</text>
              <image placement="appLogoOverride" src="file:///{icon}"/>
            </binding></visual>
            <actions>{done}<action content="{SNOOZE_MINUTES} {later}" arguments="snooze" activationType="foreground"/><action content="{open}" arguments="open" activationType="foreground"/></actions>
            <audio src="ms-winsoundevent:Notification.Reminder"/>
          </toast>"#, title = escape(&plain(&reminder.text)), line = escape(&describe(reminder, &today)), icon = escape(&icon.to_string_lossy().replace('\\', "/")));
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        let (handle, item) = (app.clone(), reminder.clone());
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, args| {
            let action = args.ok().ok().and_then(|args| args.cast::<ToastActivatedEventArgs>().ok()).and_then(|args| args.Arguments().ok()).map(|value| value.to_string()).unwrap_or_default();
            act(&handle, &item, &action);
            Ok(())
        }))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))?.Show(&toast)?;
        let mut shown = toasts.shown.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        shown.push(toast);
        if shown.len() > 20 { shown.remove(0); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reminder(kind: &str, date: &str, time: Option<&str>, end: Option<&str>) -> Reminder {
        Reminder { id: "id".into(), date: date.into(), kind: kind.into(), text: String::new(), time: time.map(Into::into), end: end.map(Into::into), due: String::new(), late: false, snoozed: false }
    }
    #[test] fn texts_read_like_the_app() {
        assert_eq!(plain("**Anna** anrufen wegen [Geburtstag]{red} ==morgen==\nZweite Zeile"), "Anna anrufen wegen Geburtstag morgen");
        assert_eq!(plain("  \n"), "Ohne Text");
        assert_eq!(plain(r"2 \* 3"), "2 * 3");
        assert_eq!(describe(&reminder("task", "2026-10-30", Some("14:15"), Some("15:00")), "2026-10-30"), "Aufgabe · 14:15–15:00");
        let mut late = reminder("event", "2026-10-31", None, None); late.late = true;
        assert_eq!(describe(&late, "2026-10-30"), "Ereignis · Sa. 31.10. · verpasst");
    }
}
