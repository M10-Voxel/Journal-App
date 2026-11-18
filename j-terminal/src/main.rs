//! J-TerminaL waits in the background for `Strg+Alt+Leertaste` and then shows the entry form for the journal.
//! The window is made hidden at start, so the shortcut only has to show it (docs/plan.md, section 3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod autostart;
mod calendar;
mod form;
mod icons;
mod repeat_sentence;
mod save;
mod snapshot;
mod instance;
mod journal;
mod placement;
mod engine;
mod repeat;
mod texts;
mod turned;

use std::{cell::RefCell, path::PathBuf, time::Duration};
use global_hotkey::{hotkey::{Code, HotKey, Modifiers}, GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use slint::{winit_030::{winit::event::WindowEvent, EventResult, WinitWindowAccessor}, ComponentHandle};

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
struct App {
    bar: Bar,
    state: form::Form,
    notice: Option<String>,
    hide_timer: slint::Timer,
    /// Dropping it would unregister the shortcut.
    _hotkeys: Option<GlobalHotKeyManager>,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
    /// How often the program was told to quit (tests: a key must not do it by accident).
    static QUITS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

fn with_bar(f: impl FnOnce(&Bar)) {
    APP.with(|app| if let Some(app) = app.borrow().as_ref() { f(&app.bar) });
}

fn with_app(f: impl FnOnce(&mut App)) {
    APP.with(|app| if let Some(app) = app.borrow_mut().as_mut() { f(app) });
}

#[cfg(test)]
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
fn icon_image(name: &str, size: f32, scale: f32) -> slint::Image {
    if name.is_empty() { return slint::Image::default(); }
    let px = (size * scale).round().max(1.0) as u32;
    ICONS.with(|cache| {
        if let Some(found) = cache.borrow().get(&(name.to_string(), px)) { return found.clone(); }
        let image = icons::draw(name, px).map(|drawn| {
            let mut pixels = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(drawn.size, drawn.size);
            for (pixel, alpha) in pixels.make_mut_slice().iter_mut().zip(drawn.alpha) { *pixel = slint::Rgba8Pixel { r: 255, g: 255, b: 255, a: alpha }; }
            slint::Image::from_rgba8(pixels)
        }).unwrap_or_default();
        let mut cache = cache.borrow_mut();
        if cache.len() > 400 { cache.clear(); }
        cache.insert((name.to_string(), px), image.clone());
        image
    })
}

fn strings(items: impl IntoIterator<Item = String>) -> slint::ModelRc<slint::SharedString> {
    std::rc::Rc::new(slint::VecModel::from(items.into_iter().map(slint::SharedString::from).collect::<Vec<_>>())).into()
}

impl App {
    fn draw(&mut self) {
        let view = self.state.view();
        let ft = texts::form_texts(self.state.language);
        let theme = self.bar.global::<Theme>();
        let plain = theme.get_cal_stroke();
        let color = |rgb: Option<calendar::Rgb>| rgb.map_or(plain, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b));
        let scale = self.bar.window().scale_factor();
        let icon_px = theme.get_icon_size();
        let label_px = theme.get_label_icon_size();
        self.bar.set_more_open(view.rows.iter().any(|row| row.field > form::Field::More.index()));
        self.bar.set_search_icon(icon_image("search", theme.get_search_icon_size(), scale));
        self.bar.set_command_icon(icon_image("square-pen", label_px, scale));
        self.bar.set_line_count(view.rows.iter().map(|row| row.line + 1).max().unwrap_or(1) as i32);
        self.bar.set_rows(std::rc::Rc::new(slint::VecModel::from(view.rows.into_iter().map(|row| FormRow {
            field: row.field as i32, line: row.line as i32, cell: row.cell as i32, multi: row.multi,
            label: row.label.into(), has_label_icon: !row.label_icon.is_empty(), label_icon: icon_image(row.label_icon, label_px, scale), value: row.value.into(), hint: row.hint.into(), filled: row.filled, error: row.error,
            has_color: row.color.is_some(), color: color(row.color), has_icon: !row.icon.is_empty(), icon: icon_image(&row.icon, icon_px, scale),
        }).collect::<Vec<_>>())).into());
        self.bar.set_active(view.active as i32);
        self.bar.set_active_line(view.active_line as i32);
        self.bar.set_active_cell(view.active_cell as i32);
        self.bar.set_active_multi(view.active_multi);
        self.bar.set_editable(view.editable);
        self.bar.set_native_arrows(view.native_arrows);
        self.bar.set_type_names(strings(view.type_names));
        self.bar.set_type_icons(std::rc::Rc::new(slint::VecModel::from(view.type_icons.iter().map(|name| icon_image(name, label_px, scale)).collect::<Vec<_>>())).into());
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
                label: line.label.into(), has_icon: !line.icon.is_empty(), icon: icon_image(line.icon, label_px, scale),
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
        self.bar.set_panel_icon(icon_image(icon, label_px, scale));
        self.bar.set_panel_kind(kind);
        self.bar.set_choices(std::rc::Rc::new(slint::VecModel::from(rows)).into());
        self.bar.set_sentence(std::rc::Rc::new(slint::VecModel::from(sentence)).into());
        self.bar.set_panel_note(view.panel_note.into());
        self.bar.set_panel_hint(view.panel_hint.into());
        self.bar.set_hint_rows(ft.hint_rows.into());
        self.bar.set_hint_pick(ft.hint_pick.into());
        self.bar.set_hint_save(ft.hint_save.into());
        self.bar.set_hint_undo(ft.hint_undo.into());
        self.bar.set_hint_calendar(ft.hint_calendar.into());
        self.draw_calendar(view.calendar);
        self.bar.set_entry_open(view.entry_open);
        self.bar.set_search_placeholder(view.search_placeholder.into());
        self.bar.set_command_selected(view.command_selected as i32);
        self.bar.set_commands(std::rc::Rc::new(slint::VecModel::from(view.commands.into_iter().map(|c| CommandRow { name: c.name.into(), detail: c.detail.into() }).collect::<Vec<_>>())).into());
        let status = view.status.or_else(|| self.notice.clone().map(|notice| (notice, true)));
        self.bar.set_notice_is_error(status.as_ref().is_some_and(|(_, error)| *error));
        self.bar.set_notice(status.map_or_else(String::new, |(text, _)| text).into());
    }

    fn draw_calendar(&self, calendar: form::CalendarView) {
        let theme = self.bar.global::<Theme>();
        let plain = theme.get_cal_stroke();
        let color = |rgb: Option<calendar::Rgb>| rgb.map_or(plain, |[r, g, b]| slint::Color::from_rgb_u8(r, g, b));
        let (layout, m) = (calendar.layout, calendar.metrics);
        let scale = self.bar.window().scale_factor();
        let icon_size = theme.get_cal_icon_size();
        self.bar.set_cal_icon(icon_image("calendar", icon_size, scale));
        self.bar.set_cal_focus(calendar.focus);
        self.bar.set_cal_time_x(m.time_x());
        self.bar.set_cal_title(layout.title.into());
        self.bar.set_cal_has_now(layout.now.is_some());
        self.bar.set_cal_has_caret(layout.caret.is_some());
        if let Some((x, y, w, h)) = layout.caret { self.bar.set_cal_caret_x(x); self.bar.set_cal_caret_y(y); self.bar.set_cal_caret_w(w); self.bar.set_cal_caret_h(h); }
        if let Some((x, y, h)) = layout.now { self.bar.set_cal_now_x(x); self.bar.set_cal_now_y(y); self.bar.set_cal_now_h(h); }
        self.bar.set_cal_ticks(std::rc::Rc::new(slint::VecModel::from(layout.ticks.into_iter().map(|tick| CalTick { x: tick.x, label: tick.label.into(), strong: tick.strong }).collect::<Vec<_>>())).into());
        self.bar.set_cal_bands(std::rc::Rc::new(slint::VecModel::from(layout.bands.into_iter().map(|band| CalBand {
            y: band.y, h: band.h, kind: match band.kind { calendar::BandKind::Day => 0, calendar::BandKind::Month => 1 },
            label: band.label.into(), week: band.week.into(), week_start: band.week_start, tint: band.tint, weekend: band.weekend, sunday: chrono::Datelike::weekday(&band.date) == chrono::Weekday::Sun, today: band.today, selected: band.selected, cursor: band.cursor, open: band.open,
        }).collect::<Vec<_>>())).into());
        self.bar.set_cal_blocks(std::rc::Rc::new(slint::VecModel::from(layout.blocks.into_iter().map(|block| CalBlock {
            x: block.x, y: block.y, w: block.w, h: block.h, title: block.title.into(), time: block.time.into(), color: color(block.color),
            fresh: block.fresh, done: block.done, cut: block.cut, point: block.point, caption_at_top: block.caption_at_top, marker: block.marker, text: block.text as i32,
            has_icon: !block.icon.is_empty(), icon: icon_image(&block.icon, icon_size, scale),
        }).collect::<Vec<_>>())).into());
        self.bar.set_cal_chips(std::rc::Rc::new(slint::VecModel::from(layout.chips.into_iter().map(|chip| CalChip {
            x: chip.x, y: chip.y, w: chip.w, h: chip.h, title: chip.title.into(), color: color(chip.color), fresh: chip.fresh, done: chip.done, dot: chip.dot,
            has_icon: !chip.icon.is_empty(), icon: icon_image(&chip.icon, icon_size, scale),
        }).collect::<Vec<_>>())).into());
        let (size, top, scale) = (theme.get_cal_lane_text_size(), theme.get_cal_lane_text_top(), self.bar.window().scale_factor());
        self.bar.set_cal_lanes(std::rc::Rc::new(slint::VecModel::from(layout.lanes.into_iter().map(|lane| {
            let icon_space = if lane.icon.is_empty() { 0.0 } else { icon_size + theme.get_calendar_gap() };
            let (title, w, h) = lane_title(&lane.title, size, lane.h - top * 2.0 - icon_space, scale);
            CalLane { x: lane.x, y: lane.y, w: lane.w, h: lane.h, color: color(lane.color), fresh: lane.fresh, done: lane.done, title, title_w: w, title_h: h,
                has_icon: !lane.icon.is_empty(), icon: icon_image(&lane.icon, icon_size, scale) }
        }).collect::<Vec<_>>())).into());
    }

    fn effect(&mut self, effect: form::Effect) {
        if let Some(text) = effect.text {
            self.bar.set_text(text.into());
            self.bar.invoke_select_text();
        }
        if let Some(text) = effect.search { self.bar.set_search_text(text.into()); }
        self.draw();
        match effect.focus {
            // After drawing: the form must be open before its input can take the keyboard.
            Some(form::Pane::Entry) => self.bar.invoke_focus_entry(),
            Some(form::Pane::Search) => self.bar.invoke_focus_search(),
            None => {}
        }
        if effect.hide { let _ = self.bar.hide(); }
        if effect.hide_soon {
            self.hide_timer.start(slint::TimerMode::SingleShot, Duration::from_millis(450), || with_bar(|bar| { let _ = bar.hide(); }));
        }
        if effect.quit {
            QUITS.with(|quits| quits.set(quits.get() + 1));
            let _ = slint::quit_event_loop();
        }
    }
}

/// The calendar's sizes as the theme has them.
fn metrics(bar: &Bar) -> calendar::Metrics {
    let theme = bar.global::<Theme>();
    calendar::Metrics {
        width: theme.get_calendar_width(), height: theme.get_calendar_height(), pad: theme.get_cal_pad(), head_h: theme.get_cal_head_height(),
        lanes: theme.get_cal_lanes() as usize, lane_w: theme.get_cal_lane_width(), label_w: theme.get_cal_label_width(),
        day_h: theme.get_cal_day_height(), thin_h: theme.get_cal_thin_height(), row_h: theme.get_cal_row_height(), month_h: theme.get_cal_month_height(),
        date_h: theme.get_cal_date_height(), chip_h: theme.get_cal_chip_height(), dot: theme.get_cal_dot(), point_w: theme.get_cal_point_width(), point_line_w: theme.get_cal_point_line_width(), zoom: 1.0, pan: 0.0,
    }
}

fn present(bar: &Bar) {
    // Defer access to APP: present can itself be called while with_bar borrows it.
    slint::Timer::single_shot(Duration::ZERO, || with_app(|app| {
        app.hide_timer.stop();
        let effect = app.state.shown();
        app.effect(effect);
    }));
    if let Err(e) = bar.show() { eprintln!("J-TerminaL: Fenster: {e}"); return; }
    place_and_focus(bar, 50);
}

/// The native window exists once the event loop has made it; while waiting in the background it already does. Only
/// right after a direct start it may still be missing, so this tries again a few milliseconds later.
fn place_and_focus(bar: &Bar, tries: u32) {
    let width = bar.global::<Theme>().get_width();
    let placed = bar.window().with_winit_window(|window| {
        let screens: Vec<placement::Screen> = window.available_monitors().map(|monitor| {
            let (position, size) = (monitor.position(), monitor.size());
            placement::Screen { left: position.x, top: position.y, width: size.width as i32, height: size.height as i32, scale: monitor.scale_factor() }
        }).collect();
        if let Some(screen) = placement::pick(&screens, placement::mouse()) {
            let (x, y) = placement::top_center(screen, width);
            window.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(x, y));
        }
        window.focus_window();
    });
    if placed.is_some() {
        bar.invoke_focus_line();
    } else if tries > 0 {
        slint::Timer::single_shot(std::time::Duration::from_millis(5), move || with_bar(|bar| place_and_focus(bar, tries - 1)));
    }
}

fn toggle(bar: &Bar) {
    if bar.window().is_visible() { let _ = bar.hide(); } else { present(bar); }
}

fn connect(bar: &Bar) {
    bar.on_cal_mouse(|button, kind, x, y, shift| with_app(|app| {
        // Moving without a button only matters while marking.
        if kind == 1 && !app.state.marking() { return; }
        let effect = app.state.cal_mouse(button, kind, x, y, shift);
        app.effect(effect);
    }));
    bar.on_cal_wheel(|x, delta, ctrl, shift| with_app(|app| { app.state.cal_wheel(x, delta, ctrl, shift); app.draw(); }));
    bar.on_search_edited(|text| with_app(|app| { app.state.search_edited(&text); app.draw(); }));
    bar.on_choice_clicked(|index| with_app(|app| { let effect = app.state.choice_click(index.max(0) as usize); app.effect(effect); }));
    bar.on_sentence_clicked(|slot, value| with_app(|app| { app.state.repeat_click(slot, value); app.draw(); }));
    bar.on_edited(|text| with_app(|app| {
        app.hide_timer.stop();
        app.state.edited(&text);
        app.draw();
    }));
    bar.on_form_key(|code, mods| with_app(|app| {
        use form::Key;
        let key = match code {
            0 => Key::Tab, 1 => Key::Up, 2 => Key::Down, 3 => Key::Enter, 4 => Key::Escape, 5 => Key::Left, 6 => Key::Right, 7 => Key::PageUp, 8 => Key::PageDown,
            9 => Key::Home, 10 => Key::Space, 11 => Key::Insert, 12 => Key::Delete, 15 => Key::Focus, 50 => Key::Undo, 51 => Key::Redo, 52 => Key::Quit,
            digit if (20..=29).contains(&digit) => Key::Digit((digit - 20) as u8), _ => return,
        };
        app.hide_timer.stop();
        let effect = app.state.key(key, form::Mods { shift: mods & 1 != 0, ctrl: mods & 2 != 0, alt: mods & 4 != 0 });
        app.effect(effect);
    }));
}

fn main() {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(e) => { eprintln!("J-TerminaL: {e}"); std::process::exit(2); }
    };

    // Before anything else: a second start only wakes the first.
    let start = instance::claim(instance::NAME, |instance::Message::Show| {
        let _ = slint::invoke_from_event_loop(|| with_bar(present));
    });
    match start {
        Ok(instance::Start::Another) => return,
        Ok(instance::Start::First) => {}
        // Without the lock it still works, only a second start is not caught.
        Err(e) => eprintln!("J-TerminaL: Instanz: {e}"),
    }

    // Not in the taskbar; a frameless tool window.
    let selected = slint::BackendSelector::new()
        .backend_name("winit".into())
        .renderer_name("software".into())
        .with_winit_window_attributes_hook(|attributes| {
            #[cfg(windows)]
            let attributes = {
                use slint::winit_030::winit::platform::windows::WindowAttributesExtWindows;
                attributes.with_skip_taskbar(true)
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
    let language = match &opened {
        Ok(journal) => texts::Language::from_setting(&journal.store.interface_language().unwrap_or_default()),
        Err(_) => texts::Language::De,
    };
    let t = texts::texts(language);
    let mut notice = match &opened {
        Ok(_) => None,
        Err(journal::Problem::NoVault) => Some(t.no_vault.to_string()),
        Err(journal::Problem::Unreachable(path)) => Some(format!("{} {}", t.unreachable, path.display())),
        Err(journal::Problem::TooNew) => Some(t.too_new.to_string()),
        Err(journal::Problem::Failed(e)) => Some(format!("{} {e}", t.open_failed)),
    };

    let bar = match Bar::new() {
        Ok(bar) => bar,
        Err(e) => { eprintln!("J-TerminaL: Fenster: {e}"); std::process::exit(1); }
    };

    let hotkey = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let hotkeys = GlobalHotKeyManager::new().map_err(|e| e.to_string())
        .and_then(|manager| manager.register(hotkey).map(|()| manager).map_err(|e| e.to_string()));
    let hotkeys = match hotkeys {
        Ok(manager) => Some(manager),
        Err(e) => { notice.get_or_insert_with(|| format!("{} {e}", t.hotkey_failed)); None }
    };
    let id = hotkey.id();
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.id == id && event.state == HotKeyState::Pressed {
            let _ = slint::invoke_from_event_loop(|| with_bar(toggle));
        }
    }));

    connect(&bar);
    // Gone as soon as another window has the focus; what was typed stays for the next time.
    bar.window().on_winit_window_event(|_, event| {
        if matches!(event, WindowEvent::Focused(false)) {
            slint::Timer::single_shot(std::time::Duration::ZERO, || with_bar(|bar| { let _ = bar.hide(); }));
        }
        if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
            // Redraw masks after Slint has adopted the monitor's new physical pixel density.
            slint::Timer::single_shot(Duration::ZERO, || with_app(|app| app.draw()));
        }
        EventResult::Propagate
    });

    let show_now = !args.background;
    let mut state = form::Form::new(opened.ok(), language);
    state.metrics = metrics(&bar);
    APP.with(|app| *app.borrow_mut() = Some(App { bar, state, notice,
        hide_timer: slint::Timer::default(), _hotkeys: hotkeys }));
    with_app(|app| app.draw());
    if show_now { with_bar(present); }
    if let Err(e) = slint::run_event_loop_until_quit() { eprintln!("J-TerminaL: {e}"); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Args, String> { parse_args(args.iter().map(|arg| arg.to_string())) }

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
        fn send_key_combo(bar: &Bar, keys: impl IntoIterator<Item = slint::platform::Key>) {
            let keys: Vec<slint::SharedString> = keys.into_iter().map(|key| char::from(key).into()).collect();
            for text in &keys { bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: text.clone() }); }
            for text in keys.into_iter().rev() { bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text }); }
        }
        fn type_text(bar: &Bar, text: &str) {
            for c in text.chars() {
                bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: c.into() });
                bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: c.into() });
            }
        }
        use slint::platform::Key as K;
        slint::platform::set_platform(Box::new(TestingBackend::new(TestingBackendOptions { mock_time: true, threading: false, renderer_name: Some("software".into()), ..Default::default() }))).unwrap();
        fn capture(bar: &Bar, name: &str) {
            if std::env::var_os("J_TERMINAL_UI_CAPTURE").is_none() { return; }
            i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            let width = bar.global::<Theme>().get_width();
            for _ in 0..2 {
                // TestingBackend::set_size assumes scale 1; supply the physical buffer size and its logical resize.
                let logical = slint::LogicalSize::new(width, bar.get_content_height());
                let scale = bar.window().scale_factor();
                bar.window().set_size(slint::PhysicalSize::new((logical.width * scale).round() as u32, (logical.height * scale).round() as u32));
                bar.window().dispatch_event(slint::platform::WindowEvent::Resized { size: logical });
                i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(1));
            }
            let pixels = bar.window().take_snapshot().unwrap();
            let mut bytes = format!("P6\n{} {}\n255\n", pixels.width(), pixels.height()).into_bytes();
            for pixel in pixels.as_slice() { bytes.extend_from_slice(&[pixel.r, pixel.g, pixel.b]); }
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ui-check");
            std::fs::create_dir_all(&dir).unwrap(); std::fs::write(dir.join(format!("{name}.ppm")), bytes).unwrap();
        }
        let path = std::env::temp_dir().join(format!("j-terminal-ui-{}.sqlite3", uuid::Uuid::new_v4()));
        let mut store = journal_core::storage::Store::open(&path).unwrap();
        // Something to look at: two coloured tags, an appointment, a holiday and a weekly series.
        {
            let tags = [("3f2a6c1e-0000-4000-8000-000000000001", "Gesundheit", "#76d982"), ("3f2a6c1e-0000-4000-8000-000000000002", "Arbeit", "#569eff"), ("3f2a6c1e-0000-4000-8000-000000000003", "Reise", "#ff9f43")];
            store.save_tags(&tags.iter().map(|(id, name, color)| journal_core::storage::Tag { id: id.to_string(), name: name.to_string(), color: color.to_string(), icon: Some(match *name { "Gesundheit" => "stethoscope", "Arbeit" => "briefcase", _ => "plane" }.into()) }).collect::<Vec<_>>()).unwrap();
            let names: Vec<engine::parse::TagName> = tags.iter().map(|(id, name, _)| engine::parse::TagName { id: id.to_string(), name: name.to_string() }).collect();
            let today = repeat::d("2026-11-18");
            for line in ["Zahnarzt Do 14–15 \\Gesundheit", "Urlaub ▬ 23.11.2026–27.11.2026 \\Reise", "Team Mo 9–10 jede Woche \\Arbeit", "Workshop 30.11.2026 10–17 \\Arbeit", "Sport heute 18–19", "Recherche heute \\Arbeit"] {
                let outcome = engine::resolve::resolve(&engine::parse::parse(line, today, &names), today).choices.remove(0);
                save::save(&mut store, &outcome, today).unwrap();
            }
        }
        let journal = journal::Journal { vault: path.parent().unwrap().into(), store };
        let bar = Bar::new().unwrap();
        connect(&bar);
        let mut state = form::Form::at(Some(journal), texts::Language::De, repeat::d("2026-11-18"), 800);
        state.metrics = metrics(&bar);
        APP.with(|slot| *slot.borrow_mut() = Some(App { bar: bar.clone_strong(), state, notice: None, hide_timer: slint::Timer::default(), _hotkeys: None }));
        bar.show().unwrap();
        with_app(|app| { let effect = app.state.shown(); app.effect(effect); });
        bar.invoke_focus_line();
        // At first only the search bar: `/Entry` opens the form.
        assert!(!bar.get_entry_open());
        capture(&bar, "search");
        // Holding Strg shows the hints and must not take the window down.
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Control).into() });
        capture(&bar, "search-hints");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Control).into() });
        // Strg alone, also inside the shortcut Strg+Alt+Leertaste, must not quit (its key code is a control character).
        send_key_combo(&bar, [K::Control, K::Alt]);
        type_text(&bar, " ");
        with_app(|app| app.state.edited(""));
        assert_eq!(QUITS.with(|quits| quits.get()), 0);
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
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Day.index() as i32);
        with_app(|app| assert!({ let layout = app.state.view().calendar.layout; layout.blocks.iter().any(|b| b.fresh) || layout.chips.iter().any(|c| c.fresh) }, "The draft is in the calendar."));

        // When: the date, then the start, then the end, on one line. Tab always goes to the next field.
        type_text(&bar, "morgen");
        assert_eq!(value(F::Day), "Do 19.11.2026 · morgen");
        send_key_combo(&bar, [K::Tab]);
        assert_eq!(bar.get_active(), F::Start.index() as i32);
        assert_eq!(bar.get_active_line(), 2, "Still the line of the date.");
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
        for _ in 0..3 { send_key_combo(&bar, [K::RightArrow]); }
        assert!(bar.get_sentence().row_count() >= 6, "Weekly: all its lines.");
        for _ in 0..4 { send_key_combo(&bar, [K::DownArrow]); }
        type_text(&bar, "1");
        capture(&bar, "repeat-sentence");
        with_app(|app| assert_eq!(app.state.view().rows.iter().find(|r| r.field == F::Repeat.index()).unwrap().value, "Wöchentlich am Mo, Do"));
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Tag.index() as i32);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 1, "The tags in their options.");
        send_key_combo(&bar, [K::DownArrow]);
        assert!(!value(F::Tag).is_empty());
        capture(&bar, "tags");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyPressed { text: char::from(K::Control).into() });
        capture(&bar, "tags-hints");
        bar.window().dispatch_event(slint::platform::WindowEvent::KeyReleased { text: char::from(K::Control).into() });
        send_key_combo(&bar, [K::Return]);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_active(), F::Description.index() as i32, "Enter on more opens it.");
        send_key_combo(&bar, [K::Tab]);
        send_key_combo(&bar, [K::Tab]);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 3, "The reminders.");
        send_key_combo(&bar, [K::Tab]);
        send_key_combo(&bar, [K::Return]);
        assert_eq!(bar.get_panel_kind(), 2, "The icons.");
        type_text(&bar, "stetho");
        assert_eq!(value(F::Icon), "stethoscope");
        capture(&bar, "icons");
        for scale in [1.25, 1.5, 2.0] {
            bar.window().dispatch_event(slint::platform::WindowEvent::ScaleFactorChanged { scale_factor: scale });
            with_app(|app| app.draw());
            assert_eq!(bar.get_type_icons().row_data(0).unwrap().size().width, (bar.global::<Theme>().get_label_icon_size() * scale).round() as u32, "Icon masks match the physical display density.");
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
        // A left click on an entry opens its day too.
        let block = with_app_value(|app| app.state.view().calendar.layout.blocks.iter().find(|b| !b.fresh && b.y > m.head_h).cloned().unwrap());
        let day = with_app_value(|app| app.state.view().calendar.layout.rows.iter().find(|row| block.y >= row.y && block.y < row.y + row.h).unwrap().date);
        let before = with_app_value(|app| app.state.opened().contains(&day));
        bar.invoke_cal_mouse(0, 0, block.x + 2.0, block.y + 2.0, false);
        with_app(|app| assert_ne!(app.state.opened().contains(&day), before));
        // Esc on a field without changes closes the form; marking in the calendar opens it again by itself.
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
        let icon = icon_image("guitar", theme.get_cal_icon_size(), 1.0);
        visual.set_cal_blocks(std::rc::Rc::new(slint::VecModel::from(vec![
            CalBlock { x: 300.0, y: 100.0, w: 22.0, h: 22.0, color: theme.get_accent(), has_icon: true, icon: icon.clone(), ..Default::default() },
            CalBlock { x: 345.0, y: 100.0, w: 19.0, h: 22.0, color: theme.get_accent(), has_icon: true, icon: icon.clone(), ..Default::default() },
            CalBlock { x: 390.0, y: 100.0, w: 22.0, h: 10.0, color: theme.get_accent(), has_icon: true, icon, ..Default::default() },
            CalBlock { x: 500.0, y: 100.0, w: 140.0, h: 32.0, color: theme.get_accent(), point: true, marker: 2.0, title: "Zeitpunkt".into(), text: 1, ..Default::default() },
            CalBlock { x: 500.0, y: 220.0, w: 140.0, h: 32.0, color: theme.get_accent(), point: true, caption_at_top: true, marker: 2.0, title: "Oben".into(), text: 1, has_icon: true, icon: icon_image("guitar", theme.get_cal_icon_size(), 1.0), ..Default::default() },
        ])).into());
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
        let count = |x: usize, y: usize, w: usize, h: usize, predicate: fn(slint::Rgba8Pixel) -> bool| {
            (y..y + h).flat_map(|y| (x..x + w).map(move |x| pixel(x, y))).filter(|p| predicate(*p)).count()
        };
        let text_x = (theme.get_padding() + theme.get_label_width() + theme.get_field_inset()) as usize;
        let text_y = (theme.get_line_height() + theme.get_border_width() + theme.get_form_row_height() * 2.0 + theme.get_field_vpad() + 3.0) as usize;
        assert!(count(text_x, text_y, 90, 19, |p| p.r > 170 && p.g > 170 && p.b > 170) > 30, "Selected date text is light on its blue background.");
        let calendar_x = (theme.get_form_width() + theme.get_border_width()) as usize;
        assert!(count(calendar_x + 306, 105, 12, 12, |p| p.b > 160 && p.g > 90) > 5, "An icon fits a narrow event even when its title does not.");
        assert_eq!(count(calendar_x + 351, 105, 12, 12, |p| p.b > 160 && p.g > 90), 0, "A too narrow event does not spill its icon.");
        assert_eq!(count(calendar_x + 396, 100, 12, 12, |p| p.b > 160 && p.g > 90), 0, "A too flat event does not spill its icon.");
        let marker = pixel(calendar_x + 502, 108);
        let accent = theme.get_accent();
        assert_eq!((marker.r,marker.g,marker.b),(accent.red(),accent.green(),accent.blue()), "A point has a strong exact-time stroke.");
        assert_eq!(pixel(calendar_x + 530,105).b,0,"The caption does not fill the entire height like a time interval.");
        assert!(pixel(calendar_x + 630,128).b>0,"The point's caption is a narrow bar at the bottom of the stroke.");
        assert!(pixel(calendar_x + 638,117).b>0,"The caption ends have small corners instead of a pill-shaped cap.");
        assert!(pixel(calendar_x + 630,225).b>0,"An upper caption is attached to the top of the time marker.");
        assert_eq!(pixel(calendar_x + 530,245).b,0,"An upper caption leaves the bottom of the marker clear.");
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
    }
}
