//! The day view as something to work in (docs/plan.md, 0c; docs/input.md): the keyboard walks through the day's title,
//! its entries, the dials and the activities; what the app's day page does with an entry works here with the same
//! shortcuts (`Alt+A/E/N`, `Alt+D/X/P/M/T/U/G/I/B`, …). With the mouse, a click on an entry's symbol opens a narrow
//! panel that comes out of the window at the left: the entry's settings, and the pickers (a month for planning, the
//! clock, the tags, the icons, the reminders, the description) in that same place.
//!
//! Every change is written at once through `journal-core`: the day is read, changed (`day_ops`) and saved, so another
//! program's changes are never overwritten. The model has no window; `form.rs` hands it the store and the warm data.
use std::collections::BTreeSet;
use chrono::{Datelike, NaiveDate};
use journal_core::storage::{Day, Store};
use crate::calendar::Rgb;
use crate::day_ops as ops;
use crate::day_view::{self, DayView, Item, RowKind};
use crate::form::{COMMON_ICONS, REMINDERS};
use crate::icons;
use crate::repeat;
use crate::snapshot::Snapshot;
use crate::texts::{day_texts, form_texts, texts, Language};

/// A key as the day view gets it (from the focus scope or the text inputs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum K { Up, Down, Left, Right, Enter, Escape, Tab, BackTab, Delete, Backspace, Home, End, PageUp, PageDown, Space, Char(char) }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods { pub shift: bool, pub ctrl: bool, pub alt: bool }

/// What the window has to do after a key or a click.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Out {
    /// The keyboard goes back to the search bar.
    pub to_search: bool,
    /// The day view's own keys (the focus scope) get the keyboard.
    pub focus: bool,
    /// The text input of the line being written gets the keyboard (with this text, all selected).
    pub edit: Option<String>,
    /// The panel's text input gets the keyboard.
    pub side_text: Option<String>,
    /// Another day is to be shown (Alt+T on a trace).
    pub go_to: Option<NaiveDate>,
    /// Something was written: the calendar shows it anew.
    pub changed: bool,
}

/// What is written in place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditTarget { Title, Entry(String), New { kind: &'static str, after: Option<String>, tag: Option<String> } }

/// The panel at the left: the actions of an entry, or one of its pickers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SideView {
    Actions,
    Tags,
    Icons,
    Reminders,
    /// The clock: minutes since midnight (none: no time), which part has the arrows, digits typed so far.
    Time { minutes: Option<u32>, on_minutes: bool, typed: String },
    /// A month to plan on: one day, or several (`multi`) collected with Space or clicks.
    Plan { multi: bool, cursor: NaiveDate, picked: BTreeSet<NaiveDate> },
    Description,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Side { pub entry: String, pub view: SideView, pub pick: usize }

/// One action of an entry in the panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action { Status, Kind, Priority, Tag, Time, Reminder, Icon, Description, Tomorrow, Plan, PlanDays, Jump, Delete }

/// The panel as drawn.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SidePanel {
    /// 0 actions, 1 tags, 2 icons, 3 reminders, 4 clock, 5 month, 6 description.
    pub kind: u8,
    pub title: String,
    pub heading: String,
    pub heading_icon: &'static str,
    pub rows: Vec<SideRow>,
    pub clock: (String, String, bool),
    pub month: String,
    pub weekdays: Vec<String>,
    pub cells: Vec<Cell>,
    /// The planning month's confirming line ("Planen auf Mi 25.11.").
    pub confirm: String,
    pub text: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SideRow { pub icon: String, pub label: String, pub value: String, pub selected: bool, pub on: bool, pub color: Option<Rgb>, pub danger: bool }

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Cell { pub label: String, pub date: NaiveDate, pub in_month: bool, pub today: bool, pub cursor: bool, pub picked: bool, pub own: bool }

/// What the day view needs from the rest: the store and the warm data, the day shown and the clock.
pub struct Ctx<'a> {
    pub store: Option<&'a mut Store>,
    pub snapshot: Option<&'a mut Snapshot>,
    pub date: NaiveDate,
    pub today: NaiveDate,
    pub language: Language,
    /// Milliseconds since 1970.
    pub now: i64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DayPane {
    pub cursor: Option<Item>,
    pub edit: Option<(EditTarget, String)>,
    pub side: Option<Side>,
    /// The panel's text (an icon search, a description).
    pub side_text: String,
    /// Digits typed on a dial or an activity.
    typed: String,
    pub message: Option<(String, bool)>,
}

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }
impl Ctx<'_> {
    pub fn clock() -> i64 { now_ms() }
}

impl DayPane {
    // ----- Reading -----

    /// The day itself, as stored.
    fn load(cx: &Ctx) -> Option<Day> { cx.store.as_ref()?.load(&cx.date.to_string()).ok() }

    /// The day view as drawn: the lines with what is chosen and written marked; a new entry being written has its own
    /// line where it will stand.
    pub fn view(&self, cx: &Ctx) -> DayView {
        let mut view = self.plain_view(cx);
        let editing = match &self.edit { Some((EditTarget::Title, _)) => Some(Item::Title), Some((EditTarget::Entry(id), _)) => Some(Item::Entry(id.clone())), _ => None };
        for row in &mut view.rows {
            row.selected = row.item.is_some() && row.item == self.cursor && self.edit.is_none();
            row.editing = row.item.is_some() && row.item == editing;
            for dial in &mut row.dials { dial.selected = Some(&dial.item) == self.cursor.as_ref() && self.edit.is_none(); }
        }
        if let Some((EditTarget::New { kind, after, .. }, _)) = &self.edit {
            let dt = day_texts(cx.language);
            view.rows.retain(|row| row.kind != RowKind::Empty || row.label != dt.nothing);
            let at = after.as_ref().and_then(|id| view.rows.iter().position(|row| row.item == Some(Item::Entry(id.clone()))))
                .map(|at| at + 1).or_else(|| view.rows.iter().position(|row| row.kind == RowKind::Heading && row.label == dt.values)).unwrap_or(view.rows.len());
            view.rows.insert(at, day_view::Row { editing: true, icon: day_view::kind_icon(kind), ..day_view::Row::new(RowKind::Entry, "") });
        }
        view
    }

    fn plain_view(&self, cx: &Ctx) -> DayView {
        let own = Self::load(cx);
        let timers = cx.store.as_ref().and_then(|store| store.activity_timers().ok()).unwrap_or_default();
        let empty = (std::collections::BTreeMap::new(), Vec::new(), day_view::PeriodData::default());
        let source = match cx.snapshot.as_deref() {
            Some(snapshot) => day_view::Source { own: own.as_ref(), days: &snapshot.days, tags: &snapshot.tags, period: &snapshot.period, timers: &timers, now: cx.now },
            None => day_view::Source { own: own.as_ref(), days: &empty.0, tags: &empty.1, period: &empty.2, timers: &timers, now: cx.now },
        };
        day_view::build(&source, cx.date, cx.today, cx.language)
    }

    fn items(&self, cx: &Ctx) -> Vec<Item> { self.plain_view(cx).items() }

    fn entry(cx: &Ctx, id: &str) -> Option<journal_core::storage::Entry> { Self::load(cx)?.entries.into_iter().find(|entry| entry.id == id) }

    fn tags(cx: &Ctx) -> Vec<journal_core::storage::Tag> { cx.snapshot.as_ref().map(|s| s.tags.clone()).unwrap_or_default() }

    // ----- Writing -----

    /// Reads the day, changes it and saves it; the warm data learns the days touched.
    fn change(&mut self, cx: &mut Ctx, change: impl FnOnce(&mut Day, &[journal_core::storage::Tag]) -> Result<(), String>) -> Result<(), String> {
        let tags = Self::tags(cx);
        let Some(store) = cx.store.as_deref_mut() else { return Err(texts(cx.language).read_only.into()) };
        let mut day = store.load(&cx.date.to_string()).map_err(|e| e.to_string())?;
        change(&mut day, &tags)?;
        let saved = store.save(day).map_err(|e| e.to_string())?;
        let mut dates = vec![cx.date];
        dates.extend(saved.touched.iter().filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()));
        if let Some(snapshot) = cx.snapshot.as_deref_mut() { let _ = snapshot.reload_days(store, &dates); }
        Ok(())
    }

    /// Changes the period data (read fresh, so nothing written elsewhere is lost).
    fn change_period(&mut self, cx: &mut Ctx, change: impl FnOnce(&mut serde_json::Value)) -> Result<(), String> {
        let Some(store) = cx.store.as_deref_mut() else { return Err(texts(cx.language).read_only.into()) };
        let mut data: serde_json::Value = serde_json::from_str(&store.period_data().map_err(|e| e.to_string())?).unwrap_or_else(|_| serde_json::json!({}));
        change(&mut data);
        let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
        store.save_period_data(&json).map_err(|e| e.to_string())?;
        if let Some(snapshot) = cx.snapshot.as_deref_mut() { let _ = snapshot.set_period(store, &json); }
        Ok(())
    }

    fn report(&mut self, result: Result<(), String>) -> Out {
        match result { Ok(()) => { self.message = None; Out { changed: true, focus: true, ..Out::default() } } Err(error) => { self.message = Some((error, true)); Out { focus: true, ..Out::default() } } }
    }

    // ----- The keyboard: from the search bar into the day and back -----

    /// ↓ from the search bar: the first line (or the given one).
    pub fn enter(&mut self, cx: &Ctx) -> Out {
        self.cursor = self.items(cx).into_iter().next();
        self.typed.clear();
        Out { focus: true, ..Out::default() }
    }

    /// The day shown changed (or the window was shown again): nothing stays chosen or open.
    pub fn reset(&mut self) { *self = DayPane::default(); }

    fn step(&mut self, cx: &Ctx, by: i32) -> Out {
        let items = self.items(cx);
        self.typed.clear();
        let at = self.cursor.as_ref().and_then(|cursor| items.iter().position(|item| item == cursor));
        match at.map(|at| at as i32 + by) {
            Some(next) if next < 0 => { self.cursor = None; Out { to_search: true, ..Out::default() } }
            Some(next) => { self.cursor = items.get((next as usize).min(items.len().saturating_sub(1))).cloned(); Out { focus: true, ..Out::default() } }
            None => { self.cursor = if by > 0 { items.first().cloned() } else { items.last().cloned() }; Out { focus: true, ..Out::default() } }
        }
    }

    /// A key while the day view has the keyboard.
    pub fn key(&mut self, cx: &mut Ctx, key: K, mods: Mods) -> Out {
        // The app's shortcuts reach the entry also while its panel is open (a picker of theirs replaces it).
        if self.side.is_some() && mods.alt && self.edit.is_none() {
            if let Some(Side { view: SideView::Description, entry, .. }) = self.side.clone() { let text = self.side_text.clone(); let r = self.change(cx, |day, _| ops::set_description(day, &entry, &text)); if let Err(error) = r { self.message = Some((error, true)); } }
            self.side = None;
            return self.alt_key(cx, key, mods);
        }
        if self.side.is_some() { return self.side_key(cx, key, mods); }
        if self.edit.is_some() { return self.edit_key(cx, key, mods); }
        if mods.alt { return self.alt_key(cx, key, mods); }
        let cursor = self.cursor.clone();
        match (key, cursor) {
            (K::Up | K::BackTab, _) => self.step(cx, -1),
            (K::Tab, _) if mods.shift => self.step(cx, -1),
            (K::Down | K::Tab, _) => self.step(cx, 1),
            (K::Escape, _) => { self.cursor = None; self.typed.clear(); Out { to_search: true, ..Out::default() } }
            (K::Enter, Some(Item::Title)) => self.start_edit(cx, EditTarget::Title),
            (K::Enter, Some(Item::Entry(id))) => match Self::entry(cx, &id) {
                Some(_) => self.start_edit(cx, EditTarget::Entry(id)),
                // Begun on an earlier day: it is changed there.
                None => { self.message = Some((day_texts(cx.language).foreign.into(), false)); Out { focus: true, ..Out::default() } }
            },
            (K::Space, Some(Item::Entry(id))) => { let r = self.change(cx, |day, _| ops::toggle_status(day, &id, false)); self.report(r) }
            (K::Delete | K::Backspace, Some(Item::Entry(id))) => self.delete(cx, &id),
            // A dial: ←/→ one step, digits set it, Entf takes it away.
            (K::Left | K::Right, Some(Item::Value(id))) => self.step_value(cx, &id, if key == K::Left { -1 } else { 1 }),
            (K::Char(digit @ '0'..='9'), Some(Item::Value(id))) => { self.typed.push(digit); let typed = self.typed.clone(); self.type_value(cx, &id, &typed) }
            (K::Char('-'), Some(Item::Value(id))) if self.typed.is_empty() => { self.typed.push('-'); let _ = id; Out { focus: true, ..Out::default() } }
            (K::Delete | K::Backspace, Some(Item::Value(id))) => { self.typed.clear(); self.set_value(cx, &id, None) }
            // An activity: Space ticks, digits and Enter set its minutes, Enter starts or pauses the timer, Shift+Enter stops it.
            (K::Space, Some(Item::Activity(id))) => { let date = cx.date.to_string(); let r = self.change_period(cx, |data| ops::toggle_activity(data, &date, &id)); self.report(r) }
            (K::Char(digit @ '0'..='9'), Some(Item::Activity(_))) => { self.typed.push(digit); Out { focus: true, ..Out::default() } }
            (K::Enter, Some(Item::Activity(id))) if !self.typed.is_empty() => {
                let minutes = self.typed.parse::<i64>().ok().map(|m| m.min(1440));
                self.typed.clear();
                let date = cx.date.to_string();
                let r = self.change_period(cx, |data| ops::set_minutes(data, &date, &id, minutes));
                self.report(r)
            }
            (K::Delete | K::Backspace, Some(Item::Activity(id))) => { self.typed.clear(); let date = cx.date.to_string(); let r = self.change_period(cx, |data| ops::set_minutes(data, &date, &id, None)); self.report(r) }
            (K::Enter, Some(Item::Activity(id))) => { let date = cx.date.to_string(); if mods.shift { self.stop_timer(cx, &date, &id) } else { self.toggle_timer(cx, &date, &id) } }
            (K::Enter, Some(Item::Timer(key))) => {
                let Some((date, id)) = key.split_once(':').map(|(d, i)| (d.to_string(), i.to_string())) else { return Out::default() };
                if mods.shift { self.stop_timer(cx, &date, &id) } else { self.toggle_timer(cx, &date, &id) }
            }
            _ => Out { focus: true, ..Out::default() },
        }
    }

    /// The app's shortcuts (`Alt+…`), on the chosen entry (new entries anywhere).
    fn alt_key(&mut self, cx: &mut Ctx, key: K, mods: Mods) -> Out {
        let lower = match key { K::Char(c) => Some(c.to_ascii_lowercase()), _ => None };
        // New entries: after the chosen one.
        if !mods.shift { if let Some(kind) = match lower { Some('a') => Some("task"), Some('e') => Some("event"), Some('n') => Some("note"), _ => None } {
            let after = match &self.cursor { Some(Item::Entry(id)) => Self::entry(cx, id).map(|e| e.id), _ => None };
            return self.start_edit(cx, EditTarget::New { kind, after, tag: None });
        } }
        let Some(Item::Entry(id)) = self.cursor.clone() else { return Out { focus: true, ..Out::default() } };
        let Some(entry) = Self::entry(cx, &id) else { self.message = Some((day_texts(cx.language).foreign.into(), false)); return Out { focus: true, ..Out::default() } };
        let tags = Self::tags(cx);
        match (key, lower, mods.shift) {
            (K::Up | K::Down, _, _) => { let by = if key == K::Up { -1 } else { 1 }; let r = self.change(cx, |day, tags| if ops::move_by(day, tags, &id, by) { Ok(()) } else { Err(String::new()) }); if r.is_err() { return Out { focus: true, ..Out::default() } } self.report(Ok(())) }
            (K::Enter, _, _) => self.open_side(cx, &id, SideView::Actions),
            (K::Delete, _, _) => self.delete(cx, &id),
            (_, Some('e'), true) => { let r = self.change(cx, |day, tags| ops::set_kind(day, tags, &id, "event")); self.report(r) }
            (_, Some('a'), true) => { let r = self.change(cx, |day, tags| ops::set_kind(day, tags, &id, "task")); self.report(r) }
            (_, Some('n'), true) => { let r = self.change(cx, |day, tags| ops::set_kind(day, tags, &id, "note")); self.report(r) }
            (_, Some('t'), true) => self.open_plan(cx, &id, true),
            (_, Some('d'), false) => { let r = self.change(cx, |day, _| ops::toggle_status(day, &id, false)); self.report(r) }
            (_, Some('x'), false) => { let r = self.change(cx, |day, _| ops::toggle_status(day, &id, true)); self.report(r) }
            (_, Some('p'), false) => { let r = self.change(cx, |day, tags| ops::toggle_priority(day, tags, &id)); self.report(r) }
            (_, Some('m'), false) => { let r = self.change(cx, |day, _| ops::plan_tomorrow(day, &id)); self.report(r) }
            // On a trace Alt+T goes to where it went.
            (_, Some('t'), false) if entry.plan.is_some() => Out { go_to: entry.plan.as_ref().and_then(|plan| plan.targets.first()).and_then(|t| NaiveDate::parse_from_str(&t.date, "%Y-%m-%d").ok()), ..Out::default() },
            (_, Some('t'), false) => self.open_plan(cx, &id, false),
            (_, Some('u'), false) => self.open_side(cx, &id, SideView::Time { minutes: entry.time.as_deref().and_then(ops::minutes), on_minutes: false, typed: String::new() }),
            (_, Some('g'), false) => { let _ = tags; self.open_side(cx, &id, SideView::Tags) }
            (_, Some('i'), false) => self.open_side(cx, &id, SideView::Icons),
            (_, Some('b'), false) => self.open_side(cx, &id, SideView::Description),
            (_, Some('r'), false) => self.open_side(cx, &id, SideView::Reminders),
            _ => Out { focus: true, ..Out::default() },
        }
    }

    fn delete(&mut self, cx: &mut Ctx, id: &str) -> Out {
        if Self::entry(cx, id).is_none() { self.message = Some((day_texts(cx.language).foreign.into(), false)); return Out { focus: true, ..Out::default() }; }
        // The chosen line goes to the next one (or the one before).
        let items = self.items(cx);
        let at = items.iter().position(|item| *item == Item::Entry(id.to_string()));
        let r = self.change(cx, |day, _| ops::remove(day, id));
        if r.is_ok() {
            let after = self.items(cx);
            self.cursor = at.and_then(|at| after.get(at).or_else(|| after.get(at.saturating_sub(1)))).cloned();
            self.side = None;
        }
        self.report(r)
    }

    // ----- Writing in place -----

    fn start_edit(&mut self, cx: &Ctx, target: EditTarget) -> Out {
        let text = match &target {
            EditTarget::Title => Self::load(cx).map(|day| day.title).unwrap_or_default(),
            EditTarget::Entry(id) => Self::entry(cx, id).map(|e| e.text).unwrap_or_default(),
            EditTarget::New { .. } => String::new(),
        };
        self.edit = Some((target, text.clone()));
        Out { edit: Some(text), ..Out::default() }
    }

    /// The text of the line being written changed.
    pub fn edited(&mut self, text: &str) { if let Some((_, current)) = &mut self.edit { *current = text.to_string(); } }

    /// Writes what was typed; a new entry only when it has text. Returns the entry's id.
    fn commit(&mut self, cx: &mut Ctx) -> Result<Option<String>, String> {
        let Some((target, text)) = self.edit.take() else { return Ok(None) };
        let text = text.trim_end().to_string();
        match target {
            EditTarget::Title => { self.change(cx, |day, _| { ops::set_title(day, &text); Ok(()) })?; self.cursor = Some(Item::Title); Ok(None) }
            EditTarget::Entry(id) => {
                if Self::entry(cx, &id).is_some_and(|e| e.text != text) { self.change(cx, |day, _| ops::set_text(day, &id, &text))?; }
                self.cursor = Some(Item::Entry(id.clone()));
                Ok(Some(id))
            }
            EditTarget::New { kind, after, tag } => {
                if text.trim().is_empty() { return Ok(None); }
                let mut made = String::new();
                self.change(cx, |day, tags| { made = ops::create(day, tags, kind, &text, after.as_deref(), tag); Ok(()) })?;
                self.cursor = Some(Item::Entry(made.clone()));
                Ok(Some(made))
            }
        }
    }

    fn edit_key(&mut self, cx: &mut Ctx, key: K, mods: Mods) -> Out {
        let target = self.edit.as_ref().map(|(target, _)| target.clone()).unwrap();
        let empty = self.edit.as_ref().is_some_and(|(_, text)| text.is_empty());
        match key {
            // Backspace in an empty entry removes it (a new one is simply not made).
            K::Backspace if empty => {
                self.edit = None;
                match target { EditTarget::Entry(id) => { let out = self.delete(cx, &id); return Out { focus: true, ..out } } _ => return Out { focus: true, ..Out::default() } }
            }
            K::Escape => { let r = self.commit(cx).map(|_| ()); let out = self.report(r); return Out { focus: true, ..out } }
            K::Enter => {
                let made = self.commit(cx);
                return match (made, &target) {
                    // Enter in an entry: a new one below, of its kind and tag (Strg+Enter: without the tag).
                    (Ok(Some(id)), EditTarget::Entry(_) | EditTarget::New { .. }) => {
                        let entry = Self::entry(cx, &id);
                        let kind = match entry.as_ref().map(|e| e.kind.as_str()) { Some("event") => "event", Some("note") => "note", _ => "task" };
                        let tag = if mods.ctrl { None } else { entry.and_then(|e| e.tag) };
                        let out = self.start_edit(cx, EditTarget::New { kind, after: Some(id), tag });
                        Out { changed: true, ..out }
                    }
                    (Ok(_), EditTarget::Title) => { let out = self.step(cx, 1); Out { changed: true, ..out } }
                    (Ok(None), _) => Out { focus: true, changed: true, ..Out::default() },
                    (Err(error), _) => { self.message = Some((error, true)); Out { focus: true, ..Out::default() } }
                };
            }
            K::Up | K::Down | K::Tab | K::BackTab if !mods.alt => {
                let r = self.commit(cx);
                if let Err(error) = r { self.message = Some((error, true)); return Out { focus: true, ..Out::default() }; }
                let out = self.step(cx, if key == K::Up || key == K::BackTab || mods.shift { -1 } else { 1 });
                return Out { changed: true, ..out };
            }
            _ => {}
        }
        if mods.alt {
            // The app's shortcuts work while writing too: what was typed is written first.
            match self.commit(cx) {
                Ok(Some(id)) => self.cursor = Some(Item::Entry(id)),
                Ok(None) => {}
                Err(error) => { self.message = Some((error, true)); return Out { focus: true, ..Out::default() }; }
            }
            let out = self.alt_key(cx, key, mods);
            return Out { changed: true, ..out };
        }
        Out::default()
    }

    // ----- Dials -----

    fn dial(&self, cx: &Ctx, id: &str) -> Option<day_view::Dial> {
        self.plain_view(cx).rows.into_iter().find(|row| row.kind == RowKind::Dials)?.dials.into_iter().find(|dial| dial.item == Item::Value(id.to_string()))
    }

    pub fn set_value(&mut self, cx: &mut Ctx, id: &str, value: Option<i64>) -> Out {
        let Some(dial) = self.dial(cx, id) else { return Out::default() };
        let value = value.map(|v| v.clamp(dial.min, dial.max));
        let date = cx.date.to_string();
        let id = id.to_string();
        self.cursor = Some(Item::Value(id.clone()));
        let r = self.change_period(cx, |data| if id == "rating" { ops::set_rating(data, &date, value) } else { ops::set_scale(data, &date, &id, value) });
        self.report(r)
    }

    fn step_value(&mut self, cx: &mut Ctx, id: &str, by: i64) -> Out {
        self.typed.clear();
        let Some(dial) = self.dial(cx, id) else { return Out::default() };
        let next = match dial.raw { Some(value) => value + by, None if by > 0 => dial.min, None => dial.max };
        self.set_value(cx, id, Some(next))
    }

    fn type_value(&mut self, cx: &mut Ctx, id: &str, typed: &str) -> Out {
        let Some(dial) = self.dial(cx, id) else { return Out::default() };
        let Ok(value) = typed.parse::<i64>() else { return Out { focus: true, ..Out::default() } };
        // More digits than the span has: start again with the last one.
        if value > dial.max { self.typed = typed.chars().last().map(String::from).unwrap_or_default(); let again = self.typed.clone(); return if again == typed { Out::default() } else { self.type_value(cx, id, &again) }; }
        self.set_value(cx, id, Some(value))
    }

    /// A click or drag on a dial (0–1 along its ring), the wheel over it (steps).
    pub fn dial_at(&mut self, cx: &mut Ctx, id: &str, fraction: f32) -> Out {
        let Some(dial) = self.dial(cx, id) else { return Out::default() };
        let value = dial.min + ((dial.max - dial.min) as f32 * fraction.clamp(0.0, 1.0)).round() as i64;
        if dial.raw == Some(value) { self.cursor = Some(Item::Value(id.to_string())); return Out { focus: true, ..Out::default() }; }
        self.set_value(cx, id, Some(value))
    }
    pub fn dial_wheel(&mut self, cx: &mut Ctx, id: &str, steps: i64) -> Out { if steps == 0 { return Out::default(); } self.step_value(cx, id, steps) }

    // ----- Activities and timers -----

    fn definition(cx: &Ctx, id: &str) -> Option<day_view::ActivityDefinition> {
        cx.snapshot.as_ref()?.period.definitions.iter().find(|d| d.id == id).cloned()
    }

    fn after_timer(&mut self, cx: &mut Ctx, result: Result<Vec<String>, String>) -> Out {
        let result = result.map(|dates| {
            if let (Some(store), Some(snapshot)) = (cx.store.as_deref(), cx.snapshot.as_deref_mut()) {
                let dates: Vec<NaiveDate> = dates.iter().filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).collect();
                let _ = snapshot.reload_days(store, &dates);
                if let Ok(json) = store.period_data() { let _ = snapshot.set_period(store, &json); }
            }
        });
        self.report(result)
    }

    pub fn toggle_timer(&mut self, cx: &mut Ctx, date: &str, id: &str) -> Out {
        let Some(store) = cx.store.as_deref() else { return Out::default() };
        let running = store.activity_timers().ok().and_then(|t| t.get(&journal_core::timers::timer_key(date, id)).map(|t| t.running())).unwrap_or(false);
        let tag = Self::definition(cx, id).and_then(|d| d.calendar_tag_id);
        let now = cx.now;
        let result = if running { store.pause_activity_timer(date, id, now).map(|_| Vec::new()) } else { store.start_activity_timer(date, id, tag.as_deref(), now).map(|_| Vec::new()) };
        self.after_timer(cx, result.map_err(|e| e.to_string()))
    }

    pub fn stop_timer(&mut self, cx: &mut Ctx, date: &str, id: &str) -> Out {
        let definition = Self::definition(cx, id);
        let dt = day_texts(cx.language);
        let text = cx.snapshot.as_ref().and_then(|s| s.period.days.get(date)).and_then(|d| d.items.get(id)).and_then(|r| r.text.clone()).unwrap_or_default();
        let activity = journal_core::timers::TimerActivity { id: id.to_string(), name: definition.as_ref().map(|d| d.name.clone()).unwrap_or_default(),
            color: definition.as_ref().map(|d| d.color.clone()).unwrap_or_default(), calendar_tag_id: definition.and_then(|d| d.calendar_tag_id) };
        let description = format!("{} · {date}{}", dt.timer_description, if text.is_empty() { String::new() } else { format!("\n{text}") });
        let now = cx.now;
        let Some(store) = cx.store.as_deref_mut() else { return Out::default() };
        let result = store.stop_activity_timer(date, &activity, &description, dt.activity_fallback, now).map_err(|e| e.to_string());
        self.after_timer(cx, result)
    }

    pub fn toggle_activity(&mut self, cx: &mut Ctx, id: &str) -> Out {
        self.cursor = Some(Item::Activity(id.to_string()));
        let date = cx.date.to_string();
        let r = self.change_period(cx, |data| ops::toggle_activity(data, &date, id));
        self.report(r)
    }

    // ----- The mouse on a line -----

    /// A click on a line: `part` 0 its text (chosen, and written in for entries and the title), 1 its symbol (an entry's
    /// panel, an activity's tick), 2 the timer's start/pause, 3 the timer's stop.
    pub fn click(&mut self, cx: &mut Ctx, item: Item, part: i32) -> Out {
        if self.edit.is_some() { if let Err(error) = self.commit(cx) { self.message = Some((error, true)); } }
        self.cursor = Some(item.clone());
        self.typed.clear();
        match (item, part) {
            (Item::Title, _) => self.start_edit(cx, EditTarget::Title),
            (Item::Entry(id), 1) => self.open_side(cx, &id, SideView::Actions),
            (Item::Entry(id), _) if Self::entry(cx, &id).is_some() => { self.side = None; self.start_edit(cx, EditTarget::Entry(id)) }
            (Item::Activity(id), 1) => self.toggle_activity(cx, &id),
            (Item::Activity(id), 2) => { let date = cx.date.to_string(); self.toggle_timer(cx, &date, &id) }
            (Item::Activity(id), 3) => { let date = cx.date.to_string(); self.stop_timer(cx, &date, &id) }
            (Item::Timer(key), 2 | 3) => {
                let Some((date, id)) = key.split_once(':').map(|(d, i)| (d.to_string(), i.to_string())) else { return Out::default() };
                if part == 3 { self.stop_timer(cx, &date, &id) } else { self.toggle_timer(cx, &date, &id) }
            }
            _ => Out { focus: true, ..Out::default() },
        }
    }

    /// A new entry of this kind from the mouse (the headings' small `+`).
    pub fn create(&mut self, cx: &Ctx, kind: &'static str) -> Out { self.start_edit(cx, EditTarget::New { kind, after: None, tag: None }) }

    // ----- The panel at the left -----

    fn open_side(&mut self, cx: &Ctx, id: &str, view: SideView) -> Out {
        if Self::entry(cx, id).is_none() { self.message = Some((day_texts(cx.language).foreign.into(), false)); return Out { focus: true, ..Out::default() }; }
        self.cursor = Some(Item::Entry(id.to_string()));
        let entry = Self::entry(cx, id).unwrap();
        let pick = match &view {
            SideView::Tags => Self::tags(cx).iter().position(|t| Some(&t.id) == entry.tag.as_ref()).map_or(0, |at| at + 1),
            SideView::Reminders => REMINDERS.iter().position(|r| *r == entry.reminder.then_some(entry.reminder_before)).unwrap_or(0),
            _ => 0,
        };
        self.side = Some(Side { entry: id.to_string(), view: view.clone(), pick });
        match view {
            SideView::Description => { self.side_text = entry.description; Out { side_text: Some(self.side_text.clone()), ..Out::default() } }
            SideView::Icons => { self.side_text.clear(); Out { side_text: Some(String::new()), ..Out::default() } }
            _ => Out { focus: true, ..Out::default() },
        }
    }

    fn open_plan(&mut self, cx: &Ctx, id: &str, multi: bool) -> Out {
        match Self::entry(cx, id) {
            Some(entry) if ops::can_plan(&entry) => self.open_side(cx, id, SideView::Plan { multi, cursor: repeat::shift(cx.date, 1), picked: BTreeSet::new() }),
            Some(_) => { self.message = Some((day_texts(cx.language).cannot_plan.into(), true)); Out { focus: true, ..Out::default() } }
            None => self.open_side(cx, id, SideView::Actions),
        }
    }

    /// The actions an entry has (as the app offers them for it).
    fn actions(entry: &journal_core::storage::Entry) -> Vec<Action> {
        if entry.plan.is_some() { return vec![Action::Jump, Action::Kind, Action::Delete]; }
        let mut list = Vec::new();
        if entry.kind == "task" { list.push(Action::Status); }
        list.extend([Action::Kind, Action::Priority, Action::Tag]);
        if entry.kind != "note" { list.extend([Action::Time, Action::Reminder]); }
        list.extend([Action::Icon, Action::Description]);
        if ops::can_plan(entry) { if entry.kind == "task" { list.push(Action::Tomorrow); } list.extend([Action::Plan, Action::PlanDays]); }
        list.push(Action::Delete);
        list
    }

    /// The panel's text changed (the icon search, the description).
    pub fn side_edited(&mut self, text: &str) {
        self.side_text = text.to_string();
        if let Some(side) = &mut self.side { if side.view == SideView::Icons { side.pick = 0; } }
    }

    fn icons_found(&self) -> Vec<&'static str> {
        if self.side_text.trim().is_empty() { COMMON_ICONS.to_vec() } else { icons::search(&self.side_text, 49) }
    }

    /// The panel closes (Esc on its actions, a click elsewhere); the keyboard stays on the entry.
    pub fn close_side(&mut self) -> Out { self.side = None; Out { focus: true, ..Out::default() } }

    fn back(&mut self) -> Out {
        match &mut self.side { Some(side) if side.view != SideView::Actions => { side.view = SideView::Actions; side.pick = 0; Out { focus: true, ..Out::default() } } _ => self.close_side() }
    }

    fn side_key(&mut self, cx: &mut Ctx, key: K, mods: Mods) -> Out {
        let Some(side) = self.side.clone() else { return Out::default() };
        let Some(entry) = Self::entry(cx, &side.entry) else { self.side = None; return Out { focus: true, ..Out::default() } };
        let id = side.entry.clone();
        if key == K::Escape {
            if side.view == SideView::Description { let text = self.side_text.clone(); let r = self.change(cx, |day, _| ops::set_description(day, &id, &text)); let out = self.report(r); self.back(); return out; }
            return self.back();
        }
        let count = |n: usize| n.max(1);
        let pick = |by: i32, n: usize| ((side.pick as i32 + by).rem_euclid(count(n) as i32)) as usize;
        match side.view.clone() {
            SideView::Actions => {
                let actions = Self::actions(&entry);
                match key {
                    K::Up | K::BackTab => self.set_pick(pick(-1, actions.len())),
                    K::Down | K::Tab => self.set_pick(pick(1, actions.len())),
                    K::Left | K::Right => {
                        let by = if key == K::Left { -1 } else { 1 };
                        match actions.get(side.pick) {
                            Some(Action::Kind) => { let at = ops::KINDS.iter().position(|k| *k == entry.kind).unwrap_or(1) as i32; let next = ops::KINDS[(at + by).rem_euclid(3) as usize]; let r = self.change(cx, |day, tags| ops::set_kind(day, tags, &id, next)); self.report(r) }
                            Some(Action::Status) => { let r = self.change(cx, |day, _| { let e = day.entries.iter_mut().find(|e| e.id == id).ok_or("")?; let at = if e.done { 1 } else if e.cancelled { 2 } else { 0 }; let next = (at + by).rem_euclid(3); e.done = next == 1; e.cancelled = next == 2; Ok(()) }); self.report(r) }
                            Some(Action::Priority) => { let r = self.change(cx, |day, tags| ops::toggle_priority(day, tags, &id)); self.report(r) }
                            _ => Out { focus: true, ..Out::default() },
                        }
                    }
                    K::Enter | K::Space => match actions.get(side.pick).copied() { Some(action) => self.act(cx, &entry, action), None => Out::default() },
                    _ => Out { focus: true, ..Out::default() },
                }
            }
            SideView::Tags => {
                let tags = Self::tags(cx);
                match key {
                    K::Up | K::BackTab => self.set_pick(pick(-1, tags.len() + 1)),
                    K::Down | K::Tab => self.set_pick(pick(1, tags.len() + 1)),
                    K::Char(digit @ '0'..='9') => { let n = digit as usize - '0' as usize; if n <= tags.len() { self.choose(cx, n) } else { Out::default() } }
                    K::Enter | K::Space => self.choose(cx, side.pick),
                    _ => Out { focus: true, ..Out::default() },
                }
            }
            SideView::Reminders => match key {
                K::Up | K::Left => self.set_pick(pick(-1, REMINDERS.len())),
                K::Down | K::Right | K::Tab => self.set_pick(pick(1, REMINDERS.len())),
                K::Enter | K::Space => self.choose(cx, side.pick),
                _ => Out { focus: true, ..Out::default() },
            },
            SideView::Icons => {
                let found = self.icons_found().len();
                match key {
                    K::Left => self.set_pick(pick(-1, found)),
                    K::Right => self.set_pick(pick(1, found)),
                    K::Up => self.set_pick(pick(-(ICON_COLUMNS as i32), found)),
                    K::Down => self.set_pick(pick(ICON_COLUMNS as i32, found)),
                    K::Enter => self.choose(cx, side.pick),
                    K::Delete if mods.ctrl => { let r = self.change(cx, |day, _| ops::set_icon(day, &id, None)); let out = self.report(r); self.back(); out }
                    _ => Out::default(),
                }
            }
            SideView::Description => Out::default(),
            SideView::Time { minutes, on_minutes, mut typed } => {
                let value = minutes.unwrap_or(((cx_hour(cx) + 1) % 24) * 60);
                let set = |this: &mut Self, minutes: Option<u32>, on_minutes: bool, typed: String| { if let Some(side) = &mut this.side { side.view = SideView::Time { minutes, on_minutes, typed }; } Out { focus: true, ..Out::default() } };
                match key {
                    K::Left | K::Right | K::Tab | K::BackTab => set(self, Some(value), !on_minutes, String::new()),
                    K::Up | K::Down => {
                        let up = key == K::Up;
                        let step = if on_minutes { if mods.ctrl { 15 } else { 1 } } else if mods.ctrl { 240 } else { 60 };
                        let next = if up { (value + step) % 1440 } else { (value + 1440 - step % 1440) % 1440 };
                        set(self, Some(next), on_minutes, String::new())
                    }
                    K::Char(digit @ '0'..='9') => {
                        typed.push(digit);
                        let parsed = parse_clock(&typed);
                        if typed.len() >= 4 { set(self, parsed.or(Some(value)), true, String::new()) } else { set(self, parsed.or(Some(value)), typed.len() > 2, typed) }
                    }
                    K::Delete | K::Backspace => { let r = self.change(cx, |day, _| ops::set_time(day, &id, None)); let out = self.report(r); self.back(); out }
                    K::Enter => { let r = self.change(cx, |day, _| ops::set_time(day, &id, Some(value))); let out = self.report(r); self.back(); out }
                    _ => Out { focus: true, ..Out::default() },
                }
            }
            SideView::Plan { multi, cursor, mut picked } => {
                let set = |this: &mut Self, cursor: NaiveDate, picked: BTreeSet<NaiveDate>| { if let Some(side) = &mut this.side { side.view = SideView::Plan { multi, cursor, picked }; } Out { focus: true, ..Out::default() } };
                match key {
                    K::Left => set(self, repeat::shift(cursor, -1), picked),
                    K::Right => set(self, repeat::shift(cursor, 1), picked),
                    K::Up => set(self, repeat::shift(cursor, -7), picked),
                    K::Down => set(self, repeat::shift(cursor, 7), picked),
                    K::PageUp | K::PageDown => set(self, add_months(cursor, if key == K::PageUp { -1 } else { 1 }), picked),
                    K::Home | K::Char('h') | K::Char('H') => set(self, cx.today, picked),
                    K::Space if multi => { if cursor != cx.date && !picked.remove(&cursor) { picked.insert(cursor); } set(self, cursor, picked) }
                    K::Enter => self.confirm_plan(cx),
                    _ => Out { focus: true, ..Out::default() },
                }
            }
        }
    }

    fn set_pick(&mut self, pick: usize) -> Out { if let Some(side) = &mut self.side { side.pick = pick; } Out { focus: true, ..Out::default() } }

    /// An action of the panel (Enter or a click on it).
    pub fn act(&mut self, cx: &mut Ctx, entry: &journal_core::storage::Entry, action: Action) -> Out {
        let id = entry.id.clone();
        match action {
            Action::Status => { let r = self.change(cx, |day, _| ops::toggle_status(day, &id, false)); self.report(r) }
            Action::Kind => { let at = ops::KINDS.iter().position(|k| *k == entry.kind).unwrap_or(1); let next = ops::KINDS[(at + 1) % 3]; let r = self.change(cx, |day, tags| ops::set_kind(day, tags, &id, next)); self.report(r) }
            Action::Priority => { let r = self.change(cx, |day, tags| ops::toggle_priority(day, tags, &id)); self.report(r) }
            Action::Tag => self.open_side(cx, &id, SideView::Tags),
            Action::Time => self.open_side(cx, &id, SideView::Time { minutes: entry.time.as_deref().and_then(ops::minutes), on_minutes: false, typed: String::new() }),
            Action::Reminder => self.open_side(cx, &id, SideView::Reminders),
            Action::Icon => self.open_side(cx, &id, SideView::Icons),
            Action::Description => self.open_side(cx, &id, SideView::Description),
            Action::Tomorrow => { let r = self.change(cx, |day, _| ops::plan_tomorrow(day, &id)); let out = self.report(r); self.side = None; out }
            Action::Plan => self.open_plan(cx, &id, false),
            Action::PlanDays => self.open_plan(cx, &id, true),
            Action::Jump => Out { go_to: entry.plan.as_ref().and_then(|plan| plan.targets.first()).and_then(|t| NaiveDate::parse_from_str(&t.date, "%Y-%m-%d").ok()), ..Out::default() },
            Action::Delete => self.delete(cx, &id),
        }
    }

    /// A choice in a list of the panel (a tag, a reminder, an icon), by keyboard or click.
    pub fn choose(&mut self, cx: &mut Ctx, index: usize) -> Out {
        let Some(side) = self.side.clone() else { return Out::default() };
        let id = side.entry.clone();
        let r = match side.view {
            SideView::Tags => { let tag = if index == 0 { None } else { Self::tags(cx).get(index - 1).map(|t| t.id.clone()) }; self.change(cx, |day, tags| ops::set_tag(day, tags, &id, tag)) }
            SideView::Reminders => { let before = REMINDERS.get(index).copied().flatten(); self.change(cx, |day, _| ops::set_reminder(day, &id, before)) }
            SideView::Icons => { let icon = self.icons_found().get(index).map(|s| s.to_string()); self.change(cx, |day, _| ops::set_icon(day, &id, icon)) }
            SideView::Actions => { let Some(entry) = Self::entry(cx, &id) else { return Out::default() }; let actions = Self::actions(&entry); self.set_pick(index); return match actions.get(index) { Some(action) => self.act(cx, &entry, *action), None => Out::default() } }
            _ => return Out::default(),
        };
        let out = self.report(r);
        self.back();
        out
    }

    /// A click on a day of the planning month: one day is planned at once on a second click, several are collected.
    pub fn plan_click(&mut self, cx: &mut Ctx, date: NaiveDate) -> Out {
        let Some(Side { view: SideView::Plan { multi, cursor, mut picked }, .. }) = self.side.clone() else { return Out::default() };
        if multi {
            if date != cx.date && !picked.remove(&date) { picked.insert(date); }
            if let Some(side) = &mut self.side { side.view = SideView::Plan { multi, cursor: date, picked }; }
            return Out { focus: true, ..Out::default() };
        }
        if cursor == date { return self.confirm_plan(cx); }
        if let Some(side) = &mut self.side { side.view = SideView::Plan { multi, cursor: date, picked }; }
        Out { focus: true, ..Out::default() }
    }

    /// Enter in the planning month (or a click on its confirming line).
    pub fn confirm_plan(&mut self, cx: &mut Ctx) -> Out {
        let Some(Side { entry, view: SideView::Plan { multi, cursor, picked }, .. }) = self.side.clone() else { return Out::default() };
        let dates: Vec<NaiveDate> = if multi && !picked.is_empty() { picked.into_iter().collect() } else { vec![cursor] };
        if dates.iter().all(|d| *d == cx.date) { return Out { focus: true, ..Out::default() }; }
        let r = self.change(cx, |day, _| ops::plan(day, &entry, &dates, if multi { "days" } else { "date" }));
        let out = self.report(r);
        self.side = None;
        out
    }

    /// The planning month a month back or on (the arrows beside its name).
    pub fn plan_month(&mut self, by: i32) -> Out {
        if let Some(Side { view: SideView::Plan { cursor, .. }, .. }) = &mut self.side { *cursor = add_months(*cursor, by); }
        Out { focus: true, ..Out::default() }
    }

    /// The confirming line of the clock or the month (a click), as Enter.
    pub fn side_confirm(&mut self, cx: &mut Ctx) -> Out { self.side_key(cx, K::Enter, Mods::default()) }

    /// Back from a picker (its heading's arrow), as Esc.
    pub fn side_back(&mut self, cx: &mut Ctx) -> Out { self.side_key(cx, K::Escape, Mods::default()) }

    /// A click on the clock's hours or minutes.
    pub fn clock_part(&mut self, minutes_part: bool) -> Out {
        if let Some(Side { view: SideView::Time { on_minutes, typed, minutes }, .. }) = &mut self.side { *on_minutes = minutes_part; typed.clear(); if minutes.is_none() { *minutes = Some(9 * 60); } }
        Out { focus: true, ..Out::default() }
    }

    /// The panel's mouse on a clock part: the wheel (steps) or a click (which part).
    pub fn clock_wheel(&mut self, minutes_part: bool, steps: i32) -> Out {
        let Some(Side { view: SideView::Time { minutes, .. }, .. }) = self.side.clone() else { return Out::default() };
        let value = minutes.unwrap_or(9 * 60) as i32;
        let next = (value + steps * if minutes_part { 5 } else { 60 }).rem_euclid(1440) as u32;
        if let Some(side) = &mut self.side { side.view = SideView::Time { minutes: Some(next), on_minutes: minutes_part, typed: String::new() }; }
        Out { focus: true, ..Out::default() }
    }

    /// The panel as drawn.
    pub fn side_view(&self, cx: &Ctx) -> Option<SidePanel> {
        let side = self.side.as_ref()?;
        let entry = Self::entry(cx, &side.entry)?;
        let (dt, ft) = (day_texts(cx.language), form_texts(cx.language));
        let tags = Self::tags(cx);
        let tag = entry.tag.as_ref().and_then(|id| tags.iter().find(|t| &t.id == id));
        let mut panel = SidePanel { title: if entry.text.trim().is_empty() { dt.untitled.into() } else { entry.text.clone() }, ..SidePanel::default() };
        let kind_name = |kind: &str| match kind { "event" => dt.kind_event, "note" => dt.kind_note, _ => dt.kind_task };
        let reminder = if entry.reminder { REMINDERS.iter().position(|r| *r == Some(entry.reminder_before)).map_or_else(|| format!("{} {}", entry.reminder_before, ft.minutes), |at| ft.reminder_presets[at].to_string()) } else { String::new() };
        match &side.view {
            SideView::Actions => {
                panel.kind = 0;

                panel.rows = Self::actions(&entry).into_iter().enumerate().map(|(i, action)| {
                    let (icon, label, value, on): (&str, &str, String, bool) = match action {
                        Action::Status => ("journal-done", dt.status, (if entry.done { dt.status_done } else if entry.cancelled { dt.status_cancelled } else { dt.status_open }).into(), entry.done),
                        Action::Kind => (day_view::kind_icon(&entry.kind), dt.kind, kind_name(&entry.kind).into(), false),
                        Action::Priority => ("journal-priority", dt.priority, String::new(), entry.priority),
                        Action::Tag => ("journal-tag", dt.tag, tag.map(|t| t.name.clone()).unwrap_or_default(), false),
                        Action::Time => ("journal-clock", dt.time, match (entry.time.as_deref(), entry.end.as_deref()) { (Some(a), Some(b)) => format!("{a}–{b}"), (Some(a), None) => a.into(), _ => String::new() }, false),
                        Action::Reminder => ("journal-bell", dt.reminder, reminder.clone(), entry.reminder),
                        Action::Icon => (entry.icon.as_deref().filter(|n| icons::exists(n)).unwrap_or("journal-icon"), dt.icon, entry.icon.clone().unwrap_or_default(), false),
                        Action::Description => ("journal-details", dt.description, entry.description.lines().next().unwrap_or_default().to_string(), false),
                        Action::Tomorrow => ("journal-tomorrow", dt.tomorrow_action, String::new(), false),
                        Action::Plan => ("journal-plan-tomorrow", dt.plan, String::new(), false),
                        Action::PlanDays => ("journal-plan-days", dt.plan_days, String::new(), false),
                        Action::Jump => ("journal-jump", dt.jump, String::new(), false),
                        Action::Delete => ("journal-trash", dt.delete, String::new(), false),
                    };
                    SideRow { icon: icon.into(), label: label.into(), value, selected: i == side.pick, on, color: if action == Action::Tag { tag.and_then(|t| crate::calendar::parse_color(&t.color)) } else { None }, danger: action == Action::Delete }
                }).collect();
            }
            SideView::Tags => {
                panel.kind = 1; panel.heading = dt.tag.into(); panel.heading_icon = "tag";
                panel.rows = std::iter::once(SideRow { icon: String::new(), label: ft.no_tag.into(), selected: side.pick == 0, on: entry.tag.is_none(), ..SideRow::default() })
                    .chain(tags.iter().enumerate().map(|(i, t)| SideRow { icon: t.icon.clone().filter(|n| icons::exists(n)).unwrap_or_default(), label: t.name.clone(), selected: side.pick == i + 1, on: entry.tag.as_ref() == Some(&t.id), color: crate::calendar::parse_color(&t.color), ..SideRow::default() })).collect();
            }
            SideView::Reminders => {
                panel.kind = 3; panel.heading = dt.reminder.into(); panel.heading_icon = "bell";
                panel.rows = ft.reminder_presets.iter().enumerate().map(|(i, label)| SideRow { label: label.to_string(), selected: side.pick == i, on: REMINDERS[i] == entry.reminder.then_some(entry.reminder_before), ..SideRow::default() }).collect();
            }
            SideView::Icons => {
                panel.kind = 2; panel.heading = dt.icon.into(); panel.heading_icon = "image"; panel.text = self.side_text.clone(); panel.placeholder = dt.icon_search.into();
                panel.rows = self.icons_found().into_iter().enumerate().map(|(i, name)| SideRow { icon: name.into(), label: name.into(), selected: side.pick == i, on: entry.icon.as_deref() == Some(name), ..SideRow::default() }).collect();
            }
            SideView::Description => {
                panel.kind = 6; panel.heading = dt.description.into(); panel.heading_icon = "text-quote"; panel.text = self.side_text.clone(); panel.placeholder = dt.description_placeholder.into();
            }
            SideView::Time { minutes, on_minutes, .. } => {
                panel.kind = 4; panel.heading = dt.time.into(); panel.heading_icon = "clock";
                let value = minutes.unwrap_or(((cx_hour(cx) + 1) % 24) * 60);
                panel.clock = (format!("{:02}", value / 60), format!("{:02}", value % 60), *on_minutes);
            }
            SideView::Plan { multi, cursor, picked } => {
                panel.kind = 5; panel.heading = if *multi { dt.plan_days } else { dt.plan }.into(); panel.heading_icon = if *multi { "calendar-range" } else { "calendar-arrow-up" };

                let t = texts(cx.language);
                panel.month = format!("{} {}", t.months[cursor.month0() as usize], cursor.year());
                panel.weekdays = dt.weekdays.iter().map(|w| w.chars().take(2).collect()).collect();
                let first = NaiveDate::from_ymd_opt(cursor.year(), cursor.month(), 1).unwrap();
                let start = repeat::shift(first, -(first.weekday().num_days_from_monday() as i64));
                panel.cells = (0..42).map(|n| { let date = repeat::shift(start, n); Cell { label: date.day().to_string(), date, in_month: date.month() == cursor.month(), today: date == cx.today, cursor: date == *cursor, picked: picked.contains(&date), own: date == cx.date } }).collect();
                let chosen: Vec<NaiveDate> = if *multi && !picked.is_empty() { picked.iter().copied().collect() } else { vec![*cursor] };
                panel.confirm = if chosen.len() == 1 { dt.plan_on.replace("%s", &repeat::format_occurrence(chosen[0], cx.language)) } else { dt.plan_on_days.replace("%d", &chosen.len().to_string()) };
            }
        }
        Some(panel)
    }
}

/// Icons per line of the panel's grid (as in `ui/theme.slint`).
pub const ICON_COLUMNS: usize = 7;

fn cx_hour(cx: &Ctx) -> u32 { let _ = cx; chrono::Timelike::hour(&chrono::Local::now()) }

/// "9", "930", "14", "1430" → minutes.
fn parse_clock(typed: &str) -> Option<u32> {
    let (hours, minutes) = match typed.len() { 1 | 2 => (typed, "0"), 3 => (&typed[..1], &typed[1..]), _ => (&typed[..2], &typed[2..4]) };
    let (hours, minutes) = (hours.parse::<u32>().ok()?, minutes.parse::<u32>().ok()?);
    (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
}

fn add_months(date: NaiveDate, by: i32) -> NaiveDate {
    let months = date.year() * 12 + date.month0() as i32 + by;
    let (year, month) = (months.div_euclid(12), months.rem_euclid(12) as u32 + 1);
    (1..=date.day()).rev().find_map(|day| NaiveDate::from_ymd_opt(year, month, day)).unwrap_or(date)
}

#[cfg(test)]
#[path = "day_tests.rs"]
mod tests;
