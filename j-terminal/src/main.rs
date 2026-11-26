//! J-TerminaL waits in the background for `Strg+Alt+Leertaste` and then shows the entry form for the journal.
//! The window is made hidden at start, so the shortcut only has to show it (docs/plan.md, section 3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod actions;
mod analysis;
mod analysis_ui;
mod period_settings;
mod features;
mod autostart;
mod calendar;
mod day;
mod day_ops;
mod day_view;
mod dial;
mod form;
mod icons;
mod board;
mod board_ink;
mod board_ui;
mod board_surface;
#[cfg(windows)] mod board_pointer;
mod notepad;
mod notebook;
mod note_markdown;
mod mail_preview;
mod note_images;
mod link_preview;
mod templates;
mod tag_edit;
mod tag_editor_ui;
mod notes_list;
mod repeat_sentence;
mod save;
mod snapshot;
mod instance;
mod journal;
mod placement;
mod reminder;
mod engine;
mod repeat;
mod shortcuts;
mod settings;
mod texts;
mod turned;

use std::{cell::RefCell, path::PathBuf, time::Duration};
use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use slint::{winit_030::{winit::event::WindowEvent, EventResult, WinitWindowAccessor}, ComponentHandle};
use day::Out;

slint::include_modules!();

#[derive(Debug, Default, PartialEq, Eq)]
struct Args {
    /// Started with Windows: wait without showing the window.
    background: bool,
    /// The Journal app's data folder; a test folder instead of the real one.
    data: Option<PathBuf>,
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut parsed = Args::default();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            autostart::BACKGROUND => parsed.background = true,
            "--data" => parsed.data = Some(args.next().ok_or("--data braucht einen Ordner")?.into()),
            other => return Err(format!("Unbekanntes Argument: {other}")),
        }
    }
    Ok(parsed)
}

/// Everything that lives on the UI thread.
#[derive(Default)]
struct NotepadMedia {
    draft: Option<uuid::Uuid>,
    thumbnails: std::collections::HashMap<String, Option<slint::Image>>,
    items: Vec<notebook::Item>,
    viewer_token: u64,
}

struct App {
    /// The tag editor, while open (a tag just made in a picker).
    tag_editor: Option<tag_edit::Editor>,
    floating_notes:std::collections::HashMap<String,FloatingBoardNote>,
    board: Option<board::Board>,
    /// The analysis over the whole window (`/Auswertung`).
    analysis: analysis_ui::State,
    board_images: std::collections::HashMap<String, slint::Image>,
    notepad_media: NotepadMedia,
    notepad_list_query: slint::SharedString,
    bar: Bar,
    settings: Option<SettingsWindow>,
    settings_navigation: settings::Navigation,
    preferences_path: Option<PathBuf>,
    journal_language: texts::Language,
    restore_launcher: bool,
    state: form::Form,
    notice: Option<String>,
    hide_timer: slint::Timer,
    /// A held key (its repeats) draws at most this often: the window keeps up instead of queueing a draw per repeat.
    draw_timer: slint::Timer,
    bindings: shortcuts::Bindings,
    hotkeys: Option<GlobalHotKeyManager>,
    active_hotkey: Option<HotKey>,
    /// What the day view's lines stand for (by the index the window gets), and the planning month's days.
    day_items: Vec<day_view::Item>,
    side_cells: Vec<chrono::NaiveDate>,
    /// The icon grid of the side panel with every icon: its names, its model and the first line in sight. Only the icons
    /// near what is seen (and the chosen one) are drawn; the others come when the grid is scrolled to them.
    side_icons: LazyIcons<SideRow>,
    /// The same for the tag editor's icons.
    tag_icons: LazyIcons<TagIcon>,
    /// Once a second while a timer runs: its clock moves on.
    tick: slint::Timer,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
    /// How often the program was told to quit (tests: a key must not do it by accident).
    static QUITS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

fn with_bar(f: impl FnOnce(&Bar)) {
    // The window's own handle, so the state is free again while `f` runs: showing the window can make Slint call back
    // at once (a new size of the calendar), and those callbacks need the state.
    let bar = APP.with(|app| app.borrow().as_ref().map(|app| app.bar.clone_strong()));
    if let Some(bar) = bar { f(&bar); }
}

fn with_app(f: impl FnOnce(&mut App)) {
    APP.with(|app| if let Some(app) = app.borrow_mut().as_mut() { f(app) });
}

#[cfg(windows)]
thread_local! {
    static CREATING_LAUNCHER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

thread_local! {
    static PICKING_IMAGE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// The file dialog closed. Keep ignoring focus loss a moment longer: Windows reports it only after the dialog is gone.
fn picking_done() {
    slint::Timer::single_shot(Duration::from_millis(400), || PICKING_IMAGE.with(|picking| picking.set(false)));
}

fn choose_notepad_image() {
    #[cfg(windows)]
    slint::Timer::single_shot(Duration::ZERO, || {
        let selected = APP.with(|slot| {
            let slot = slot.borrow();
            let app = slot.as_ref()?;
            let draft = app.state.notepad().filter(|draft| !draft.loading_image)?;
            Some((app.bar.clone_strong(), draft.card.id, app.state.language))
        });
        let Some((bar, note_id, language)) = selected else { return; };
        let labels = texts::notepad_texts(language);
        PICKING_IMAGE.with(|picking| picking.set(true));
        let dialog = || rfd::FileDialog::new().set_title(labels.image)
            .add_filter(labels.image, &["png", "jpeg", "jpg", "webp"]);
        let file = bar.window().with_winit_window(|window| dialog().set_parent(window).pick_file()).flatten();
        picking_done();
        let Some(path) = file else { return; };
        with_app(|app| { app.state.notepad_image_loading(true); app.draw(); });
        std::thread::spawn(move || {
            let result = notebook::Attachment::image(&path);
            let _ = slint::invoke_from_event_loop(move || with_app(|app| {
                app.state.finish_notepad_image(note_id, result);
                app.draw();
            }));
        });
    });
}

fn open_notepad_link(url: String) {
    let location = std::ffi::OsString::from(url);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let location: Vec<_> = location.encode_wide().chain([0]).collect();
        unsafe {
            ShellExecuteW(std::ptr::null_mut(), std::ptr::null(), location.as_ptr(),
                std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL);
        }
    }
    #[cfg(not(windows))]
    {
        let command = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        let _ = std::process::Command::new(command).arg(location).spawn();
    }
}

fn with_app_value<T>(f: impl FnOnce(&mut App) -> T) -> T {
    APP.with(|app| f(app.borrow_mut().as_mut().expect("the app is set up")))
}

thread_local! {
    /// Turned lane titles, drawn once per title, size and room.
    static TITLES: RefCell<std::collections::HashMap<(String, u32, u32), (slint::Image, f32, f32)>> = RefCell::new(std::collections::HashMap::new());
}

/// A lane's title as an image turned to read downwards, and its size in logical pixels.
fn lane_title(title: &str, size: f32, room: f32, scale: f32) -> (slint::Image, f32, f32) {
    let key = (title.to_string(), (room * scale) as u32 / 8, (size * scale) as u32);
    TITLES.with(|cache| {
        if let Some(found) = cache.borrow().get(&key) { return found.clone(); }
        let made = match turned::turned(title, size * scale, room * scale) {
            Some(mask) => {
                let mut pixels = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(mask.width, mask.height);
                for (pixel, alpha) in pixels.make_mut_slice().iter_mut().zip(mask.alpha) { *pixel = slint::Rgba8Pixel { r: 255, g: 255, b: 255, a: alpha }; }
                (slint::Image::from_rgba8(pixels), mask.width as f32 / scale, mask.height as f32 / scale)
            }
            None => (slint::Image::default(), 0.0, 0.0),
        };
        let mut cache = cache.borrow_mut();
        if cache.len() > 300 { cache.clear(); }
        cache.insert(key, made.clone());
        made
    })
}

thread_local! {
    /// Drawn entry icons, by name and size.
    static ICONS: RefCell<std::collections::HashMap<(String, u32), slint::Image>> = RefCell::new(std::collections::HashMap::new());
}

/// An entry icon as an image (a mask the window tints); empty without a name.
fn control_image(bar: &Bar, name: &str, size: f32, scale: f32) -> slint::Image {
    let name = match name {
        "play" => "journal-play",
        "pause" => "journal-pause",
        "square" => "journal-stop",
        "x" => "journal-done",
        "chevron-left" => "journal-left",
        "chevron-right" => "journal-right",
        "chevron-down" => "journal-down",
        "search" => "journal-search",
        "square-pen" => "journal-pencil",
        "calendar" => "journal-calendar",
        "clock" => "journal-clock",
        "bell" => "journal-bell",
        "star" => "journal-priority",
        "calendar-range" => "journal-plan-days",
        "calendar-arrow-up" => "journal-plan-tomorrow",
        "tag" => "journal-tag",
        "image" => "journal-icon",
        "shapes" => "journal-icon",
        "text-quote" => "journal-details",
        "text-align-start" => "journal-details",
        "repeat" => "journal-repeat",
        other => other,
    };
    journal_image(bar, name, size, scale)
}

/// From how many icons a grid draws only those near what is seen.
const LAZY_ICONS: usize = 120;

/// A grid of every icon whose cells get their icon only near the lines in sight (and the chosen one): drawing all of
/// them (about 1600) would take seconds on every key. The others come when the grid is scrolled to them.
struct LazyIcons<T: Clone + 'static> {
    names: Vec<String>,
    model: Option<std::rc::Rc<slint::VecModel<T>>>,
    columns: usize,
    /// The first line in sight.
    top: usize,
    drawn: std::collections::BTreeSet<usize>,
    set: fn(&mut T, slint::Image),
}

impl<T: Clone + 'static> LazyIcons<T> {
    fn new(set: fn(&mut T, slint::Image)) -> Self { Self { names: Vec::new(), model: None, columns: 1, top: 0, drawn: Default::default(), set } }
    /// Lines in sight and around them (a page above and two below, for scrolling on without waiting).
    fn near(&self, index: usize) -> bool { let line = index / self.columns; line + 10 >= self.top && line <= self.top + 24 }
    /// The chosen icon's line keeps the window around it.
    fn follow(&mut self, index: usize) { let line = index / self.columns; if line < self.top || line > self.top + 8 { self.top = line.saturating_sub(4); } }
    /// The rows with their icons drawn where needed; `chosen` always.
    fn build(&mut self, mut rows: Vec<T>, names: Vec<String>, columns: usize, chosen: Option<usize>, size: f32, scale: f32) -> std::rc::Rc<slint::VecModel<T>> {
        self.columns = columns.max(1);
        if self.names != names { self.top = 0; }
        if let Some(chosen) = chosen { self.follow(chosen); }
        self.drawn.clear();
        for (index, row) in rows.iter_mut().enumerate() {
            let Some(name) = names.get(index) else { continue };
            if self.near(index) || Some(index) == chosen {
                (self.set)(row, icon_image(name, size, scale));
                self.drawn.insert(index);
            }
        }
        self.names = names;
        let model = std::rc::Rc::new(slint::VecModel::from(rows));
        self.model = Some(model.clone());
        model
    }
    /// The grid came to other lines: their icons are drawn now.
    fn scrolled(&mut self, line: i32, size: f32, scale: f32) {
        use slint::Model;
        let Some(model) = self.model.clone() else { return };
        self.top = line.max(0) as usize;
        for index in 0..self.names.len() {
            if !self.near(index) || self.drawn.contains(&index) { continue; }
            if let Some(mut row) = model.row_data(index) {
                (self.set)(&mut row, icon_image(&self.names[index], size, scale));
                model.set_row_data(index, row);
                self.drawn.insert(index);
            }
        }
    }
    fn clear(&mut self) { self.names.clear(); self.model = None; self.drawn.clear(); self.top = 0; }
}

/// A line of a side list without its icon (drawn separately where needed).
fn picker_row_plain(bar: &Bar, r: &day::SideRow) -> SideRow {
    SideRow {
        has_icon: !r.icon.is_empty(), icon: slint::Image::default(),
        label: r.label.as_str().into(), value: r.value.as_str().into(), selected: r.selected, on: r.on,
        has_color: r.color.is_some(), color: r.color.map_or(bar.global::<Theme>().get_accent(), |[r,g,b]| slint::Color::from_rgb_u8(r,g,b)),
        danger: r.danger,
    }
}

fn picker_row(bar: &Bar, r: &day::SideRow, size: f32) -> SideRow {
    SideRow {
        has_icon: !r.icon.is_empty(), icon: journal_image(bar, &r.icon, size, bar.window().scale_factor()),
        label: r.label.as_str().into(), value: r.value.as_str().into(), selected: r.selected, on: r.on,
        has_color: r.color.is_some(), color: r.color.map_or(bar.global::<Theme>().get_accent(), |[r,g,b]| slint::Color::from_rgb_u8(r,g,b)),
        danger: r.danger,
    }
}

fn journal_image(bar: &Bar, name: &str, size: f32, scale: f32) -> slint::Image {
    let icons = bar.global::<JournalIcons>();
    match name {
        "journal-play" => icons.get_play_icon(),
        "journal-pause" => icons.get_pause_icon(),
        "journal-stop" => icons.get_stop_icon(),
        "journal-journal" => icons.get_journal_icon(),
        "journal-calendar" => icons.get_calendar_icon(),
        "journal-plan-tomorrow" => icons.get_plan_tomorrow_icon(),
        "journal-plan-days" => icons.get_plan_days_icon(),
        "journal-left" => icons.get_left_icon(),
        "journal-right" => icons.get_right_icon(),
        "journal-down" => icons.get_down_icon(),
        "journal-task" => icons.get_task_icon(),
        "journal-note" => icons.get_note_icon(),
        "journal-event" => icons.get_event_icon(),
        "journal-done" => icons.get_done_icon(),
        "journal-cancel" => icons.get_cancel_icon(),
        "journal-tomorrow" => icons.get_tomorrow_icon(),
        "journal-priority" => icons.get_priority_icon(),
        "journal-priority-event" => icons.get_priority_event_icon(),
        "journal-priority-note" => icons.get_priority_note_icon(),
        "journal-migrated" => icons.get_migrated_icon(),
        "journal-migrated-event" => icons.get_migrated_event_icon(),
        "journal-scheduled" => icons.get_scheduled_icon(),
        "journal-scheduled-event" => icons.get_scheduled_event_icon(),
        "journal-scheduled-multi" => icons.get_scheduled_multi_icon(),
        "journal-scheduled-multi-event" => icons.get_scheduled_multi_event_icon(),
        "journal-repeat" => icons.get_repeat_icon(),
        "journal-clock" => icons.get_clock_icon(),
        "journal-bell" => icons.get_bell_icon(),
        "journal-undo" => icons.get_undo_icon(),
        "journal-jump" => icons.get_jump_icon(),
        "journal-pencil" => icons.get_pencil_icon(),
        "journal-icon" => icons.get_icon_icon(),
        "journal-tag" => icons.get_tag_icon(),
        "journal-details" => icons.get_details_icon(),
        "journal-search" => icons.get_search_icon(),
        "journal-trash" => icons.get_trash_icon(),
        _ => icon_image(name, size, scale),
    }
}

fn icon_image(name: &str, size: f32, scale: f32) -> slint::Image {
    if name.is_empty() { return slint::Image::default(); }
    let px = (size * scale).round().max(1.0) as u32;
    ICONS.with(|cache| {
        if let Some(found) = cache.borrow().get(&(name.to_string(), px)) { return found.clone(); }
        let image = raster_icon(name, px);
        let mut cache = cache.borrow_mut();
        if cache.len() > 900 { cache.clear(); }
        cache.insert((name.to_string(), px), image.clone());
        image
    })
}

fn raster_icon(name: &str, px: u32) -> slint::Image {
    icons::draw(name, px).map(|drawn| {
        let mut pixels = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(drawn.size, drawn.size);
        for (pixel, alpha) in pixels.make_mut_slice().iter_mut().zip(drawn.alpha) { *pixel = slint::Rgba8Pixel { r: 255, g: 255, b: 255, a: alpha }; }
        slint::Image::from_rgba8(pixels)
    }).unwrap_or_default()
}

thread_local! {
    /// Drawn dials, by size, fill and colours.
    static DIALS: RefCell<std::collections::HashMap<(u32, i32, [u8; 4], [u8; 4]), slint::Image>> = RefCell::new(std::collections::HashMap::new());
}

/// A dial's ring as an image (dial.rs), in physical pixels for sharp edges.
fn dial_image(size: f32, thickness: f32, fill: Option<f32>, track: [u8; 4], color: [u8; 4], scale: f32) -> slint::Image {
    let px = (size * scale).round().max(4.0) as u32;
    let key = (px, fill.map_or(-1, |f| (f * 1000.0).round() as i32), track, color);
    DIALS.with(|cache| {
        if let Some(found) = cache.borrow().get(&key) { return found.clone(); }
        let drawn = dial::draw(px, thickness * scale, fill, track, color);
        let mut pixels = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(drawn.size, drawn.size);
        for (pixel, rgba) in pixels.make_mut_slice().iter_mut().zip(drawn.rgba.chunks(4)) {
            // Slint takes premultiplied colours.
            let a = rgba[3] as u32;
            *pixel = slint::Rgba8Pixel { r: (rgba[0] as u32 * a / 255) as u8, g: (rgba[1] as u32 * a / 255) as u8, b: (rgba[2] as u32 * a / 255) as u8, a: rgba[3] };
        }
        let image = slint::Image::from_rgba8_premultiplied(pixels);
        let mut cache = cache.borrow_mut();
        if cache.len() > 200 { cache.clear(); }
        cache.insert(key, image.clone());
        image
    })
}

/// How many dials stand side by side: all of up to three, four as two by two, more three to a line.
fn dial_layout_columns(count: usize) -> usize {
    match count { 0..=3 => count.max(1), 4 => 2, _ => 3 }
}

fn rgba(color: slint::Color) -> [u8; 4] { [color.red(), color.green(), color.blue(), color.alpha()] }

/// A key of the day view from its text (Slint's key codes).
fn day_key(text: &str) -> Option<day::K> {
    use slint::platform::Key;
    use day::K;
    let c = text.chars().next()?;
    let is = |key: Key| c == char::from(key);
    Some(if is(Key::UpArrow) { K::Up } else if is(Key::DownArrow) { K::Down } else if is(Key::LeftArrow) { K::Left } else if is(Key::RightArrow) { K::Right }
        else if is(Key::Return) { K::Enter } else if is(Key::Escape) { K::Escape } else if is(Key::Tab) { K::Tab } else if is(Key::Backtab) { K::BackTab }
        else if is(Key::Delete) { K::Delete } else if is(Key::Backspace) { K::Backspace } else if is(Key::Home) { K::Home } else if is(Key::End) { K::End }
        else if is(Key::PageUp) { K::PageUp } else if is(Key::PageDown) { K::PageDown } else if c == ' ' { K::Space }
        else if c.is_control() || ('\u{F700}'..='\u{F8FF}').contains(&c) { return None } else { K::Char(c) })
}

fn search_runs(text: &str, words: &[String]) -> slint::ModelRc<SearchRun> {
    let chars: Vec<char> = text.chars().collect();
    let mut marked = vec![false; chars.len()];
    let mut folded = String::new();
    let mut offsets = Vec::with_capacity(chars.len() + 1);
    for c in &chars {
        offsets.push(folded.len());
        folded.push_str(&engine::parse::fold(&c.to_string()));
    }
    offsets.push(folded.len());
    for word in words.iter().filter(|s| !s.is_empty()) {
        let word = engine::parse::fold(word);
        for (from, _) in folded.match_indices(&word) {
            let start = offsets.partition_point(|offset| *offset <= from) - 1;
            let end = offsets.partition_point(|offset| *offset < from + word.len());
            marked[start..end].fill(true);
        }
    }
    let mut runs = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        while i < chars.len() && marked[i] == marked[start] { i += 1; }
        runs.push(SearchRun { label: chars[start..i].iter().collect::<String>().into(), marked: marked[start] });
    }
    std::rc::Rc::new(slint::VecModel::from(runs)).into()
}

fn markdown_rows(source: &str, paper: bool) -> Vec<NotepadMarkdownRow> {
    note_markdown::blocks(source, paper).into_iter().map(|block| NotepadMarkdownRow {
        text: block.display,
        heading: block.heading as i32,
        indent: block.indent as i32,
        marker: block.marker.into(),
        offset: block.check.map_or(-1, |(offset, _)| offset as i32),
        checked: block.check.is_some_and(|(_, checked)| checked),
        urls: strings(block.links),
        is_code: block.code.is_some(),
        code: block.code.unwrap_or_default().into(),
        language: block.language.into(),
        is_table: block.table.is_some(),
        aligns: std::rc::Rc::new(slint::VecModel::from(block.table.as_ref().map(|table| table.aligns.clone()).unwrap_or_default())).into(),
        table: std::rc::Rc::new(slint::VecModel::from(block.table.map(|table| table.rows).unwrap_or_default().into_iter()
            .map(|cells| NotepadTableRow { cells: std::rc::Rc::new(slint::VecModel::from(cells)).into() }).collect::<Vec<_>>())).into(),
    }).collect()
}

fn strings(items: impl IntoIterator<Item = String>) -> slint::ModelRc<slint::SharedString> {
    std::rc::Rc::new(slint::VecModel::from(items.into_iter().map(slint::SharedString::from).collect::<Vec<_>>())).into()
}

impl App {
    fn change_shortcut(&mut self, id: &str, text: &str, mask: i32) -> String {
        use shortcuts::EditError;
        let labels = texts::shortcut_labels(self.state.language);
        let key = if text.is_empty() { None } else {
            let Some(chord) = shortcuts::chord(text, mask) else { return labels.reserved.into(); };
            Some(chord)
        };
        let mut next = self.bindings.clone();
        match next.set(id, key) {
            Ok(()) => {}
            Err(EditError::Conflict(other)) => {
                return format!("{} „{}“.", labels.conflict, EditError::conflict_label(other, self.state.language));
            }
            Err(_) => return labels.reserved.into(),
        }

        let new_hotkey = next.system_hotkey();
        let replacing = id == "window-toggle" && self.active_hotkey != Some(new_hotkey);
        if replacing {
            if self.hotkeys.is_none() { self.hotkeys = GlobalHotKeyManager::new().ok(); }
            let Some(manager) = &self.hotkeys else { return labels.system_error.into(); };
            if manager.register(new_hotkey).is_err() { return labels.system_error.into(); }
        }
        if let Err(error) = next.save() {
            if replacing {
                if let Some(manager) = &self.hotkeys { let _ = manager.unregister(new_hotkey); }
            }
            return format!("{} {error}", labels.persist_error);
        }
        if replacing {
            if let (Some(manager), Some(previous)) = (&self.hotkeys, self.active_hotkey) {
                if let Err(error) = manager.unregister(previous) {
                    eprintln!("J-TerminaL: {error}");
                }
            }
            self.active_hotkey = Some(new_hotkey);
        }
        self.bindings = next;
        self.draw();
        if let Some(window) = &self.settings { self.draw_settings_rows(window); }
        String::new()
    }

    /// A switch of F1 → Funktionen (`feature:notebook`, `feature:week`, `feature:week:note` …).
    fn change_feature(&mut self, id: &str, on: bool) -> String {
        let mut next = self.state.preferences;
        if !settings::change_feature(&mut next.features, id, on) { return String::new(); }
        next.features_set = true;
        if let Some(path) = &self.preferences_path {
            if let Err(error) = settings::write_json(path, &next) {
                return format!("{} {error}", texts::settings::tr(texts::settings::WRITE_ERROR, self.state.language));
            }
        }
        self.state.preferences = next;
        // A view switched off: the left side goes to the nearest one on.
        self.state.keep_view();
        self.draw();
        if let Some(window) = &self.settings { self.draw_settings_rows(window); }
        String::new()
    }

    fn change_preference(&mut self, key: PreferenceKey, index: i32) -> String {
        let mut next = self.state.preferences;
        if next.change(key, index).is_none() { return String::new(); }
        if let Some(path) = &self.preferences_path {
            if let Err(error) = settings::write_json(path, &next) {
                return format!("{} {error}", texts::settings::tr(texts::settings::WRITE_ERROR, self.state.language));
            }
        }
        self.state.preferences = next;
        self.state.language = next.effective_language(self.journal_language);
        // Weeks shown again: the day column gets back the room for them (the width chosen is kept for when they go).
        if key == PreferenceKey::WeekNumbers {
            let chosen = next.calendar_label_width.map_or(self.bar.global::<Theme>().get_cal_label_width(), f32::from);
            self.state.metrics.label_w = clamp_label_width(&self.bar, chosen, next.week_numbers);
        }
        self.draw();
        if let Some(window) = &self.settings {
            if key == PreferenceKey::Language { self.draw_settings_labels(window); }
            self.draw_settings_rows(window);
        }
        String::new()
    }

    fn show_settings(&mut self) {
        self.hide_timer.stop();
        if self.settings.is_none() {
            match SettingsWindow::new() {
                Ok(settings) => {
                    connect_settings(&settings);
                    self.bar.window().with_winit_window(|launcher| {
                        let Some(monitor) = launcher.current_monitor() else { return; };
                        let area = placement::work_area(screen_for_monitor(monitor));
                        let theme = settings.global::<Theme>();
                        let physical = |length: f32| (f64::from(length) * area.scale).round() as i32;
                        let margin = physical(theme.get_settings_padding()) * 2;
                        let width = physical(theme.get_settings_width()).min((area.width - margin).max(1));
                        let height = physical(theme.get_settings_height()).min((area.height - margin).max(1));
                        settings.window().set_size(slint::PhysicalSize::new(width as u32, height as u32));
                        settings.window().set_position(slint::PhysicalPosition::new(
                            area.left + (area.width - width) / 2, area.top + (area.height - height) / 2,
                        ));
                    });
                    self.settings = Some(settings);
                }
                Err(error) => { eprintln!("J-TerminaL: {}: {error}", texts::shortcut_labels(self.state.language).settings); return; }
            }
        }
        let settings = self.settings.as_ref().unwrap();
        if !settings.window().is_visible() {
            self.settings_navigation = settings::Navigation::default();
            self.draw_settings_labels(settings);
            self.draw_settings_rows(settings);
            settings.invoke_begin_session();
            if let Err(error) = settings.show() { eprintln!("J-TerminaL: {error}"); return; }
            self.restore_launcher = self.bar.window().is_visible();
            if self.restore_launcher { hide_bar(&self.bar); }
        }
        settings.window().with_winit_window(|window| {
            window.set_minimized(false);
            window.focus_window();
        });
    }

    fn close_settings(&mut self) {
        let Some(settings) = self.settings.take() else { return };
        settings.invoke_stop_recording();
        let _ = settings.hide();
        self.settings_navigation = Default::default();
        // Finish dispatching the close event before destroying its native window.
        slint::Timer::single_shot(Duration::ZERO, move || drop(settings));
        if std::mem::take(&mut self.restore_launcher) {
            let _ = self.bar.show();
            self.bar.window().with_winit_window(|window| window.focus_window());
        }
    }

    fn draw_settings_labels(&self, window: &SettingsWindow) {
        use texts::settings as copy;
        let lang = self.state.language;
        let labels = texts::shortcut_labels(lang);
        window.set_labels(SettingsLabels {
            settings: labels.settings.into(), search: labels.search.into(), empty: labels.empty.into(),
            record: labels.record.into(), reset: labels.reset.into(), change: labels.change.into(),
            back: copy::tr(copy::BACK, lang).into(), forward: copy::tr(copy::FORWARD, lang).into(),
            minimize: copy::tr(copy::MINIMIZE, lang).into(), close: copy::tr(copy::CLOSE, lang).into(),
        });
        window.set_categories(settings::categories(window, lang));
        window.set_version(env!("CARGO_PKG_VERSION").into());
        window.set_terminal_icon(settings::icon(window, "terminal", window.global::<Theme>().get_search_icon_size()));
    }

    fn draw_settings_rows(&self, window: &SettingsWindow) {
        let nav = &self.settings_navigation;
        let location = nav.location();
        window.set_category(location.page as i32);
        window.set_can_go_back(nav.back());
        window.set_can_go_forward(nav.forward());
        window.set_searching(!location.query.trim().is_empty());
        if window.get_query().as_str() != location.query { window.set_query(location.query.as_str().into()); }
        let rows = settings::rows(location, &self.state.preferences, &self.bindings, self.state.language);
        window.set_rows(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        self.draw_period_settings(window, true);
    }

    /// The panel of the activities or the day values. `anew`: a new list (lines added, removed or moved); else the
    /// lines change in place, so a field being written in keeps the keyboard.
    fn draw_period_settings(&self, window: &SettingsWindow, anew: bool) {
        use slint::Model;
        let location = self.settings_navigation.location();
        let page = location.page.period().filter(|_| location.query.trim().is_empty());
        window.set_period_page(match page { Some(period_settings::Page::Activities) => 1, Some(period_settings::Page::Values) => 2, None => 0 });
        let Some(page) = page else { window.set_period_rows(Default::default()); return };
        let t = period_settings::texts(self.state.language);
        window.set_period_labels(PeriodLabels {
            hint: if page == period_settings::Page::Activities { t.activities_hint } else { t.values_hint }.into(),
            name: if page == period_settings::Page::Activities { t.name_activity } else { t.name_value }.into(),
            daily_rating: t.daily_rating.into(), shades: t.shades.into(), lightest: t.lightest.into(), darkest: t.darkest.into(),
            reset: t.reset.into(), active: t.active.into(), track: t.track.into(), notes: t.notes.into(),
            new_item: if page == period_settings::Page::Activities { t.new_activity } else { t.new_value }.into(),
            add: t.add.into(), from: t.from.into(), until: t.until.into(), delete: t.delete.into(), delete_ask: t.delete_ask.into(),
            untracked: t.untracked.into(), color: t.color.into(), hex: t.hex.into(), move_hint: t.move_hint.into(),
        });
        let color = |hex: &str| calendar::parse_color(hex).map_or_else(slint::Color::default, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b));
        window.set_swatches(std::rc::Rc::new(slint::VecModel::from(tag_edit::SWATCHES.iter().map(|hex| color(hex)).collect::<Vec<_>>())).into());
        window.set_swatch_hex(strings(tag_edit::SWATCHES.iter().map(|hex| hex.to_string())));
        let rows: Vec<PeriodRow> = self.state.period_settings_rows(page).into_iter().map(|row| {
            let (hue, sat, val) = tag_edit::hsv_of(&row.color);
            PeriodRow {
                kind: match row.kind { period_settings::Kind::Activity => 0, period_settings::Kind::Scale => 1, period_settings::Kind::Rating => 2 },
                id: row.id.into(), name: row.name.into(), color: color(&row.color), hue, sat, val,
                swatch: tag_edit::SWATCHES.iter().position(|hex| hex.eq_ignore_ascii_case(&row.color)).map_or(-1, |at| at as i32),
                hex: row.color.into(), active: row.active, track: row.track, text_field: row.text_field,
                min: row.min.to_string().into(), max: row.max.to_string().into(), custom_range: row.custom_range,
                palette: std::rc::Rc::new(slint::VecModel::from(row.palette.iter().map(|[r, g, b]| slint::Color::from_rgb_u8(*r, *g, *b)).collect::<Vec<_>>())).into(),
            }
        }).collect();
        let current = window.get_period_rows();
        let same = !anew && current.row_count() == rows.len() && rows.iter().enumerate().all(|(at, row)| current.row_data(at).is_some_and(|old| old.id == row.id));
        if same {
            for (at, row) in rows.into_iter().enumerate() {
                if current.row_data(at).as_ref() != Some(&row) { current.set_row_data(at, row); }
            }
        } else {
            window.set_period_rows(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        }
    }

    /// A change in the panel of activities or values: written to the journal, the day view and the panel show it.
    fn period_setting(&mut self, change: impl FnOnce(&mut serde_json::Value, &mut Vec<journal_core::storage::Tag>, period_settings::Page) -> Option<period_settings::Outcome>) {
        let Some(page) = self.settings_navigation.location().page.period() else { return };
        let result = self.state.change_period_settings(|data, tags| change(data, tags, page));
        let error = match &result { Err(error) => error.clone(), Ok(_) => String::new() };
        if let Some(window) = &self.settings {
            window.set_period_error(error.into());
            if let Ok(Some(outcome)) = &result { self.draw_period_settings(window, outcome.structure); }
        }
        if matches!(result, Ok(Some(_))) { self.draw(); }
    }

    fn draw(&mut self) {
        let view = self.state.view();
        let theme = self.bar.global::<Theme>();
        let plain = theme.get_cal_stroke();
        let color = |rgb: Option<calendar::Rgb>| rgb.map_or(plain, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b));
        let scale = self.bar.window().scale_factor();
        let icon_px = theme.get_icon_size();
        let label_px = theme.get_label_icon_size();
        self.bar.set_search_icon(control_image(&self.bar, "search", theme.get_search_icon_size(), scale));
        self.bar.set_icon_arrow_back(icon_image("arrow-left", label_px, scale));
        self.bar.set_icon_flag(icon_image("flag", label_px, scale));
        self.bar.set_icon_chevron_down(icon_image("chevron-down", theme.get_footer_icon_size(), scale));
        self.bar.set_icon_success(icon_image("circle-check", theme.get_footer_icon_size(), scale));
        self.bar.set_icon_error(icon_image("circle-exclamation-point", theme.get_footer_icon_size(), scale));
        let keys = self.bar.global::<KeyIcons>();
        keys.set_enter(icon_image("corner-down-left", theme.get_keycap_size(), scale));
        keys.set_shift(icon_image("arrow-big-up", theme.get_keycap_size(), scale));
        self.bar.set_orientation(self.state.preferences.orientation as i32);
        self.bar.set_title_text(view.title.clone().into());
        self.bar.set_title_hint(view.title_hint.clone().into());
        self.bar.set_in_header(view.in_header);
        self.bar.set_title_error(view.title_error);
        self.bar.set_entry_priority(view.priority);
        self.draw_menu(view.menu.clone(), view.context);
        self.draw_footer(&view);
        self.bar.set_line_count(view.rows.iter().map(|row| row.line + 1).max().unwrap_or(1) as i32);
        // The labels take only the room of the longest one shown, so the fields get the rest.
        let longest = view.rows.iter().map(|row| row.label.as_str()).max_by_key(|label| label.chars().count()).unwrap_or_default();
        self.bar.set_longest_label(longest.into());
        self.bar.set_rows(std::rc::Rc::new(slint::VecModel::from(view.rows.into_iter().map(|row| FormRow {
            field: row.field as i32, line: row.line as i32, cell: row.cell as i32, multi: row.multi,
            label: row.label.into(), has_label_icon: !row.label_icon.is_empty(), label_icon: control_image(&self.bar, row.label_icon, label_px, scale), value: row.value.into(), hint: row.hint.into(), filled: row.filled, error: row.error,
            has_color: row.color.is_some(), color: color(row.color), has_icon: !row.icon.is_empty(), icon: journal_image(&self.bar, &row.icon, icon_px, scale),
        }).collect::<Vec<_>>())).into());
        self.bar.set_active(view.active as i32);
        self.bar.set_active_line(view.active_line as i32);
        self.bar.set_active_cell(view.active_cell as i32);
        self.bar.set_active_multi(view.active_multi);
        self.bar.set_editable(view.editable);
        self.bar.set_native_arrows(view.native_arrows);
        self.bar.set_day_picker_open(self.state.day_picker_open());
        self.bar.set_type_names(strings(view.type_names));
        self.bar.set_type_icons(std::rc::Rc::new(slint::VecModel::from(view.type_icons.iter().map(|name| journal_image(&self.bar, name, label_px, scale)).collect::<Vec<_>>())).into());
        self.bar.set_options(view.options);
        self.bar.set_type_selected(view.type_selected as i32);
        self.bar.set_placeholder(view.placeholder.into());
        // The choices under the active line.
        let choices = |list: Vec<form::Choice>, window: usize| {
            // A long list shows a window around the chosen one.
            let at = list.iter().position(|c| c.selected).unwrap_or(0);
            let from = at.saturating_sub(window / 2).min(list.len().saturating_sub(window));
            list.into_iter().enumerate().skip(from).take(window).map(|(index, c)| ChoiceRow {
                index: index as i32, label: c.label.into(), has_color: c.color.is_some(), color: color(c.color),
                has_icon: !c.icon.is_empty(), icon: icon_image(&c.icon, icon_px, scale), selected: c.selected,
            }).collect::<Vec<_>>()
        };
        let (mut label, mut icon) = (String::new(), "");
        let (kind, rows, sentence) = match view.panel {
            form::Panel::None => (0, Vec::new(), Vec::new()),
            form::Panel::Tags(list) => (1, choices(list, 8), Vec::new()),
            form::Panel::Icons(list) => (2, choices(list, 56), Vec::new()),
            form::Panel::Reminders(list) => (3, choices(list, 16), Vec::new()),
            form::Panel::Repeat(lines) => (4, Vec::new(), lines.into_iter().map(|line| SentenceLine {
                label: line.label.into(), has_icon: !line.icon.is_empty(), icon: control_image(&self.bar, line.icon, label_px, scale),
                parts: std::rc::Rc::new(slint::VecModel::from(line.parts.into_iter().map(|p| SentencePart {
                    text: p.text.into(), kind: p.kind as i32, selected: p.selected, focused: p.focused, slot: p.slot, value: p.value, after: p.after.into(),
                }).collect::<Vec<_>>())).into(),
            }).collect::<Vec<_>>()),
            form::Panel::Clock { label: text, hours, minutes, on_minutes } => {
                self.bar.set_clock_hours(hours.into()); self.bar.set_clock_minutes(minutes.into()); self.bar.set_clock_on_minutes(on_minutes);
                (label, icon) = (text, "clock");
                (5, Vec::new(), Vec::new())
            }
            form::Panel::Calendar { label: text, hours } => { (label, icon) = (text, if hours { "calendar-clock" } else { "calendar" }); (6, Vec::new(), Vec::new()) }
        };
        self.bar.set_panel_label(label.into());
        self.bar.set_panel_icon(control_image(&self.bar, icon, label_px, scale));
        self.bar.set_panel_kind(kind);
        self.bar.set_choices(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        self.bar.set_sentence(std::rc::Rc::new(slint::VecModel::from(sentence)).into());
        self.bar.set_panel_note(view.panel_note.into());
        self.draw_calendar(view.calendar);
        self.draw_day(view.day, view.side);
        self.bar.set_entry_open(view.entry_open);
        self.draw_notepad();
        self.bar.set_search_placeholder(view.search_placeholder.into());
        self.bar.set_command_selected(view.command_selected as i32);
        let lang = usize::from(self.state.language == texts::Language::En);
        self.bar.set_searching(view.searching);
        self.bar.set_search_empty(texts::form_texts(self.state.language).no_hits.into());
        self.bar.set_commands_label(texts::search::COMMANDS[lang].into());
        self.bar.set_clear_label(texts::search::CLEAR[lang].into());
        let theme = self.bar.global::<Theme>();
        let mut top = 0.;
        let rows = view.commands.into_iter().map(|c| {
            let preview = c.has_preview();
            let header = if c.look.heading.is_empty() { 0. } else { theme.get_section_height() };
            let tall = theme.get_row_height() + header + if c.look.snippet.is_empty() { 0. } else { theme.get_small_size() + theme.get_calendar_gap() };
            let row = CommandRow {
                name: c.name.clone().into(), detail: c.detail.into(), heading: c.look.heading.into(), tag: c.look.tag.into(),
                icon: journal_image(&self.bar, c.look.icon, label_px, scale), has_icon: !c.look.icon.is_empty(),
                sigil: c.look.sigil, has_color: c.look.color.is_some(), tint: c.look.color.map_or(theme.get_muted(), |rgb| color(Some(rgb))),
                title_runs: search_runs(&c.name, &c.look.words), snippet_runs: search_runs(&c.look.snippet, &c.look.words),
                top, tall, header, preview, description: c.look.description.into(),
            };
            top += tall;
            row
        }).collect::<Vec<_>>();
        self.bar.set_commands(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        // One short message in the footer: the day view's, the form's, or a problem from the start.
        let hotkey_hint = || {
            if self.bindings.system_hotkey() == self.active_hotkey? { return None; }
            let key = shortcuts::label(self.active_hotkey?, self.state.language);
            Some((format!("{} {key}", texts::texts(self.state.language).alternate_hotkey), false))
        };
        let status = view.day_message.filter(|_| !view.entry_open).or(view.status).or_else(|| self.notice.clone().map(|notice| (notice, true))).or_else(hotkey_hint)
            .or_else(|| self.active_hotkey.is_none().then(|| (texts::texts(self.state.language).hotkey_failed.to_string(), true)));
        self.bar.set_notice_is_error(status.as_ref().is_some_and(|(_, error)| *error));
        self.bar.set_notice(status.map_or_else(String::new, |(text, _)| text).into());
    }

    /// The actions behind Strg+K: their lines with sections and the keys they have now.
    fn draw_menu(&mut self, menu: Option<form::MenuView>, context: form::Context) {
        let at = texts::action_texts(self.state.language);
        self.bar.set_menu_placeholder(at.search.into());
        self.bar.set_menu_empty(at.nothing.into());
        let Some(menu) = menu else { self.bar.set_menu_open(false); return; };
        let theme = self.bar.global::<Theme>();
        let (scale, px) = (self.bar.window().scale_factor(), theme.get_label_icon_size());
        let first = match context { form::Context::NotesList | form::Context::NotesRead | form::Context::NotesEdit => at.section_note, _ => at.section_entry };
        let mut previous = usize::MAX;
        // Where each line is in the list (a section's line and heading come before its first): the list follows the keys.
        let (row_h, spacing, heading) = (theme.get_side_row_height(), theme.get_choice_spacing(), theme.get_border_width() + theme.get_section_height());
        let mut y = 0.0;
        let rows: Vec<MenuRow> = menu.items.iter().enumerate().map(|(i, item)| {
            let section = if item.section != previous { match item.section { 0 => first, 2 => texts::tags::delete_entry(self.state.language), _ => at.section_general } } else { "" };
            previous = item.section;
            let extra = if !section.is_empty() && i > 0 { heading } else { 0.0 };
            let top = y + extra;
            y = top + row_h + spacing;
            let keys = item.id.binding().map(|id| shortcuts::keys(&self.bindings, id, self.state.language)).unwrap_or_else(|| item.id.fixed_keys().to_string());
            let icon = journal_image(&self.bar, &item.icon, px, scale);
            MenuRow {
                top, section: section.into(), has_icon: !item.icon.is_empty(), icon, label: item.label.clone().into(), value: item.value.clone().into(),
                caps: strings(shortcuts::caps(&keys)), on: item.on, danger: item.danger,
                has_color: item.color.is_some(), color: item.color.map_or_else(slint::Color::default, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b)),
            }
        }).collect();
        self.bar.set_menu_title(menu.title.into());
        self.bar.set_menu_rows(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        self.bar.set_menu_pick(menu.pick as i32);
        self.bar.set_app_menu(menu.app_menu);
        self.bar.set_menu_open(true);
    }

    /// The footer: where one is, the main action there and the actions, each with its keys.
    fn draw_footer(&mut self, view: &form::View) {
        use form::Context as C;
        let at = texts::action_texts(self.state.language);
        let language = self.state.language;
        let keys = |id: &str| strings(shortcuts::caps(&shortcuts::keys(&self.bindings, id, language)));
        let label = match view.context {
            C::Day | C::DayLine if view.searching && self.state.preferences.keycaps => texts::search::FILTER_HINT[usize::from(language == texts::Language::En)],
            C::Day | C::DayLine => &view.day.heading,
            C::Entry if self.state.editing_entry() => at.edit,
            C::Entry => at.new_entry,
            C::NotesList | C::NotesRead | C::NotesEdit => at.notepad,
        };
        let primary = if view.searching {
            view.commands.get(view.command_selected).map(|row| (row.primary_label(language), strings(["↵".to_string()])))
        } else { Some(match view.context {
            // In the day view the types to make are icons of their own (below).
            C::Day => return self.footer_icons(view, Vec::new(), at, keys("day-actions")),
            C::DayLine => (at.edit, strings(["↵".to_string()])),
            C::Entry if self.state.editing_entry() => (at.notes_save, keys("form-save")),
            C::Entry => (at.create, keys("form-save")),
            C::NotesList => (at.notes_new, keys("notes-new")),
            C::NotesRead => (at.notes_edit, keys("notes-edit")),
            C::NotesEdit => (at.notes_save, keys("notes-save")),
        }) };
        self.bar.set_footer_date(matches!(view.context, C::Day | C::DayLine) && !view.searching);
        self.bar.set_footer_menu_label(at.menu.into());
        self.bar.set_footer_label(label.into());
        let mut hints = Vec::new();
        if let Some((label, caps)) = primary {
            hints.push(FooterHint { label: label.into(), caps: if self.state.preferences.keycaps { caps } else { Default::default() }, action: 0 });
        }
        let actions = keys("day-actions");
        self.footer_icons(view, hints, at, actions);
    }

    /// The actions hint after `hints`, and in the day view the icons that make an event, a task or a note.
    fn footer_icons(&mut self, view: &form::View, mut hints: Vec<FooterHint>, at: &texts::ActionTexts, actions: slint::ModelRc<slint::SharedString>) {
        use form::Context as C;
        if matches!(view.context, C::Day) && hints.is_empty() {
            self.bar.set_footer_date(!view.searching);
            self.bar.set_footer_menu_label(at.menu.into());
            self.bar.set_footer_label(view.day.heading.clone().into());
        }
        hints.push(FooterHint { label: at.actions.into(), caps: if self.state.preferences.keycaps { actions } else { Default::default() }, action: 1 });
        self.bar.set_footer_hints(std::rc::Rc::new(slint::VecModel::from(hints)).into());
        let day = matches!(view.context, C::Day | C::DayLine) && !view.searching;
        let (size, scale) = (self.bar.global::<Theme>().get_footer_icon_size(), self.bar.window().scale_factor());
        let icons: Vec<slint::Image> = if day { ["journal-event", "journal-task", "journal-note"].iter().map(|name| journal_image(&self.bar, name, size, scale)).collect() } else { Vec::new() };
        self.bar.set_footer_create_icons(std::rc::Rc::new(slint::VecModel::from(icons)).into());
    }

    fn draw_notepad(&mut self) {
        let labels = texts::notepad_texts(self.state.language);
        self.bar.set_notepad_heading(labels.heading.into());
        let Some(draft) = self.state.notepad() else {
            if self.bar.get_notepad_open() {
                self.bar.set_notepad_open(false);
                self.bar.set_notepad_title("".into());
                self.bar.set_notepad_body("".into());
                self.bar.set_notepad_query("".into());
                self.notepad_list_query = Default::default();
                self.bar.set_notepad_choices(Default::default());
                self.bar.set_notepad_markdown(Default::default());
                self.reset_notepad_media(None);
            }
            return;
        };
        let previous_panel = self.bar.get_notepad_panel();
        if self.bar.get_notepad_open() && previous_panel != draft.panel {
            if previous_panel == 1 { self.notepad_list_query = self.bar.get_notepad_query(); }
            self.bar.set_notepad_query(if draft.panel == 1 { self.notepad_list_query.clone() } else { Default::default() });
        }
        let theme = self.bar.global::<Theme>();
        let icon = |name| icon_image(name, theme.get_label_icon_size(), self.bar.window().scale_factor());
        let card_id = draft.card.id;
        let stored = draft.card.original.as_ref();
        let heading = match draft.panel {
            0 if draft.editing => if stored.is_some() { labels.edit_heading } else { labels.new_note },
            2 => labels.choose_tag,
            3 => labels.attachments,
            4 => labels.choose_folder,
            _ => labels.heading,
        };
        self.bar.set_notepad_editor_heading(heading.into());
        let displayed_day = stored.and_then(|card| chrono::NaiveDate::parse_from_str(notebook::text(card, "created"), "%Y-%m-%d").ok()).unwrap_or(draft.date);
        // A new note goes to the notebook only (no longer onto the day's board): just its day.
        let date = day_view::long_date(displayed_day, self.state.language);
        let tag = self.state.notepad_tag_name();
        let date = match tag.as_deref() {
            Some(tag) if !draft.editing => format!("{date} · {tag}"),
            _ => date,
        };
        self.bar.set_notepad_date(date.into());
        if self.bar.get_notepad_title().as_str() != draft.title() { self.bar.set_notepad_title(draft.title().into()); }
        if self.bar.get_notepad_body().as_str() != draft.body() { self.bar.set_notepad_body(draft.body().into()); }
        self.bar.set_notepad_editing(draft.editing);
        self.bar.set_notepad_can_save(draft.can_save());
        self.bar.set_notepad_title_label(labels.note_title.into());
        self.bar.set_notepad_body_label(labels.note_body.into());
        self.bar.set_notepad_labels(NotepadLabels {
            new_note: labels.new_note.into(), edit_note: labels.edit_note.into(), save_note: labels.save_note.into(),
            back: labels.back.into(), exit: labels.exit.into(), add_link: labels.add_link.into(), untitled: labels.untitled.into(),
        });
        self.bar.set_notepad_image_label(labels.image.into());
        self.bar.set_notepad_image_icon(icon("image-plus"));
        self.bar.set_notepad_link_icon(icon("link"));
        self.bar.set_notepad_check_icon(icon("check"));
        self.bar.set_notepad_copy_icon(icon("copy"));
        self.bar.set_notepad_copy_label(labels.copy_code.into());
        self.bar.set_notepad_all_notes(labels.all_notes.into());
        self.bar.set_notepad_day_notes(labels.day_notes.into());
        self.bar.set_notepad_on_day(draft.notes_on_day);
        let mut tools = Vec::new();
        if draft.editing {
            tools.push(NotepadTool {
                id: 1, icon: icon("tag"),
                label: tag.as_deref().unwrap_or(labels.choose_tag).into(), active: tag.is_some(),
            });
            tools.push(NotepadTool { id: 4, icon: icon("folder"), label: labels.choose_folder.into(), active: draft.card.folder.is_some() });
        }
        tools.push(NotepadTool { id: 2, icon: icon("paperclip"), label: labels.attachments.into(), active: false });
        if draft.editing {
            tools.push(NotepadTool {
                id: 3, icon: icon(if draft.preview { "pencil" } else { "eye" }),
                label: (if draft.preview { labels.source } else { labels.preview }).into(), active: draft.preview,
            });
        }
        self.bar.set_notepad_tools(std::rc::Rc::new(slint::VecModel::from(tools)).into());
        let (placeholder, empty) = match draft.panel {
            1 => (labels.filter_notes, labels.browse_empty),
            2 => (labels.choose_tag, ""),
            3 => (if draft.editing { labels.link } else { labels.filter_attachments }, labels.attachments_empty),
            4 => (labels.choose_folder, ""),
            _ => ("", ""),
        };
        self.bar.set_notepad_panel_placeholder(placeholder.into());
        self.bar.set_notepad_panel_empty(empty.into());
        self.bar.set_notepad_panel(draft.panel);
        self.bar.set_notepad_preview(draft.preview);
        let markdown: Vec<_> = if draft.preview {
            markdown_rows(draft.body(), false)
        } else { Vec::new() };
        self.bar.set_notepad_markdown(std::rc::Rc::new(slint::VecModel::from(markdown)).into());
        self.refresh_notepad_media(Some(card_id));
        self.bar.set_notepad_open(true);
    }

    fn reset_notepad_media(&mut self, draft: Option<uuid::Uuid>) {
        self.notepad_media.draft = draft;
        self.notepad_media.thumbnails.clear();
        self.notepad_media.items.clear();
        self.bar.set_notepad_images(Default::default());
        self.close_notepad_viewer();
    }

    fn refresh_notepad_media(&mut self, draft: Option<uuid::Uuid>) {
        if self.notepad_media.draft != draft { self.reset_notepad_media(draft); }
        self.notepad_media.items = self.state.notepad_images();
        let jobs: Vec<_> = self.notepad_media.items.iter().filter_map(|item| {
            use std::collections::hash_map::Entry;
            let source = item.image.clone()?;
            let key = item.id.to_string();
            if let Entry::Vacant(entry) = self.notepad_media.thumbnails.entry(key.clone()) {
                entry.insert(None);
                Some((key, source))
            } else { None }
        }).collect();
        self.publish_notepad_media();
        if jobs.is_empty() { return; }
        let size = (self.bar.global::<Theme>().get_notepad_thumb_height() * self.bar.window().scale_factor() * 3.0).ceil() as u32;
        std::thread::spawn(move || {
            for (key, source) in jobs {
                let pixels = note_images::decode(&source, size);
                let _ = slint::invoke_from_event_loop(move || with_app(|app| {
                    if app.notepad_media.draft == draft {
                        app.notepad_media.thumbnails.insert(key, pixels.as_ref().map(note_images::to_slint));
                        app.publish_notepad_media();
                    }
                }));
            }
        });
    }

    fn publish_notepad_media(&mut self) {
        let items = self.notepad_media.items.iter().filter_map(|item| {
            let key = item.id.to_string();
            let thumbnail = self.notepad_media.thumbnails.get(&key)?.clone()?;
            Some(NotepadImage { key: key.into(), title: item.title.clone().into(), thumbnail })
        }).collect::<Vec<_>>();
        self.bar.set_notepad_images(std::rc::Rc::new(slint::VecModel::from(items)).into());
        self.draw_notepad_choices();
    }

    fn close_notepad_viewer(&mut self) {
        self.notepad_media.viewer_token = self.notepad_media.viewer_token.wrapping_add(1);
        self.bar.set_notepad_viewer_open(false);
        self.bar.set_notepad_viewed_image(slint::Image::default());
    }

    fn show_notepad_target(&mut self, target: notebook::Target) {
        let notebook::Target::Image { title, source } = target else {
            if let notebook::Target::Link(url) = target { open_notepad_link(url); }
            return;
        };
        let labels = texts::notepad_texts(self.state.language);
        self.close_notepad_viewer();
        self.bar.set_notepad_viewed_title(title.into());
        self.bar.set_notepad_viewer_message(labels.image_loading_preview.into());
        self.bar.set_notepad_viewer_open(true);
        let token = self.notepad_media.viewer_token;
        let window = self.bar.window().size();
        let size = window.width.max(window.height).clamp(640, 1800);
        std::thread::spawn(move || {
            let result = note_images::decode(&source, size);
            let _ = slint::invoke_from_event_loop(move || with_app(|app| {
                if app.notepad_media.viewer_token != token { return; }
                if let Some(image) = result {
                    app.bar.set_notepad_viewed_image(note_images::to_slint(&image));
                    app.bar.set_notepad_viewer_message("".into());
                } else {
                    app.bar.set_notepad_viewer_message(labels.image_unavailable.into());
                }
            }));
        });
    }

    fn draw_notepad_choices(&mut self) {
        // An action of the list set its input (cleared, or a folder's name to change).
        if let Some(query) = self.state.take_notes_query() { self.bar.set_notepad_query(query.into()); }
        let (size, scale) = (self.bar.global::<Theme>().get_label_icon_size(), self.bar.window().scale_factor());
        let rows: Vec<_> = self.state.notepad_choices(&self.bar.get_notepad_query()).into_iter().map(|row| {
            let thumbnail = self.notepad_media.thumbnails.get(&row.key).and_then(Option::as_ref);
            NotepadChoiceRow {
                key: row.key.into(), title: row.title.into(), detail: row.detail.into(), has_color: row.color.is_some(),
                color: row.color.map_or_else(slint::Color::default, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b)),
                group: row.group.into(), has_image: thumbnail.is_some(), thumbnail: thumbnail.cloned().unwrap_or_default(),
                depth: row.depth as i32, folder: row.folder, open: row.open, selected: row.selected,
                has_icon: !row.icon.is_empty(), icon: if row.icon.is_empty() { Default::default() } else { icon_image(row.icon, size, scale) },
            }
        }).collect();
        // Where the chosen line is (as the list lays its lines out), so the list scrolls to it.
        let theme = self.bar.global::<Theme>();
        let (line, thumb) = (theme.get_choice_height(), theme.get_notepad_thumb_height());
        let mut top = 0.0;
        for row in &rows {
            let head = if row.group.is_empty() { 0.0 } else { line };
            let height = head + if row.has_image { thumb } else { line };
            if row.selected {
                self.bar.set_notepad_cursor_top(top);
                self.bar.set_notepad_cursor_height(height);
                self.bar.set_notepad_cursor_request(self.bar.get_notepad_cursor_request().wrapping_add(1));
                break;
            }
            top += height;
        }
        self.bar.set_notepad_choices(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        self.bar.set_notepad_list_mode(self.state.notes_list_mode());
        if let Some((placeholder, empty)) = self.state.notes_list_hint() {
            self.bar.set_notepad_panel_placeholder(placeholder.into());
            self.bar.set_notepad_panel_empty(empty.into());
        }
    }

    fn draw_calendar(&self, calendar: form::CalendarView) {
        let theme = self.bar.global::<Theme>();
        let plain = theme.get_cal_stroke();
        // A tag in the yellow of important entries is turned a little off it, so the two stay apart.
        let mark = theme.get_cal_priority();
        let mark = [mark.red(), mark.green(), mark.blue()];
        let color = |rgb: Option<calendar::Rgb>| rgb.map_or(plain, |rgb| { let [r, g, b] = calendar::apart(rgb, mark); slint::Color::from_rgb_u8(r, g, b) });
        let (layout, m) = (calendar.layout, calendar.metrics);
        let scale = self.bar.window().scale_factor();
        let icon_size = theme.get_cal_icon_size();
        self.bar.set_cal_icon(control_image(&self.bar, "calendar", icon_size, scale));
        self.bar.set_cal_focus(calendar.focus);
        self.bar.set_cal_time_x(m.time_x());
        self.bar.set_cal_title(layout.title.into());
        let prefs = &self.state.preferences;
        self.bar.set_cal_has_now(prefs.now_line && layout.now.is_some());
        self.bar.set_cal_has_caret(layout.caret.is_some());
        if let Some((x, y, w, h)) = layout.caret { self.bar.set_cal_caret_x(x); self.bar.set_cal_caret_y(y); self.bar.set_cal_caret_w(w); self.bar.set_cal_caret_h(h); }
        if let Some((x, y, h)) = layout.now { self.bar.set_cal_now_x(x); self.bar.set_cal_now_y(y); self.bar.set_cal_now_h(h); }
        self.bar.set_cal_ticks(std::rc::Rc::new(slint::VecModel::from(layout.ticks.into_iter().map(|tick| CalTick { x: tick.x, label: tick.label.into(), strong: tick.strong }).collect::<Vec<_>>())).into());
        self.bar.set_cal_bands(std::rc::Rc::new(slint::VecModel::from(layout.bands.into_iter().map(|band| CalBand {
            y: band.y, h: band.h, kind: match band.kind { calendar::BandKind::Day => 0, calendar::BandKind::Month => 1 },
            label: band.label.into(), week: if prefs.week_numbers { band.week.into() } else { Default::default() },
            week_start: band.week_start, tint: band.tint, weekend: prefs.weekends && band.weekend,
            sunday: prefs.weekends && chrono::Datelike::weekday(&band.date) == chrono::Weekday::Sun, today: band.today, selected: band.selected, cursor: band.cursor, open: band.open,
        }).collect::<Vec<_>>())).into());
        self.bar.set_cal_blocks(std::rc::Rc::new(slint::VecModel::from(layout.blocks.into_iter().map(|block| CalBlock {
            x: block.x, y: block.y, w: block.w, h: block.h, title: block.title.into(), time: block.time.into(), color: color(block.color),
            fresh: block.fresh, done: block.done, priority: block.priority, cut: block.cut, point: block.point, caption_at_top: block.caption_at_top, marker: block.marker, text: block.text as i32,
            has_icon: !block.icon.is_empty(), icon: icon_image(&block.icon, icon_size, scale),
        }).collect::<Vec<_>>())).into());
        self.bar.set_cal_chips(std::rc::Rc::new(slint::VecModel::from(layout.chips.into_iter().map(|chip| CalChip {
            x: chip.x, y: chip.y, w: chip.w, h: chip.h, title: chip.title.into(), color: color(chip.color), fresh: chip.fresh, done: chip.done, priority: chip.priority, dot: chip.dot,
            has_icon: !chip.icon.is_empty(), icon: icon_image(&chip.icon, icon_size, scale),
        }).collect::<Vec<_>>())).into());
        let (size, top, scale) = (theme.get_cal_lane_text_size(), theme.get_cal_lane_text_top(), self.bar.window().scale_factor());
        self.bar.set_cal_lanes(std::rc::Rc::new(slint::VecModel::from(layout.lanes.into_iter().map(|lane| {
            let icon_space = if lane.icon.is_empty() { 0.0 } else { icon_size + theme.get_calendar_gap() };
            let (title, w, h) = lane_title(&lane.title, size, lane.h - top * 2.0 - icon_space, scale);
            CalLane { x: lane.x, y: lane.y, w: lane.w, h: lane.h, color: color(lane.color), fresh: lane.fresh, done: lane.done, priority: lane.priority, title, title_w: w, title_h: h,
                has_icon: !lane.icon.is_empty(), icon: icon_image(&lane.icon, icon_size, scale) }
        }).collect::<Vec<_>>())).into());
    }

    /// The day view under the search bar, and the panel at the left.
    fn draw_day(&mut self, day: day_view::DayView, side: Option<day::SidePanel>) {
        let theme = self.bar.global::<Theme>();
        let scale = self.bar.window().scale_factor();
        let dt = texts::day_texts(self.state.language);
        let (symbol, heading_icon, tag_icon) = (theme.get_day_symbol_size(), theme.get_day_heading_icon(), theme.get_day_tag_icon_size());
        self.bar.set_day_heading(day.heading.clone().into());
        self.bar.set_day_relative(day.relative.clone().into());
        self.bar.set_day_is_today(day.is_today);
        self.bar.set_day_title_placeholder(if day.view == features::View::Day { dt.title_placeholder } else { dt.period_title_placeholder }.into());
        for (name, set) in [("play", Bar::set_icon_play as fn(&Bar, slint::Image)), ("pause", Bar::set_icon_pause), ("square", Bar::set_icon_stop), ("x", Bar::set_icon_close), ("chevron-left", Bar::set_icon_back), ("chevron-right", Bar::set_icon_forward), ("calendar-check", Bar::set_icon_today)] {
            set(&self.bar, control_image(&self.bar, name, tag_icon, scale));
        }
        let color = |rgb: Option<calendar::Rgb>| rgb.map_or(theme.get_accent(), |[r, g, b]| slint::Color::from_rgb_u8(r, g, b));
        self.day_items = day.items();
        let index_of = |item: &Option<day_view::Item>| item.as_ref().and_then(|item| self.day_items.iter().position(|known| known == item)).map_or(-1, |at| at as i32);
        // Where the chosen line is (the list keeps it in view).
        let paired = day.rows.iter().any(|r| r.kind == day_view::RowKind::Activity);
        let values_shown = day.rows.iter().any(|r| r.kind == day_view::RowKind::Dials);
        let views = self.state.views();
        self.bar.set_views(strings(views.0.iter().map(|view| texts::settings::tr(texts::settings::view_name(*view), self.state.language).to_string())));
        self.bar.set_view_index(views.0.iter().position(|view| *view == views.1).map_or(0, |at| at as i32));
        self.bar.set_view_switch_label(dt.view_switch.into());
        self.bar.set_day_note_placeholder(if day.view == features::View::Day { dt.note_day } else { dt.note_period }.into());
        let mut column = 0;
        let mut top = 0.0f32;
        let mut footer = false;
        let mut entries_height = 0.0;
        let mut focus = (false, 0.0, 0.0);
        let mut bottom = 0.0f32;
        let (dial_px, thickness) = (theme.get_dial_size(), theme.get_dial_thickness());
        let track = rgba(theme.get_dial_track());
        let mut entries = Vec::new();
        let mut footer_rows = Vec::new();
        for row in &day.rows {
            use day_view::RowKind as K;
            let kind = match row.kind { K::Heading => 0, K::Entry => 1, K::Activity => 3, K::Empty => 4, K::Title => 5, K::Timer => 6, K::Dials => 7, K::Note => 8 };
            // The values and the checklist stand at the bottom, side by side when both are shown.
            if row.kind == K::Heading && (row.icon == "gauge" || row.icon == "activity") && !footer {
                footer = true;
                entries_height = top;
            }
            if row.kind == K::Heading && row.icon == "gauge" {
                top = 0.0;
                column = i32::from(paired);
            }
            if row.kind == K::Heading && row.icon == "activity" {
                column = if values_shown { 2 } else { 0 };
                top = 0.0;
            }
            let inner = self.bar.get_form_space() - 2.0 * theme.get_padding();
            let width = if column == 0 { inner } else { (inner - theme.get_gap()) / 2.0 };
            // The dials: up to three side by side, four as two by two, five and six three to a line; smaller where
            // the room asks for it.
            let dial_count = row.dials.len();
            let columns = dial_layout_columns(dial_count);
            let spacing = theme.get_dial_spacing();
            let cell = theme.get_dial_cell_width().min((width - spacing * (columns as f32 - 1.0)) / columns as f32);
            let dial_size = (theme.get_dial_size() * cell / theme.get_dial_cell_width()).floor();
            let dial_row = theme.get_dial_row_height() - (theme.get_dial_size() - dial_size);
            let tall = match row.kind {
                K::Heading => theme.get_day_heading_height(), K::Title => theme.get_day_title_height(),
                K::Dials => dial_row * dial_count.div_ceil(columns) as f32,
                // The note: as many lines as its text takes (about), more while it is written.
                // The note: a field of a few lines at least, growing with its text (and over the rest of the room when
                // nothing comes below it, see `fill`).
                K::Note => {
                    let per_line = ((width - 2.0 * theme.get_field_inset()) / (theme.get_write_size() * 0.6)).max(8.0) as usize;
                    let lines: usize = row.label.split('\n').map(|line| line.chars().count().div_ceil(per_line).max(1)).sum();
                    let shown = (lines + usize::from(row.editing)).max(theme.get_day_note_min_lines() as usize).min(theme.get_day_note_lines() as usize * 2);
                    shown as f32 * theme.get_day_note_line() + theme.get_day_note_pad() * 2.0
                }
                _ => theme.get_day_row_height(),
            };
            let y = top;
            top += tall;
            if footer { bottom = bottom.max(top); }
            if row.selected || row.editing || row.dials.iter().any(|d| d.selected) {
                let line = row.dials.iter().position(|d| d.selected).unwrap_or_default() / columns;
                focus = (footer, y + line as f32 * dial_row, tall.min(dial_row));
            }
            let model = DayRow {
                column, top: y, tall, kind, item: index_of(&row.item), icon: journal_image(&self.bar, row.icon, if kind == 0 { heading_icon } else { symbol }, scale),
                has_tag_icon: !row.tag_icon.is_empty(), tag_icon: icon_image(&row.tag_icon, tag_icon, scale),
                has_color: row.color.is_some(), color: color(row.color), done: row.done, priority: row.priority, trace: row.trace, foreign: row.foreign,
                selected: row.selected, editing: row.editing, track: row.track, has_timer: row.timer.is_some(),
                timer_running: row.timer.as_ref().is_some_and(|t| t.running), timer_clock: row.timer.as_ref().map(|t| t.clock.clone()).unwrap_or_default().into(),
                label: row.label.clone().into(), detail: row.detail.clone().into(), description: row.description.trim().into(),
                dial_columns: columns as i32, dial_cell: cell, dial_size, dial_row,
                plain: matches!(row.item, Some(day_view::Item::PeriodEntry(_))),
                fill: false,
                dials: std::rc::Rc::new(slint::VecModel::from(row.dials.iter().map(|d| DialCell {
                    raw: d.raw.unwrap_or(d.min) as i32, low: d.min as i32, high: d.max as i32, item: index_of(&Some(d.item.clone())), label: d.label.clone().into(), value: d.value.clone().into(), selected: d.selected,
                    color: color(Some(d.color)), image: dial_image(dial_size, thickness * dial_size / dial_px, d.fill, track, rgba(color(Some(d.color))), scale),
                }).collect::<Vec<_>>())).into(),
            };
            if footer { footer_rows.push(model); } else { entries.push(model); }
        }
        // The note as the last line of the list takes the room left under it.
        if let Some(last) = entries.last_mut() { last.fill = last.kind == 8; }
        self.bar.set_day_list_height(entries_height);
        self.bar.set_day_footer_height(bottom);
        self.bar.set_day_rows(std::rc::Rc::new(slint::VecModel::from(entries)).into());
        self.bar.set_day_footer_rows(std::rc::Rc::new(slint::VecModel::from(footer_rows)).into());
        self.bar.set_day_focus_footer(focus.0);
        self.bar.set_day_focus_y(focus.1);
        self.bar.set_day_focus_h(focus.2);

        let Some(side) = side else {
            self.bar.set_side_open(false);
            self.side_cells.clear();
            return;
        };
        self.bar.set_side_kind(side.kind as i32);
        self.bar.set_side_focus_index(side.rows.iter().position(|row| row.selected).map_or(-1, |index| index as i32));
        self.bar.set_side_title(side.title.into());
        self.bar.set_side_heading(side.heading.into());
        self.bar.set_side_heading_icon(control_image(&self.bar, side.heading_icon, theme.get_label_icon_size(), scale));
        let row_icon = if side.kind == 2 { theme.get_icon_size() } else { theme.get_label_icon_size() };
        if side.kind == 2 && side.rows.len() > LAZY_ICONS {
            // Every icon: only those near the lines in sight and the chosen one are drawn.
            let chosen = side.rows.iter().position(|row| row.selected);
            let rows = side.rows.iter().map(|r| picker_row_plain(&self.bar, r)).collect();
            let names = side.rows.iter().map(|r| r.icon.clone()).collect();
            let model = self.side_icons.build(rows, names, theme.get_side_icon_columns() as usize, chosen, row_icon, scale);
            self.bar.set_side_rows(model.into());
        } else {
            self.side_icons.clear();
            self.bar.set_side_rows(std::rc::Rc::new(slint::VecModel::from(side.rows.iter().map(|r| picker_row(&self.bar, r, row_icon)).collect::<Vec<_>>())).into());
        }
        self.bar.set_side_clock_hours(side.clock.0.into());
        self.bar.set_side_clock_minutes(side.clock.1.into());
        self.bar.set_side_clock_on_minutes(side.clock.2);
        self.bar.set_side_month_title(side.month.into());
        self.bar.set_side_weekdays(strings(side.weekdays));
        self.side_cells = side.cells.iter().map(|c| c.date).collect();
        self.bar.set_side_cells(std::rc::Rc::new(slint::VecModel::from(side.cells.iter().map(|c| MonthCell {
            label: c.label.clone().into(), in_month: c.in_month, today: c.today, cursor: c.cursor, picked: c.picked, own: c.own, pending: c.pending, disabled: c.disabled,
        }).collect::<Vec<_>>())).into());
        self.bar.set_side_confirm_text(if side.kind == 4 { dt.take.into() } else { side.confirm.into() });
        self.bar.set_side_text_shown(side.text.into());
        self.bar.set_side_placeholder(side.placeholder.into());

        self.bar.set_side_open(true);
    }

    /// Writes the preferences (the notepad's width and whether it fills the window) and shows them.
    fn save_preferences(&mut self) {
        self.bar.set_notepad_width(self.state.preferences.notepad_width.map_or(0.0, f32::from));
        self.bar.set_notepad_wide(self.state.preferences.notepad_wide);
        if let Some(path) = &self.preferences_path {
            if let Err(error) = settings::write_json(path, &self.state.preferences) { eprintln!("J-TerminaL: {error}"); }
        }
    }

    fn effect(&mut self, effect: form::Effect) { self.effect_with(effect, false); }

    /// The effect of a repeated key (one held down): the same, but the drawing waits a moment and is done once for
    /// all repeats that came meanwhile.
    fn effect_repeated(&mut self, effect: form::Effect) {
        let plain = effect.focus.is_none() && effect.board.is_none() && !effect.analysis && !effect.settings && !effect.hide && !effect.hide_soon && !effect.quit;
        self.effect_with(effect, plain);
    }

    fn effect_with(&mut self, effect: form::Effect, later: bool) {
        self.bar.invoke_dismiss_preview();
        if let Some(text) = effect.text {
            self.bar.set_text(text.into());
            self.bar.invoke_select_text();
        }
        if let Some(text) = effect.search { self.bar.set_search_text(text.into()); }
        // The day view's inputs take their text when they appear.
        match (&effect.focus, &effect.day_text) {
            (Some(form::Pane::DayEdit), Some(text)) => self.bar.set_day_edit_text(text.clone().into()),
            (Some(form::Pane::SideText), Some(text)) => self.bar.set_side_text(text.clone().into()),
            _ => {}
        }
        if later {
            if !self.draw_timer.running() {
                self.draw_timer.start(slint::TimerMode::SingleShot, Duration::from_millis(25), || with_app(|app| app.draw()));
            }
        } else {
            self.draw_timer.stop();
            self.draw();
        }
        match effect.focus {
            // After drawing: the form must be open before its input can take the keyboard.
            Some(form::Pane::Entry) => self.bar.invoke_focus_entry(),
            Some(form::Pane::Search) => self.bar.invoke_focus_search(),
            Some(form::Pane::Day) => self.bar.invoke_focus_day(),
            Some(form::Pane::Menu) => self.bar.invoke_focus_menu(),
            Some(form::Pane::Notes) => self.bar.invoke_focus_notepad(),
            // The inputs of the day view and the popover's pickers focus themselves when they appear.
            Some(form::Pane::SideText) => self.bar.invoke_focus_menu(),
            Some(form::Pane::DayEdit) | None => {}
        }
        if let Some(cursor) = effect.search_cursor { self.bar.invoke_place_search_cursor(cursor as i32); }
        // A gap of a template's title: only it is selected, so typing fills it.
        if let Some((from, to)) = effect.select { self.bar.invoke_select_range(from as i32, to as i32); }
        if let Some(id) = effect.attachment { if let Some(target) = self.state.notepad_target(&id.to_string()) { self.show_notepad_target(target); } }
        if effect.save_preferences { self.save_preferences(); }
        if let Some(period)=effect.board {self.open_board(period);}
        if effect.analysis { self.open_analysis(); }
        if let Some(id) = effect.edit_tag { self.open_tag_editor(&id); }
        if effect.settings { self.show_settings(); }
        if effect.hide { hide_bar(&self.bar); }
        if effect.hide_soon {
            self.hide_timer.start(slint::TimerMode::SingleShot, Duration::from_millis(450), || with_bar(|bar| hide_bar(bar)));
        }
        if effect.quit {
            QUITS.with(|quits| quits.set(quits.get() + 1));
            let _ = slint::quit_event_loop();
        }
    }
}

/// The day column's width within the theme's bounds. Without the calendar weeks it may be as narrow as the date.
fn clamp_label_width(bar: &Bar, width: f32, weeks: bool) -> f32 {
    let theme = bar.global::<Theme>();
    let least = if weeks { theme.get_cal_label_min_width() } else { theme.get_cal_label_min_width_no_weeks() };
    width.clamp(least, theme.get_cal_label_max_width())
}

/// The calendar's sizes as the theme has them.
fn metrics(bar: &Bar) -> calendar::Metrics {
    let theme = bar.global::<Theme>();
    calendar::Metrics {
        width: theme.get_calendar_width(), height: theme.get_calendar_height(), pad: theme.get_cal_pad(), head_h: theme.get_cal_head_height(),
        lanes: theme.get_cal_lanes() as usize, lane_w: theme.get_cal_lane_width(), label_w: theme.get_cal_label_width(), date_w: theme.get_cal_date_width(),
        day_h: theme.get_cal_day_height(), thin_h: theme.get_cal_thin_height(), row_h: theme.get_cal_row_height(), month_h: theme.get_cal_month_height(),
        date_h: theme.get_cal_date_height(), chip_h: theme.get_cal_chip_height(), dot: theme.get_cal_dot(), point_w: theme.get_cal_point_width(), point_line_w: theme.get_cal_point_line_width(), zoom: 1.0, pan: 0.0,
    }
}

/// The global opening chord belongs to the window that was active before us.
fn release_opening_modifiers(window: &slint::Window) {
    use slint::platform::{Key, WindowEvent};
    for key in [Key::Control, Key::Alt, Key::Shift] {
        window.dispatch_event(WindowEvent::KeyReleased { text: char::from(key).into() });
    }
}

fn filter_opening_modifiers(window: &slint::Window, event: &WindowEvent) -> EventResult {
    use slint::winit_030::winit::{event::ElementState, keyboard::{Key, NamedKey}};
    if matches!(event, WindowEvent::Focused(true)) {
        release_opening_modifiers(window);
    }
    if let WindowEvent::KeyboardInput { event, is_synthetic: true, .. } = event {
        if event.state == ElementState::Pressed && matches!(event.logical_key, Key::Named(NamedKey::Control | NamedKey::Alt | NamedKey::Shift)) {
            return EventResult::PreventDefault;
        }
    }
    EventResult::Propagate
}

fn present(bar: &Bar) {
    // Defer access to APP: present can itself be called while with_bar borrows it.
    slint::Timer::single_shot(Duration::ZERO, || with_app(|app| {
        app.hide_timer.stop();
        app.restore_launcher = false;
        // Where it opens: where it was (within the time set in F1), or the start view.
        let keep = app.state.preferences.keeps_place(HIDDEN_AT.with(|at| at.get()).map(|at| at.elapsed()));
        if !keep {
            if app.board.is_some() { app.close_board(); }
            if app.analysis.open { app.close_analysis(); }
            let effect = app.state.back_to_start();
            app.effect(effect);
            return;
        }
        if app.board.is_some(){app.tick_board();app.draw_board();board_ui::focus_board(&app.bar);}
        else if app.analysis.open {
            // Back where it was, with what changed meanwhile.
            app.state.refresh();
            app.draw_analysis();
            let ui = app.bar.global::<AnalysisUi>();
            ui.set_focus_request(ui.get_focus_request().wrapping_add(1));
        }
        else{let effect = app.state.resumed();app.effect(effect);}
    }));
    release_opening_modifiers(bar.window());
    if let Err(e) = bar.show() { eprintln!("J-TerminaL: Fenster: {e}"); return; }
    let centered = APP.with(|slot| slot.borrow().as_ref().is_some_and(|app| app.state.preferences.center_window));
    place_and_focus(bar, centered, 50);
}

/// The window opens on `date`'s day view (a reminder card's title).
fn open_day(date: chrono::NaiveDate) {
    with_bar(present);
    // After `present`'s own preparation, which may return to today.
    slint::Timer::single_shot(Duration::ZERO, move || with_app(|app| {
        if app.board.is_some() { return; }
        if app.analysis.open { app.close_analysis(); }
        app.state.reveal_day(date);
        app.draw();
    }));
}

fn screen_for_monitor(monitor: slint::winit_030::winit::monitor::MonitorHandle) -> placement::Screen {
    let (position, size) = (monitor.position(), monitor.size());
    placement::Screen { left: position.x, top: position.y, width: size.width as i32, height: size.height as i32, scale: monitor.scale_factor() }
}

fn center_resized_window(bar: &Bar, vertically: bool) {
    if !bar.window().is_visible() { return; }
    bar.window().with_winit_window(|window| {
        let (Some(monitor), Ok(position)) = (window.current_monitor(), window.outer_position()) else { return; };
        let size = window.outer_size();
        if size.width == 0 || size.height == 0 { return; }
        let area = placement::work_area(screen_for_monitor(monitor));
        let x = placement::centered_left(area, size.width as i32);
        let y = if vertically { area.top + (area.height - size.height as i32).max(0) / 2 } else { position.y };
        if x != position.x || y != position.y {
            window.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(x, y));
        }
    });
}

/// The native window exists once the event loop has made it; while waiting in the background it already does. Only
/// right after a direct start it may still be missing, so this tries again a few milliseconds later.
fn place_and_focus(bar: &Bar, centered: bool, tries: u32) {
    let placed = bar.window().with_winit_window(|window| {
        let screens: Vec<placement::Screen> = window.available_monitors().map(screen_for_monitor).collect();
        if let Some(screen) = placement::pick(&screens, placement::mouse()).map(placement::work_area) {
            bar.set_screen_width((screen.width as f64 / screen.scale) as f32);
            let preferred_height = if centered {
                bar.set_screen_height((screen.height as f64 / screen.scale) as f32);
                bar.get_content_height()
            } else { bar.global::<Theme>().get_calendar_height() * if bar.get_stacked() { 2.0 } else { 1.0 } };
            let (x, y) = placement::top_center(screen, bar.get_content_width());
            let room = (screen.height - (preferred_height as f64 * screen.scale).round() as i32).max(0);
            let y = if centered { screen.top + room / 2 } else { y.min(screen.top + room) };
            if !centered { bar.set_screen_height(((screen.top + screen.height - y) as f64 / screen.scale) as f32); }
            window.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(x, y));
        }
        window.focus_window();
    });
    if placed.is_some() {
        #[cfg(windows)]
        configure_launcher_frame(bar);
        if bar.global::<BoardUi>().get_opened(){board_ui::focus_board(bar);}else{bar.invoke_focus_line();}
    } else if tries > 0 {
        slint::Timer::single_shot(std::time::Duration::from_millis(5), move || with_bar(|bar| place_and_focus(bar, centered, tries - 1)));
    }
}

#[cfg(windows)]
fn transparency_enabled() -> bool {
    use windows_sys::Win32::UI::{Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW}, WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST}};
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let mut contrast = HIGHCONTRASTW { cbSize: size_of::<HIGHCONTRASTW>() as u32, ..Default::default() };
    unsafe { SystemParametersInfoW(SPI_GETHIGHCONTRAST, contrast.cbSize, (&mut contrast as *mut HIGHCONTRASTW).cast(), 0) };
    let transparency = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|key| key.get_value::<u32, _>("EnableTransparency"));
    contrast.dwFlags & HCF_HIGHCONTRASTON == 0 && transparency.unwrap_or(1) != 0
}

/// Let DWM clip its acrylic and the client to the same rounded outline.
#[cfg(windows)]
fn configure_launcher_frame(bar: &Bar) {
    use slint::winit_030::winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::{
        Graphics::{Dwm::*, Gdi::SetWindowRgn},
        UI::{Controls::MARGINS, Shell::SetWindowSubclass, WindowsAndMessaging::*},
    };

    let glass = bar.window().with_winit_window(|window| {
        let Ok(handle) = window.window_handle() else { return false };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else { return false };
        let hwnd = handle.hwnd.get() as _;
        unsafe {
            SetWindowSubclass(hwnd, Some(launcher_frame), 2, 0);
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if style & WS_CAPTION != 0 {
                SetWindowLongW(hwnd, GWL_STYLE, (style & !WS_CAPTION) as i32);
                SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
            }
        }
        let attribute = |name, value: i32| unsafe {
            DwmSetWindowAttribute(hwnd, name as u32, (&value as *const i32).cast(), size_of::<i32>() as u32) >= 0
        };
        if transparency_enabled() {
            attribute(DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
            // DWM can keep a solid acrylic fallback across hide/show. Commit
            // the removal before requesting the material again on this HWND.
            if bar.get_glass() && attribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE) {
                unsafe { DwmFlush() };
            }
            let frame = MARGINS { cxLeftWidth: -1, ..Default::default() };
            // A custom window region prevents DWM from rounding the system backdrop.
            if attribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)
                && unsafe { SetWindowRgn(hwnd, std::ptr::null_mut(), 1) } != 0
                && attribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_TRANSIENTWINDOW)
                && unsafe { DwmExtendFrameIntoClientArea(hwnd, &frame) } >= 0
            {
                let border = bar.global::<Theme>().get_border();
                let color_ref = i32::from(border.red()) | (i32::from(border.green()) << 8) | (i32::from(border.blue()) << 16);
                attribute(DWMWA_BORDER_COLOR, color_ref);
                return true;
            }
        }
        attribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE);
        unsafe { DwmExtendFrameIntoClientArea(hwnd, &MARGINS::default()) };
        false
    });
    bar.set_glass(glass == Some(true));
    round_window(bar);
}

// The launcher owns its full client area. Keep winit's focus handling, but
// suppress the non-client repaint Windows would otherwise do on activation.
#[cfg(windows)]
unsafe extern "system" fn launcher_frame(hwnd: windows_sys::Win32::Foundation::HWND, msg: u32, wp: usize, lp: isize, id: usize, _: usize) -> isize {
    use windows_sys::Win32::UI::{Shell::{DefSubclassProc, RemoveWindowSubclass}, WindowsAndMessaging::*};
    match msg {
        WM_STYLECHANGING if wp as i32 == GWL_STYLE && lp != 0 => {
            (*(lp as *mut STYLESTRUCT)).styleNew &= !WS_CAPTION;
        }
        WM_NCACTIVATE => return DefSubclassProc(hwnd, msg, wp, -1),
        WM_NCPAINT => return 0,
        WM_SETTINGCHANGE | WM_DWMCOMPOSITIONCHANGED => {
            slint::Timer::single_shot(Duration::ZERO, || with_bar(|bar| {
                if bar.window().is_visible() { configure_launcher_frame(bar); }
            }));
        }
        WM_NCDESTROY => { RemoveWindowSubclass(hwnd, Some(launcher_frame), id); }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

#[cfg(windows)]
fn round_window(bar: &Bar) {
    use slint::winit_030::winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::Graphics::Gdi::{DeleteObject, InvalidateRect, SetWindowRgn};

    if bar.get_glass() { return; }
    bar.window().with_winit_window(|window| {
        let Ok(handle) = window.window_handle() else { return };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else { return };
        let size = window.outer_size();
        if size.width == 0 || size.height == 0 { return; }
        let diameter = (2.0 * f64::from(bar.global::<Theme>().get_radius()) * window.scale_factor()).round() as i32;
        unsafe {
            let region = window_region(size.width, size.height, diameter);
            // Windows takes ownership when SetWindowRgn succeeds.
            if !region.is_null() {
                let hwnd = handle.hwnd.get() as _;
                // A non-client repaint can draw the Win32 caption across the Slint header.
                if SetWindowRgn(hwnd, region, 0) == 0 {
                    DeleteObject(region);
                } else {
                    InvalidateRect(hwnd, std::ptr::null(), 0);
                }
            }
        }
    });
}

#[cfg(windows)]
fn window_region(width: u32, height: u32, diameter: i32) -> windows_sys::Win32::Graphics::Gdi::HRGN {
    unsafe { windows_sys::Win32::Graphics::Gdi::CreateRoundRectRgn(0, 0, width as i32 + 1, height as i32 + 1, diameter, diameter) }
}

#[cfg(all(test, windows))]
#[test]
fn native_window_rounds_both_right_corners() {
    use windows_sys::Win32::Graphics::Gdi::{DeleteObject, PtInRegion};
    for (width, height, diameter) in [(1501, 400, 32), (2252, 600, 48)] {
        let region = window_region(width, height, diameter);
        assert!(!region.is_null());
        unsafe {
            let right = width as i32 - 1;
            let bottom = height as i32 - 1;
            assert_eq!(PtInRegion(region, right, 0), 0);
            assert_eq!(PtInRegion(region, right, bottom), 0);
            assert_ne!(PtInRegion(region, right, bottom / 2), 0);
            DeleteObject(region);
        }
    }
}

thread_local! {
    /// When the main window was last hidden.
    static HIDDEN_AT: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

/// Hides the main window and notes when (for going back to the start view after a while).
fn hide_bar(bar: &Bar) {
    if bar.window().is_visible() { HIDDEN_AT.with(|at| at.set(Some(std::time::Instant::now()))); }
    let _ = bar.hide();
}

fn toggle(bar: &Bar) {
    if bar.window().is_visible() {
        with_app(|app| app.restore_launcher = false);
        hide_bar(bar);
    } else { present(bar); }
}

fn route_key(context: ShortcutContext, text: slint::SharedString, mask: i32) -> RoutedKey {
    let context = match context {
        ShortcutContext::Window => shortcuts::WINDOW,
        ShortcutContext::Search => shortcuts::SEARCH,
        ShortcutContext::Form => shortcuts::FORM,
        ShortcutContext::Day => shortcuts::DAY,
        ShortcutContext::DayEdit => shortcuts::DAY_EDIT,
        ShortcutContext::Side => shortcuts::SIDE,
        ShortcutContext::Notes => shortcuts::NOTES,
    };
    APP.with(|slot| {
        slot.borrow().as_ref().and_then(|app| app.bindings.route(context, &text, mask))
            .map(|(text, mask)| RoutedKey { text: text.into(), mask })
            .unwrap_or(RoutedKey { text, mask })
    })
}

fn connect_settings(settings: &SettingsWindow) {
    settings.global::<KeyBindings>().on_resolve(route_key);
    settings.on_dismiss(|| with_app(App::close_settings));
    settings.window().on_close_requested(|| {
        with_app(App::close_settings);
        slint::CloseRequestResponse::KeepWindowShown
    });
    let weak = settings.as_weak();
    settings.window().on_winit_window_event(move |window, event| {
        if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
            let weak = weak.clone();
            slint::Timer::single_shot(Duration::ZERO, move || {
                if let Some(window) = weak.upgrade() {
                    with_app(|app| app.draw_settings_labels(&window));
                }
            });
        }
        filter_opening_modifiers(window, event)
    });
    let weak = settings.as_weak();
    settings.on_system_menu(move |x, y| {
        if let Some(settings) = weak.upgrade() {
            settings.window().with_winit_window(|window| window.show_window_menu(slint::winit_030::winit::dpi::LogicalPosition::new(x, y)));
        }
    });
    settings.on_update_binding(|id, text, mask| APP.with(|app| {
        app.borrow_mut().as_mut().map_or_else(slint::SharedString::default, |app| app.change_shortcut(&id, &text, mask).into())
    }));
    let weak = settings.as_weak();
    settings.on_editable_row(move |index, direction| {
        use slint::Model;
        let Some(settings) = weak.upgrade() else { return -1; };
        let rows = settings.get_rows();
        let end = rows.row_count() as i32;
        let editable = |i: &i32| rows.row_data(*i as usize).is_some_and(|row| row.control != RowControl::Fixed);
        let found = if direction < 0 {
            (0..(index + 1).min(end)).rev().find(editable)
        } else {
            (index.max(0)..end).find(editable)
        };
        found.unwrap_or(-1)
    });
    settings.on_lookup(|query| with_app(|app| {
        app.settings_navigation.search(&query);
        if let Some(settings) = &app.settings { app.draw_settings_rows(settings); }
    }));
    settings.on_navigate(|index| with_app(|app| {
        app.settings_navigation.visit(index);
        if let Some(settings) = &app.settings { app.draw_settings_rows(settings); }
    }));
    settings.on_travel(|forward| with_app(|app| {
        app.settings_navigation.travel(forward);
        if let Some(settings) = &app.settings { app.draw_settings_rows(settings); }
    }));
    settings.on_period_edit(|id, field, value| with_app(|app| {
        // The picker's field and hue bar give hue, saturation and brightness; stored is the hex code.
        let (field, value) = if field == "hsv" {
            let parts: Vec<f32> = value.split(',').filter_map(|part| part.trim().parse().ok()).collect();
            let [h, s, v] = parts[..] else { return };
            ("color".to_string(), tag_edit::hex_of(h, s, v))
        } else { (field.to_string(), value.to_string()) };
        app.period_setting(|data, tags, page| period_settings::change(data, tags, page, &id, &field, &value));
    }));
    settings.on_period_add(|name| with_app(|app| {
        app.period_setting(|data, tags, page| period_settings::add(data, tags, page, &name));
    }));
    settings.on_set_preference(|key, index| APP.with(|app| {
        app.borrow_mut().as_mut().map_or_else(Default::default, |app| app.change_preference(key, index).into())
    }));
    settings.on_set_feature(|id, on| APP.with(|app| {
        app.borrow_mut().as_mut().map_or_else(Default::default, |app| app.change_feature(&id, on).into())
    }));
}

fn connect(bar: &Bar) {
    board_ui::connect(bar);
    analysis_ui::connect(bar);
    tag_editor_ui::connect(bar);
    bar.global::<KeyBindings>().on_resolve(route_key);
    bar.on_open_settings(|| with_app(App::show_settings));
    let weak = bar.as_weak();
    bar.on_dial_preview(move |value, low, high, color| {
        let Some(bar) = weak.upgrade() else { return slint::Image::default(); };
        let theme = bar.global::<Theme>();
        let fraction = (value - low) as f32 / (high - low).max(1) as f32;
        dial_image(theme.get_dial_size(), theme.get_dial_thickness(), Some(fraction), rgba(theme.get_dial_track()), rgba(color), bar.window().scale_factor())
    });
    bar.on_calendar_resized(|width, height| {
        let resize = move |app: &mut App| {
            if height > 0.0 && width > 0.0 && (app.state.metrics.height != height || app.state.metrics.width != width) {
                app.state.metrics.width = width;
                app.state.metrics.height = height;
                let calendar = app.state.calendar_view();
                app.draw_calendar(calendar);
            }
        };
        // Slint may report the size while the state is in use (the window being shown or drawn): then right after.
        if APP.with(|slot| slot.try_borrow_mut().is_err()) {
            slint::Timer::single_shot(Duration::ZERO, move || with_app(resize));
        } else { with_app(resize); }
    });
    bar.on_cal_mouse(|button, kind, x, y, shift| with_app(|app| {
        // Moving without a button only matters while marking.
        if kind == 1 && !app.state.marking() { return; }
        let effect = app.state.cal_mouse(button, kind, x, y, shift);
        app.effect(effect);
    }));
    bar.on_preview_body(|source| mail_preview::body(&source));
    bar.on_calendar_hover_preview(|x, y| APP.with(|slot| {
        let slot = slot.borrow();
        let Some((index, x, y, entry)) = slot.as_ref().and_then(|app| app.state.calendar_hover_entry(x, y)) else { return EntryPreview::default() };
        EntryPreview { source: 3, index: index as i32, title: entry.text.trim().into(), description: entry.description.trim().into(), x, y }
    }));
    bar.on_calendar_keyboard_preview(|step| APP.with(|slot| {
        let slot = slot.borrow();
        let Some((index, x, y, entry)) = slot.as_ref().and_then(|app| app.state.calendar_keyboard_preview(step.max(0) as usize)) else { return EntryPreview::default() };
        EntryPreview { source: 3, index: index as i32, title: entry.text.trim().into(), description: entry.description.trim().into(), x, y }
    }));
    bar.on_day_keyboard_preview(|| APP.with(|slot| {
        use slint::Model;
        let slot = slot.borrow();
        let Some(app) = slot.as_ref() else { return EntryPreview::default() };
        let Some(row) = app.bar.get_day_rows().iter().find(|row| row.kind == 1 && row.selected && !row.editing) else { return EntryPreview::default() };
        EntryPreview { source: 2, index: row.item, title: row.label, description: row.description,
            x: app.bar.get_form_space(), y: app.bar.global::<Theme>().get_line_height() }
    }));
    let weak = bar.as_weak();
    bar.on_cal_resize_labels(move |x| {
        let Some(bar) = weak.upgrade() else { return };
        with_app(|app| {
            let m = &app.state.metrics;
            let width = clamp_label_width(&bar, x - m.pad - m.lanes as f32 * m.lane_w, app.state.preferences.week_numbers).round();
            if width == m.label_w { return; }
            app.state.metrics.label_w = width;
            let calendar = app.state.calendar_view();
            app.draw_calendar(calendar);
        });
    });
    bar.on_notepad_resized(|width| with_app(|app| {
        let width = width.round().max(0.0) as u16;
        if app.state.preferences.notepad_width == Some(width) { return; }
        app.state.preferences.notepad_width = Some(width);
        app.save_preferences();
    }));
    bar.on_cal_resize_labels_done(|| with_app(|app| {
        let width = app.state.metrics.label_w as u16;
        if app.state.preferences.calendar_label_width == Some(width) { return; }
        app.state.preferences.calendar_label_width = Some(width);
        if let Some(path) = &app.preferences_path {
            if let Err(error) = settings::write_json(path, &app.state.preferences) { eprintln!("J-TerminaL: {error}"); }
        }
    }));
    bar.on_cal_wheel(|x, delta, ctrl, shift| with_app(|app| { app.state.cal_wheel(x, delta, ctrl, shift); app.draw(); }));
    bar.on_day_today(|| with_app(|app| { app.state.show_today(); app.draw(); }));
    bar.on_view_step(|by| with_app(|app| { app.hide_timer.stop(); app.state.step_view(by); app.draw(); }));
    bar.on_view_choose(|index| with_app(|app| {
        let (views, _) = app.state.views();
        if let Some(view) = views.get(index.max(0) as usize) { app.state.set_view(*view); app.draw(); }
    }));
    bar.on_release_plan_space(|| with_app(|app| app.state.release_plan_space()));
    bar.on_day_shortcut(|text, mask| APP.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(app) = slot.as_mut() else { return false };
        let Some((id, text, mods)) = app.bindings.day_shortcut(&text, mask) else { return false };
        if id == "journal-search" {
            if app.state.pane.edit.is_some() || app.state.pane.side.is_some() { return false; }
            if app.state.menu.take().is_some() { app.draw(); }
            app.bar.invoke_focus_search();
        } else if let Some(key) = day_key(&text) {
            app.hide_timer.stop();
            app.state.menu = None;
            let effect = app.state.day_key(key, day::Mods { shift: mods & 1 != 0, ctrl: mods & 2 != 0, alt: true });
            app.effect(effect);
        }
        true
    }));
    bar.on_day_key(|text, mods| with_app(|app| {
        let Some(key) = day_key(&text) else { return };
        app.hide_timer.stop();
        let effect = app.state.day_key(key, day::Mods { shift: mods & 1 != 0, ctrl: mods & 2 != 0, alt: mods & 4 != 0 });
        if mods & 8 != 0 { app.effect_repeated(effect); } else { app.effect(effect); }
    }));
    bar.on_day_edited(|text| with_app(|app| app.state.pane.edited(&text)));
    bar.on_day_click(|item, part| with_app(|app| {
        let Some(item) = app.day_items.get(item.max(0) as usize).cloned().filter(|_| item >= 0) else { return };
        let out = app.state.with_pane(|pane, cx| pane.click(cx, item, part));
        let effect = app.state.pane_effect(out);
        app.effect(effect);
    }));
    bar.on_field_clicked(|index| with_app(|app| { let effect = app.state.click_field(index.max(0) as usize); app.effect(effect); }));
    bar.on_toggle_menu(|| with_app(|app| { app.hide_timer.stop(); let effect = app.state.toggle_menu(); app.effect(effect); }));
    bar.on_app_menu_clicked(|| with_app(|app| { app.hide_timer.stop(); let effect = app.state.toggle_app_menu(); app.effect(effect); }));
    bar.on_menu_edited(|text| with_app(|app| { app.state.menu_edited(&text); app.draw(); }));
    bar.on_menu_key(|text, mods| with_app(|app| {
        let key = match day_key(&text) {
            Some(day::K::Up | day::K::BackTab) => form::Key::Up,
            Some(day::K::Tab) if mods & 1 != 0 => form::Key::Up,
            Some(day::K::Down | day::K::Tab) => form::Key::Down,
            Some(day::K::Home) => form::Key::Home,
            Some(day::K::End) => form::Key::End,
            Some(day::K::Enter) => form::Key::Enter,
            Some(day::K::Escape) => form::Key::Escape,
            _ => return,
        };
        let effect = app.state.menu_key(key);
        app.effect(effect);
    }));
    bar.on_menu_choose(|index| with_app(|app| { let effect = app.state.menu_choose(index.max(0) as usize); app.effect(effect); }));
    bar.on_footer_create(|kind| with_app(|app| { let effect = app.state.create_in_day(kind.max(0) as usize); app.effect(effect); }));
    bar.on_footer_action(|which| with_app(|app| {
        app.hide_timer.stop();
        let effect = if which == 1 { app.state.toggle_menu() } else { app.state.footer_primary() };
        app.effect(effect);
    }));
    bar.on_dial_set(|item, value, clear| with_app(|app| {
        let Some(day_view::Item::Value(id)) = app.day_items.get(item as usize).cloned() else { return };
        let out = app.state.with_pane(|pane, cx| pane.set_value(cx, &id, (!clear).then_some(value as i64)));
        let effect = app.state.pane_effect(out);
        app.effect(effect);
    }));
    bar.on_dial_point(|item, dx, dy| with_app(|app| {
        let Some(day_view::Item::Value(id)) = app.day_items.get(item.max(0) as usize).cloned() else { return };
        let fraction = dial::fraction_at(dx, dy);
        let out = app.state.with_pane(|pane, cx| pane.dial_at(cx, &id, fraction));
        let effect = app.state.pane_effect(Out { focus: true, ..out });
        app.effect(effect);
    }));
    bar.on_dial_wheel(|item, delta| with_app(|app| {
        let Some(day_view::Item::Value(id)) = app.day_items.get(item.max(0) as usize).cloned() else { return };
        let steps = if delta > 0.0 { 1 } else if delta < 0.0 { -1 } else { 0 };
        let out = app.state.with_pane(|pane, cx| pane.dial_wheel(cx, &id, steps));
        let effect = app.state.pane_effect(Out { focus: true, ..out });
        app.effect(effect);
    }));
    bar.on_side_scrolled(|line| with_app(|app| {
        let (size, scale) = (app.bar.global::<Theme>().get_icon_size(), app.bar.window().scale_factor());
        app.side_icons.scrolled(line, size, scale);
    }));
    bar.on_side_choose(|index| with_app(|app| { let out = app.state.with_pane(|pane, cx| pane.choose(cx, index.max(0) as usize)); let effect = app.state.pane_effect(out); app.effect(effect); }));
    bar.on_side_edited(|text| with_app(|app| { app.state.pane.side_edited(&text); app.draw(); }));
    bar.on_side_day(|index| with_app(|app| {
        let Some(date) = app.side_cells.get(index.max(0) as usize).copied() else { return };
        let effect = if app.state.month_picker_open() {
            app.state.pick_month_date(date)
        } else {
            let out = app.state.with_pane(|pane, cx| pane.plan_click(cx, date));
            app.state.pane_effect(out)
        };
        app.effect(effect);
    }));
    bar.on_side_month(|by| with_app(|app| {
        let effect = if app.state.month_picker_open() {
            let key = if by < 0 { form::Key::PageUp } else { form::Key::PageDown };
            app.state.key(key, form::Mods::default())
        } else {
            let out = app.state.pane.plan_month(by);
            app.state.pane_effect(out)
        };
        app.effect(effect);
    }));
    bar.on_side_confirm(|| with_app(|app| {
        let effect = if app.state.month_picker_open() {
            app.state.key(form::Key::Enter, form::Mods::default())
        } else {
            let out = app.state.with_pane(|pane, cx| pane.side_confirm(cx));
            app.state.pane_effect(out)
        };
        app.effect(effect);
    }));
    bar.on_side_back(|| with_app(|app| {
        let effect = if app.state.month_picker_open() {
            app.state.key(form::Key::Escape, form::Mods::default())
        } else {
            let out = app.state.with_pane(|pane, cx| pane.side_back(cx));
            app.state.pane_effect(out)
        };
        app.effect(effect);
    }));
    bar.on_side_close(|| with_app(|app| { let out = app.state.pane.close_side(); let effect = app.state.pane_effect(out); app.effect(effect); }));
    bar.on_side_clock(|minutes, steps| with_app(|app| {
        let out = if steps == 0 { app.state.pane.clock_part(minutes) } else { app.state.pane.clock_wheel(minutes, steps) };
        let effect = app.state.pane_effect(out);
        app.effect(effect);
    }));
    bar.on_open_notepad(|| with_app(|app| {
        app.close_notepad_viewer();
        let effect = app.state.open_notepad();
        app.effect(effect);
        app.bar.invoke_focus_notepad();
    }));
    bar.on_notepad_new_note(|| with_app(|app| {
        app.close_notepad_viewer();
        let effect = app.state.new_notepad_note();
        app.effect(effect);
    }));
    bar.on_command_chosen(|index| with_app(|app| { let effect = app.state.choose_command(index as usize); app.effect(effect); }));
    bar.on_notepad_tool(|index| with_app(|app| {
        match index {
            3 => app.state.notepad_preview(),
            4 => app.state.notepad_panel(4),
            5 => { app.state.preferences.notepad_wide = !app.state.preferences.notepad_wide; app.save_preferences(); }
            _ => app.state.notepad_panel(index + 1),
        }
        app.draw();
    }));
    bar.on_notepad_filter(|_| with_app(|app| app.draw_notepad_choices()));
    bar.on_notepad_list_key(|key| with_app(|app| {
        let out = app.state.notes_list_key(&key);
        if out.close { let effect = app.state.finish_notepad(false); return app.effect(effect); }
        if let Some(query) = out.query { app.bar.set_notepad_query(query.into()); }
        if let Some(target) = out.target { app.show_notepad_target(target); }
        app.effect(out.effect);
        app.draw_notepad_choices();
    }));
    bar.on_notepad_list_menu(|key| with_app(|app| { let effect = app.state.notes_list_menu(&key); app.effect(effect); }));
    bar.on_notepad_list_drop(|key, index| with_app(|app| {
        let out = app.state.notes_list_drop(&key, index.max(0) as usize);
        if let Some(query) = out.query { app.bar.set_notepad_query(query.into()); }
        app.effect(out.effect);
        app.draw_notepad_choices();
    }));
    bar.on_notepad_choose(|key| with_app(|app| {
        let target = app.state.pick_notepad(&key);
        if let Some(target) = target { app.show_notepad_target(target); }
        app.draw();
        if let Some(id) = app.state.take_tag_edit() { app.open_tag_editor(&id); }
    }));
    bar.on_notepad_view_attachment(|key| with_app(|app| {
        if let Some(target) = app.state.notepad_target(&key) { app.show_notepad_target(target); }
    }));
    bar.on_notepad_close_viewer(|| with_app(App::close_notepad_viewer));
    bar.on_notepad_scope(|day| with_app(|app| {
        app.state.set_notepad_day_filter(day);
        app.bar.set_notepad_on_day(day);
        app.draw_notepad_choices();
    }));
    bar.on_notepad_indent_edit(|text, anchor, cursor, reverse| {
        let edit = note_markdown::tab(&text, anchor.max(0) as usize, cursor.max(0) as usize, reverse);
        NotepadIndent { text: edit.text.into(), anchor: edit.anchor as i32, cursor: edit.cursor as i32 }
    });
    bar.on_notepad_continue_list(|text, anchor, cursor| {
        note_markdown::continue_list(&text, anchor.max(0) as usize, cursor.max(0) as usize)
            .map(|edit| NotepadIndent { text: edit.text.into(), anchor: edit.anchor as i32, cursor: edit.cursor as i32 })
            .unwrap_or_else(|| NotepadIndent { text, anchor: -1, cursor: -1 })
    });
    bar.on_notepad_link(|url| with_app(|app| {
        if app.state.attach_notepad(notebook::Attachment::link(&url)) { app.bar.set_notepad_query("".into()); }
        app.draw();
    }));
    bar.on_notepad_image(choose_notepad_image);
    bar.on_notepad_check(|offset| with_app(|app| {
        app.state.notepad_toggle_check(offset as usize);
        app.draw();
    }));
    bar.on_notepad_follow(|url| {
        if let Some(url) = notebook::web_address(&url) { open_notepad_link(url); }
    });
    bar.on_notepad_edited(|body, text| with_app(|app| {
        app.state.edit_notepad(body, &text);
        app.bar.set_notepad_can_save(app.state.notepad().is_some_and(|draft| draft.can_save()));
        app.bar.set_notice(app.notice.clone().unwrap_or_default().into());
        app.bar.set_notice_is_error(app.notice.is_some());
    }));
    bar.on_notepad_finish(|save| with_app(|app| { let effect = app.state.finish_notepad(save); app.effect(effect); }));
    bar.on_search_edited(|text, cursor| with_app(|app| { app.state.search_at(&text, cursor.max(0) as usize); app.draw(); }));
    bar.on_search_cursor_moved(|text, cursor| APP.with(|slot| {
        // Setting text or focus after a selection can synchronously move the native input cursor.
        if let Ok(mut slot) = slot.try_borrow_mut() {
            if let Some(app) = slot.as_mut() {
                if app.state.move_search_cursor(&text, cursor.max(0) as usize) { app.draw(); }
            }
        }
    }));
    bar.on_choice_clicked(|index| with_app(|app| { let effect = app.state.choice_click(index.max(0) as usize); app.effect(effect); }));
    bar.on_sentence_clicked(|slot, value| with_app(|app| { app.state.repeat_click(slot, value); app.draw(); }));
    bar.on_edited(|text| with_app(|app| {
        app.hide_timer.stop();
        app.state.edited(&text);
        app.draw();
    }));
    bar.on_escape_fallback(|| with_app(|app| {
        app.hide_timer.stop();
        if app.analysis.open { app.close_analysis(); return; }
        let effect = app.state.escape();
        app.effect(effect);
    }));
    bar.on_hide_window(|| with_app(|app| {
        app.hide_timer.stop();
        app.restore_launcher = false;
        hide_bar(&app.bar);
    }));
    bar.on_form_key(|code, mods| with_app(|app| {
        use form::Key;
        let key = match code {
            0 => Key::Tab, 1 => Key::Up, 2 => Key::Down, 3 => Key::Enter, 4 => Key::Escape, 5 => Key::Left, 6 => Key::Right, 7 => Key::PageUp, 8 => Key::PageDown,
            9 => Key::Home, 10 => Key::Space, 11 => Key::Insert, 12 => Key::Delete, 15 => Key::Focus, 50 => Key::Undo, 51 => Key::Redo, 52 => Key::Quit,
            30 => Key::Priority, 31 => Key::Extra(form::Field::Description), 32 => Key::Extra(form::Field::Reminder), 33 => Key::Extra(form::Field::Icon), 34 => Key::Close,
            digit if (20..=29).contains(&digit) => Key::Digit((digit - 20) as u8), _ => return,
        };
        app.hide_timer.stop();
        let effect = app.state.key(key, form::Mods { shift: mods & 1 != 0, ctrl: mods & 2 != 0, alt: mods & 4 != 0 });
        if mods & 8 != 0 { app.effect_repeated(effect); } else { app.effect(effect); }
    }));
}

fn main() {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(e) => { eprintln!("J-TerminaL: {e}"); std::process::exit(2); }
    };

    // Canonicalize an explicit first-run profile the same way on every launch.
    if let Some(path) = &args.data {
        if let Err(e) = std::fs::create_dir_all(path) {
            eprintln!("J-TerminaL: {}: {e}", path.display());
            std::process::exit(1);
        }
    }
    // A second start only wakes the first.
    let start = instance::claim(&instance::socket(args.data.as_deref()), |instance::Message::Show| {
        let _ = slint::invoke_from_event_loop(|| with_bar(present));
    });
    match start {
        Ok(instance::Start::Another) => return,
        Ok(instance::Start::First) => {}
        Err(e) => { eprintln!("J-TerminaL: Instanz: {e}"); std::process::exit(1); }
    }

    // Both windows paint their own frame. Settings are resizable and have a taskbar entry.
    let selected = slint::BackendSelector::new()
        .backend_name("winit".into())
        .renderer_name("software".into())
        .with_winit_window_attributes_hook(|attributes| {
            #[cfg(windows)]
            let attributes = {
                use slint::winit_030::winit::platform::windows::WindowAttributesExtWindows;
                let attributes = attributes.with_transparent(false);
                if CREATING_LAUNCHER.with(|creating| creating.get()) {
                    attributes.with_skip_taskbar(true).with_decorations(false)
                } else if reminder::CREATING.with(|creating| creating.get()) {
                    // The reminder cards: above everything, without a taskbar entry and without taking the keyboard.
                    use slint::winit_030::winit::platform::windows::CornerPreference;
                    attributes.with_skip_taskbar(true).with_decorations(false).with_undecorated_shadow(true)
                        .with_corner_preference(CornerPreference::Round).with_active(false)
                        .with_window_level(slint::winit_030::winit::window::WindowLevel::AlwaysOnTop)
                        .with_theme(Some(slint::winit_030::winit::window::Theme::Dark))
                } else {
                    use slint::winit_030::winit::platform::windows::CornerPreference;
                    attributes.with_decorations(false).with_undecorated_shadow(true)
                        .with_corner_preference(CornerPreference::Round)
                        .with_theme(Some(slint::winit_030::winit::window::Theme::Dark))
                }
            };
            attributes
        })
        .select();
    if let Err(e) = selected { eprintln!("J-TerminaL: Oberfläche: {e}"); std::process::exit(1); }

    if !cfg!(debug_assertions) && args.data.is_none() {
        if let Err(e) = autostart::register() { eprintln!("J-TerminaL: Autostart: {e}"); }
    }

    let data = args.data.clone().or_else(journal_core::vault::app_data_folder);
    let opened = match &data { Some(data) => journal::open(data), None => Err(journal::Problem::NoVault) };
    let journal_language = match &opened {
        Ok(journal) => texts::Language::from_setting(&journal.store.interface_language().unwrap_or_default()),
        Err(_) => texts::Language::De,
    };
    let preferences_path = data.as_ref().map(|directory| directory.join("j-terminal-settings.json"));
    let preferences = settings::Preferences::load(preferences_path.as_deref()).unwrap_or_else(|error| {
        eprintln!("J-TerminaL: {}: {error}", texts::shortcut_labels(journal_language).settings);
        settings::Preferences::default()
    });
    let language = preferences.effective_language(journal_language);
    let t = texts::texts(language);
    let mut notice = match &opened {
        Ok(_) => None,
        Err(journal::Problem::NoVault) => Some(t.no_vault.to_string()),
        Err(journal::Problem::Unreachable(path)) => Some(format!("{} {}", t.unreachable, path.display())),
        Err(journal::Problem::TooNew) => Some(t.too_new.to_string()),
        Err(journal::Problem::Failed(e)) => Some(format!("{} {e}", t.open_failed)),
    };

    #[cfg(windows)]
    CREATING_LAUNCHER.with(|creating| creating.set(true));
    let bar = match Bar::new() {
        Ok(bar) => bar,
        Err(e) => { eprintln!("J-TerminaL: Fenster: {e}"); std::process::exit(1); }
    };
    // The backend's attribute hook runs when the Slint window adapter is created.
    let _ = bar.window();
    #[cfg(windows)]
    CREATING_LAUNCHER.with(|creating| creating.set(false));

    let mut bindings = shortcuts::Bindings::at(data.as_ref().map(|directory| directory.join("j-terminal-shortcuts.json")));
    match bindings.load() {
        Err(error) => { notice.get_or_insert_with(|| format!("{} {error}", texts::shortcut_labels(language).persist_error)); }
        // Said once: the cleaned keys are written back.
        Ok(dropped) if !dropped.is_empty() => {
            let names: Vec<&str> = dropped.iter().map(|id| shortcuts::Bindings::action_label(id, language)).collect();
            notice.get_or_insert_with(|| format!("{} {}", texts::shortcut_labels(language).reset_taken, names.join(", ")));
            let _ = bindings.save();
        }
        Ok(_) => {}
    }
    let hotkeys = GlobalHotKeyManager::new().ok();
    let active_hotkey = hotkeys.as_ref().and_then(|manager|
        bindings.register_system_hotkey(|key| manager.register(key).is_ok()));
    GlobalHotKeyEvent::set_event_handler(Some(|event: GlobalHotKeyEvent| {
        if event.state != HotKeyState::Pressed { return; }
        let _ = slint::invoke_from_event_loop(move || {
            let bar = APP.with(|slot| slot.borrow().as_ref().and_then(|app| {
                (app.active_hotkey.is_some_and(|key| key.id() == event.id)
                    && !app.settings.as_ref().is_some_and(|settings| settings.get_recording()))
                    .then(|| app.bar.clone_strong())
            }));
            if let Some(bar) = bar { toggle(&bar); }
        });
    }));

    connect(&bar);
    // Preserve drafts when the launcher hides on focus loss.
    bar.window().on_winit_window_event(|window, event| {
        if matches!(event, WindowEvent::RedrawRequested) {
            APP.with(|slot| {
                if let Ok(mut slot) = slot.try_borrow_mut() {
                    if let Some(app) = slot.as_mut() { app.paint_pending_ink(); }
                }
            });
        }
        if matches!(filter_opening_modifiers(window, event), EventResult::PreventDefault) {
            return EventResult::PreventDefault;
        }
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
            // Use the applied outer width, including intermediate sizes of the side panel animation.
            slint::Timer::single_shot(Duration::ZERO, || with_app(|app| {
                #[cfg(windows)]
                round_window(&app.bar);
                center_resized_window(&app.bar, app.state.preferences.center_window);
            }));
        }
        if matches!(event, WindowEvent::Focused(false)) && !PICKING_IMAGE.with(|picking| picking.get()) {
            slint::Timer::single_shot(Duration::ZERO, || with_app(|app| {
                // A file dialog hands the focus back late: its focus loss arrives after the dialog closed.
                if PICKING_IMAGE.with(|picking| picking.get()) || app.bar.window().with_winit_window(|w| w.has_focus()) == Some(true) { return; }
                if !app.board.as_ref().is_some_and(|b|b.editor==2) {hide_bar(&app.bar);}
            }));
        }
        if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
            // Redraw masks after Slint has adopted the monitor's new physical pixel density.
            slint::Timer::single_shot(Duration::ZERO, || with_app(|app| app.draw()));
        }
        EventResult::Propagate
    });

    let show_now = !args.background || active_hotkey.is_none();
    let mut state = form::Form::new(opened.ok(), language);
    state.preferences = preferences;
    // The templates (`#Name`) beside J-TerminaL's settings; without a folder they live only while it runs.
    state.templates = templates::Templates::load(data.as_ref().map(|directory| directory.join("j-terminal-templates.json"))).unwrap_or_else(|error| {
        eprintln!("J-TerminaL: {}: {error}", texts::templates::HEADING[usize::from(language == texts::Language::En)]);
        templates::Templates::default()
    });
    state.metrics = metrics(&bar);
    if let Some(width) = preferences.calendar_label_width { state.metrics.label_w = clamp_label_width(&bar, width as f32, preferences.week_numbers); }
    APP.with(|app| *app.borrow_mut() = Some(App { tag_editor: None, floating_notes:Default::default(),board:None, analysis: Default::default(), board_images:Default::default(), notepad_media: NotepadMedia::default(), notepad_list_query: Default::default(),
        bar, settings: None, settings_navigation: Default::default(), preferences_path, journal_language, restore_launcher: false, state, notice,
        hide_timer: slint::Timer::default(), bindings, hotkeys, active_hotkey, day_items: Vec::new(), side_cells: Vec::new(), side_icons: LazyIcons::new(|row, icon| row.icon = icon), tag_icons: LazyIcons::new(|row, icon| row.icon = icon), tick: slint::Timer::default(), draw_timer: slint::Timer::default() }));
    with_app(|app| {
        app.bar.set_notepad_width(app.state.preferences.notepad_width.map_or(0.0, f32::from));
        app.bar.set_notepad_wide(app.state.preferences.notepad_wide);
        app.refresh_board_scopes();
        app.draw();
    });
    with_app(|app| app.tick.start(slint::TimerMode::Repeated, Duration::from_secs(1), || with_app(|app| {
        app.refresh_floating();
        if app.board.as_ref().is_some_and(|b|b.changed.is_some()) || app.bar.window().is_visible() { app.tick_board(); }
        if app.analysis.open && app.bar.window().is_visible() { app.refresh_analysis(); }
        if app.board.is_none() && !app.analysis.open && app.bar.window().is_visible() && !app.bar.get_dragging_dial() && !app.state.entry_shown() && app.state.notepad().is_none() && app.state.timers_running() { app.draw(); }
    })));
    // Reminders come from here while the Journal app does not run; a test journal's always (it is not the app's).
    reminder::start(instance::socket(args.data.as_deref()) == instance::NAME);
    if show_now { with_bar(present); }
    if let Err(e) = slint::run_event_loop_until_quit() { eprintln!("J-TerminaL: {e}"); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Args, String> { parse_args(args.iter().map(|arg| arg.to_string())) }

    #[test]
    fn dials_stand_three_four_or_three_to_a_line() {
        let lines = |count: usize| count.div_ceil(dial_layout_columns(count));
        assert_eq!((1..=6).map(dial_layout_columns).collect::<Vec<_>>(), [1, 2, 3, 2, 3, 3]);
        assert_eq!((1..=6).map(lines).collect::<Vec<_>>(), [1, 1, 1, 2, 2, 2]);
    }

    #[test]
    fn reads_the_arguments() {
        assert_eq!(parse(&[]).unwrap(), Args::default());
        assert_eq!(parse(&["--background"]).unwrap(), Args { background: true, data: None });
        assert_eq!(parse(&["--data", "C:\\Test", "--background"]).unwrap(), Args { background: true, data: Some("C:\\Test".into()) });
        assert!(parse(&["--data"]).is_err());
        assert!(parse(&["--quiet"]).is_err());
    }

    #[test]
    fn keyboard_walks_through_the_form_in_the_real_ui() {
        use i_slint_backend_testing::{TestingBackend, TestingBackendOptions};
        use slint::Model;
        fn send_key_combo(bar: &impl ComponentHandle, keys: impl IntoIterator<Item = slint::platform::Key>) {
            let keys: Vec<slint::SharedString> = keys.into_iter().map(|key| char::from(key).into()).collect();
            for text in &keys { bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: text.clone() }); }
            for text in keys.into_iter().rev() { bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text }); }
        }
        fn type_text(bar: &impl ComponentHandle, text: &str) {
            for c in text.chars() {
                bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: c.into() });
                bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: c.into() });
            }
        }
        use slint::platform::Key as K;
        fn key_with_modifiers(bar: &impl ComponentHandle, modifiers: &[K], text: &str) {
            use slint::platform::WindowEvent;
            for &key in modifiers {
                bar.window().dispatch_event(WindowEvent::KeyPressed { text: char::from(key).into() });
            }
            type_text(bar, text);
            for &key in modifiers.iter().rev() {
                bar.window().dispatch_event(WindowEvent::KeyReleased { text: char::from(key).into() });
            }
        }
        fn click(bar: &impl ComponentHandle, position: slint::LogicalPosition) {
            use slint::platform::{PointerEventButton, WindowEvent};
            bar.window().dispatch_event(WindowEvent::PointerPressed { position, button: PointerEventButton::Left });
            bar.window().dispatch_event(WindowEvent::PointerReleased { position, button: PointerEventButton::Left });
        }
        slint::platform::set_platform(Box::new(TestingBackend::new(TestingBackendOptions { mock_time: true, threading: false, renderer_name: Some("software".into()), ..Default::default() }))).unwrap();
        fn fit_viewport(bar: &Bar) {
            let width = bar.get_content_width();
            for _ in 0..2 {
                // TestingBackend::set_size assumes scale 1; supply the physical buffer size and its logical resize.
                let logical = slint::LogicalSize::new(width, bar.get_content_height());
                let scale = bar.window().scale_factor();
                bar.window().set_size(slint::PhysicalSize::new((logical.width * scale).round() as u32, (logical.height * scale).round() as u32));
                bar.window().dispatch_event(slint::platform::WindowEvent::Resized { size: logical });
                i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            }
        }
        fn capture(bar: &Bar, name: &str) {
            if std::env::var_os("J_TERMINAL_UI_CAPTURE").is_none() { return; }
            fit_viewport(bar);
            capture_window(bar.window(), name);
        }
        fn capture_window(window: &slint::Window, name: &str) {
            if std::env::var_os("J_TERMINAL_UI_CAPTURE").is_none() { return; }
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(200));
            let pixels = window.take_snapshot().unwrap();
            let mut bytes = format!("P6\n{} {}\n255\n", pixels.width(), pixels.height()).into_bytes();
            for pixel in pixels.as_slice() { bytes.extend_from_slice(&[pixel.r, pixel.g, pixel.b]); }
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ui-check");
            std::fs::create_dir_all(&dir).unwrap(); std::fs::write(dir.join(format!("{name}.ppm")), bytes).unwrap();
        }
        let path = std::env::temp_dir().join(format!("j-terminal-ui-{}.sqlite3", uuid::Uuid::new_v4()));
        let mut store = journal_core::storage::Store::open(&path).unwrap();
        let folder = uuid::Uuid::new_v4();
        store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)", rusqlite::params![
            format!("board:folder:{folder}"),
            serde_json::json!({"id": folder.to_string(), "name": "Projekte", "parent": null, "order": 1}).to_string(),
        ]).unwrap();
        // Something to look at: two coloured tags, an appointment, a holiday and a weekly series.
        {
            let tags = [("3f2a6c1e-0000-4000-8000-000000000001", "Gesundheit", "#76d982"), ("3f2a6c1e-0000-4000-8000-000000000002", "Arbeit", "#569eff"), ("3f2a6c1e-0000-4000-8000-000000000003", "Reise", "#ff9f43")];
            store.save_tags(&tags.iter().map(|(id, name, color)| journal_core::storage::Tag { id: id.to_string(), name: name.to_string(), color: color.to_string(), icon: Some(match *name { "Gesundheit" => "stethoscope", "Arbeit" => "briefcase", _ => "plane" }.into()) }).collect::<Vec<_>>()).unwrap();
            let names: Vec<engine::parse::TagName> = tags.iter().map(|(id, name, _)| engine::parse::TagName { id: id.to_string(), name: name.to_string() }).collect();
            let today = repeat::d("2026-11-18");
            let mail = format!("journal-mail:v1\n{}", serde_json::json!({
                "html": format!("<h2>Programm</h2>{}", "<p><strong>Praxis</strong> mit Beispielen.</p>".repeat(25)),
                "text": "Programm und Praxis mit Beispielen."
            }));
            for line in ["Zahnarzt Do 14–15 \\Gesundheit", "Urlaub ▬ 23.11.2026–27.11.2026 \\Reise", "Team Mo 9–10 jede Woche \\Arbeit", "Workshop 30.11.2026 10–17 \\Arbeit", "Sport heute 18–19", "Recherche heute \\Arbeit"] {
                let outcome = engine::resolve::resolve(&engine::parse::parse(line, today, &names), today).choices.remove(0);
                let description = match outcome.text.as_str() {
                    "Zahnarzt" => "Versichertenkarte mitnehmen.\nDie Praxis liegt im zweiten Stock neben dem Aufzug. Bitte fünfzehn Minuten vor dem vereinbarten Termin dort sein.",
                    "Sport" => "Turnschuhe mitnehmen.",
                    "Workshop" => mail.as_str(),
                    _ => "",
                };
                save::save_with(&mut store, &outcome, &save::Extras { description: description.into(), ..Default::default() }, today).unwrap();
            }
            // The app's rating, a day value and two activities for the day view.
            store.save_period_data(&serde_json::json!({
                "definitions": [{ "id": "run", "name": "Laufen", "color": "#ff9f43", "trackTime": true, "textField": false, "active": true },
                                { "id": "read", "name": "Lesen", "color": "#76d982", "trackTime": true, "textField": true, "active": true }],
                "scales": [{ "id": "stress", "name": "Stress", "color": "#e57b7b", "min": 0, "max": 10, "active": true }],
                "days": {
                    "2026-11-18": { "rating": 7, "scales": { "stress": 3 }, "items": { "read": { "done": false, "minutes": 45 } } },
                    // Earlier days for the analysis (/Auswertung).
                    "2026-11-02": { "rating": 5, "scales": { "stress": 6 }, "items": { "run": { "done": true, "minutes": 30 } } },
                    "2026-11-03": { "rating": 6, "scales": { "stress": 5 }, "items": { "read": { "done": true, "minutes": 20 } } },
                    "2026-11-05": { "rating": 8, "items": { "run": { "done": true, "minutes": 75 }, "read": { "done": true, "minutes": 60 } } },
                    "2026-11-09": { "rating": 4, "scales": { "stress": 8 }, "items": { "run": { "done": true, "minutes": 140 } } },
                    "2026-11-10": { "rating": 6, "scales": { "stress": 4 }, "items": { "read": { "done": true, "minutes": 95 } } },
                    "2026-11-16": { "rating": 9, "scales": { "stress": 2 }, "items": { "run": { "done": true, "minutes": 50 } } },
                    "2026-11-17": { "rating": 8, "scales": { "stress": 3 }, "items": { "read": { "done": true, "minutes": 180 } } },
                    "2026-10-12": { "rating": 3, "scales": { "stress": 9 }, "items": { "run": { "done": true, "minutes": 20 } } },
                    "2026-10-20": { "rating": 5, "items": { "read": { "done": true, "minutes": 40 } } }
                },
                "notes": {}
            }).to_string()).unwrap();
        }
        let journal = journal::Journal { vault: path.parent().unwrap().into(), store };
        let bar = Bar::new().unwrap();
        connect(&bar);
        let mut state = form::Form::at(Some(journal), texts::Language::De, repeat::d("2026-11-18"), 800);
        state.metrics = metrics(&bar);
        APP.with(|slot| *slot.borrow_mut() = Some(App { tag_editor: None, floating_notes:Default::default(),board:None, analysis: Default::default(), board_images:Default::default(), notepad_media: NotepadMedia::default(), notepad_list_query: Default::default(),
            bar: bar.clone_strong(), settings: None, settings_navigation: Default::default(), preferences_path: None,
            journal_language: texts::Language::De, restore_launcher: false, state, notice: None, hide_timer: slint::Timer::default(),
            bindings: shortcuts::Bindings::default(), hotkeys: None, active_hotkey: None, day_items: Vec::new(), side_cells: Vec::new(), side_icons: LazyIcons::new(|row, icon| row.icon = icon), tag_icons: LazyIcons::new(|row, icon| row.icon = icon), tick: slint::Timer::default(), draw_timer: slint::Timer::default() }));
        let settings_open = || with_app_value(|app| app.settings.as_ref().is_some_and(|settings| settings.window().is_visible()));
        let settings = || with_app_value(|app| app.settings.as_ref().unwrap().clone_strong());
        let open_footer_menu = || {
            fit_viewport(&bar);
            let theme = bar.global::<Theme>();
            click(&bar, slint::LogicalPosition::new(
                theme.get_padding() + 8.0,
                bar.get_content_height() - theme.get_footer_height() / 2.0,
            ));
            assert!(bar.get_menu_open() && bar.get_app_menu(), "The footer icon opens the app menu.");
            assert_eq!(bar.get_menu_rows().row_data(0).unwrap().label.as_str(), "Einstellungen");
        };
        bar.show().unwrap();
        with_app(|app| { let effect = app.state.shown(); app.effect(effect); });
        bar.invoke_focus_line();

        // The analysis (/Auswertung) over the whole window: the month around the day shown, then the other periods.
        type_text(&bar, "/Auswertung");
        assert_eq!(bar.get_commands().row_data(0).unwrap().name.as_str(), "/Auswertung");
        send_key_combo(&bar, [K::Return]);
        let analysis = bar.global::<AnalysisUi>();
        assert!(analysis.get_opened(), "The command opens the analysis.");
        assert_eq!((analysis.get_eyebrow().as_str(), analysis.get_heading().as_str(), analysis.get_mode()), ("Monatsübersicht", "November 2026", 1));
        assert_eq!(analysis.get_legend().row_data(0).unwrap().stat.as_str(), "Ø 6.6 / 10 · 8 Tage");
        assert_eq!(analysis.get_cards().row_count(), 2);
        assert_eq!(analysis.get_cards().row_data(0).unwrap().total.as_str(), "4 h 55 min");
        capture(&bar, "analysis-month");
        send_key_combo(&bar, [K::PageDown]);
        capture(&bar, "analysis-month-cards");
        send_key_combo(&bar, [K::PageUp]);
        // The mouse on a day of the heatmap, then the keyboard: Alt+→ walks the days.
        key_with_modifiers(&bar, &[K::Alt], &char::from(K::RightArrow).to_string());
        assert_eq!(analysis.get_detail().as_str(), "18. Nov.: Tagesbewertung 7, Stress 3", "Alt+→ starts at today.");
        let card = |i: usize| analysis.get_cards().row_data(i).unwrap();
        assert!(card(1).hint && !card(1).cells.iter().any(|c| c.active), "The day is the chart's only (the graph in focus).");
        capture(&bar, "analysis-month-day");
        // ↓ to the cards: the day goes with the focus, and only that card shows it.
        send_key_combo(&bar, [K::DownArrow]);
        send_key_combo(&bar, [K::DownArrow]);
        assert_eq!(analysis.get_focus(), 2);
        assert_eq!(card(1).detail.as_str(), "Mi., 18. Nov. 2026 · 45 min");
        assert!(analysis.get_hint() && card(0).hint, "The chart and the other card show no day.");
        key_with_modifiers(&bar, &[K::Alt], &char::from(K::LeftArrow).to_string());
        assert_eq!(card(1).detail.as_str(), "Di., 17. Nov. 2026 · 180 min", "Alt+← moves the day in that card only.");
        assert!(analysis.get_hint());
        capture(&bar, "analysis-month-card-focus");
        send_key_combo(&bar, [K::DownArrow]);
        assert_eq!(analysis.get_focus(), 2, "The last graph stays.");
        // The mouse on the chart: it comes into focus with its day; the cards let theirs go.
        AnalysisUi::get(&bar).invoke_point(0, "2026-11-10".into());
        assert_eq!((analysis.get_focus(), card(1).hint), (0, true));
        send_key_combo(&bar, [K::UpArrow]);
        assert_eq!(analysis.get_focus(), 0);
        send_key_combo(&bar, [K::RightArrow]);
        assert_eq!(analysis.get_heading().as_str(), "Dezember 2026");
        send_key_combo(&bar, [K::RightArrow]);
        assert_eq!(analysis.get_heading().as_str(), "Januar 2027", "November → Dezember → Januar.");
        send_key_combo(&bar, [K::Home]);
        assert_eq!(analysis.get_heading().as_str(), "November 2026");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!((analysis.get_heading().as_str(), analysis.get_mode()), ("Quartal 4 · 2026", 2));
        assert_eq!(analysis.get_labels().row_count(), 3, "A quarter's chart: its months.");
        capture(&bar, "analysis-quarter");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(analysis.get_heading().as_str(), "2026");
        assert_eq!(analysis.get_cards().row_data(0).unwrap().columns, 54);
        capture(&bar, "analysis-year");
        send_key_combo(&bar, [K::End]);
        capture(&bar, "analysis-year-cards");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(analysis.get_heading().as_str(), "16. Nov. – 22. Nov. 2026");
        capture(&bar, "analysis-week");
        send_key_combo(&bar, [K::End]);
        capture(&bar, "analysis-week-cards");
        type_text(&bar, "1");
        assert!(analysis.get_legend().row_data(0).unwrap().hidden, "1 hides the daily rating's line.");
        type_text(&bar, "1");
        // Shift+Esc hides the window from anywhere; opened again within the time set it is still here …
        let reopen = || { present(&bar); i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1)); };
        with_app(|app| { app.state.preferences.reopen_stay = true; app.state.preferences.reopen_minutes = true; app.state.preferences.reopen_after = 5; });
        key_with_modifiers(&bar, &[K::Shift], &char::from(K::Escape).to_string());
        assert!(!bar.window().is_visible(), "Shift+Esc hides the window.");
        reopen();
        assert!(bar.window().is_visible() && analysis.get_opened(), "Kept where it was.");
        // … with "Zur Startansicht" it opens at the start.
        with_app(|app| app.state.preferences.reopen_stay = false);
        key_with_modifiers(&bar, &[K::Shift], &char::from(K::Escape).to_string());
        reopen();
        assert!(!analysis.get_opened(), "Back at the start view.");
        with_app(|app| app.state.preferences.reopen_stay = false);
        type_text(&bar, "/Auswertung");
        send_key_combo(&bar, [K::Return]);
        assert!(analysis.get_opened());
        send_key_combo(&bar, [K::Escape]);
        assert!(!analysis.get_opened(), "Esc goes back.");
        // Use a separate vault and device projection for the complete board interaction.
        let board_dir=std::env::temp_dir().join(format!("j-terminal-board-ui-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&board_dir).unwrap();
        let scope_file=board_dir.join(journal_core::board::SCOPES_FILE);
        std::fs::write(&scope_file, br#"["week"]"#).unwrap();
        let mut board_store=journal_core::storage::Store::open(&board_dir.join("journal.sqlite3")).unwrap();
        let tags = [
            ("Privat", "circle-user", "#aa83bd"), ("Arbeit", "briefcase", "#569eff"),
            ("Uni", "graduation-cap", "#6496ed"), ("Magnesium", "circle", "#c7b544"),
            ("Malen", "palette", "#d48641"), ("Gitarre", "guitar", "#da514e"),
            ("Appointments", "pin", "#65c597"), ("Delivery", "truck", "#68bf7a"),
            ("Payment", "wallet", "#8caa42"),
        ].map(|(name,icon,color)| journal_core::storage::Tag { id:uuid::Uuid::new_v4().to_string(),
            name:name.into(), color:color.into(), icon:Some(icon.into()) });
        board_store.save_tags(&tags).unwrap();
        let previous=with_app_value(|app|{
            app.preferences_path=Some(board_dir.join("settings.json"));app.refresh_board_scopes();
            app.state.journal.replace(journal::Journal{vault:board_dir.clone(),store:board_store})
        });
        type_text(&bar,"/Pinnwand");
        assert_eq!(bar.get_commands().row_count(),1);
        send_key_combo(&bar,[K::Return]);
        fit_viewport(&bar);
        let board=bar.global::<BoardUi>();
        assert!(board.get_opened());assert!(board.get_heading().contains("2026-11-16"));
        key_with_modifiers(&bar,&[K::Control],"n");send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_editor(),1);
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(5));
        type_text(&bar,"# Auflistung");
        send_key_combo(&bar,[K::Return]);send_key_combo(&bar,[K::Return]);
        type_text(&bar,"Ich bin hier noch nicht **fertig**");
        let rows=board.get_tiles().row_data(0).unwrap().rows;
        assert_eq!(rows.row_count(),2);
        assert_eq!(rows.row_data(0).unwrap().heading,1);
        assert_eq!(rows.row_data(1).unwrap().text,slint::StyledText::from_markdown("Ich bin hier noch nicht **fertig**").unwrap());
        assert!(with_app_value(|a|a.board.as_ref().unwrap().selected_card().unwrap()["text"]==""),
            "The formatted preview is visible before autosave");
        // A table and the app's colours on the card.
        send_key_combo(&bar,[K::Return]);send_key_combo(&bar,[K::Return]);
        type_text(&bar,"| Was | Wann |");send_key_combo(&bar,[K::Return]);
        type_text(&bar,"|---|:-:|");send_key_combo(&bar,[K::Return]);
        type_text(&bar,"Kaffee");send_key_combo(&bar,[K::Tab]);type_text(&bar,"[8:00]{blau}");
        send_key_combo(&bar,[K::Return]);send_key_combo(&bar,[K::Return]);send_key_combo(&bar,[K::Return]);
        type_text(&bar,"==Wichtig== und [gelb]{gelb}");
        assert!(board.get_tiles().row_data(0).unwrap().rows.iter().any(|row|row.is_table&&row.table.row_count()==2&&row.aligns.row_count()==2));
        click(&bar,slint::LogicalPosition::new(70.,bar.get_board_canvas_y()+20.));
        type_text(&bar,"Hallo ich habe einen Titel");
        assert_eq!(board.get_tiles().row_data(0).unwrap().title,"Hallo ich habe einen Titel");

        capture(&bar,"board-text-editor");
        send_key_combo(&bar,[K::Escape]);
        capture(&bar,"board-table-card");
        key_with_modifiers(&bar,&[K::Control],"n");send_key_combo(&bar,[K::Return]);send_key_combo(&bar,[K::Escape]);
        assert_eq!(board.get_tiles().row_count(),2);
        key_with_modifiers(&bar,&[K::Alt],"l");send_key_combo(&bar,[K::LeftArrow]);
        assert!(board.get_threads().iter().any(|e|e.preview));
        send_key_combo(&bar,[K::Escape]);assert_eq!(board.get_threads().row_count(),0);
        key_with_modifiers(&bar,&[K::Alt],"l");send_key_combo(&bar,[K::RightArrow]);send_key_combo(&bar,[K::Return]);
        assert!(board.get_threads().iter().any(|e|e.arrow && !e.preview));
        {
            use slint::platform::{WindowEvent,PointerEventButton as Button};
            let position=|x:f32,y:f32|slint::LogicalPosition::new(
                (x-board.get_left())*board.get_zoom(),bar.get_board_canvas_y()+(y-board.get_top())*board.get_zoom());
            let press=|position|bar.window().dispatch_event(WindowEvent::PointerPressed{position,button:Button::Left});
            let motion=|position|{bar.window().dispatch_event(WindowEvent::PointerMoved{position});
                i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(18));};
            let release=|position|bar.window().dispatch_event(WindowEvent::PointerReleased{position,button:Button::Left});
            let saved=||with_app_value(|a|{
                let journal=a.state.journal.as_ref().unwrap();
                journal.store.conn.total_changes()
            });
            // Place the second pin above and to the right, as on the reference board.
            let second=board.invoke_box_at(1);
            let first=board.invoke_box_at(0);
            let dest=position(first.x+416.+32.,first.y+66.);
            press(position(second.x+32.,second.y+66.));
            motion(dest);release(dest);
            let r=board.invoke_box_at(0);
            let commits=saved();
            let start=position(r.x+30.,r.y+70.);
            let finish=position(r.x+110.,r.y+148.);
            press(start);motion(finish);
            assert_eq!(board.invoke_box_at(0).x,r.x+80.,"Paper follows the held pointer");
            assert_eq!(saved(),commits);
            send_key_combo(&bar,[K::Escape]);release(finish);
            assert_eq!(board.invoke_box_at(0).x,r.x);
            assert_eq!(saved(),commits,"Cancelling a drag leaves storage untouched");
            press(start);motion(finish);release(finish);
            let r=board.invoke_box_at(0);
            assert_eq!(r.y,board.get_tiles().row_data(0).unwrap().top);
            assert!(saved()>commits);
            let corner=position(r.x+r.w-3.,r.y+r.h-3.);
            let enlarged=position(r.x+r.w+18.,r.y+r.h+50.);
            press(corner);motion(enlarged);
            assert!(board.invoke_box_at(0).h>r.h+49.);
            release(enlarged);
            assert_eq!(board.get_tiles().row_data(0).unwrap().w,r.w+21.);
            let group=board.get_groups().row_data(0).unwrap();
            let gb=board.invoke_group_box(group.members.clone());
            let anchor=position(gb.x+gb.w/2.,gb.y);
            let shift=position(gb.x+gb.w/2.+10.,gb.y+5.);
            let before=board.invoke_box_at(1);
            press(anchor);motion(shift);
            assert_eq!(board.invoke_box_at(1).x,before.x+10.);
            release(shift);
            let r=board.invoke_box_at(0);
            motion(position(r.x+30.,r.y+35.));
            assert_eq!(board.get_hover(),0,"Hover over the paper exposes its actions");
            capture(&bar,"board-hover");
            let on_card=position(r.x+30.,r.y+70.);
            bar.window().dispatch_event(WindowEvent::PointerPressed{position:on_card,button:Button::Right});
            bar.window().dispatch_event(WindowEvent::PointerReleased{position:on_card,button:Button::Right});
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(5));
            assert!(board.get_menu_open());
            assert!(board.get_menu_compact(),"A right click opens the small card at the mouse");
            assert!(board.get_menu_x()>0.);
            assert!((0..board.get_options().row_count()).all(|i|board.get_options().row_data(i).unwrap().caps.row_count()==0),"Without keys");
            capture(&bar,"board-actions");
            type_text(&bar,"Papierfarbe");
            assert_eq!(board.get_options().row_count(),1);
            send_key_combo(&bar,[K::Return]);
            assert_eq!(board.get_options().row_count(),4);
            send_key_combo(&bar,[K::Escape]);
            assert!(board.get_options().row_count()>4);
            send_key_combo(&bar,[K::Escape]);
            assert!(!board.get_menu_open());
            board.invoke_tool(0,"tag".into());
            assert!(board.get_tag_open());
            assert_eq!(board.get_menu_search(),"Tag suchen …");
            let tag_rows=board.get_tag_rows();
            assert_eq!(tag_rows.row_count(),tags.len()+1);
            assert!(tag_rows.row_data(0).unwrap().on);
            let work=tag_rows.iter().find(|row|row.label=="Arbeit").unwrap();
            assert!(work.has_icon && work.has_color);
            assert_eq!(work.color,slint::Color::from_rgb_u8(0x56,0x9e,0xff));
            type_text(&bar,"rbeit");
            assert_eq!(board.get_tag_rows().row_count(),2,"Arbeit, and the line that makes a tag of what is typed");
            send_key_combo(&bar,[K::Return]);
            board.invoke_tool(0,"tag".into());
            send_key_combo(&bar,[K::DownArrow]);
            assert!(board.get_tag_rows().iter().any(|row|row.label=="Arbeit" && row.on));
            assert!(board.get_tag_rows().row_data(1).unwrap().selected);
            capture(&bar,"board-tags");
            send_key_combo(&bar,[K::Escape]);
            // A tag typed that is not there: its line makes it, and the tag editor opens on it.
            board.invoke_tool(0,"tag".into());
            type_text(&bar,"Garten");
            let last=board.get_tag_rows().row_count()-1;
            assert_eq!(board.get_tag_rows().row_data(last).unwrap().label,"Tag „Garten“ anlegen");
            for _ in 0..last { send_key_combo(&bar,[K::DownArrow]); }
            send_key_combo(&bar,[K::Return]);
            let editor=bar.global::<TagEditorUi>();
            assert!(editor.get_open(),"The editor opens on the new tag");
            assert_eq!(editor.get_name(),"Garten");
            // Tab: the colour field; ↑ brighter (it is already as bright as it goes), Shift+→ another hue.
            send_key_combo(&bar,[K::Tab]);
            assert_eq!(editor.get_part(),1);
            send_key_combo(&bar,[K::Tab]);
            send_key_combo(&bar,[K::RightArrow]);
            send_key_combo(&bar,[K::RightArrow]);
            send_key_combo(&bar,[K::Tab]);send_key_combo(&bar,[K::Tab]);
            assert_eq!(editor.get_part(),4);
            type_text(&bar,"flower");
            send_key_combo(&bar,[K::RightArrow]);
            capture(&bar,"tag-editor");
            let chosen_color=editor.get_hex().to_string();
            let chosen_icon=editor.get_icon_name().to_string();
            send_key_combo(&bar,[K::Return]);
            assert!(!editor.get_open());
            let garden=with_app_value(|a|a.state.journal.as_ref().unwrap().store.tags().unwrap().into_iter().find(|t|t.name=="Garten").unwrap());
            assert_eq!((garden.color,garden.icon.unwrap_or_default()),(chosen_color,chosen_icon));
            assert_eq!(with_app_value(|a|a.board.as_ref().unwrap().selected_card().unwrap()["tag"].as_str().map(str::to_string)),Some(garden.id));
            board.invoke_tool(0,"reset-size".into());
            assert!(board.get_tiles().row_data(0).unwrap().auto_height);
            assert_eq!(board.get_tiles().row_data(0).unwrap().w,232.);
            let r=board.invoke_box_at(0);
            let corner=position(r.x+r.w-4.,r.y+r.h-4.);
            let reference_size=position(r.x+r.w-4.,r.y+245.-4.);
            press(corner);motion(reference_size);release(reference_size);
            motion(position(3.,3.));capture(&bar,"board-paper-and-thread");
            send_key_combo(&bar,[K::Return]);capture(&bar,"board-live-markdown");
            {
                // Vertical (F1 → Ausrichtung) on a wide screen: the note opens above the board, the window keeps the
                // height of the vertical layout instead of the calendar's.
                let wide_height=bar.get_content_height();
                with_app(|app|{app.state.preferences.orientation=settings::Orientation::Vertical;app.draw();});
                fit_viewport(&bar);
                assert!(bar.get_stacked(),"Vertical though the screen is wide.");
                assert!(bar.get_content_height()>wide_height,"As high as the vertical layout.");
                assert_eq!(bar.get_board_viewport_w(),bar.get_content_width(),"The board under the note, over the whole width.");
                assert!(bar.get_board_viewport_y()>bar.global::<Theme>().get_line_height()+50.,"The note above it.");
                capture(&bar,"board-vertical");
                with_app(|app|{app.state.preferences.orientation=settings::Orientation::Horizontal;app.draw();});
                let wide=bar.get_screen_width();
                bar.set_screen_width(700.);
                assert!(!bar.get_stacked(),"Horizontal though the screen is narrow.");
                bar.set_screen_width(wide);
                with_app(|app|{app.state.preferences.orientation=settings::Orientation::Auto;app.draw();});
                fit_viewport(&bar);
                assert_eq!(bar.get_content_height(),wide_height);
            }
            let original_width=bar.get_screen_width();
            let original_scale=bar.window().scale_factor();
            bar.set_screen_width(430.);
            bar.window().dispatch_event(WindowEvent::ScaleFactorChanged{scale_factor:1.5});
            fit_viewport(&bar);
            assert_eq!(bar.get_board_viewport_w(),bar.get_content_width());
            assert!(bar.get_board_viewport_h()<bar.get_content_height()*0.6 && bar.get_board_viewport_h()>0.);
            capture(&bar,"board-narrow-150");
            bar.window().dispatch_event(WindowEvent::ScaleFactorChanged{scale_factor:original_scale});
            bar.set_screen_width(original_width);
            fit_viewport(&bar);
            send_key_combo(&bar,[K::Escape]);
            board.invoke_select(board.get_tiles().row_data(1).unwrap().id);
        }
        send_key_combo(&bar,[K::Return]);board.invoke_command("mode".into());fit_viewport(&bar);
        assert_eq!(board.get_editor(),2);
        click(&bar,slint::LogicalPosition::new(68.,112.));
        assert!(with_app_value(|a|a.board.as_ref().unwrap().selected_card().unwrap()["ink"]["strokes"].as_array().is_some_and(|v|!v.is_empty())));
        assert!(bar.get_board_canvas_w()>600. && bar.get_board_canvas_h()>320.);
        assert_eq!(board.get_tiles().row_data(board.get_selected() as usize).unwrap().ink.shapes.row_count(),1);
        let image=bar.window().take_snapshot().unwrap();
        let pen_near_click=(107..118).any(|y|(63..74).any(|x|image.as_slice()[y*image.width() as usize+x].r<140));
        assert!(pen_near_click,"A mouse stroke appears under the pointer in the large editor.");
        // The same local coordinate must be dark on the card during the stroke and after saving.
        let ink_position=slint::LogicalPosition::new(bar.get_board_canvas_x()+bar.get_board_canvas_w()*0.14,
            bar.get_board_canvas_y()+bar.get_board_canvas_h()*0.16);
        let ink_on_paper=|| {
            let r=board.invoke_box_at(board.get_selected());
            let theme=bar.global::<Theme>();
            let x=r.x+theme.get_board_body_inset()+board.invoke_ink_width(r.w)*0.14;
            let y=r.y+theme.get_board_body_top()+board.invoke_ink_height(r.h)*0.16;
            let px=(bar.get_board_viewport_x()+(x-board.get_left())*board.get_zoom())*bar.window().scale_factor();
            let py=(bar.get_board_viewport_y()+(y-board.get_top())*board.get_zoom())*bar.window().scale_factor();
            let image=bar.window().take_snapshot().unwrap();
            (-2..=2).any(|dy|(-2..=2).any(|dx|{
                let (x,y)=(px.round() as i32+dx,py.round() as i32+dy);
                x>=0 && y>=0 && x<image.width() as i32 && y<image.height() as i32 &&
                    image.as_slice()[y as usize*image.width() as usize+x as usize].r<140
            }))
        };
        assert!(!ink_on_paper(),"The expected stroke location starts as blank paper");
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerPressed{
            position:ink_position,button:slint::platform::PointerEventButton::Left});
        assert!(ink_on_paper(),"A held stroke is visible at the corresponding paper coordinate");
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerReleased{
            position:ink_position,button:slint::platform::PointerEventButton::Left});
        assert!(ink_on_paper(),"Releasing the stroke preserves its location");
        // Pick a pen with the command search, then use the visible palette and stroke widths.
        key_with_modifiers(&bar,&[K::Control],"k");
        type_text(&bar,"Stiftart");send_key_combo(&bar,[K::Return]);
        type_text(&bar,"Textmarker");send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_ink_tool(),"marker");
        board.invoke_command("color".into());
        assert_eq!(board.get_ink_picker(),"color");
        send_key_combo(&bar,[K::Home]); send_key_combo(&bar,[K::RightArrow]); send_key_combo(&bar,[K::RightArrow]);
        send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_ink_color(),slint::Color::from_rgb_u8(0x7e,0xe0,0x7e));
        board.invoke_command("size".into()); send_key_combo(&bar,[K::RightArrow]);send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_ink_size(),24.);
        // The displayed outline should extend under movement before the release or any disk write.
        let start=slint::LogicalPosition::new(145.,175.);
        let end=slint::LogicalPosition::new(235.,215.);
        let n=board.get_tiles().row_data(board.get_selected() as usize).unwrap().ink.shapes.row_count();
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerPressed{position:start,button:slint::platform::PointerEventButton::Left});
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerMoved{position:end});
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(20));
        with_app(|a| a.paint_pending_ink());
        assert!(board.get_draft().w>25.);
        assert_eq!(board.get_tiles().row_data(board.get_selected() as usize).unwrap().ink.shapes.row_count(),n);
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerReleased{position:end,button:slint::platform::PointerEventButton::Left});
        assert!(board.get_draft().commands.is_empty());
        let tile=board.get_tiles().row_data(board.get_selected() as usize).unwrap();
        assert_eq!(tile.ink.shapes.row_count(),n+1);
        assert_eq!(tile.ink.shapes.row_data(n).unwrap().color,board.get_ink_color());
        // Pen settings are independent from the highlighter. Reopen a preset, draw a
        // pressure-varying curve, then inspect the same path and controls at 2x zoom.
        key_with_modifiers(&bar,&[K::Control],"z");
        board.invoke_command("pen".into());
        assert_eq!(board.get_ink_size(),3.);
        board.invoke_command("color".into());
        let blue=board.get_options().iter().position(|row|row.label=="Blau").unwrap();
        board.invoke_choose(blue as i32);
        let tip = |i: usize| {
            let t=i as f32/110.;
            (74.+t*320., 140.+(t*20.).sin()*32.+(t*50.).sin()*8., 0.32+0.58*(t*8.).sin().abs())
        };
        with_app(|a|{
            for i in 0..=110 {
                let (x,y,p)=tip(i);
                a.board_point(if i==0 {0} else {1},x,y,p,false);
            }
        });
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(20));
        with_app(|a| a.paint_pending_ink());
        let live_stroke = board.get_draft();
        let before_lift = bar.window().take_snapshot().unwrap();
        with_app(|a| {
            let (x, y, pressure) = tip(110);
            a.board_point(2, x, y, pressure, false);
        });
        let shapes = board.get_tiles().row_data(board.get_selected() as usize).unwrap().ink.shapes;
        let saved_stroke = shapes.row_data(shapes.row_count() - 1).unwrap();
        assert!(!live_stroke.commands.is_empty());
        assert!(live_stroke.commands == saved_stroke.commands, "The pressure curve changed on release");
        let after_lift = bar.window().take_snapshot().unwrap();
        assert_eq!(before_lift.size(), after_lift.size());
        let scale = bar.window().scale_factor();
        let x = (bar.get_board_canvas_x() * scale).ceil() as usize;
        let y = (bar.get_board_canvas_y() * scale).ceil() as usize;
        let right = ((bar.get_board_canvas_x() + bar.get_board_canvas_w()) * scale).floor() as usize;
        let bottom = ((bar.get_board_canvas_y() + bar.get_board_canvas_h()) * scale).floor() as usize;
        let stride = before_lift.width() as usize;
        for row in y..bottom {
            let span = (row * stride + x)..(row * stride + right);
            assert!(before_lift.as_slice()[span.clone()] == after_lift.as_slice()[span],
                "The drawing canvas changed on release in row {row}");
        }
        board.invoke_command("color".into());capture(&bar,"board-ink-palette");send_key_combo(&bar,[K::Escape]);
        capture(&bar,"board-ink-editor");
        {
            use slint::platform::{WindowEvent as E, PointerEventButton as Button};
            let position = |x, y| slint::LogicalPosition::new(bar.get_board_canvas_x()+x, bar.get_board_canvas_y()+y);
            let old_scale = bar.get_board_canvas_scale();
            let old_board_zoom = board.get_zoom();
            let start = position(240., 100.);
            bar.window().dispatch_event(E::PointerPressed { position: start, button: Button::Middle });
            bar.window().dispatch_event(E::PointerMoved { position: position(270., 115.) });
            bar.window().dispatch_event(E::PointerReleased { position: position(270.,115.), button: Button::Middle });
            assert!((board.get_ink_pan_x()*old_scale + 30.).abs() < 0.01);
            assert!((board.get_ink_pan_y()*old_scale + 15.).abs() < 0.01);
            let under_pointer = || (board.get_ink_pan_x()+270./bar.get_board_canvas_scale(),
                board.get_ink_pan_y()+115./bar.get_board_canvas_scale());
            let old_anchor = under_pointer();
            bar.window().dispatch_event(E::KeyPressed { text: K::Control.into() });
            bar.window().dispatch_event(E::PointerScrolled { position: position(270.,115.), delta_x:0., delta_y:90. });
            bar.window().dispatch_event(E::KeyReleased { text: K::Control.into() });
            let new_anchor = under_pointer();
            assert!(board.get_ink_zoom()>1. && (old_anchor.0-new_anchor.0).abs()<0.01 && (old_anchor.1-new_anchor.1).abs()<0.01);
            assert_eq!(old_board_zoom, board.get_zoom());
            key_with_modifiers(&bar, &[K::Control], "0");
            assert_eq!((board.get_ink_zoom(),board.get_ink_pan_x(),board.get_ink_pan_y()), (1.,0.,0.));
            board.invoke_command("grid".into());
            board.invoke_command("spacing".into());
            board.set_value("4".into());board.invoke_command("submit".into());
            let doc = board.get_tiles().row_data(board.get_selected() as usize).unwrap().ink;
            assert_eq!((doc.pattern.as_str(),doc.step),("grid",4.));
            board.invoke_ink_camera(2.,0.,0.,0.,0.);
            let pitch = 4.*bar.get_board_canvas_scale()*scale;
            let image = bar.window().take_snapshot().unwrap();
            let row = y+(0.5*pitch) as usize;
            let start = x+(14.5*pitch) as usize;
            let paper = image.as_slice()[row*stride+start];
            let line_width = (start..start+pitch.round() as usize)
                .filter(|&col| image.as_slice()[row*stride+col]!=paper).count();
            assert!((1..=2).contains(&line_width), "Grid at spacing 4 and 2x zoom has {line_width} painted pixels per line");
            board.invoke_command("pencil".into());
            with_app(|a| {
                a.board_point(0,80.,260.,0.8,false);
                a.board_point(1,350.,275.,0.8,false);
                a.paint_pending_ink();
            });
            let graphite = board.get_draft();
            assert!(!graphite.grain.is_empty());
            let live = bar.window().take_snapshot().unwrap();
            with_app(|a| a.board_point(2,350.,275.,0.8,false));
            let saved = bar.window().take_snapshot().unwrap();
            for row in y..bottom {
                let span = (row*stride+x)..(row*stride+right);
                assert!(live.as_slice()[span.clone()] == saved.as_slice()[span], "Graphite changed on release");
            }
            capture(&bar,"board-pencil-grid");
            board.invoke_command("reset-view".into());
            board.invoke_command("blank".into());
            board.invoke_command("pen".into());
        }
        let (z,left,top)=(board.get_zoom(),board.get_left(),board.get_top());
        let r=board.invoke_box_at(board.get_selected());
        board.set_zoom(2.);board.set_left(r.x-7.);board.set_top(r.y-10.);
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerMoved{position:slint::LogicalPosition::new(
            bar.get_board_viewport_x()+90.,bar.get_board_viewport_y()+160.)});
        assert_eq!(board.get_hover(),board.get_selected());
        capture(&bar,"board-ink-zoom");
        board.set_zoom(z);board.set_left(left);board.set_top(top);
        send_key_combo(&bar,[K::F11]);assert!(board.get_maximized());
        send_key_combo(&bar,[K::Escape]);assert!(!board.get_maximized());
        send_key_combo(&bar,[K::Escape]);assert_eq!(board.get_editor(),0);
        fit_viewport(&bar);
        let edge=board.get_threads().row_data(0).unwrap();
        let a=board.invoke_box_at(edge.first);let z=board.invoke_box_at(edge.second);
        let ax=a.x+a.w/2.;let zx=z.x+z.w/2.;
        let sag=(12.+(zx-ax).hypot(z.y-a.y)*0.16).min(90.);
        let hit=board.invoke_hit((ax+zx)/2.,(a.y+z.y)/2.+sag);
        assert_eq!(hit.operation,"edge","The curved thread is selectable between the two pins");
        let pixels=bar.window().take_snapshot().unwrap();
        let scale=bar.window().scale_factor();
        let px=(((ax+zx)/2.-board.get_left())*board.get_zoom()*scale) as i32;
        let py=((bar.get_board_canvas_y()+((a.y+z.y)/2.+sag-board.get_top())*board.get_zoom())*scale) as i32;
        assert!((-4..=4).any(|dy|(-4..=4).any(|dx|{
            let x=px+dx;let y=py+dy;
            if x<0 || y<0 || x>=pixels.width() as i32 || y>=pixels.height() as i32 {return false;}
            let p=pixels.as_slice()[y as usize*pixels.width() as usize+x as usize];
            p.b>190 && p.r<120 && p.g>105
        })),"The rendered thread passes through its hit area");
        capture(&bar,"period-board");
        send_key_combo(&bar,[K::Control,K::RightArrow]);assert!(board.get_heading().contains("2026-11-23"));
        send_key_combo(&bar,[K::Control,K::LeftArrow]);
        assert_eq!(board.get_tiles().row_data(0).unwrap().h,245.);
        assert_eq!(board.get_threads().row_count(),1);
        // The right-click position is a board coordinate even in a zoomed, panned view.
        board.invoke_viewport("zoom-in".into());
        board.set_left(72.);board.set_top(33.);
        let position=slint::LogicalPosition::new(840.,bar.get_board_canvas_y()+180.);
        let (wx,wy)=(board.get_left()+position.x/board.get_zoom(),board.get_top()+180./board.get_zoom());
        use slint::platform::{WindowEvent as BoardEvent,PointerEventButton as BoardButton};
        bar.window().dispatch_event(BoardEvent::PointerPressed{position,button:BoardButton::Right});
        bar.window().dispatch_event(BoardEvent::PointerReleased{position,button:BoardButton::Right});
        assert_eq!(board.get_menu_title(),"Anpinnen");
        assert!(board.get_menu_compact());
        send_key_combo(&bar,[K::Return]);
        let pinned=board.invoke_box_at(board.get_selected());
        assert!((pinned.x-wx).abs()<0.1 && (pinned.y-wy).abs()<0.1);
        assert!(!board.get_menu_compact(),"Closed, the card forgets the mouse");
        // From the keyboard the actions open at their usual place, with their keys.
        key_with_modifiers(&bar,&[K::Control],"n");
        assert!(board.get_menu_open() && !board.get_menu_compact());
        // A web link: its address, then its own title; the page's preview fills in the rest and the title can change later.
        board.invoke_command("dismiss".into());board.invoke_command("reset-view".into());
        board.invoke_command("link".into());
        type_text(&bar,"example.org/seite");send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_prompt(),"Titel des Links (leer: Titel der Seite)");
        assert_eq!(board.get_value(),"","The title starts empty.");
        type_text(&bar,"Mein Link");send_key_combo(&bar,[K::Return]);
        assert_eq!(board.get_prompt(),"");
        let link_id=with_app_value(|a|a.board.as_ref().unwrap().selected.clone());
        let picture={
            use base64::Engine;
            let mut png=Vec::new();
            image::RgbaImage::from_pixel(32,18,image::Rgba([200,40,60,255])).write_to(&mut std::io::Cursor::new(&mut png),image::ImageFormat::Png).unwrap();
            format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png))
        };
        with_app(|a|{a.apply_link_preview(&link_id,"https://example.org/seite",link_preview::Preview{
            title:"Der Titel der Seite".into(),description:"Eine Beschreibung der Seite, etwas länger, damit sie umbricht.".into(),
            site:"YouTube".into(),author:"Ein Kanal".into(),image:picture,accent:"#ff0000".into()}).unwrap();a.draw_board();});
        let link_tile=||board.get_tiles().iter().find(|t|t.id==link_id.as_str()).unwrap();
        assert_eq!(link_tile().title,"Mein Link","The title the user gave stays.");
        assert_eq!(link_tile().detail,"YouTube · Ein Kanal");
        assert!(link_tile().picture.size().width>0 && link_tile().auto_height && link_tile().rows.row_count()==1);
        capture(&bar,"board-link");
        board.invoke_command("rename".into());assert_eq!(board.get_value(),"Mein Link");
        key_with_modifiers(&bar,&[K::Control],"a");type_text(&bar,"Umbenannt");send_key_combo(&bar,[K::Return]);
        assert_eq!(link_tile().title,"Umbenannt");
        std::fs::write(&scope_file,b"[]").unwrap();with_app(App::tick_board);assert!(!board.get_opened());
        // Back to the first journal: its warm data again (the tag editor read the board's journal).
        with_app(|app|{app.state.journal=previous;app.state.reload_tags();app.preferences_path=None;app.refresh_board_scopes();app.draw();});
        std::fs::remove_dir_all(board_dir).unwrap();bar.invoke_focus_line();
        // At first only the search bar: `/Entry` opens the form.
        assert!(!bar.get_entry_open());
        // Under it the day view: today with its entries and the rating.
        assert_eq!((bar.get_day_heading().as_str(), bar.get_day_relative().as_str()), ("Mittwoch, 18. November 2026", "Heute"));
        let day_labels = |bar: &Bar| bar.get_day_rows().iter().filter(|row| row.kind == 1).map(|row| row.label.to_string()).collect::<Vec<_>>();
        assert!(day_labels(&bar).contains(&"Sport".to_string()) && day_labels(&bar).contains(&"Recherche".to_string()), "{:?}", day_labels(&bar));
        assert!(bar.get_day_footer_rows().iter().any(|row| row.kind == 7 && row.dials.iter().any(|dial| dial.label == "Bewertung" && dial.value == "7")));
        assert!(bar.get_day_footer_rows().iter().any(|row| row.kind == 3 && row.label == "Lesen" && row.done && row.detail == "45 Min."));
        capture(&bar, "search");
        type_text(&bar, "Workshop");
        send_key_combo(&bar, [K::F3]);
        assert_eq!(bar.get_entry_preview_title(), "Workshop");
        capture(&bar, "mail-entry-preview");
        send_key_combo(&bar, [K::PageDown]);
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
        assert!(bar.get_preview_scroll_y() < 0.0);
        send_key_combo(&bar, [K::Escape]);
        send_key_combo(&bar, [K::Escape]);
        let hover = |x, y| {
            bar.window().dispatch_event(slint::platform::WindowEvent::PointerMoved { position: slint::LogicalPosition::new(x, y) });
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(bar.global::<Theme>().get_entry_preview_delay() as u64 + 1));
        };
        fit_viewport(&bar);
        let theme = bar.global::<Theme>();
        type_text(&bar, "Workshop");
        let result = bar.get_commands().row_data(0).unwrap();
        let left = theme.get_padding() * 3.0;
        let top = theme.get_line_height() + result.top;
        hover(left, top + result.header + theme.get_row_height() / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "Workshop");
        let inside_y = top + result.tall + theme.get_preview_tail() + theme.get_preview_padding() * 2.0;
        hover(left, inside_y);
        assert_eq!(bar.get_entry_preview_title(), "Workshop");
        bar.window().dispatch_event(slint::platform::WindowEvent::PointerScrolled {
            position: slint::LogicalPosition::new(left, inside_y), delta_x: 0.0, delta_y: -90.0,
        });
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(250));
        assert!(bar.get_preview_scroll_y() < 0.0, "Wheel scrolls the mail body");
        hover(left, theme.get_line_height() / 2.0);
        send_key_combo(&bar, [K::Escape]);
        let sport = bar.get_day_rows().iter().find(|row| row.label == "Sport").unwrap();
        hover(theme.get_padding() + theme.get_day_symbol_box() + theme.get_gap() * 2.0,
            theme.get_line_height() + theme.get_calendar_gap() + sport.top + sport.tall / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "Sport");
        assert_eq!(bar.get_entry_preview_description(), "Turnschuhe mitnehmen.");
        assert!(!bar.get_day_rows().iter().any(|row| row.selected || row.editing));
        capture(&bar, "day-entry-preview");
        hover(theme.get_padding(), theme.get_line_height() / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "");
        send_key_combo(&bar, [K::DownArrow]);
        for _ in 0..3 {
            if bar.get_day_rows().iter().any(|row| row.kind == 1 && row.selected) { break; }
            send_key_combo(&bar, [K::DownArrow]);
        }
        let selected = bar.get_day_rows().iter().find(|row| row.kind == 1 && row.selected).unwrap();
        send_key_combo(&bar, [K::F3]);
        assert_eq!(bar.get_entry_preview_title(), selected.label);
        send_key_combo(&bar, [K::Escape]);
        assert_eq!(bar.get_entry_preview_title(), "");
        assert!(bar.get_day_rows().iter().any(|row| row.label == selected.label && row.selected));
        send_key_combo(&bar, [K::Escape]);
        bar.invoke_focus_line();
        // Drag the first value through both scroll containers using real pointer events.
        {
            use slint::platform::{PointerEventButton, WindowEvent};
            let theme = bar.global::<Theme>();
            bar.window().set_size(slint::LogicalSize::new(theme.get_width(), theme.get_calendar_height()));
            let row = bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap();
            let x = theme.get_padding() + theme.get_dial_cell_width() / 2.0;
            let y = theme.get_calendar_height() - theme.get_footer_height() - bar.get_day_footer_height()
                - theme.get_day_bottom() + row.top + theme.get_dial_top() + row.dial_size / 2.0;
            let start = slint::LogicalPosition::new(x, y);
            let end = slint::LogicalPosition::new(x, y - 2.0 * theme.get_dial_drag_step());
            let rating_at = |bar: &Bar| bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap().dials.row_data(0).unwrap();
            let ring_ink = |bar: &Bar| {
                let pixels = bar.window().take_snapshot().unwrap();
                let ring_size = theme.get_dial_size();
                let color = rating_at(bar).color;
                let left = (x - ring_size / 2.0) as usize;
                let top = (y - ring_size / 2.0) as usize;
                let mut count = 0;
                for row in top..top + ring_size as usize {
                    for col in left..left + ring_size as usize {
                        let pixel = &pixels.as_slice()[row * pixels.width() as usize + col];
                        if (pixel.r, pixel.g, pixel.b) == (color.red(), color.green(), color.blue()) {
                            count += 1;
                        }
                    }
                }
                count
            };
            let before = ring_ink(&bar);
            assert!(before > 0, "The dial renders at the foot of the pane.");
            bar.window().dispatch_event(WindowEvent::PointerPressed { position: start, button: PointerEventButton::Left });
            bar.window().dispatch_event(WindowEvent::PointerMoved { position: end });
            assert_eq!(rating_at(&bar).value.as_str(), "7", "The drag is still in progress.");
            assert!(ring_ink(&bar) > before, "The ring fills during the drag.");
            bar.window().dispatch_event(WindowEvent::PointerReleased { position: end, button: PointerEventButton::Left });
            let rating = bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap().dials.row_data(0).unwrap();
            assert_eq!(rating.value.as_str(), "9", "Dragging up two steps from seven");
            bar.invoke_dial_set(rating.item, 7, false);
            bar.invoke_focus_line();
        }
        // The views at the left (F1 → Funktionen): Strg+Tab and the switch beside the search turn them.
        {
            use features::{Module, View};
            assert_eq!(bar.get_views().row_count(), 5, "Every view is on at first, as in the app.");
            key_with_modifiers(&bar, &[K::Control], &char::from(K::Tab).to_string());
            assert_eq!(with_app_value(|app| app.state.view), View::Week);
            assert!(bar.get_day_heading().starts_with("Wochenübersicht"), "{}", bar.get_day_heading());
            assert_eq!(bar.get_view_index(), 1);
            // A week shows its note and its evaluation (the app's defaults); its own entries once switched on.
            with_app(|app| { app.state.preferences.features = app.state.preferences.features.with_module(View::Week, Module::Entries, true).with_module(View::Week, Module::Rating, true).with_module(View::Week, Module::Activities, true); app.draw(); });
            let kinds = || bar.get_day_rows().iter().map(|row| row.kind).collect::<Vec<_>>();
            assert_eq!(kinds()[..2], [5, 8], "The heading, then the note right under it.");
            assert!(!kinds().contains(&9), "No lines to open the evaluation or the board: the actions and commands do that.");
            // Writing in the note, Strg+Enter keeps it; Alt+A a task of the week's own list.
            send_key_combo(&bar, [K::DownArrow]);
            send_key_combo(&bar, [K::Return]);
            assert!(bar.get_day_rows().iter().any(|row| row.kind == 8 && row.editing), "↓ from the search: the note first (a period's heading is not chosen).");
            bar.invoke_day_edited("Eine ruhige Woche\nmit zwei Zeilen".into());
            key_with_modifiers(&bar, &[K::Control], &char::from(K::Return).to_string());
            let data = || with_app_value(|app| serde_json::from_str::<serde_json::Value>(&app.state.journal.as_ref().unwrap().store.period_data().unwrap()).unwrap());
            assert_eq!(data()["notes"]["week:2026-11-16"], "Eine ruhige Woche\nmit zwei Zeilen");
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
            type_text(&bar, "a");
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
            bar.invoke_day_edited("Steuererklärung".into());
            send_key_combo(&bar, [K::Escape]);
            let entries = data()["entries"]["week:2026-11-16"].clone();
            assert_eq!(entries.as_object().map(|list| list.values().map(|e| e["text"].as_str().unwrap_or_default().to_string()).collect::<Vec<_>>()), Some(vec!["Steuererklärung".to_string()]));
            capture(&bar, "view-week");
            // A week's own title (F1 → Funktionen → Titel), written in place as a day's.
            with_app(|app| { app.state.preferences.features = app.state.preferences.features.with_module(View::Week, Module::Title, true); app.draw(); });
            assert_eq!(kinds()[..3], [5, 5, 8], "The heading, the title, the note.");
            bar.invoke_day_click(bar.get_day_rows().row_data(1).unwrap().item, 0);
            bar.invoke_day_edited("Umzugswoche".into());
            send_key_combo(&bar, [K::Return]);
            assert_eq!(data()["notes"]["title:week:2026-11-16"], "Umzugswoche");
            assert_eq!(bar.get_day_rows().row_data(1).unwrap().label.as_str(), "Umzugswoche");
            assert!(!bar.get_day_is_today() || bar.get_day_relative().as_str() == "Diese Woche");
            capture(&bar, "view-week-title");
            // The switch: a click on a view, the wheel on it.
            bar.invoke_view_choose(2);
            assert_eq!(with_app_value(|app| app.state.view), View::Month);
            bar.invoke_view_step(-1);
            assert_eq!(with_app_value(|app| app.state.view), View::Week);
            bar.invoke_view_choose(0);
            assert_eq!(with_app_value(|app| app.state.view), View::Day);
            // Only the day on: the switch gives way to the slash again.
            with_app(|app| { let mut f = app.state.preferences.features; for view in [View::Week, View::Month, View::Quarter, View::Year] { f = f.with_view(view, false); } app.state.preferences.features = f; app.draw(); });
            assert_eq!(bar.get_views().row_count(), 1);
            key_with_modifiers(&bar, &[K::Control], &char::from(K::Tab).to_string());
            assert_eq!(with_app_value(|app| app.state.view), View::Day, "Nothing to switch to.");
            bar.invoke_focus_line();
        }
        // The inline slash opens exactly the command list that typing '/' opens. A tap
        // on the same spot clears it and returns input to the search field.
        let theme = bar.global::<Theme>();
        let query_tool = slint::LogicalPosition::new(theme.get_form_width() - theme.get_padding() - 3.5 * theme.get_accessory_height(), theme.get_line_height() / 2.0);
        click(&bar, query_tool);
        assert_eq!(bar.get_search_text(), "/");
        assert_eq!(bar.get_commands().row_data(0).unwrap().heading.as_str(), "Befehle");
        capture(&bar, "launcher-commands");
        click(&bar, query_tool);
        assert_eq!(bar.get_search_text(), "");
        with_app(|app| { app.state.preferences.features = features::Features::default(); app.draw(); });
        type_text(&bar, "xyz-ohne-treffer");
        assert!(bar.get_searching() && bar.get_commands().row_count() == 0);
        assert!(bar.get_footer_hints().iter().all(|hint| hint.action != 0));
        send_key_combo(&bar, [K::DownArrow, K::Escape]);
        assert!(!bar.get_searching() && bar.window().is_visible());
        type_text(&bar, "/Tag");
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_side_open() && bar.get_day_picker_open());
        let initial_month = bar.get_side_month_title();
        send_key_combo(&bar, [K::PageDown]);
        assert_ne!(bar.get_side_month_title(), initial_month);
        send_key_combo(&bar, [K::Home]);
        send_key_combo(&bar, [K::RightArrow]);
        send_key_combo(&bar, [K::Return]);
        assert!(!bar.get_side_open() && !bar.get_entry_open());
        assert_eq!(day_labels(&bar), ["Zahnarzt"]);
        type_text(&bar, "/Today");
        let theme = bar.global::<Theme>();
        let first = bar.get_commands().row_data(0).unwrap();
        click(&bar, slint::LogicalPosition::new(theme.get_padding() * 2.0, theme.get_line_height() + first.header + theme.get_row_height() / 2.0));
        assert_eq!(bar.get_day_relative().as_str(), "Heute");
        // Alt+→ shows tomorrow (the dentist), Alt+H today again; the search bar keeps the keyboard.
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
        send_key_combo(&bar, [K::RightArrow]);
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
        assert_eq!(bar.get_day_relative().as_str(), "in 1 d");
        assert_eq!(bar.get_footer_label().as_str(), "Donnerstag, 19. November 2026");
        assert_eq!(day_labels(&bar), ["Zahnarzt"]);
        assert!(bar.get_cal_bands().iter().any(|band| band.selected), "The calendar marks the day the view shows.");
        capture(&bar, "day-view-tomorrow");
        // The command opens tomorrow's note list.
        type_text(&bar, "@");
        assert_eq!(bar.get_commands().row_count(), 10);
        capture(&bar, "search-type-filters");
        send_key_combo(&bar, [K::DownArrow]);
        // The footer applies precisely the filter selected with the keyboard.
        assert_eq!(bar.get_footer_hints().row_data(0).unwrap().label.as_str(), "Filter übernehmen");
        click(&bar, slint::LogicalPosition::new(theme.get_form_width() * 0.6, bar.get_content_height() - theme.get_footer_height() / 2.0));
        assert_eq!(bar.get_search_text(), "@Ereignis ");
        send_key_combo(&bar, [K::Escape]);
        type_text(&bar, "ahn");
        assert_eq!(bar.get_commands().row_data(0).unwrap().name, "Zahnarzt");
        let result = bar.get_commands().row_data(0).unwrap();
        hover(theme.get_padding() * 2.0, theme.get_line_height() + result.header + theme.get_row_height() / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "Zahnarzt");
        assert!(bar.get_entry_preview_description().ends_with("dort sein."));
        hover(theme.get_padding(), theme.get_line_height() / 2.0);
        send_key_combo(&bar, [K::F3]);
        assert_eq!(bar.get_entry_preview_title(), "Zahnarzt");
        assert_eq!(bar.get_search_text(), "ahn");
        send_key_combo(&bar, [K::Escape]);
        assert_eq!(bar.get_search_text(), "ahn");
        capture(&bar, "search-entry-results");
        send_key_combo(&bar, [K::Escape]);
        type_text(&bar, "/Notizblock");
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_notepad_open() && !bar.get_entry_open());
        assert_eq!(bar.get_notepad_panel(), 1);
        assert_eq!(bar.get_notepad_date().as_str(), "Donnerstag, 19. November 2026");
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_notepad_open());
        {
            // Strg+K, a few letters and Enter: the notepad from the actions.
            key_with_modifiers(&bar, &[K::Control], "k");
            assert!(bar.get_menu_open());
            type_text(&bar, "notiz");
            assert_eq!(bar.get_menu_rows().row_data(0).unwrap().label.as_str(), "Notizblock öffnen");
            send_key_combo(&bar, [K::Return]);
            assert!(!bar.get_menu_open());
            assert!(bar.get_notepad_open(), "The actions open the notepad.");
            assert_eq!(bar.get_notepad_panel(), 1);
            assert_eq!(bar.get_notepad_title().as_str(), "");
            key_with_modifiers(&bar, &[K::Control, K::Shift], "N");
            assert!(bar.get_notepad_editing() && bar.get_notepad_panel() == 0);
            type_text(&bar, "Entwurf");
            send_key_combo(&bar, [K::Escape]);
            assert!(bar.get_notepad_open(), "The first Esc asks before discarding edits.");
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressRepeated { text: char::from(K::Escape).into() });
            assert!(bar.get_notepad_open(), "Holding Esc must not discard the draft.");
            send_key_combo(&bar, [K::Escape]);
            assert_eq!(bar.get_notepad_panel(), 1, "A separate Esc press discards the draft and returns to the list.");
            send_key_combo(&bar, [K::Escape]);
            assert!(!bar.get_notepad_open());
        }
        key_with_modifiers(&bar, &[K::Control, K::Shift], "N");
        assert!(bar.get_notepad_open());
        assert!(bar.get_notepad_editing() && bar.get_notepad_panel() == 0);
        let ctrl = |text: &str| key_with_modifiers(&bar, &[K::Control], text);
        assert!(!bar.get_notepad_date().starts_with("Tagespinnwand"), "A new note goes to the notebook only, not onto a board.");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(bar.get_notepad_body().as_str(), "    ");
        send_key_combo(&bar, [K::Shift, K::Tab]);
        assert_eq!(bar.get_notepad_body().as_str(), "");
        type_text(&bar, "- Stichpunkt");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_body().as_str(), "- Stichpunkt\n- ");
        ctrl("a");
        type_text(&bar, "- [ ] Test");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_body().as_str(), "- [ ] Test\n- [ ] ");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_body().as_str(), "- [ ] Test\n");
        type_text(&bar, "~~~rust");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "let test = 42;");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "~~~");
        capture(&bar, "notebook-editor");
        ctrl("t");
        assert_eq!(bar.get_notepad_panel(), 2);
        type_text(&bar, "Arbeit");
        assert_eq!(bar.get_notepad_choices().row_count(), 2);
        send_key_combo(&bar, [K::DownArrow, K::Return]);
        assert_eq!(bar.get_notepad_panel(), 0);
        assert!(bar.get_notepad_tools().iter().any(|tool| tool.id == 1 && tool.label == "Arbeit"));
        ctrl("l");
        assert_eq!(bar.get_notepad_panel(), 3);
        type_text(&bar, "https://example.org");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_choices().row_count(), 1);
        send_key_combo(&bar, [K::Escape]);
        open_footer_menu();
        send_key_combo(&bar, [K::Return]);
        assert!(settings_open() && !bar.window().is_visible(), "Settings have their own window.");
        let keys_window = settings();
        type_text(&keys_window, "Markdown");
        send_key_combo(&keys_window, [K::Return]);
        assert!(keys_window.get_recording());
        key_with_modifiers(&keys_window, &[K::Control], "l");
        assert!(keys_window.get_recording(), "A conflicting shortcut is rejected.");
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "Strg+M");
        send_key_combo(&keys_window, [K::F8]);
        assert!(!keys_window.get_recording());
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "F8");
        capture_window(keys_window.window(), "shortcut-assignment");
        send_key_combo(&keys_window, [K::F1]);
        assert!(!settings_open() && bar.get_notepad_open());
        let closed_window = keys_window.as_weak();
        drop(keys_window);
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
        assert!(closed_window.upgrade().is_none());
        ctrl("m");
        assert!(!bar.get_notepad_preview(), "The old binding gives way to the replacement.");
        send_key_combo(&bar, [K::F8]);
        assert!(bar.get_notepad_preview());
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_notepad_body().starts_with("- [x] Test"));
        assert!(bar.get_notepad_markdown().iter().any(|row| row.is_code && row.code == "let test = 42;\n"));
        capture(&bar, "notebook-card");
        send_key_combo(&bar, [K::DownArrow, K::Return]);
        send_key_combo(&bar, [K::F8]);
        send_key_combo(&bar, [K::Control, K::End]);
        send_key_combo(&bar, [K::Return]);
        ctrl("v");
        assert!(bar.get_notepad_body().ends_with("let test = 42;\n"), "The code action copies only the contents of the block.");
        // Bold reads bold in the reader (the capture below shows it).
        type_text(&bar, "Normal **fett** normal");
        // A table: Enter on a row adds one, Tab goes to the next cell; and the app's colour and highlight.
        send_key_combo(&bar, [K::Return]);
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "| Tag | Wert |");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "|:--|--:|");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "Mo");
        send_key_combo(&bar, [K::Tab]);
        type_text(&bar, "**3**");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "Di");
        send_key_combo(&bar, [K::Tab]);
        type_text(&bar, "5");
        send_key_combo(&bar, [K::Return]);
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "[Farbe]{rot} und ==markiert==");
        assert!(bar.get_notepad_body().contains("| Tag | Wert |\n|:--|--:|\n| Mo  | **3**  |\n| Di  | 5  |\n\n[Farbe]{rot}"), "{:?}", bar.get_notepad_body());
        // The footer's main action saves (as Strg+Enter).
        assert_eq!(bar.get_footer_hints().row_data(0).unwrap().label.as_str(), "Speichern");
        bar.invoke_footer_action(0);
        assert!(bar.get_notepad_open() && bar.get_notepad_preview() && !bar.get_notepad_editing());
        assert!(bar.get_notepad_date().ends_with("Arbeit"));
        capture(&bar, "notebook-reader");
        // The note wider: its edge dragged (the calendar narrows); F11 over the whole window and back.
        let calendar_before = with_app_value(|app| app.state.metrics.width);
        bar.set_notepad_width(700.);
        fit_viewport(&bar);
        assert!(with_app_value(|app| app.state.metrics.width) < calendar_before - 200., "The calendar narrows beside a wider note.");
        bar.invoke_notepad_resized(700.);
        assert_eq!(with_app_value(|app| app.state.preferences.notepad_width), Some(700));
        capture(&bar, "notebook-wider");
        send_key_combo(&bar, [K::F11]);
        assert!(bar.get_notepad_wide() && with_app_value(|app| app.state.preferences.notepad_wide));
        capture(&bar, "notebook-wide");
        send_key_combo(&bar, [K::F11]);
        assert!(!bar.get_notepad_wide());
        bar.set_notepad_width(0.);
        bar.invoke_notepad_resized(460.);
        ctrl("k");
        type_text(&bar, "Ordner");
        assert_eq!(bar.get_menu_rows().row_data(0).unwrap().label, "Ordner zuweisen");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_panel(), 4);
        type_text(&bar, "Projekte");
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_notepad_preview() && !bar.get_notepad_editing() && bar.get_notepad_panel() == 0);
        with_app(|app| {
            let note = app.state.notepad().unwrap();
            assert_eq!(note.card.original.as_ref().unwrap()["folder"], folder.to_string());
        });
        send_key_combo(&bar, [K::Escape]);
        assert_eq!(bar.get_notepad_panel(), 1);
        capture(&bar, "notebook-list");
        // All notes as a tree: the arrows walk it, Strg+K on a folder makes a subfolder.
        assert_eq!(bar.get_notepad_list_mode(), 0);
        let row = |i: usize| bar.get_notepad_choices().row_data(i).unwrap();
        assert!(row(0).folder && row(0).selected, "The tree starts on its first folder.");
        send_key_combo(&bar, [K::DownArrow]);
        assert!(row(1).selected && !row(0).selected, "↓ moves the cursor.");
        send_key_combo(&bar, [K::UpArrow]);
        ctrl("k");
        type_text(&bar, "Unterordner");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_notepad_list_mode(), 3);
        type_text(&bar, "Archiv");
        send_key_combo(&bar, [K::Return]);
        assert_eq!((row(1).title.as_str(), row(1).depth, row(1).selected), ("Archiv", 1, true));
        assert_eq!(bar.get_notepad_query().as_str(), "");
        capture(&bar, "notebook-tree");
        // ← goes to the folder around, ← again closes it, → opens it, ↓ walks into it.
        let count = bar.get_notepad_choices().row_count();
        send_key_combo(&bar, [K::LeftArrow]);
        assert!(row(0).selected && row(0).open, "← on an empty folder: to the folder it is in.");
        send_key_combo(&bar, [K::LeftArrow]);
        assert!(!row(0).open && bar.get_notepad_choices().row_count() < count, "← closes the folder.");
        send_key_combo(&bar, [K::RightArrow]);
        assert!(row(0).open && bar.get_notepad_choices().row_count() == count, "→ opens it again.");
        send_key_combo(&bar, [K::DownArrow]);
        assert!(row(1).selected, "↓ into the folder.");
        // A click on a folder closes it; the arrows still walk the list afterwards.
        {
            use slint::platform::{PointerEventButton as Button, WindowEvent};
            let at = slint::LogicalPosition::new(150., 232. - 56.);
            bar.window().dispatch_event(WindowEvent::PointerPressed { position: at, button: Button::Left });
            bar.window().dispatch_event(WindowEvent::PointerReleased { position: at, button: Button::Left });
        }
        assert!(row(0).selected && !row(0).open, "The click closed the folder.");
        send_key_combo(&bar, [K::RightArrow]);
        assert!(row(0).open, "→ after a click opens it.");
        send_key_combo(&bar, [K::DownArrow]);
        assert!(row(1).selected, "↓ after a click.");
        // Dragged with the mouse: the note onto "Archiv" goes into it.
        {
            use slint::platform::{PointerEventButton as Button, WindowEvent};
            let at = |y: f32| slint::LogicalPosition::new(150., y);
            bar.window().dispatch_event(WindowEvent::PointerPressed { position: at(232.), button: Button::Left });
            for y in [228., 220., 212., 204.] { bar.window().dispatch_event(WindowEvent::PointerMoved { position: at(y) }); }
            bar.window().dispatch_event(WindowEvent::PointerReleased { position: at(204.), button: Button::Left });
        }
        assert_eq!((row(2).title.as_str(), row(2).depth), ("Neue Notiz", 2), "In Archiv now.");
        type_text(&bar, "Neue");
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_notepad_preview() && !bar.get_notepad_editing());
        send_key_combo(&bar, [K::F2]);
        assert!(!bar.get_notepad_preview() && bar.get_notepad_editing());
        send_key_combo(&bar, [K::Escape]);
        assert!(bar.get_notepad_preview() && !bar.get_notepad_editing());
        send_key_combo(&bar, [K::Escape]);
        assert_eq!(bar.get_notepad_query().as_str(), "Neue");
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_notepad_open());
        ctrl("n");
        assert!(bar.get_notepad_open() && bar.get_notepad_panel() == 1);
        assert!(!bar.get_notepad_on_day(), "Strg+N: every note and folder.");
        // A long tree: the list follows the cursor (each key builds the rows anew, so they scroll as they appear).
        with_app(|app| {
            let journal = app.state.journal.as_mut().unwrap();
            for n in 0..24 { notebook::create_folder(&mut journal.store, &format!("Mappe {n:02}"), None).unwrap(); }
            app.draw_notepad_choices();
        });
        let screen = bar.get_screen_height();
        bar.set_screen_height(600.0);
        send_key_combo(&bar, [K::End]);
        let last = bar.get_notepad_choices().row_count() - 1;
        assert!(bar.get_notepad_choices().row_data(last).unwrap().selected);
        capture(&bar, "notebook-long-end");
        send_key_combo(&bar, [K::Home]);
        capture(&bar, "notebook-long-home");
        bar.set_screen_height(screen);
        with_app(|app| {
            let journal = app.state.journal.as_mut().unwrap();
            for folder in notebook::folder_list(&journal.store).unwrap().into_iter().filter(|f| f.name.starts_with("Mappe ")) {
                notebook::remove_folder(&mut journal.store, &folder.id).unwrap();
            }
            app.draw_notepad_choices();
        });
        send_key_combo(&bar, [K::Tab]);
        assert!(bar.get_notepad_on_day());
        send_key_combo(&bar, [K::Escape]);
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
        type_text(&bar, "h");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
        assert!(bar.get_day_is_today());
        assert_eq!(bar.get_search_text(), "", "Alt+H typed nothing.");
        // The middle button on a day in the calendar; a click on the distance goes back to today.
        let urlaub = with_app_value(|app| app.state.view().calendar.layout.rows.iter().find(|row| row.date == repeat::d("2026-11-23")).map(|row| row.y + 2.0).unwrap());
        bar.invoke_cal_mouse(2, 0, 30.0, urlaub, false);
        assert_eq!(day_labels(&bar), ["Urlaub", "Team"], "A multiday entry shows on every day it covers, before the timed ones.");
        capture(&bar, "day-view-holiday");
        // The today icon beside the view switch (a click: back to today).
        bar.invoke_day_today();
        assert!(bar.get_day_is_today());
        let alt = |bar: &Bar, text: &str| {
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
            type_text(bar, text);
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
        };
        // Into the day: ↓ from the search bar chooses the title; Alt+A writes a task in place, Enter the next, Esc ends.
        send_key_combo(&bar, [K::DownArrow]);
        assert!(bar.get_day_rows().iter().any(|row| row.selected && row.kind == 5), "The day's title is chosen first.");
        key_with_modifiers(&bar, &[K::Control], "f");
        type_text(&bar, "Probe");
        assert_eq!(bar.get_search_text(), "Probe");
        alt(&bar, "a");
        assert_eq!(bar.get_search_text(), "");
        assert!(bar.get_day_rows().iter().any(|row| row.editing && row.kind == 1), "A line for the new task.");
        type_text(&bar, "Brot kaufen");
        send_key_combo(&bar, [K::Return]);
        type_text(&bar, "Post");
        send_key_combo(&bar, [K::Escape]);
        assert!(day_labels(&bar).contains(&"Brot kaufen".to_string()) && day_labels(&bar).contains(&"Post".to_string()), "{:?}", day_labels(&bar));
        // Alt+D on the chosen task ticks it (it was chosen after writing).
        alt(&bar, "d");
        assert!(bar.get_day_rows().iter().any(|row| row.label == "Post" && row.done));
        capture(&bar, "day-entries");
        // A click on an entry's symbol: its actions (as Strg+K) open over the footer; the window keeps its size.
        let item = bar.get_day_rows().iter().find(|row| row.label == "Brot kaufen").unwrap().item;
        let footer_before = bar.get_day_footer_height();
        let top_before = bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap().top;
        assert_eq!(top_before, bar.global::<Theme>().get_day_heading_height(), "The dial positions do not include the entries.");
        let closed_width = bar.get_content_width();
        bar.invoke_day_click(item, 1);
        assert!(bar.get_menu_open());
        assert_eq!(bar.get_content_width(), closed_width, "The actions do not widen the window.");
        assert_eq!(bar.get_menu_title().as_str(), "Brot kaufen");
        let labels = |bar: &Bar| bar.get_menu_rows().iter().map(|row| row.label.to_string()).collect::<Vec<_>>();
        assert!(labels(&bar).contains(&"Status".to_string()) && !labels(&bar).contains(&"Neue Aufgabe".to_string()), "On an entry only its own actions: {:?}", labels(&bar));
        assert_eq!(labels(&bar).last().map(String::as_str), Some("Löschen"), "Deleting is last.");
        let status = bar.get_menu_rows().iter().find(|row| row.label == "Status").unwrap();
        assert_eq!(status.caps.iter().map(|cap| cap.to_string()).collect::<Vec<_>>(), ["Alt", "D"], "Each action shows its keys.");
        capture(&bar, "actions-entry");
        // Open the month from the actions and select dates with the physical Space and arrow keys.
        type_text(&bar, "plan");
        assert_eq!(labels(&bar)[0], "Planen", "{:?}", labels(&bar));
        capture(&bar, "actions-search");
        send_key_combo(&bar, [K::Return]);
        assert!(!bar.get_menu_open() && bar.get_side_open());
        assert_eq!(bar.get_side_kind(), 5);
        assert_eq!(bar.get_side_cells().row_count(), 42);
        capture(&bar, "actions-plan");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: " ".into() });
        send_key_combo(&bar, [K::RightArrow]);
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: " ".into() });
        assert_eq!(bar.get_side_cells().iter().filter(|day| day.picked).count(), 2);
        send_key_combo(&bar, [K::Shift, K::RightArrow]);
        send_key_combo(&bar, [K::Shift, K::RightArrow]);
        assert_eq!(bar.get_side_cells().iter().filter(|day| day.pending).count(), 3);
        type_text(&bar, " ");
        assert_eq!(bar.get_side_cells().iter().filter(|day| day.picked).count(), 4);
        send_key_combo(&bar, [K::Return]);
        assert!(!bar.get_side_open() && !bar.get_menu_open(), "Planned: the card goes.");
        send_key_combo(&bar, [K::Alt, K::Delete]);
        assert!(bar.get_side_open());
        assert_eq!(bar.get_side_rows().row_data(0).unwrap().label, "Nur diesen");
        assert!(bar.get_side_rows().row_data(0).unwrap().selected);
        send_key_combo(&bar, [K::RightArrow]);
        assert!(bar.get_side_rows().row_data(1).unwrap().selected);
        send_key_combo(&bar, [K::Escape]);
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_side_open());
        // A tag only with the keyboard: Strg+K on "Post", "tag", Enter; the search has the keys, ↓ and Enter choose.
        let post = bar.get_day_rows().iter().find(|row| row.label == "Post").unwrap().item;
        bar.invoke_day_click(post, 4);
        type_text(&bar, "tag");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_side_kind(), 1, "The tags in the card.");
        let tags = bar.get_side_rows().row_count();
        assert!(tags > 1);
        type_text(&bar, "x");
        assert!(bar.get_side_rows().row_count() < tags, "Typing filters the tags.");
        send_key_combo(&bar, [K::Backspace]);
        assert_eq!(bar.get_side_rows().row_count(), tags);
        send_key_combo(&bar, [K::DownArrow, K::Return]);
        assert!(!bar.get_side_open() && !bar.get_menu_open());
        assert!(bar.get_day_rows().iter().any(|row| row.label == "Post" && row.has_color), "The tag is set.");
        // Every icon (about 1600): only those near the lines in sight are drawn, the others when scrolled to.
        bar.invoke_day_click(post, 4);
        type_text(&bar, "symbol");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_side_kind(), 2, "The icons in the card.");
        let more = bar.get_side_rows().row_count() - 1;
        assert_eq!(bar.get_side_rows().row_data(more).unwrap().label.as_str(), "Alle Symbole");
        bar.invoke_side_choose(more as i32);
        let all = bar.get_side_rows();
        let drawn = || bar.get_side_rows().iter().filter(|row| row.icon.size().width > 0).count();
        assert!(all.row_count() > 1000, "Every icon.");
        assert!(drawn() < 300, "Only those near the lines in sight are drawn ({}).", drawn());
        let columns = bar.global::<Theme>().get_side_icon_columns() as usize;
        assert_eq!(bar.get_side_rows().row_data(150 * columns).unwrap().icon.size().width, 0);
        bar.invoke_side_scrolled(150);
        assert!(bar.get_side_rows().row_data(150 * columns).unwrap().icon.size().width > 0, "Scrolled there: drawn now.");
        send_key_combo(&bar, [K::Escape]);
        send_key_combo(&bar, [K::Escape]);
        // Backspace in an empty search goes a step back: out of a picker into the actions, then out of them.
        bar.invoke_day_click(post, 4);
        type_text(&bar, "uhr");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_side_kind(), 4, "The clock.");
        send_key_combo(&bar, [K::Backspace]);
        assert!(bar.get_menu_open() && !bar.get_side_open(), "Backspace: back to the actions.");
        // ↓ to the last line: the list follows.
        let rows = bar.get_menu_rows().row_count();
        send_key_combo(&bar, [K::End]);
        assert_eq!(bar.get_menu_pick() as usize, rows - 1);
        send_key_combo(&bar, [K::Home]);
        assert_eq!(bar.get_menu_pick(), 0);
        for _ in 1..rows { send_key_combo(&bar, [K::DownArrow]); }
        assert_eq!(bar.get_menu_pick() as usize, rows - 1);
        assert!(bar.get_menu_rows().row_data(rows - 1).unwrap().top > 200.0, "The last line lies below the first view.");
        capture(&bar, "actions-scrolled");
        send_key_combo(&bar, [K::Backspace]);
        assert!(!bar.get_menu_open(), "Backspace in the empty search closes the actions.");
        assert!(bar.get_day_rows().iter().any(|row| row.label == "Brot kaufen" && row.trace));
        // The dials: a click on the ring sets by its place.
        let dial = bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap().dials.row_data(0).unwrap();
        bar.invoke_dial_point(dial.item, 20.0, 0.0);
        let dial = bar.get_day_footer_rows().iter().find(|row| row.kind == 7).unwrap().dials.row_data(0).unwrap();
        assert_eq!(dial.value.as_str(), "8", "Right of the centre: 225° of 270° on 0–10.");
        capture(&bar, "day-dials");
        bar.invoke_dial_set(dial.item, 5, false);
        assert_eq!(bar.get_day_footer_rows().iter().find(|r| r.kind == 7).unwrap().dials.row_data(0).unwrap().value.as_str(), "5");
        bar.invoke_dial_set(dial.item, 0, true);
        assert_eq!(bar.get_day_footer_rows().iter().find(|r| r.kind == 7).unwrap().dials.row_data(0).unwrap().value.as_str(), "–");
        // At portrait width the same side panel opens above a full-width day pane.
        bar.set_screen_width(720.0);
        bar.set_screen_height(1100.0);
        with_app(|app| app.draw());
        assert!(bar.get_stacked() && bar.get_content_height() <= 1100.0);
        assert_eq!(bar.get_form_space(), 720.0);
        assert_eq!(bar.get_day_footer_height(), footer_before);
        fit_viewport(&bar);
        capture(&bar, "portrait-day");
        bar.invoke_day_click(item, 4);
        assert!(bar.get_menu_open(), "A right click opens the entry's actions too.");
        fit_viewport(&bar);
        capture(&bar, "portrait-actions");
        // The calendar beneath the card also dismisses it; the same tap must
        // not expand the day or open an entry underneath it.
        let opened_before = with_app_value(|app| app.state.opened().clone());
        let beside = slint::LogicalPosition::new(theme.get_padding(), bar.get_content_height() - theme.get_row_height());
        use slint::platform::{PointerEventButton, WindowEvent};
        bar.window().dispatch_event(WindowEvent::PointerPressed { position: beside, button: PointerEventButton::Left });
        bar.window().dispatch_event(WindowEvent::PointerReleased { position: beside, button: PointerEventButton::Left });
        assert!(!bar.get_menu_open() && !bar.get_side_open(), "A click beside the actions closes them.");
        assert_eq!(with_app_value(|app| app.state.opened().clone()), opened_before);
        bar.set_screen_width(2000.0);
        bar.set_screen_height(2200.0);
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(200));
        with_app(|app| app.draw());
        fit_viewport(&bar);
        send_key_combo(&bar, [K::Escape]);
        // Opening starts clear even if the previous activation missed both key releases.
        for key in [K::Control, K::Alt] {
            bar.window().dispatch_event(WindowEvent::KeyPressed { text: char::from(key).into() });
        }
        assert!(!settings_open());
        release_opening_modifiers(bar.window());
        type_text(&bar, "probe");
        assert_eq!(bar.get_search_text().as_str(), "probe");
        assert_eq!(QUITS.with(|quits| quits.get()), 0);

        open_footer_menu();
        capture(&bar, "app-menu");
        send_key_combo(&bar, [K::Return]);
        assert!(settings_open());
        assert!(!bar.get_menu_open());
        settings().window().dispatch_event(WindowEvent::CloseRequested);
        assert!(!settings_open() && bar.window().is_visible());

        // F1 → Aktivitäten and Tageswerte: the app's settings of the checklist and the day values.
        send_key_combo(&bar, [K::F1]);
        let period_window = settings();
        // F1 → Funktionen: the views and their parts as switches; a click switches one.
        period_window.invoke_navigate(5);
        assert_eq!(period_window.get_period_page(), 0);
        let feature_rows = period_window.get_rows();
        let week_entries = feature_rows.iter().position(|row| row.id == "feature:week:entries").expect("The week's own entries.");
        assert_eq!(feature_rows.row_data(week_entries).unwrap().index, 0);
        capture_window(period_window.window(), "settings-features");
        with_app(|app| { app.change_feature("feature:week:entries", true); });
        assert!(with_app_value(|app| app.state.preferences.features.has(features::View::Week, features::Module::Entries) && app.state.preferences.features_set));
        with_app(|app| { app.change_feature("feature:week:entries", false); });
        period_window.invoke_navigate(6);
        assert_eq!(period_window.get_period_page(), 1);
        let names = |window: &SettingsWindow| window.get_period_rows().iter().map(|row| row.name.to_string()).collect::<Vec<_>>();
        assert_eq!(names(&period_window), ["Laufen", "Lesen"]);
        // The keyboard: Tab from the search goes to the new activity's field; Enter adds it.
        send_key_combo(&period_window, [K::Tab]);
        send_key_combo(&period_window, [K::Tab]);
        type_text(&period_window, "Yoga");
        send_key_combo(&period_window, [K::Return]);
        assert_eq!(names(&period_window), ["Laufen", "Lesen", "Yoga"], "Enter in the new field adds the activity.");
        let period = || -> serde_json::Value { serde_json::from_str(&with_app_value(|app| app.state.journal.as_ref().unwrap().store.period_data().unwrap())).unwrap() };
        let yoga = period()["definitions"][2].clone();
        assert_eq!((yoga["color"].as_str(), yoga["trackTime"].as_bool(), yoga["active"].as_bool()), (Some("#e6a85c"), Some(true), Some(true)));
        let tags = with_app_value(|app| app.state.journal.as_ref().unwrap().store.tags().unwrap());
        assert!(tags.iter().any(|tag| Some(tag.id.as_str()) == yoga["calendarTagId"].as_str() && tag.name == "Yoga"), "Every activity has a tag of its own.");
        let yoga_id = yoga["id"].as_str().unwrap().to_string();
        period_window.invoke_period_edit(yoga_id.clone().into(), "max".into(), "60".into());
        period_window.invoke_period_edit(yoga_id.clone().into(), "hsv".into(), "120,1,1".into());
        period_window.invoke_period_edit(yoga_id.clone().into(), "up".into(), "".into());
        assert_eq!(names(&period_window), ["Laufen", "Yoga", "Lesen"]);
        assert_eq!((period()["definitions"][1]["maxMinutes"].as_i64(), period()["definitions"][1]["color"].as_str()), (Some(60), Some("#00ff00")));
        assert!(with_app_value(|app| app.state.journal.as_ref().unwrap().store.tags().unwrap()).iter().any(|tag| tag.name == "Yoga" && tag.color == "#00ff00"));
        period_window.invoke_period_edit(yoga_id.clone().into(), "text".into(), "".into());
        assert!(period_window.get_period_rows().row_data(1).unwrap().text_field);
        capture_window(period_window.window(), "settings-activities");
        period_window.invoke_navigate(7);
        assert_eq!(period_window.get_period_page(), 2);
        assert_eq!(period_window.get_period_rows().row_data(0).unwrap().kind, 2, "The daily rating first.");
        assert_eq!(names(&period_window)[1], "Stress");
        period_window.invoke_period_add("Schlaf".into());
        let sleep = period_window.get_period_rows().row_data(2).unwrap();
        assert_eq!((sleep.name.as_str(), sleep.min.as_str(), sleep.max.as_str()), ("Schlaf", "0", "10"));
        period_window.invoke_period_edit("rating".into(), "max".into(), "5".into());
        assert_eq!(period()["rating"]["max"], 5);
        capture_window(period_window.window(), "settings-values");
        // The colour dot of the daily rating opens the picker.
        click(&period_window, slint::LogicalPosition::new(261., 334.));
        capture_window(period_window.window(), "settings-values-picker");
        click(&period_window, slint::LogicalPosition::new(261., 334.));
        period_window.invoke_period_edit(sleep.id.clone(), "delete".into(), "".into());
        assert_eq!(names(&period_window).len(), 2);
        period_window.invoke_period_edit("rating".into(), "reset".into(), "".into());
        period_window.window().dispatch_event(WindowEvent::CloseRequested);
        assert!(!settings_open());

        send_key_combo(&bar, [K::F1]);
        assert!(settings_open());
        let keys_window = settings();
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
        assert!(keys_window.window().is_visible());
        assert!(keys_window.get_query().is_empty());
        let settings_theme = keys_window.global::<Theme>();
        let key_position = |x, y| slint::LogicalPosition::new(x, y);
        assert_eq!(keys_window.get_category(), 0);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().control, RowControl::Featured);
        capture_window(keys_window.window(), "settings-general");
        {
            // "Dort bleiben": the time and its unit appear; the number goes up with → and takes typed digits.
            let index_of = |key: PreferenceKey| keys_window.get_rows().iter().position(|row| row.preference == key);
            let reopen = index_of(PreferenceKey::Reopen).unwrap();
            with_app(|app| { app.change_preference(PreferenceKey::Reopen, 1); });
            let amount = index_of(PreferenceKey::ReopenAfter).expect("The time appears.");
            assert!(index_of(PreferenceKey::ReopenUnit).is_some());
            assert_eq!(keys_window.get_rows().row_data(amount).unwrap().value.as_str(), "5");
            let _ = reopen;
            capture_window(keys_window.window(), "settings-reopen");
            {
                use slint::platform::{PointerEventButton, WindowEvent};
                let at = slint::LogicalPosition::new(600.0, 627.0);
                keys_window.window().dispatch_event(WindowEvent::PointerPressed { position: at, button: PointerEventButton::Left });
                keys_window.window().dispatch_event(WindowEvent::PointerReleased { position: at, button: PointerEventButton::Left });
                let press = |text: slint::SharedString| {
                    keys_window.window().dispatch_event(WindowEvent::KeyPressed { text: text.clone() });
                    keys_window.window().dispatch_event(WindowEvent::KeyReleased { text });
                };
                press(char::from(K::RightArrow).into());
                with_app(|app| assert_eq!(app.state.preferences.reopen_after, 6, "→ adds one."));
                press("3".into()); press("0".into());
                with_app(|app| assert_eq!(app.state.preferences.reopen_after, 30, "Digits typed."));
                press(char::from(K::Backspace).into());
                with_app(|app| assert_eq!(app.state.preferences.reopen_after, 3));
            }
            with_app(|app| { app.change_preference(PreferenceKey::ReopenAfter, 12); app.change_preference(PreferenceKey::Reopen, 0); });
            assert!(index_of(PreferenceKey::ReopenAfter).is_none());
            with_app(|app| assert_eq!(app.state.preferences.reopen_after, 12));
            with_app(|app| { app.change_preference(PreferenceKey::ReopenAfter, 5); });
        }
        let pixels = keys_window.window().take_snapshot().unwrap();
        let scale = keys_window.window().scale_factor();
        let right = pixels.width() as f32 - (settings_theme.get_settings_padding() + settings_theme.get_settings_row_inset()) * scale;
        let left = right - settings_theme.get_settings_switch_width() * scale;
        let mut colored_pixels = 0;
        for (i, p) in pixels.as_slice().iter().enumerate() {
            if p.r != p.g || p.g != p.b {
                let x = (i % pixels.width() as usize) as f32;
                assert!(x >= left.floor() && x < right.ceil(), "Only the active switch tracks carry color");
                colored_pixels += 1;
            }
        }
        assert!(colored_pixels > 0);
        let profile = path.with_extension("settings.json");
        with_app(|app| app.preferences_path = Some(profile.clone()));
        type_text(&keys_window, "Sprache");
        send_key_combo(&keys_window, [K::Return]);
        send_key_combo(&keys_window, [K::End]);
        send_key_combo(&keys_window, [K::Return]);
        assert_eq!(keys_window.get_labels().settings, "Settings");
        assert_eq!(bar.get_footer_menu_label(), "Menu");
        key_with_modifiers(&keys_window, &[K::Control], "f");
        type_text(&keys_window, "Language");
        send_key_combo(&keys_window, [K::Return]);
        send_key_combo(&keys_window, [K::Home]);
        send_key_combo(&keys_window, [K::Return]);
        assert_eq!(keys_window.get_labels().settings, "Einstellungen");
        key_with_modifiers(&keys_window, &[K::Control], "f");
        // Global search finds an option outside the current category; Enter operates its real switch.
        type_text(&keys_window, "Kalenderwochen");
        with_app(|app| app.preferences_path = Some(path.join("unwritable.json")));
        send_key_combo(&keys_window, [K::Return]);
        assert!(with_app_value(|app| app.state.preferences.week_numbers), "A failed write leaves the live value intact");
        with_app(|app| app.preferences_path = Some(profile.clone()));
        send_key_combo(&keys_window, [K::Return]);
        assert!(!with_app_value(|app| app.state.preferences.week_numbers));
        assert!(!settings::Preferences::load(Some(&profile)).unwrap().week_numbers);
        assert!(bar.get_cal_bands().iter().all(|band| band.week.is_empty()));
        send_key_combo(&keys_window, [K::Return]);
        assert!(with_app_value(|app| app.state.preferences.week_numbers));
        key_with_modifiers(&keys_window, &[K::Control], "f");
        type_text(&keys_window, "Startansicht");
        send_key_combo(&keys_window, [K::Return]);
        send_key_combo(&keys_window, [K::DownArrow]);
        send_key_combo(&keys_window, [K::Return]);
        assert_eq!(with_app_value(|app| app.state.preferences.start_view), settings::StartView::Entry);
        send_key_combo(&keys_window, [K::Return]);
        send_key_combo(&keys_window, [K::UpArrow]);
        send_key_combo(&keys_window, [K::Return]);
        assert_eq!(with_app_value(|app| app.state.preferences.start_view), settings::StartView::Day);

        let first_category_y = settings_theme.get_settings_caption_height() + settings_theme.get_settings_padding()
            + settings_theme.get_settings_search_height() + settings_theme.get_settings_text_gap()
            + settings_theme.get_settings_identity_height() + settings_theme.get_settings_category_gap()
            + settings_theme.get_settings_category_height() / 2.0;
        let category_step = settings_theme.get_settings_category_height() + settings_theme.get_settings_category_gap();
        click(&keys_window, key_position(settings_theme.get_settings_navigation_width() / 2.0, first_category_y + category_step));
        assert_eq!(keys_window.get_categories().row_data(1).unwrap().name, "Tastatur");
        assert_eq!(keys_window.get_category(), 1);
        assert!(keys_window.get_query().is_empty() && keys_window.get_can_go_back());
        send_key_combo(&keys_window, [K::Alt, K::LeftArrow]);
        assert_eq!(keys_window.get_query(), "Startansicht");
        send_key_combo(&keys_window, [K::Alt, K::RightArrow]);
        assert_eq!(keys_window.get_category(), 1);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().heading, "Allgemein");
        assert!(keys_window.get_rows().iter().any(|row| row.heading == "Tagesansicht"));
        capture_window(keys_window.window(), "shortcut-settings");
        click(&keys_window, slint::LogicalPosition::new(
            settings_theme.get_settings_navigation_width() + settings_theme.get_settings_padding() + settings_theme.get_padding() * 2.0,
            settings_theme.get_settings_caption_height() + settings_theme.get_settings_padding() + settings_theme.get_settings_hero_height()
                + settings_theme.get_settings_section_height() + settings_theme.get_settings_row_height() / 2.0,
        ));
        assert!(keys_window.get_recording(), "Clicking the action text records its shortcut.");
        send_key_combo(&keys_window, [K::Escape]);
        assert!(settings_open() && !keys_window.get_recording());
        type_text(&keys_window, "Markdown");
        let rows: Vec<_> = keys_window.get_rows().iter().collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].heading, "Notizblock");
        assert_eq!(rows[0].value, "F8");
        let first_row_y = settings_theme.get_settings_caption_height() + settings_theme.get_settings_padding() + settings_theme.get_settings_section_height()
            + settings_theme.get_settings_row_height() / 2.0;
        let row_right = settings_theme.get_settings_width() - settings_theme.get_settings_padding()
            - settings_theme.get_settings_row_inset();
        let edit_x = row_right - settings_theme.get_settings_key_inset() - settings_theme.get_settings_action_icon_size() / 2.0;
        click(&keys_window, slint::LogicalPosition::new(edit_x, first_row_y));
        assert!(keys_window.get_recording());
        send_key_combo(&keys_window, [K::F9]);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "F9");
        // Tab from the selected row to the search and back before resetting with Delete.
        send_key_combo(&keys_window, [K::Tab]);
        send_key_combo(&keys_window, [K::Tab]);
        send_key_combo(&keys_window, [K::Delete]);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "Strg+M");
        send_key_combo(&keys_window, [K::F1]);
        assert!(!settings_open());
        type_text(&bar, "x");
        assert_eq!(bar.get_search_text().as_str(), "probex", "Closing restores focus to the search field.");
        // The settings from the actions (Strg+K).
        key_with_modifiers(&bar, &[K::Control], "k");
        type_text(&bar, "einst");
        send_key_combo(&bar, [K::Return]);
        assert!(settings_open());
        let keys_window = settings();
        type_text(&keys_window, "Einstellungen öffnen");
        send_key_combo(&keys_window, [K::Return]);
        assert!(keys_window.get_recording());
        send_key_combo(&keys_window, [K::F9]);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "F9");
        send_key_combo(&keys_window, [K::F1]);
        assert!(settings_open());
        send_key_combo(&keys_window, [K::F9]);
        assert!(!settings_open());
        send_key_combo(&bar, [K::F9]);
        let keys_window = settings();
        type_text(&keys_window, "Einstellungen öffnen");
        send_key_combo(&keys_window, [K::Tab]);
        send_key_combo(&keys_window, [K::Delete]);
        assert_eq!(keys_window.get_rows().row_data(0).unwrap().value, "F1");
        send_key_combo(&keys_window, [K::F1]);
        assert!(!settings_open());
        send_key_combo(&bar, [K::Escape]);
        type_text(&bar, "/ein");
        assert_eq!(bar.get_commands().row_data(0).unwrap().name, "/Entry");
        capture(&bar, "commands");
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_entry_open());
        assert_eq!(bar.get_search_text(), "");
        use form::Field as F;
        let value = |field: F| with_app_value(|app| app.state.view().rows.into_iter().find(|row| row.field == field.index()).map(|row| row.value).unwrap_or_default());
        assert_eq!(bar.get_active(), F::Title.index() as i32, "The cursor starts in the title.");
        assert_eq!(bar.get_type_names().row_count(), 4, "Calendar, event, task, note.");
        assert!(bar.get_editable());
        capture(&bar, "form-empty");

        // A bare title: Enter never creates, it goes on to the date.
        type_text(&bar, "Zahnarzt");
        open_footer_menu();
        send_key_combo(&bar, [K::Return]);
        assert!(settings_open());
        send_key_combo(&settings(), [K::Escape]);
        assert!(!settings_open());
        assert_eq!(bar.get_text().as_str(), "Zahnarzt");
        key_with_modifiers(&bar, &[K::Control], "n");
        assert!(bar.get_notepad_open() && !bar.get_entry_open());
        if bar.get_notepad_panel() == 0 { send_key_combo(&bar, [K::Tab]); }
        send_key_combo(&bar, [K::Escape]);
        assert!(bar.get_entry_open() && !bar.get_notepad_open());
        assert_eq!(bar.get_text().as_str(), "Zahnarzt");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Day.index() as i32);
        with_app(|app| assert!({ let layout = app.state.view().calendar.layout; layout.blocks.iter().any(|b| b.fresh) || layout.chips.iter().any(|c| c.fresh) }, "The draft is in the calendar."));

        // When: the date, then the start, then the end, on one line. Tab always goes to the next field.
        type_text(&bar, "morgen");
        assert_eq!(value(F::Day), "Do 19.11.2026 · morgen");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(bar.get_active(), F::Start.index() as i32);
        assert_eq!(bar.get_active_line(), 0, "Still the line of the date (the first under the top line).");
        type_text(&bar, "1430");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(bar.get_active(), F::End.index() as i32);
        // Enter on the end: the clock. ↑ an hour, Strg+↑ four; → the minutes, Strg+↑ a quarter.
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 5);
        assert_eq!((bar.get_clock_hours().as_str(), bar.get_clock_minutes().as_str()), ("15", "30"), "An hour after the start.");
        send_key_combo(&bar, [K::RightArrow]);
        send_key_combo(&bar, [K::Control, K::UpArrow]);
        assert_eq!(bar.get_clock_minutes().as_str(), "45");
        capture(&bar, "clock");
        send_key_combo(&bar, [K::Return]);
        assert_eq!((value(F::End), bar.get_active()), ("15:45".to_string(), F::Repeat.index() as i32), "Enter takes it and goes on.");

        // Type: Alt+2 from any field, or the arrows on the first line.
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
        type_text(&bar, "2");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
        assert_eq!(bar.get_type_selected(), 1);
        for _ in 0..3 { send_key_combo(&bar, [K::UpArrow]); }
        assert_eq!(bar.get_active(), F::Kind.index() as i32);
        assert!(!bar.get_editable());
        send_key_combo(&bar, [K::RightArrow]);
        assert_eq!(bar.get_type_selected(), 2);
        send_key_combo(&bar, [K::LeftArrow]);
        assert_eq!(bar.get_type_selected(), 1);
        capture(&bar, "form-event");

        // The repetition: Enter opens its lines, → takes a rhythm, ↓ goes on to the next line; the calendar follows.
        for _ in 0..3 { send_key_combo(&bar, [K::DownArrow]); }
        assert_eq!(bar.get_active(), F::Repeat.index() as i32);
        assert_eq!(bar.get_panel_kind(), 0, "Closed until Enter.");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 4);
        type_text(&bar, "5");
        send_key_combo(&bar, [K::Backspace]);
        assert_eq!(bar.get_sentence().row_count(), 1, "Backspace on the presets turns repetition off.");
        for _ in 0..3 { send_key_combo(&bar, [K::RightArrow]); }
        assert!(bar.get_sentence().row_count() >= 6, "Weekly: all its lines.");
        for _ in 0..3 { send_key_combo(&bar, [K::DownArrow]); }
        type_text(&bar, "1");
        capture(&bar, "repeat-sentence");
        with_app(|app| assert_eq!(app.state.view().rows.iter().find(|r| r.field == F::Repeat.index()).unwrap().value, "Wöchentlich am Mo, Do"));
        send_key_combo(&bar, [K::DownArrow]);
        type_text(&bar, " ");
        assert!(bar.get_side_open());
        assert_eq!(bar.get_side_heading().as_str(), "Ab");
        capture(&bar, "repeat-date");
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_side_open());
        assert_eq!(bar.get_panel_kind(), 4, "Escape returns from the popup to the repetition.");
        send_key_combo(&bar, [K::DownArrow]);
        send_key_combo(&bar, [K::RightArrow]);
        send_key_combo(&bar, [K::RightArrow]);
        type_text(&bar, " ");
        assert!(bar.get_side_open());
        assert_eq!(bar.get_side_heading().as_str(), "Bis");
        send_key_combo(&bar, [K::Return]);
        assert!(!bar.get_side_open());
        send_key_combo(&bar, [K::Delete]);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Tag.index() as i32);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 1, "The tags in their options.");
        send_key_combo(&bar, [K::DownArrow]);
        assert!(!value(F::Tag).is_empty());
        capture(&bar, "tags");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Reminder.index() as i32, "After the tag the reminder: a new entry always shows it.");
        // Alt+B: the description gets its line.
        let alt = |bar: &Bar, text: &str| {
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Alt).into() });
            type_text(bar, text);
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Alt).into() });
        };
        alt(&bar, "b");
        assert_eq!(bar.get_active(), F::Description.index() as i32, "Alt+B opens the description.");
        type_text(&bar, "Unterlagen mitbringen");
        alt(&bar, "p");
        assert!(bar.get_entry_priority(), "Alt+P sets the flag beside the title.");
        capture(&bar, "form-extras");
        // Reopen the weekly editor with the description shown, as in the reported blank area.
        for _ in 0..2 { send_key_combo(&bar, [K::UpArrow]); }
        assert_eq!(bar.get_active(), F::Repeat.index() as i32);
        send_key_combo(&bar, [K::Return]);
        let theme = bar.global::<Theme>();
        let expanded = bar.get_content_height();
        assert!(expanded >= theme.get_calendar_height());
        let resize_and_check_calendar = |height| {
            let size = slint::LogicalSize::new(theme.get_width(), height);
            bar.window().dispatch_event(slint::platform::WindowEvent::Resized { size });
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            let bands = bar.get_cal_bands();
            // A month heading can cover the bottom while its first day starts below the viewport.
            let last = bands.iter().filter(|band| band.y < height).last().unwrap();
            let layout_height = with_app_value(|app| app.state.metrics.height);
            assert!(last.y < height && last.y + last.h >= height,
                "The last visible band spans {}–{} at viewport height {height} (layout height {layout_height}).", last.y, last.y + last.h);
        };
        resize_and_check_calendar(expanded);
        send_key_combo(&bar, [K::Escape]);
        resize_and_check_calendar(bar.get_content_height());
        for _ in 0..2 { send_key_combo(&bar, [K::DownArrow]); }
        assert_eq!(bar.get_active(), F::Description.index() as i32);
        alt(&bar, "r");
        assert_eq!(bar.get_panel_kind(), 3, "Alt+R: the reminders.");
        alt(&bar, "i");
        assert_eq!(bar.get_panel_kind(), 2, "Alt+I: the icons.");
        type_text(&bar, "stetho");
        assert_eq!(value(F::Icon), "stethoscope");
        capture(&bar, "icons");
        {
            // Holding ↓ in the icons: the repeats move the choice at once, the window draws once they pause.
            for _ in 0..6 { send_key_combo(&bar, [K::Backspace]); }
            let chosen = || bar.get_choices().iter().position(|c| c.selected);
            let before = chosen();
            for _ in 0..3 { bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressRepeated { text: char::from(K::DownArrow).into() }); }
            assert_eq!(chosen(), before, "Not drawn per repeat.");
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(30));
            assert_eq!(chosen(), Some(30), "Drawn once: three lines further down.");
            bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::DownArrow).into() });
            type_text(&bar, "stetho");
        }
        for scale in [1.25, 1.5, 2.0] {
            bar.window().dispatch_event(slint::platform::WindowEvent::ScaleFactorChanged { scale_factor: scale });
            with_app(|app| app.draw());
            assert_eq!(bar.get_choices().row_data(0).unwrap().icon.size().width, (bar.global::<Theme>().get_icon_size() * scale).round() as u32, "Icon masks match the physical display density.");
            capture(&bar, &format!("icons-dpi-{}", (scale * 100.0) as u32));
        }
        bar.window().dispatch_event(slint::platform::WindowEvent::ScaleFactorChanged { scale_factor: 1.0 });
        with_app(|app| app.draw());

        // Creating: Shift+Enter keeps the window and empties the form.
        send_key_combo(&bar, [K::Shift, K::Return]);
        assert!(bar.window().is_visible());
        assert_eq!(bar.get_active(), F::Title.index() as i32);
        assert_eq!(bar.get_text(), "");
        assert_eq!(bar.get_notice(), "Gespeichert");
        assert!(bar.get_cal_bands().row_count() > 0);

        // The calendar: Enter on the date gives it the keyboard; Shift+↓ draws a range of days, live.
        type_text(&bar, "Projekt");
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Day.index() as i32);
        send_key_combo(&bar, [K::Return]);
        assert!(bar.get_cal_focus());
        assert!(bar.get_cal_has_caret());
        send_key_combo(&bar, [K::F3]);
        let first = bar.get_entry_preview_title();
        assert!(!first.is_empty());
        let mut titles = vec![first];
        for _ in 0..20 {
            send_key_combo(&bar, [K::F3]);
            let next = bar.get_entry_preview_title();
            if next == titles[0] { break; }
            assert!(!next.is_empty());
            titles.push(next);
        }
        assert!(titles.iter().any(|title| title == "Recherche") && titles.iter().any(|title| title == "Sport"));
        send_key_combo(&bar, [K::Escape]);
        assert!(bar.get_cal_focus());
        for _ in 0..4 { send_key_combo(&bar, [K::Shift, K::DownArrow]); }
        assert_eq!(value(F::Day), "18.11.2026–22.11.2026", "A range: one entry over several days.");
        capture(&bar, "calendar-range");
        // Tab: into the hours; the caret moves with →.
        send_key_combo(&bar, [K::Tab]);
        send_key_combo(&bar, [K::RightArrow]);
        capture(&bar, "calendar-hours");
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_cal_focus());
        assert_eq!(value(F::Day), "", "Esc without a range leaves the date as it was.");

        // The mouse, as in the app. Left click on a day opens it, a second one closes it again.
        let m = with_app_value(|app| app.state.metrics);
        let row_of = |day: &str| with_app_value(|app| app.state.view().calendar.layout.rows.iter().find(|row| row.date == repeat::d(day)).map(|row| row.y + 2.0).unwrap());
        let x_of = |minutes: f32| m.time_x() + m.time_w() * minutes / 1440.0;
        let calendar_x = bar.get_form_space() + theme.get_border_width();
        let chip = with_app_value(|app| app.state.view().calendar.layout.chips.iter()
            .find(|chip| chip.title == "Recherche" && chip.y > m.head_h).cloned().unwrap());
        hover(calendar_x + chip.x + chip.w / 2.0, chip.y + chip.h / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "Recherche");
        let dentist = bar.get_cal_blocks().iter().find(|block| block.title == "Zahnarzt").unwrap();
        hover(calendar_x + dentist.x + dentist.w / 2.0, dentist.y + dentist.h / 2.0);
        assert_eq!(bar.get_entry_preview_title(), "Zahnarzt");
        assert!(bar.get_entry_preview_description().starts_with("Versichertenkarte"));
        let lane = bar.get_cal_lanes().iter().find(|lane| !lane.fresh && lane.y + lane.h > m.head_h && lane.y < m.height).unwrap();
        hover(calendar_x + lane.x + lane.w / 2.0, (lane.y + 2.0).max(m.head_h + 1.0));
        assert_eq!(bar.get_entry_preview_title(), "Urlaub");
        assert_eq!(bar.get_entry_preview_description(), "");
        capture(&bar, "calendar-entry-preview");
        bar.invoke_cal_mouse(0, 0, 30.0, row_of("2026-11-19"), false);
        with_app(|app| assert!(app.state.opened().contains(&repeat::d("2026-11-19"))));
        bar.invoke_cal_mouse(0, 0, 30.0, row_of("2026-11-19"), false);
        with_app(|app| assert!(!app.state.opened().contains(&repeat::d("2026-11-19"))));
        // Shift+click opens everything in between.
        bar.invoke_cal_mouse(0, 0, 30.0, row_of("2026-11-24"), true);
        with_app(|app| assert!((19..=24).all(|day| app.state.opened().contains(&repeat::d(&format!("2026-11-{day}"))))));
        // A right drag in the hours marks the time, here over midnight into the next day.
        let (from, to) = (row_of("2026-11-20"), row_of("2026-11-22"));
        bar.invoke_cal_mouse(1, 0, x_of(14.0 * 60.0 + 1.0), from, false);
        bar.invoke_cal_mouse(1, 1, x_of(15.75 * 60.0 + 1.0), to, false);
        bar.invoke_cal_mouse(1, 2, x_of(15.75 * 60.0 + 1.0), to, false);
        assert_eq!((value(F::Day), value(F::Start), value(F::End)), ("20.11.2026–22.11.2026".to_string(), "14:00".to_string(), "16:00 (+2 Tage)".to_string()));
        with_app(|app| {
            let view = app.state.view();
            assert_eq!(view.type_selected, 0, "Made in the calendar: an appointment in the calendar, as in the app.");
            assert!(!view.calendar.layout.lanes.iter().any(|lane| lane.fresh), "A range drawn in the hours stays there.");
            assert_eq!(view.calendar.layout.blocks.iter().filter(|block| block.fresh).count(), 3, "All three days are shown in their hour bands.");
        });
        capture(&bar, "calendar-mouse");
        // A right click at the side of a day: the whole day.
        bar.invoke_cal_mouse(1, 0, 30.0, row_of("2026-11-25"), false);
        bar.invoke_cal_mouse(1, 2, 30.0, row_of("2026-11-25"), false);
        assert_eq!((value(F::Day), value(F::Start)), ("Mi 25.11.2026".to_string(), String::new()));
        // A left click opens the existing entry after the current draft is closed.
        let block = with_app_value(|app| app.state.view().calendar.layout.blocks.iter().find(|b| !b.fresh && b.y > m.head_h).cloned().unwrap());
        bar.invoke_cal_mouse(0, 0, block.x + 2.0, block.y + 2.0, false);
        with_app(|app| assert!(!app.state.editing_entry(), "The open draft is kept."));
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_entry_open());
        let block = with_app_value(|app| app.state.view().calendar.layout.blocks.iter().find(|b| !b.fresh && b.y > m.head_h).cloned().unwrap());
        bar.invoke_cal_mouse(0, 0, block.x + 2.0, block.y + 2.0, false);
        with_app(|app| assert!(app.state.editing_entry(), "Clicking a stored block opens it for editing."));
        send_key_combo(&bar, [K::Escape]);
        assert!(!bar.get_entry_open());
        bar.invoke_cal_mouse(1, 0, 30.0, row_of("2026-11-26"), false);
        bar.invoke_cal_mouse(1, 2, 30.0, row_of("2026-11-26"), false);
        assert!(bar.get_entry_open());
        assert_eq!(bar.get_active(), F::Title.index() as i32, "The title is what is still missing.");
        capture(&bar, "calendar-opens-entry");
        // The wheel: Strg makes the days taller, Strg+Shift zooms the hours, Shift moves them.
        let tall = with_app_value(|app| app.state.view().calendar.layout.rows[1].h);
        bar.invoke_cal_wheel(300.0, 240.0, true, false);
        with_app(|app| assert!(app.state.view().calendar.layout.rows[1].h > tall));
        bar.invoke_cal_wheel(m.time_x() + m.time_w() / 2.0, 700.0, true, true);
        assert!(bar.get_cal_ticks().row_count() >= 4);
        with_app(|app| assert!(app.state.metrics_now().zoom > 3.0));
        let first = bar.get_cal_ticks().row_data(0).unwrap().label;
        bar.invoke_cal_wheel(300.0, -240.0, false, true);
        assert_ne!(bar.get_cal_ticks().row_data(0).unwrap().label, first, "The hours moved sideways.");
        capture(&bar, "calendar-zoomed");
        // And it goes on for ever.
        for _ in 0..200 { bar.invoke_cal_wheel(300.0, -400.0, false, false); }
        with_app(|app| assert!(app.state.view().calendar.layout.first.unwrap() > repeat::d("2028-01-01")));
        APP.with(|slot| *slot.borrow_mut() = None);

        // Render the reported regressions without journal data: selected date text, icon-only narrow events,
        // and a month boundary crossing both an hour line and a multiday lane.
        let visual = Bar::new().unwrap();
        let theme = visual.global::<Theme>();
        visual.set_entry_open(true);
        visual.set_line_count(3);
        visual.set_active(F::Day.index() as i32);
        visual.set_active_line(2);
        visual.set_active_multi(true);
        visual.set_editable(true);
        visual.set_text("19.11.2026".into());
        visual.set_longest_label("Wiederholung".into());
        let icon = icon_image("guitar", theme.get_cal_icon_size(), 1.0);
        visual.set_cal_blocks(std::rc::Rc::new(slint::VecModel::from(vec![
            CalBlock { x: 300.0, y: 100.0, w: 22.0, h: 22.0, color: theme.get_accent(), has_icon: true, icon: icon.clone(), ..Default::default() },
            CalBlock { x: 345.0, y: 100.0, w: 19.0, h: 22.0, color: theme.get_accent(), has_icon: true, icon: icon.clone(), ..Default::default() },
            CalBlock { x: 390.0, y: 100.0, w: 22.0, h: 10.0, color: theme.get_accent(), has_icon: true, icon, ..Default::default() },
            CalBlock { x: 500.0, y: 100.0, w: 140.0, h: 32.0, color: theme.get_accent(), point: true, marker: 2.0, title: "Zeitpunkt".into(), text: 1, ..Default::default() },
            CalBlock { x: 500.0, y: 220.0, w: 140.0, h: 32.0, color: theme.get_accent(), point: true, caption_at_top: true, marker: 2.0, title: "Oben".into(), text: 1, has_icon: true, icon: icon_image("guitar", theme.get_cal_icon_size(), 1.0), ..Default::default() },
            // Important: the strong yellow edge instead of the tag's colour; beside it a tag of the now line's colour.
            CalBlock { x: 680.0, y: 90.0, w: 120.0, h: 40.0, color: theme.get_accent(), priority: true, title: "Wichtig".into(), text: 1, ..Default::default() },
            CalBlock { x: 680.0, y: 200.0, w: 120.0, h: 40.0, color: theme.get_cal_now(), title: "Rot".into(), text: 1, ..Default::default() },
        ])).into());
        visual.set_cal_chips(std::rc::Rc::new(slint::VecModel::from(vec![
            CalChip { x: 820.0, y: 100.0, w: 120.0, h: 22.0, color: theme.get_accent(), priority: true, title: "Ganztägig".into(), ..Default::default() },
            CalChip { x: 960.0, y: 105.0, w: 8.0, h: 8.0, color: theme.get_accent(), priority: true, dot: true, ..Default::default() },
        ])).into());
        // The time now over a block of its own colour: its rim and the arrow on top keep it in sight.
        visual.set_cal_has_now(true);
        visual.set_cal_now_x(740.0);
        visual.set_cal_now_y(190.0);
        visual.set_cal_now_h(60.0);
        visual.set_cal_bands(std::rc::Rc::new(slint::VecModel::from(vec![
            CalBand { y: 160.0, h: theme.get_cal_month_height(), kind: 1, label: "Januar 2027".into(), ..Default::default() },
        ])).into());
        visual.set_cal_lanes(std::rc::Rc::new(slint::VecModel::from(vec![
            CalLane { x: 0.0, y: 140.0, w: 18.0, h: 80.0, color: theme.get_accent(), ..Default::default() },
        ])).into());
        visual.set_cal_ticks(std::rc::Rc::new(slint::VecModel::from(vec![
            CalTick { x: 200.0, label: "06:00".into(), strong: true },
        ])).into());
        visual.show().unwrap();
        visual.window().set_size(slint::LogicalSize::new(theme.get_width(), theme.get_calendar_height()));
        visual.invoke_focus_entry();
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
        capture(&visual, "readability-regressions");
        let pixels = visual.window().take_snapshot().unwrap();
        let width = pixels.width() as usize;
        let pixel = |x: usize, y: usize| pixels.as_slice()[y * width + x];
        let mark = theme.get_cal_priority();
        assert!(pixels.as_slice().iter().any(|p| (p.r, p.g, p.b) == (mark.red(), mark.green(), mark.blue())), "An important entry's edge in the calendar's yellow.");
        // The shared window frame must also clip the calendar header and the last day.
        let bottom = pixels.height() as usize - 1;
        // The outline is a light veil over the surface.
        let (frame, surface) = (theme.get_border(), theme.get_background());
        let veil = |over: u8, under: u8| (under as f32 + (over as f32 - under as f32) * frame.alpha() as f32 / 255.0).round() as i32;
        let expected = (veil(frame.red(), surface.red()), veil(frame.green(), surface.green()), veil(frame.blue(), surface.blue()));
        let inset = theme.get_frame_inset() as usize;
        for (x, y) in [(32, inset), (width - 33, inset), (width - 1 - inset, bottom / 2), (width - 33, bottom - inset), (inset, bottom / 2)] {
            let p = pixel(x, y);
            let near = (p.r as i32 - expected.0).abs() <= 2 && (p.g as i32 - expected.1).abs() <= 2 && (p.b as i32 - expected.2).abs() <= 2;
            assert!(near, "Visible frame at ({x}, {y}): {:?} instead of {expected:?}", (p.r, p.g, p.b));
        }
        for y in [0, 2, bottom - 2, bottom] {
            for x in 0..theme.get_radius() as usize {
                assert_eq!(pixel(x, y).a, pixel(width - 1 - x, y).a, "Corner coverage at ({x}, {y})");
            }
        }
        // Follow the stroke around each bend, including the diagonal pixels
        // that a binary Windows region used to cut through.
        let radius = theme.get_radius();
        let midline = radius - theme.get_frame_inset() - theme.get_frame_stroke() / 2.0;
        for degrees in 0..=90 {
            let angle = (degrees as f32).to_radians();
            let x = (radius - midline * angle.cos()).floor() as usize;
            let y = (radius - midline * angle.sin()).floor() as usize;
            for (cx, cy) in [(x, y), (width-1-x, y), (x, bottom-y), (width-1-x, bottom-y)] {
                let p = pixel(cx, cy);
                assert!(p.a == 255 && p.r > theme.get_background().red(), "Interrupted frame at ({cx}, {cy})");
            }
        }
        let count = |x: usize, y: usize, w: usize, h: usize, predicate: fn(slint::Rgba8Pixel) -> bool| {
            (y..y + h).flat_map(|y| (x..x + w).map(move |x| pixel(x, y))).filter(|p| predicate(*p)).count()
        };
        let text_x = (theme.get_padding() + visual.get_label_width() + theme.get_field_inset()) as usize;
        let text_y = (theme.get_line_height() + theme.get_border_width() + theme.get_form_row_height() * 2.0 + theme.get_field_vpad() + 3.0) as usize;
        assert!(count(text_x, text_y, 90, 19, |p| p.r > 170 && p.g > 170 && p.b > 170) > 30, "Selected date text is light on its blue background.");
        let calendar_x = (theme.get_form_width() + theme.get_border_width()) as usize;
        assert!(count(calendar_x + 306, 105, 12, 12, |p| p.b > 160 && p.g > 90) > 5, "An icon fits a narrow event even when its title does not.");
        assert_eq!(count(calendar_x + 351, 105, 12, 12, |p| p.b > 160 && p.g > 90), 0, "A too narrow event does not spill its icon.");
        assert_eq!(count(calendar_x + 396, 100, 12, 12, |p| p.b > 160 && p.g > 90), 0, "A too flat event does not spill its icon.");
        let marker = pixel(calendar_x + 502, 108);
        let accent = theme.get_accent();
        assert_eq!((marker.r,marker.g,marker.b),(accent.red(),accent.green(),accent.blue()), "A point has a strong exact-time stroke.");
        // Empty: the surface; filled: tinted by the event's colour.
        let ground = theme.get_background().blue();
        let filled = |p: slint::Rgba8Pixel| p.b > ground.saturating_add(20);
        assert_eq!(pixel(calendar_x + 530,105).b,ground,"The caption does not fill the entire height like a time interval.");
        assert!(filled(pixel(calendar_x + 630,128)),"The point's caption is a narrow bar at the bottom of the stroke.");
        assert!(filled(pixel(calendar_x + 638,117)),"The caption ends have small corners instead of a pill-shaped cap.");
        assert!(filled(pixel(calendar_x + 630,225)),"An upper caption is attached to the top of the time marker.");
        assert_eq!(pixel(calendar_x + 530,245).b,ground,"An upper caption leaves the bottom of the marker clear.");
        assert!(count(calendar_x + 510,222,12,12, |p| p.b>160 && p.g>90)>5,"The icon follows the caption to the top of the marker.");
        let line = theme.get_cal_month_line();
        let at_line = pixel(calendar_x + 200, 160);
        assert_eq!((at_line.r, at_line.g, at_line.b), (line.red(), line.green(), line.blue()), "The month line is visible over the hour grid.");
        let head = theme.get_cal_month_head();
        let at_lane = pixel(calendar_x + 8, 170);
        assert_eq!((at_lane.r, at_lane.g, at_lane.b), (head.red(), head.green(), head.blue()), "The month heading is visible over multiday lanes.");
        visual.hide().unwrap();
        if std::env::var_os("J_TERMINAL_UI_CAPTURE").is_some() {
            // A closed, checkpointed fixture for native visual and memory checks with --data, never the real vault.
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ui-check/native-test");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::copy(&path, dir.join("journal.sqlite3")).unwrap();
        }
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
        std::fs::remove_file(profile).unwrap();
    }
}
