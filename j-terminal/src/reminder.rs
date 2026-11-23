//! Reminders when J-TerminaL runs without the Journal app. As in the app (`src-tauri/src/reminders.rs`, branch
//! `Windows`) the store is asked just after every full minute which reminders are due (`Store::due_reminders`); each
//! comes once, as the store logs it, even when both programs share the journal. While the Journal app runs it shows
//! them itself and J-TerminaL keeps out (its single-instance lock, see `journal_app_running`).
//!
//! They come as small cards at the bottom right of the screen (`ui/reminder.slint`), above every window and without
//! taking the keyboard, with the system's reminder sound. Only the mouse works on them: the title opens the day,
//! "Erledigt" finishes a task, "10 Min. später" shows it again then (the wheel over it changes the minutes one by one),
//! "Ausblenden" drops the card.
use std::{cell::RefCell, time::Duration};
use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, Timelike};
use journal_core::storage::{Reminder, Store};
use slint::{winit_030::{winit::event::WindowEvent, EventResult, WinitWindowAccessor}, ComponentHandle, Model, VecModel};
use crate::{texts::{reminder_texts, Language}, ReminderCard, ReminderWindow};

/// Shown again after this many minutes, unless the wheel chose otherwise.
pub const SNOOZE_DEFAULT: i32 = 10;
/// The wheel keeps the minutes within a day.
pub const SNOOZE_MAX: i32 = 24 * 60;
/// Due at once (after days away): the newest few as cards, the rest counted in one note.
const MAX_CARDS: usize = 3;
/// Cards on screen at most; the oldest goes.
const MAX_SHOWN: usize = 4;
/// The lock `tauri-plugin-single-instance` holds while the Journal app runs (its identifier and `-sim`).
#[cfg(windows)]
const JOURNAL_APP_LOCK: &str = "de.journal.local-sim";

/// A card on screen.
#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    pub reminder: Reminder,
    pub snooze: i32,
}

impl Card {
    fn new(reminder: Reminder) -> Self { Self { reminder, snooze: SNOOZE_DEFAULT } }
    /// The note about further missed reminders.
    pub fn info(&self) -> bool { self.reminder.kind == "info" }
}

/// What is due at `now`: at most `MAX_CARDS` reminders (the newest), and how many more there were.
pub fn collect(store: &mut Store, now: NaiveDateTime) -> Result<(Vec<Reminder>, usize), String> {
    let mut due = store.due_reminders(now).map_err(|e| e.to_string())?;
    let rest = due.len().saturating_sub(MAX_CARDS);
    Ok((due.split_off(rest), rest))
}

/// New cards join the ones on screen (a reminder shown again replaces its old card); the oldest go beyond `MAX_SHOWN`.
pub fn push(cards: &mut Vec<Card>, reminder: Reminder) {
    cards.retain(|card| card.reminder.id != reminder.id);
    cards.push(Card::new(reminder));
    if cards.len() > MAX_SHOWN { cards.drain(..cards.len() - MAX_SHOWN); }
}

/// The note counting `rest` further missed reminders, as a card of its own.
pub fn more(rest: usize, language: Language) -> Reminder {
    let t = reminder_texts(language);
    let text = if rest == 1 { t.more_one } else { t.more_many }.replace("%n", &rest.to_string());
    Reminder { id: "missed".into(), date: String::new(), kind: "info".into(), text, time: None, end: None, due: String::new(), late: true, snoozed: false }
}

/// The wheel's minutes: one per notch, from 1 to `SNOOZE_MAX`.
pub fn wheel(minutes: i32, steps: i32) -> i32 { (minutes + steps).clamp(1, SNOOZE_MAX) }

/// The entry's first line without Markdown marks (`**`, `*`, `~~`, `==`, `[text]{colour}`), as the app shows it.
pub fn plain(text: &str, language: Language) -> String {
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
    if result.is_empty() { reminder_texts(language).untitled.into() } else { result }
}

/// "Aufgabe · 14:15–15:00 · Sa. 31.10. · verpasst".
pub fn describe(reminder: &Reminder, today: NaiveDate, language: Language) -> String {
    let t = reminder_texts(language);
    let mut parts = vec![if reminder.kind == "task" { t.task } else { t.event }.to_string()];
    if let Some(time) = &reminder.time { parts.push(match &reminder.end { Some(end) => format!("{time}–{end}"), None => time.clone() }); }
    if let Ok(date) = NaiveDate::parse_from_str(&reminder.date, "%Y-%m-%d") {
        if date != today { parts.push(format!("{} {}", t.weekdays[date.weekday().num_days_from_monday() as usize], date.format("%d.%m."))); }
    }
    if reminder.snoozed { parts.push(t.again.into()); } else if reminder.late { parts.push(t.missed.into()); }
    parts.join(" · ")
}

fn card_row(card: &Card, today: NaiveDate, language: Language) -> ReminderCard {
    let t = reminder_texts(language);
    let info = card.info();
    ReminderCard {
        title: if info { card.reminder.text.clone() } else { plain(&card.reminder.text, language) }.into(),
        line: if info { String::new() } else { describe(&card.reminder, today, language) }.into(),
        later: format!("{} {}", card.snooze, t.later).into(),
        task: card.reminder.kind == "task",
        info,
    }
}

/// Whether the Journal app runs (it then shows the reminders itself).
#[cfg(windows)]
pub fn journal_app_running() -> bool { lock_held(JOURNAL_APP_LOCK) }
#[cfg(not(windows))]
pub fn journal_app_running() -> bool { false }

#[cfg(windows)]
fn lock_held(name: &str) -> bool {
    use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::OpenMutexW};
    const SYNCHRONIZE: u32 = 0x0010_0000;
    let name: Vec<u16> = name.encode_utf16().chain([0]).collect();
    let handle = unsafe { OpenMutexW(SYNCHRONIZE, 0, name.as_ptr()) };
    if handle.is_null() { return false; }
    unsafe { CloseHandle(handle) };
    true
}

/// The system's reminder sound (as the app's notifications), without a fallback beep.
fn chime() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};
        let alias: Vec<u16> = "Notification.Reminder".encode_utf16().chain([0]).collect();
        unsafe { PlaySoundW(alias.as_ptr(), std::ptr::null_mut(), SND_ALIAS | SND_ASYNC | SND_NODEFAULT) };
    }
}

// ----- On the UI thread -----

struct State {
    /// Off for a test journal (`--data`): the Journal app never shows that one's reminders.
    defer_to_app: bool,
    timer: slint::Timer,
    window: Option<ReminderWindow>,
    cards: Vec<Card>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    /// Set while the card window is made, so the window hook gives it its look (main.rs).
    pub static CREATING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Starts the checks: at once (reminders missed while nothing ran come now) and then just after every full minute.
/// `defer_to_app`: the journal is the Journal app's own, so a running app shows its reminders itself.
pub fn start(defer_to_app: bool) {
    STATE.with(|state| *state.borrow_mut() = Some(State { defer_to_app, timer: slint::Timer::default(), window: None, cards: Vec::new() }));
    slint::Timer::single_shot(Duration::ZERO, check);
}

fn schedule() {
    // Just after the next full minute, as reminders are set to the minute.
    let second = u64::from(Local::now().second());
    let wait = Duration::from_secs(61 - second.min(59));
    STATE.with(|state| if let Some(state) = state.borrow().as_ref() { state.timer.start(slint::TimerMode::SingleShot, wait, check); });
}

fn check() {
    let defer = STATE.with(|state| state.borrow().as_ref().is_some_and(|state| state.defer_to_app));
    if !(defer && journal_app_running()) {
        let now = Local::now().naive_local();
        let found = crate::with_app_value(|app| {
            let language = app.state.language;
            app.state.journal.as_mut().map(|journal| (collect(&mut journal.store, now), language))
        });
        match found {
            Some((Ok((due, rest)), language)) if !due.is_empty() || rest > 0 => {
                STATE.with(|state| if let Some(state) = state.borrow_mut().as_mut() {
                    for reminder in due { push(&mut state.cards, reminder); }
                    if rest > 0 { push(&mut state.cards, more(rest, language)); }
                });
                show(language);
                chime();
            }
            Some((Err(error), _)) => eprintln!("J-TerminaL: Erinnerungen: {error}"),
            _ => {}
        }
    }
    schedule();
}

fn language() -> Language { crate::with_app_value(|app| app.state.language) }

/// Shows the cards (or closes the window when none is left).
fn show(language: Language) {
    let today = Local::now().date_naive();
    let (window, rows) = STATE.with(|state| {
        let mut state = state.borrow_mut();
        let Some(state) = state.as_mut() else { return (None, Vec::new()) };
        let rows: Vec<ReminderCard> = state.cards.iter().map(|card| card_row(card, today, language)).collect();
        if rows.is_empty() {
            if let Some(window) = &state.window { let _ = window.hide(); }
            return (None, rows);
        }
        if state.window.is_none() { state.window = make_window().map_err(|e| eprintln!("J-TerminaL: Erinnerung: {e}")).ok(); }
        (state.window.as_ref().map(ComponentHandle::clone_strong), rows)
    });
    let Some(window) = window else { return };
    let t = reminder_texts(language);
    window.set_done_label(t.done.into());
    window.set_dismiss_label(t.dismiss.into());
    window.set_cards(std::rc::Rc::new(VecModel::from(rows)).into());
    if !window.window().is_visible() {
        CREATING.with(|creating| creating.set(true));
        let shown = window.show();
        CREATING.with(|creating| creating.set(false));
        if let Err(e) = shown { eprintln!("J-TerminaL: Erinnerung: {e}"); return; }
    }
    slint::Timer::single_shot(Duration::ZERO, place);
}

fn make_window() -> Result<ReminderWindow, slint::PlatformError> {
    CREATING.with(|creating| creating.set(true));
    let window = ReminderWindow::new();
    if let Ok(window) = &window { let _ = window.window(); }
    CREATING.with(|creating| creating.set(false));
    let window = window?;
    window.on_open(|index| act(index, Action::Open));
    window.on_done(|index| act(index, Action::Done));
    window.on_snooze(|index| act(index, Action::Snooze));
    window.on_dismiss(|index| act(index, Action::Dismiss));
    window.on_wheel(|index, steps| {
        let changed = STATE.with(|state| {
            let mut state = state.borrow_mut();
            let card = state.as_mut()?.cards.get_mut(usize::try_from(index).ok()?)?;
            card.snooze = wheel(card.snooze, steps);
            Some(card.snooze)
        });
        if let Some(minutes) = changed {
            with_window(|window| {
                let cards = window.get_cards();
                if let Some(mut row) = cards.row_data(index as usize) {
                    row.later = format!("{minutes} {}", reminder_texts(language()).later).into();
                    cards.set_row_data(index as usize, row);
                }
            });
        }
    });
    window.window().on_close_requested(|| {
        STATE.with(|state| if let Some(state) = state.borrow_mut().as_mut() { state.cards.clear(); });
        slint::CloseRequestResponse::HideWindow
    });
    // The height follows the cards; the window stays at the bottom.
    window.window().on_winit_window_event(|_, event| {
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) { slint::Timer::single_shot(Duration::ZERO, place); }
        EventResult::Propagate
    });
    Ok(window)
}

fn with_window(f: impl FnOnce(&ReminderWindow)) {
    let window = STATE.with(|state| state.borrow().as_ref().and_then(|state| state.window.as_ref().map(ComponentHandle::clone_strong)));
    if let Some(window) = window { f(&window); }
}

/// At the bottom right of the work area (above the taskbar) of the screen with the mouse. The native window exists
/// only once the event loop made it, so its style is set here as well.
fn place() {
    with_window(|window| {
        #[cfg(windows)]
        no_activate(window);
        let margin = window.global::<crate::Theme>().get_reminder_margin();
        window.window().with_winit_window(|native| {
            let screens: Vec<crate::placement::Screen> = native.available_monitors().map(crate::screen_for_monitor).collect();
            let Some(area) = crate::placement::pick(&screens, crate::placement::mouse()).map(crate::placement::work_area) else { return };
            let size = native.outer_size();
            let margin = (f64::from(margin) * area.scale).round() as i32;
            let x = area.left + area.width - size.width as i32 - margin;
            let y = area.top + area.height - size.height as i32 - margin;
            native.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(x, y));
        });
    });
}

/// Clicks on the cards do not take the keyboard from the window being typed in.
#[cfg(windows)]
fn no_activate(window: &ReminderWindow) {
    use slint::winit_030::winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW};
    window.window().with_winit_window(|native| {
        let Ok(handle) = native.window_handle() else { return };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else { return };
        let hwnd = handle.hwnd.get() as _;
        unsafe {
            let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            let wanted = (style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
            if wanted != style { SetWindowLongW(hwnd, GWL_EXSTYLE, wanted as i32); }
        }
    });
}

#[derive(Clone, Copy)]
enum Action { Open, Done, Snooze, Dismiss }

fn act(index: i32, action: Action) {
    let card = STATE.with(|state| {
        let mut state = state.borrow_mut();
        let state = state.as_mut()?;
        let index = usize::try_from(index).ok().filter(|index| *index < state.cards.len())?;
        Some(state.cards.remove(index))
    });
    let Some(card) = card else { return };
    let language = language();
    show(language);
    if card.info() { return; }
    let reminder = card.reminder;
    match action {
        Action::Dismiss => {}
        Action::Snooze => {
            let until = Local::now().naive_local() + chrono::Duration::minutes(i64::from(card.snooze));
            crate::with_app(|app| if let Some(journal) = app.state.journal.as_mut() {
                if let Err(e) = journal.store.snooze_reminder(&reminder.id, &reminder.due, until) { eprintln!("J-TerminaL: Erinnerung: {e}"); }
            });
        }
        Action::Done => crate::with_app(|app| {
            if let Err(e) = app.state.finish_task(&reminder.id) { eprintln!("J-TerminaL: Erinnerung: {e}"); }
            if app.bar.window().is_visible() { app.draw(); }
        }),
        Action::Open => {
            let Ok(date) = NaiveDate::parse_from_str(&reminder.date, "%Y-%m-%d") else { return };
            crate::open_day(date);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str, kind: &str, date: &str, time: Option<&str>, end: Option<&str>) -> Reminder {
        Reminder { id: id.into(), date: date.into(), kind: kind.into(), text: String::new(), time: time.map(Into::into), end: end.map(Into::into), due: String::new(), late: false, snoozed: false }
    }
    fn d(text: &str) -> NaiveDate { text.parse().unwrap() }
    fn at(text: &str) -> NaiveDateTime { NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M").unwrap() }

    #[test]
    fn texts_read_like_the_app() {
        assert_eq!(plain("**Anna** anrufen wegen [Geburtstag]{red} ==morgen==\nZweite Zeile", Language::De), "Anna anrufen wegen Geburtstag morgen");
        assert_eq!(plain("  \n", Language::De), "Ohne Text");
        assert_eq!(plain("", Language::En), "No text");
        assert_eq!(plain(r"2 \* 3", Language::De), "2 * 3");
        assert_eq!(describe(&reminder("a", "task", "2026-10-30", Some("14:15"), Some("15:00")), d("2026-10-30"), Language::De), "Aufgabe · 14:15–15:00");
        let mut late = reminder("a", "event", "2026-10-31", None, None);
        late.late = true;
        assert_eq!(describe(&late, d("2026-10-30"), Language::De), "Ereignis · Sa. 31.10. · verpasst");
        assert_eq!(describe(&late, d("2026-10-30"), Language::En), "Event · Sat 31.10. · missed");
        late.snoozed = true;
        assert_eq!(describe(&late, d("2026-10-31"), Language::De), "Ereignis · erneut");
    }

    #[test]
    fn the_wheel_moves_by_minutes_within_a_day() {
        assert_eq!(wheel(SNOOZE_DEFAULT, 1), 11);
        assert_eq!(wheel(SNOOZE_DEFAULT, -1), 9);
        assert_eq!(wheel(1, -1), 1, "At least a minute.");
        assert_eq!(wheel(SNOOZE_MAX, 3), SNOOZE_MAX);
    }

    #[test]
    fn cards_replace_their_old_one_and_keep_the_newest() {
        let mut cards = Vec::new();
        for id in ["a", "b", "c", "d", "e"] { push(&mut cards, reminder(id, "task", "2026-11-23", None, None)); }
        assert_eq!(cards.iter().map(|card| card.reminder.id.as_str()).collect::<Vec<_>>(), ["b", "c", "d", "e"]);
        cards[1].snooze = 25;
        push(&mut cards, reminder("c", "task", "2026-11-23", None, None));
        assert_eq!(cards.iter().map(|card| card.reminder.id.as_str()).collect::<Vec<_>>(), ["b", "d", "e", "c"]);
        assert_eq!(cards[3].snooze, SNOOZE_DEFAULT, "Shown again with the default minutes.");
        let note = more(2, Language::De);
        assert!(Card::new(note.clone()).info());
        assert_eq!(note.text, "Noch 2 weitere verpasste Erinnerungen – im Journal an ihren Tagen.");
        assert_eq!(more(1, Language::En).text, "1 more missed reminder – in the journal on its day.");
    }

    /// Against a test journal in the temp folder, never the real one.
    #[test]
    fn due_reminders_come_once_and_again_after_snoozing() {
        let path = std::env::temp_dir().join(format!("j-terminal-reminder-{}.sqlite3", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut store = Store::open(&path).unwrap();
        let mut day = store.load("2026-11-23").unwrap();
        let mut entries = Vec::new();
        for (name, time) in [("one", "09:00"), ("two", "09:01"), ("three", "09:02"), ("four", "09:03"), ("five", "09:04")] {
            let mut entry: journal_core::storage::Entry = serde_json::from_value(serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(), "kind": "task", "text": format!("**{name}**"), "done": false, "cancelled": false, "priority": false, "time": time, "reminder": true,
            })).unwrap();
            entry.reminder_before = 0;
            entries.push(entry);
        }
        day.entries = entries;
        store.save(day).unwrap();
        let names = |due: &[Reminder]| due.iter().map(|r| plain(&r.text, Language::De)).collect::<Vec<_>>();
        // The first check sets the start; nothing before it comes.
        assert_eq!(collect(&mut store, at("2026-11-23T08:00")).unwrap(), (Vec::new(), 0));
        let (due, rest) = collect(&mut store, at("2026-11-23T09:10")).unwrap();
        assert_eq!((names(&due), rest), (vec!["three".to_string(), "four".into(), "five".into()], 2), "The newest as cards, the rest counted.");
        assert!(due.iter().all(|r| r.late));
        assert_eq!(collect(&mut store, at("2026-11-23T09:11")).unwrap(), (Vec::new(), 0), "Each comes once.");
        store.snooze_reminder(&due[2].id, &due[2].due, at("2026-11-23T09:20")).unwrap();
        store.snooze_reminder(&due[1].id, &due[1].due, at("2026-11-23T09:20")).unwrap();
        // "Erledigt" on a card: a finished task is not shown again.
        store.change_linked(&[journal_core::storage::LinkedChange { id: due[1].id.clone(), action: "done".into() }]).unwrap();
        assert_eq!(collect(&mut store, at("2026-11-23T09:19")).unwrap().0, Vec::new());
        let (again, _) = collect(&mut store, at("2026-11-23T09:20")).unwrap();
        assert_eq!(again.iter().map(|r| (plain(&r.text, Language::De), r.snoozed)).collect::<Vec<_>>(), [("five".to_string(), true)]);
        drop(store);
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
    }

    #[cfg(windows)]
    #[test]
    fn sees_a_held_lock() {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::CreateMutexW};
        let name = format!("j-terminal-test-lock-{}", std::process::id());
        assert!(!lock_held(&name));
        let wide: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 1, wide.as_ptr()) };
        assert!(!handle.is_null());
        assert!(lock_held(&name));
        unsafe { CloseHandle(handle) };
        assert!(!lock_held(&name));
    }
}
