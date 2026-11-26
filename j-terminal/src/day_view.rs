//! The day view at the left (docs/plan.md, 0c): while no entry form is open, the space under the search bar sums up one
//! day: its appointments, open tasks, notes, the rating and day values, and the activities. Today by default; the
//! calendar (middle click) or `Alt+←/→` choose another day. Reading only: nothing here writes.
//!
//! Ratings, day values and activities come from the app's `period-data` setting (`src/periodData.ts`, branch `Windows`).
//! Running timers live in the app's web storage and are not visible here (Stufe 5).
use std::collections::{BTreeMap, HashMap};
use chrono::{Datelike, NaiveDate};
use journal_core::{storage::{Day, Entry, Tag}, timers::ActivityTimer};
use serde::Deserialize;
use crate::calendar::{self, Item as CalItem, Rgb};
use crate::icons;
use crate::repeat;
use crate::texts::{day_texts, texts, Language};
use crate::features::{Features, Module, View};

// ----- The app's period data (only what the day view reads) -----

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PeriodData {
    pub definitions: Vec<ActivityDefinition>,
    pub days: HashMap<String, PeriodDay>,
    pub scales: Vec<ScaleDefinition>,
    pub rating: Option<RatingScale>,
    /// The notes of days and periods, by the period's key (`day:2026-11-18`, `week:2026-11-16` …).
    #[serde(skip)]
    pub notes: HashMap<String, String>,
    /// A week's … year's own rating and values (`periods`), by its key.
    #[serde(skip)]
    pub periods: HashMap<String, PeriodValues>,
    /// A week's … year's own entries (`entries`), by its key, in the app's order (tasks, then notes, by `order`).
    #[serde(skip)]
    pub entries: HashMap<String, Vec<PeriodEntry>>,
}

/// A period's own rating and values (`PeriodValues`).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PeriodValues { pub rating: Option<f64>, pub scales: HashMap<String, f64> }

/// A period's own entry (`PeriodEntry`): a task with its tick, or a note.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PeriodEntry { pub id: String, pub note: bool, pub text: String, pub done: bool, pub order: f64 }

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ActivityDefinition {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(rename = "trackTime")]
    pub track_time: Option<bool>,
    pub active: Option<bool>,
    #[serde(rename = "calendarTagId")]
    pub calendar_tag_id: Option<String>,
    /// The minutes the analysis' seven shades run over (`activityRange`).
    #[serde(rename = "minMinutes")]
    pub min_minutes: Option<f64>,
    #[serde(rename = "maxMinutes")]
    pub max_minutes: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ScaleDefinition {
    pub id: String,
    pub name: String,
    pub color: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub active: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct RatingScale { pub color: String, pub min: Option<f64>, pub max: Option<f64> }

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PeriodDay {
    pub rating: Option<f64>,
    pub scales: HashMap<String, f64>,
    pub items: HashMap<String, ActivityRecord>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ActivityRecord { pub done: bool, pub minutes: Option<f64>, pub text: Option<String> }

impl PeriodData {
    /// As the app reads it; anything unreadable is an empty set (the app normalises the same way).
    pub fn parse(json: &str) -> PeriodData {
        let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
        let mut data = PeriodData::default();
        if let Some(list) = value.get("definitions").and_then(|v| v.as_array()) {
            data.definitions = list.iter().filter_map(|item| serde_json::from_value::<ActivityDefinition>(item.clone()).ok()).filter(|item| !item.id.is_empty()).collect();
        }
        if let Some(list) = value.get("scales").and_then(|v| v.as_array()) {
            data.scales = list.iter().filter_map(|item| serde_json::from_value::<ScaleDefinition>(item.clone()).ok()).filter(|item| !item.id.is_empty()).collect();
        }
        if let Some(days) = value.get("days").and_then(|v| v.as_object()) {
            for (date, day) in days {
                let mut read = PeriodDay { rating: day.get("rating").and_then(|v| v.as_f64()).filter(|v| v.is_finite()), ..PeriodDay::default() };
                if let Some(scales) = day.get("scales").and_then(|v| v.as_object()) {
                    read.scales = scales.iter().filter_map(|(id, v)| v.as_f64().filter(|v| v.is_finite()).map(|v| (id.clone(), v))).collect();
                }
                if let Some(items) = day.get("items").and_then(|v| v.as_object()) {
                    read.items = items.iter().filter_map(|(id, v)| serde_json::from_value::<ActivityRecord>(v.clone()).ok().map(|r| (id.clone(), r))).collect();
                }
                data.days.insert(date.clone(), read);
            }
        }
        data.rating = value.get("rating").and_then(|v| serde_json::from_value(v.clone()).ok());
        if let Some(notes) = value.get("notes").and_then(|v| v.as_object()) {
            data.notes = notes.iter().filter_map(|(key, text)| text.as_str().map(|text| (key.clone(), text.to_string()))).collect();
        }
        if let Some(periods) = value.get("periods").and_then(|v| v.as_object()) {
            for (key, values) in periods {
                let mut read = PeriodValues { rating: values.get("rating").and_then(|v| v.as_f64()).filter(|v| v.is_finite()), ..PeriodValues::default() };
                if let Some(scales) = values.get("scales").and_then(|v| v.as_object()) {
                    read.scales = scales.iter().filter_map(|(id, v)| v.as_f64().filter(|v| v.is_finite()).map(|v| (id.clone(), v))).collect();
                }
                data.periods.insert(key.clone(), read);
            }
        }
        if let Some(entries) = value.get("entries").and_then(|v| v.as_object()) {
            for (key, list) in entries {
                let Some(list) = list.as_object() else { continue };
                let mut read: Vec<PeriodEntry> = list.iter().filter(|(id, entry)| !id.is_empty() && entry.is_object()).map(|(id, entry)| PeriodEntry {
                    id: id.clone(), note: entry.get("kind").and_then(|k| k.as_str()) == Some("note"),
                    text: entry.get("text").and_then(|t| t.as_str()).unwrap_or_default().to_string(),
                    done: entry.get("done").and_then(|d| d.as_bool()) == Some(true),
                    order: entry.get("order").and_then(|o| o.as_f64()).filter(|o| o.is_finite()).unwrap_or(0.0),
                }).collect();
                // `periodEntries`: tasks first, then by order, then by id.
                read.sort_by(|a, b| a.note.cmp(&b.note).then(a.order.total_cmp(&b.order)).then(a.id.cmp(&b.id)));
                data.entries.insert(key.clone(), read);
            }
        }
        data
    }
}

/// A scale's span made valid as in `scaleRange` (periodData.ts): whole numbers, min below max, otherwise 0–10.
pub fn scale_range(min: Option<f64>, max: Option<f64>) -> (i64, i64) {
    match (min.map(f64::round), max.map(f64::round)) {
        (Some(min), Some(max)) if min.is_finite() && max.is_finite() && min < max && max - min <= 1000.0 && min.abs() <= 100000.0 && max.abs() <= 100000.0 => (min as i64, max as i64),
        _ => (0, 10),
    }
}

/// `#rrggbb` or the app's default (its accent).
fn color_or_accent(text: &str) -> Rgb { calendar::parse_color(text).unwrap_or([0x56, 0x9e, 0xff]) }

// ----- The view -----

/// What a line of the day view stands for: the keyboard and the mouse choose it, the actions work on it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Item {
    /// The day's title.
    Title,
    /// An entry of the day (by id).
    Entry(String),
    /// The rating (`rating`) or a day value (the scale's id): a dial.
    Value(String),
    /// An activity of the day (by id).
    Activity(String),
    /// A timer of another day (its key `<date>:<activity>`), shown while it exists.
    Timer(String),
    /// The note of the day or the period.
    Note,
    /// An entry of a week's … year's own list (by id).
    PeriodEntry(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowKind {
    /// The day's title, written in place.
    Title,
    /// A section's heading: its name, its icon and how many it holds.
    Heading,
    /// An appointment, task or note.
    Entry,
    /// The rating and the day values: one line of dials.
    Dials,
    /// An activity: done or not, the time spent, its timer.
    Activity,
    /// A timer of another day.
    Timer,
    /// A quiet line where a section has nothing.
    Empty,
    /// The note: a free text over several lines.
    Note,
}

/// A dial: the rating or a day value.
#[derive(Clone, Debug, PartialEq)]
pub struct Dial {
    pub item: Item,
    pub label: String,
    /// The value as shown ("7"), "–" without one.
    pub value: String,
    pub raw: Option<i64>,
    pub min: i64,
    pub max: i64,
    /// How far the ring is filled (0–1); none without a value.
    pub fill: Option<f32>,
    pub color: Rgb,
    /// The keyboard is on it.
    pub selected: bool,
}

/// A timer's state as shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimerView { pub running: bool, pub clock: String }

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub kind: RowKind,
    pub item: Option<Item>,
    pub label: String,
    /// The time (entries), the count (headings), the minutes (activities), the day (timers of other days).
    pub detail: String,
    pub description: String,
    /// Lucide icon in front (the entry's symbol, the heading's icon).
    pub icon: &'static str,
    /// The entry's own or its tag's icon at the right.
    pub tag_icon: String,
    pub color: Option<Rgb>,
    pub done: bool,
    pub priority: bool,
    /// A planned entry's trace (its time chip names where it went).
    pub trace: bool,
    /// Begun on an earlier day: changed there, not here.
    pub foreign: bool,
    /// The activity records time (its timer can run).
    pub track: bool,
    pub timer: Option<TimerView>,
    pub dials: Vec<Dial>,
    /// The keyboard is on it.
    pub selected: bool,
    /// It is being written (the text input stands on it).
    pub editing: bool,
}

impl Row {
    pub fn new(kind: RowKind, label: impl Into<String>) -> Row {
        Row { kind, item: None, label: label.into(), detail: String::new(), description: String::new(), icon: "", tag_icon: String::new(), color: None, done: false, priority: false,
            trace: false, foreign: false, track: false, timer: None, dials: Vec::new(), selected: false, editing: false }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DayView {
    pub date: NaiveDate,
    /// "Mittwoch, 18. November 2026".
    pub heading: String,
    /// "Heute", "Morgen", "Gestern", "in 3 Tagen", "vor 2 Tagen".
    pub relative: String,
    pub is_today: bool,
    pub title: String,
    pub rows: Vec<Row>,
    /// The view shown (a day, or a week … year).
    pub view: View,
}

impl DayView {
    /// The lines the keyboard walks through, in order (a line of dials gives each dial).
    pub fn items(&self) -> Vec<Item> {
        self.rows.iter().flat_map(|row| if row.kind == RowKind::Dials { row.dials.iter().map(|dial| dial.item.clone()).collect() } else { row.item.clone().into_iter().collect::<Vec<_>>() }).collect()
    }
}

/// Everything the day view reads: the day itself (with its traces), the entries of the days before (entries over several
/// days), the tags, the period data and the timers.
pub struct Source<'a> {
    pub own: Option<&'a Day>,
    pub days: &'a BTreeMap<NaiveDate, Vec<Entry>>,
    pub tags: &'a [Tag],
    pub period: &'a PeriodData,
    pub timers: &'a BTreeMap<String, ActivityTimer>,
    /// Milliseconds since 1970 (for the timers' clocks).
    pub now: i64,
    /// The calendar time of the activities' tags in the period shown (a week … year's checklist adds it up).
    pub calendar: &'a crate::analysis::CalendarMinutes,
}

/// A time of day as the app writes it: "14:00".
fn clock(minutes: u32) -> String { format!("{:02}:{:02}", minutes / 60, minutes % 60) }

/// A timer's clock: "01:05:09" (`timerClock`).
pub fn timer_clock(ms: i64) -> String { let s = ms.max(0) / 1000; format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) }

fn item_of(first: NaiveDate, entry: &Entry) -> CalItem {
    let mut item = CalItem::new(first, entry.time.as_deref(), entry.end.as_deref(), &entry.text, None, false, entry.done);
    item.time_grid = entry.time_grid;
    item
}

/// The entries on `date`: its own (from the day itself when given, traces included), and those over several days that
/// began before and still cover it. Entries only for the calendar (`showInJournal: false`) stay in the calendar, as in the
/// app's day page.
fn entries_on<'a>(source: &Source<'a>, date: NaiveDate) -> Vec<(NaiveDate, &'a Entry, CalItem)> {
    let mut found = Vec::new();
    for (first, entries) in source.days.range(repeat::shift(date, -366)..date) {
        for entry in entries.iter().filter(|entry| entry.plan.is_none() && entry.show_in_journal) {
            let item = item_of(*first, entry);
            if item.last >= date { found.push((*first, entry, item)); }
        }
    }
    let own: Vec<&Entry> = match source.own { Some(day) => day.entries.iter().collect(), None => source.days.get(&date).map(|list| list.iter().collect()).unwrap_or_default() };
    found.extend(own.into_iter().filter(|entry| entry.show_in_journal).map(|entry| (date, entry, item_of(date, entry))));
    found
}

/// When an entry is on `date`, as its chip says: "14:00–15:30", "14:00", over several days "Mo 23.11. – Fr 27.11.".
fn when(item: &CalItem, date: NaiveDate, language: Language) -> String {
    if item.last > item.first {
        let day = |d: NaiveDate| repeat::format_occurrence(d, language);
        return match (item.start, item.end) {
            (Some(start), Some(end)) if item.time_grid => {
                let from = if date == item.first { clock(start) } else { day(item.first) };
                let to = if date == item.last { clock(end.min(1440)) } else { day(item.last) };
                format!("{from} – {to}")
            }
            _ => format!("{} – {}", day(item.first), day(item.last)),
        };
    }
    match (item.start, item.end) {
        (Some(start), Some(end)) => format!("{}–{}", clock(start), clock(end.min(1440))),
        (Some(start), None) => clock(start),
        _ => String::new(),
    }
}

/// "Heute" or the compact distance from today in the day switch.
fn relative(date: NaiveDate, today: NaiveDate, language: Language) -> String {
    let dt = day_texts(language);
    match repeat::days_between(today, date) {
        0 => dt.today.into(),
        n if n > 0 => dt.in_days.replace("%d", &n.to_string()),
        n => dt.days_ago.replace("%d", &(-n).to_string()),
    }
}

/// "45 Min.", "1 Std. 30 Min.".
pub fn minutes_text(minutes: i64, language: Language) -> String {
    let dt = day_texts(language);
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m} {}", dt.minutes),
        (h, 0) => format!("{h} {}", dt.hours),
        (h, m) => format!("{h} {} {m} {}", dt.hours, dt.minutes),
    }
}

/// The long date: "Mittwoch, 18. November 2026".
pub fn long_date(date: NaiveDate, language: Language) -> String {
    let (t, dt) = (texts(language), day_texts(language));
    match language {
        Language::De => format!("{}, {}. {} {}", dt.weekdays[date.weekday().num_days_from_monday() as usize], date.day(), t.months[date.month0() as usize], date.year()),
        Language::En => format!("{}, {} {}, {}", dt.weekdays[date.weekday().num_days_from_monday() as usize], t.months[date.month0() as usize], date.day(), date.year()),
    }
}

/// The symbol of an entry as in the app: its kind, a star when important, a tick when done, an arrow when planned on.
pub fn kind_icon(kind: &str) -> &'static str {
    match kind { "event" => "journal-event", "note" => "journal-note", _ => "journal-task" }
}

fn symbol(entry: &Entry) -> &'static str {
    if let Some(plan) = &entry.plan {
        return match (plan.via.as_str(), plan.targets.len() > 1, entry.kind == "event") {
            ("tomorrow", _, true) => "journal-migrated-event", ("tomorrow", _, false) => "journal-migrated",
            ("days", _, true) | (_, true, true) => "journal-scheduled-multi-event",
            ("days", _, false) | (_, true, false) => "journal-scheduled-multi",
            (_, _, true) => "journal-scheduled-event", _ => "journal-scheduled",
        };
    }
    if entry.done { return "journal-done"; }
    if entry.cancelled { return "journal-cancel"; }
    if entry.priority { return match entry.kind.as_str() { "event" => "journal-priority-event", "note" => "journal-priority-note", _ => "journal-priority" }; }
    kind_icon(&entry.kind)
}

/// The left side for `view` around `date`, with the parts `features` show there: a day (its title, entries, values and
/// checklist, as before) or a week … year (its own entries, rating, values, checklist summed over its days, note, and
/// lines to its evaluation and board). The note stands right under the title.
pub fn build(source: &Source, date: NaiveDate, today: NaiveDate, language: Language, view: View, features: &Features) -> DayView {
    let dt = day_texts(language);
    let has = |module: Module| features.has(view, module);
    let tag = |id: Option<&str>| id.and_then(|id| source.tags.iter().find(|tag| tag.id == id));
    let entry_row = |first: NaiveDate, entry: &Entry, item: &CalItem| {
        let known = tag(entry.tag.as_deref());
        let own = entry.icon.as_deref().filter(|name| icons::exists(name));
        let tag_icon = own.or_else(|| known.and_then(|tag| tag.icon.as_deref()).filter(|name| icons::exists(name))).unwrap_or_default();
        let detail = match &entry.plan {
            // A trace names where it went.
            Some(plan) if plan.targets.len() > 1 => dt.planned_days.replace("%d", &plan.targets.len().to_string()),
            Some(plan) => plan.targets.first().and_then(|target| NaiveDate::parse_from_str(&target.date, "%Y-%m-%d").ok()).map(|target| format!("→ {}", repeat::format_occurrence(target, language))).unwrap_or_default(),
            None => when(item, date, language),
        };
        Row { item: Some(Item::Entry(entry.id.clone())), detail, icon: symbol(entry), tag_icon: tag_icon.to_string(), color: known.and_then(|tag| calendar::parse_color(&tag.color)),
            done: entry.done || entry.cancelled, priority: entry.priority, trace: entry.plan.is_some(), foreign: first != date,
            description: entry.description.clone(),
            ..Row::new(RowKind::Entry, if entry.text.trim().is_empty() { dt.untitled.to_string() } else { entry.text.trim().to_string() }) }
    };
    let period = source.period;
    let key = view.period_key(date);
    let (start, end) = view.bounds(date);
    let day = view == View::Day;
    // A day's title is the day's; a week's … year's is kept among the notes under its own key (the app keeps that list
    // whole and shows only the notes themselves).
    let title = if day { source.own.map(|day| day.title.clone()).unwrap_or_default() } else { period.notes.get(&title_key(&key)).cloned().unwrap_or_default() };
    let mut rows = Vec::new();
    // A period's heading shows which period it is (not chosen by the keyboard).
    if !day { rows.push(Row::new(RowKind::Title, period_title(date, view, language))); }
    if has(Module::Title) { rows.push(Row { item: Some(Item::Title), ..Row::new(RowKind::Title, title.clone()) }); }

    // The note: right under the title.
    if has(Module::Note) {
        rows.push(Row { item: Some(Item::Note), ..Row::new(RowKind::Note, period.notes.get(&key).cloned().unwrap_or_default()) });
    }

    // Timers of other days keep running: they stand on top, whatever day is shown.
    for (timer_key, timer) in source.timers.iter() {
        let Some((timer_day, activity)) = timer_key.split_once(':') else { continue };
        if day && timer_day == date.to_string() { continue; }
        if !day && NaiveDate::parse_from_str(timer_day, "%Y-%m-%d").is_ok_and(|d| d >= start && d <= end) && has(Module::Activities) { continue; }
        let definition = period.definitions.iter().find(|item| item.id == activity);
        let shown = NaiveDate::parse_from_str(timer_day, "%Y-%m-%d").map(|d| repeat::format_occurrence(d, language)).unwrap_or_else(|_| timer_day.to_string());
        rows.push(Row { item: Some(Item::Timer(timer_key.clone())), icon: if timer.running() { "timer" } else { "circle-pause" }, detail: shown,
            color: Some(color_or_accent(definition.map_or("", |d| d.color.as_str()))), track: true,
            timer: Some(TimerView { running: timer.running(), clock: timer_clock(timer.elapsed(source.now)) }),
            ..Row::new(RowKind::Timer, definition.map_or(activity.to_string(), |d| d.name.clone())) });
    }

    if has(Module::Entries) {
        if day {
            // The entries in the day's own order (as the app keeps it: by kind, tag and priority), those begun earlier first.
            let found = entries_on(source, date);
            rows.push(Row { icon: "journal-journal", detail: found.len().to_string(), ..Row::new(RowKind::Heading, dt.entries) });
            if found.is_empty() { rows.push(Row::new(RowKind::Empty, dt.nothing)); }
            rows.extend(found.iter().map(|(first, entry, item)| entry_row(*first, entry, item)));
        } else {
            // A period's own list: tasks with their tick, then notes (`PeriodEntries.tsx`).
            let list = period.entries.get(&key).cloned().unwrap_or_default();
            rows.push(Row { icon: "journal-journal", detail: list.len().to_string(), ..Row::new(RowKind::Heading, dt.entries) });
            if list.is_empty() { rows.push(Row::new(RowKind::Empty, dt.period_nothing)); }
            rows.extend(list.into_iter().map(|entry| Row {
                item: Some(Item::PeriodEntry(entry.id.clone())), done: entry.done,
                icon: if entry.note { "journal-note" } else if entry.done { "journal-done" } else { "journal-task" },
                ..Row::new(RowKind::Entry, if entry.text.trim().is_empty() { dt.untitled.to_string() } else { entry.text.trim().to_string() })
            }));
        }
    }

    // The evaluation and the board are opened from the actions and the commands (`/Auswertung`, `/Pinnwand-…`), not from
    // lines of the view.

    // The rating and the active values: one line of dials, each with its span. A day's are the day's; a period's are its
    // own (`periods`), apart from its days.
    let day_record = period.days.get(&date.to_string());
    let own = period.periods.get(&key);
    let rating_value = if day { day_record.and_then(|d| d.rating) } else { own.and_then(|o| o.rating) };
    let scale_value = |id: &str| if day { day_record.and_then(|d| d.scales.get(id).copied()) } else { own.and_then(|o| o.scales.get(id).copied()) };
    if has(Module::Rating) || has(Module::Scales) {
        rows.push(Row { icon: "gauge", ..Row::new(RowKind::Heading, if day || !has(Module::Scales) { dt.values } else { dt.period_values }) });
        let rating = period.rating.as_ref();
        let dial = |item: Item, label: &str, value: Option<f64>, (min, max): (i64, i64), color: Rgb| {
            let shown = value.map(|value| value.clamp(min as f64, max as f64));
            Dial { item, label: label.to_string(), value: shown.map_or_else(|| "–".into(), number), raw: shown.map(|v| v.round() as i64), min, max,
                fill: shown.map(|value| ((value - min as f64) / (max - min) as f64) as f32), color, selected: false }
        };
        let mut dials = Vec::new();
        if has(Module::Rating) {
            dials.push(dial(Item::Value("rating".into()), dt.rating, rating_value, scale_range(rating.and_then(|r| r.min), rating.and_then(|r| r.max)), color_or_accent(rating.map_or("", |r| r.color.as_str()))));
        }
        if has(Module::Scales) {
            for scale in period.scales.iter().filter(|scale| scale.active != Some(false)) {
                dials.push(dial(Item::Value(scale.id.clone()), if scale.name.trim().is_empty() { dt.untitled } else { scale.name.trim() }, scale_value(&scale.id), scale_range(scale.min, scale.max), color_or_accent(&scale.color)));
            }
        }
        rows.push(Row { dials, ..Row::new(RowKind::Dials, "") });
    }

    if has(Module::Activities) {
        if day {
            // The active activities (and those with a timer here): done (or with time) or not yet, and their timer.
            let activities: Vec<_> = period.definitions.iter().filter(|activity| activity.active != Some(false) || source.timers.contains_key(&format!("{date}:{}", activity.id))).collect();
            if !activities.is_empty() {
                let records: Vec<_> = activities.iter().map(|activity| day_record.and_then(|day| day.items.get(&activity.id))).collect();
                let done = records.iter().filter(|record| record.is_some_and(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0)).count();
                rows.push(Row { icon: "activity", detail: format!("{done} / {}", activities.len()), ..Row::new(RowKind::Heading, dt.activities) });
                for (activity, record) in activities.iter().zip(records) {
                    let minutes = record.and_then(|r| r.minutes).filter(|m| m.is_finite() && *m > 0.0).map(|m| m.round() as i64);
                    let done = record.is_some_and(|r| r.done) || minutes.is_some();
                    let timer = source.timers.get(&format!("{date}:{}", activity.id)).map(|timer| TimerView { running: timer.running(), clock: timer_clock(timer.elapsed(source.now)) });
                    rows.push(Row { item: Some(Item::Activity(activity.id.clone())), done, icon: if done { "circle-check" } else { "circle" },
                        detail: minutes.map(|m| minutes_text(m, language)).unwrap_or_default(), color: Some(color_or_accent(&activity.color)),
                        track: activity.track_time != Some(false), timer,
                        ..Row::new(RowKind::Activity, if activity.name.trim().is_empty() { dt.untitled } else { activity.name.trim() }) });
                }
            }
        } else {
            // A period's checklist adds up its days (the calendar time of the activities' tags too); its tick and timer
            // are today's while today lies in it.
            let dates = crate::analysis::dates(start, end);
            let shown = crate::analysis::records(period, source.calendar, &dates);
            let today_in = today >= start && today <= end;
            let activities: Vec<_> = period.definitions.iter().filter(|activity| activity.active != Some(false)
                || dates.iter().any(|d| shown.get(d).is_some_and(|items| items.contains_key(&activity.id)))).collect();
            if !activities.is_empty() {
                let mut done_today = 0;
                let mut lines = Vec::new();
                for activity in &activities {
                    let records: Vec<_> = dates.iter().filter_map(|d| shown.get(d).and_then(|items| items.get(&activity.id))).collect();
                    let minutes: f64 = records.iter().filter_map(|r| r.minutes).filter(|m| m.is_finite() && *m > 0.0).sum();
                    let days = records.iter().filter(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0).count();
                    let today_record = shown.get(&today).and_then(|items| items.get(&activity.id));
                    let done = today_in && today_record.is_some_and(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0);
                    if done { done_today += 1; }
                    let timer = if today_in { source.timers.get(&format!("{today}:{}", activity.id)).map(|timer| TimerView { running: timer.running(), clock: timer_clock(timer.elapsed(source.now)) }) } else { None };
                    let mut detail = dt.period_days.replace("%d", &days.to_string()).replace("%n", &dates.len().to_string());
                    // Short in the narrow column: "2/7 · 3 Std. 45 Min."
                    if minutes > 0.0 { detail = format!("{days}/{}", dates.len()); }
                    if minutes > 0.0 { detail = format!("{detail} · {}", minutes_text(minutes.round() as i64, language)); }
                    lines.push(Row { item: Some(Item::Activity(activity.id.clone())), done, icon: if done { "circle-check" } else if today_in { "circle" } else { "circle-dot" },
                        detail, color: Some(color_or_accent(&activity.color)), track: today_in && activity.track_time != Some(false), timer,
                        ..Row::new(RowKind::Activity, if activity.name.trim().is_empty() { dt.untitled } else { activity.name.trim() }) });
                }
                rows.push(Row { icon: "activity", detail: if today_in { format!("{done_today} / {}", activities.len()) } else { String::new() }, ..Row::new(RowKind::Heading, dt.activities) });
                rows.extend(lines);
            }
        }
    }

    let heading = if day { long_date(date, language) } else { period_title(date, view, language) };
    let relative = relative_view(date, today, view, language);
    DayView { date, heading, relative, is_today: if day { date == today } else { today >= start && today <= end }, title, rows, view }
}

/// Where a week's … year's title is kept: among the notes, `title:<key>`.
pub fn title_key(key: &str) -> String { format!("title:{key}") }

/// A period's heading: "Wochenübersicht · 16. Nov. – 22. Nov. 2026", as the app's eyebrow and title.
pub fn period_title(date: NaiveDate, view: View, language: Language) -> String {
    match view.period() {
        Some(mode) => format!("{} · {}", crate::texts::analysis::EYEBROWS[usize::from(language == Language::En)][mode.index()], crate::analysis::title(date, mode, language)),
        None => long_date(date, language),
    }
}

/// The distance in the head: "Heute" / "Diese Woche", "in 2 Wochen", "vor 3 Monaten".
fn relative_view(date: NaiveDate, today: NaiveDate, view: View, language: Language) -> String {
    if view == View::Day { return relative(date, today, language); }
    let dt = day_texts(language);
    let n = view.distance(today, date);
    let unit = dt.view_units[view.index()];
    match n {
        0 => dt.view_this[view.index()].into(),
        n if n > 0 => dt.in_views.replace("%d", &n.to_string()).replace("%u", if n == 1 { unit.0 } else { unit.1 }),
        n => dt.views_ago.replace("%d", &(-n).to_string()).replace("%u", if n == -1 { unit.2 } else { unit.3 }),
    }
}

/// A value as shown: whole numbers without a point.
fn number(value: f64) -> String { if value.fract() == 0.0 { format!("{}", value as i64) } else { format!("{value:.1}") } }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;
    static NO_MINUTES: crate::analysis::CalendarMinutes = std::collections::BTreeMap::new();

    fn entry(kind: &str, text: &str, extra: serde_json::Value) -> Entry {
        let mut value = serde_json::json!({ "id": uuid::Uuid::new_v4().to_string(), "kind": kind, "text": text, "done": false, "cancelled": false });
        if let (Some(target), Some(extra)) = (value.as_object_mut(), extra.as_object()) { for (k, v) in extra { target.insert(k.clone(), v.clone()); } }
        serde_json::from_value(value).unwrap()
    }
    fn labels(view: &DayView, kind: RowKind) -> Vec<String> { view.rows.iter().filter(|row| row.kind == kind).map(|row| row.label.clone()).collect() }
    fn dials(view: &DayView) -> Vec<Dial> { view.rows.iter().find(|row| row.kind == RowKind::Dials).map(|row| row.dials.clone()).unwrap_or_default() }
    fn source<'a>(days: &'a BTreeMap<NaiveDate, Vec<Entry>>, tags: &'a [Tag], period: &'a PeriodData, timers: &'a BTreeMap<String, ActivityTimer>) -> Source<'a> {
        Source { own: None, days, tags, period, timers, now: 0, calendar: &NO_MINUTES }
    }

    #[test]
    fn sums_up_a_day_by_kind_in_its_own_order_without_calendar_only_entries() {
        let mut days = BTreeMap::new();
        days.insert(d("2026-11-18"), vec![
            entry("event", "Zahnarzt", serde_json::json!({ "time": "14:00", "end": "15:30", "tag": "health" })),
            entry("event", "Frühstück", serde_json::json!({ "time": "08:00" })),
            entry("event", "Geburtstag", serde_json::json!({ "showInJournal": false })),
            entry("task", "Wichtig", serde_json::json!({ "priority": true, "time": "10:00" })),
            entry("task", "Einkaufen", serde_json::json!({})),
            entry("task", "Erledigt", serde_json::json!({ "done": true })),
            entry("task", "Weiter", serde_json::json!({ "plan": { "via": "tomorrow", "targets": [{ "date": "2026-11-19", "id": uuid::Uuid::new_v4().to_string() }], "time": null, "reminder": false } })),
            entry("note", "Gedanke", serde_json::json!({})),
        ]);
        let tags = vec![Tag { id: "health".into(), name: "Gesundheit".into(), color: "#76d982".into(), icon: Some("stethoscope".into()) }];
        let (period, timers) = (PeriodData::default(), BTreeMap::new());
        let view = build(&source(&days, &tags, &period, &timers), d("2026-11-18"), d("2026-11-18"), Language::De, View::Day, &Features::default());
        assert_eq!(view.heading, "Mittwoch, 18. November 2026");
        assert_eq!((view.relative.as_str(), view.is_today), ("Heute", true));
        assert_eq!(view.rows[0].kind, RowKind::Title, "The day's title comes first.");
        assert_eq!(labels(&view, RowKind::Heading), ["Einträge", "Werte"]);
        assert_eq!(labels(&view, RowKind::Entry), ["Zahnarzt", "Frühstück", "Wichtig", "Einkaufen", "Erledigt", "Weiter", "Gedanke"], "As the day keeps them; calendar-only entries stay in the calendar.");
        let row = |label: &str| view.rows.iter().find(|row| row.label == label).unwrap().clone();
        assert_eq!((row("Zahnarzt").detail.as_str(), row("Zahnarzt").tag_icon.as_str(), row("Zahnarzt").color), ("14:00–15:30", "stethoscope", Some([0x76, 0xd9, 0x82])));
        assert_eq!(row("Frühstück").detail, "08:00", "A point in time.");
        assert_eq!((row("Wichtig").icon, row("Erledigt").icon, row("Erledigt").done), ("journal-priority", "journal-done", true));
        assert_eq!((row("Weiter").trace, row("Weiter").detail.as_str(), row("Weiter").icon), (true, "→ Do 19.11.", "journal-migrated"), "A trace names where it went.");
        assert_eq!(view.rows.iter().find(|row| row.kind == RowKind::Heading && row.label == "Einträge").unwrap().detail, "7");
        assert_eq!(view.items()[0], Item::Title);
        assert!(view.items().contains(&Item::Value("rating".into())), "The dials are chosen one by one.");
    }

    #[test]
    fn entries_over_several_days_appear_on_every_day_they_cover_and_stay_with_their_first_day() {
        let mut days = BTreeMap::new();
        days.insert(d("2026-11-23"), vec![entry("event", "Urlaub", serde_json::json!({ "time": "00:00", "end": "120:00" }))]);
        days.insert(d("2026-11-20"), vec![entry("event", "Messe", serde_json::json!({ "time": "14:00", "end": "40:00", "timeGrid": true }))]);
        let (period, timers) = (PeriodData::default(), BTreeMap::new());
        let src = source(&days, &[], &period, &timers);
        for day in ["2026-11-23", "2026-11-25", "2026-11-27"] {
            assert_eq!(labels(&build(&src, d(day), d("2026-11-18"), Language::De, View::Day, &Features::default()), RowKind::Entry), ["Urlaub"], "{day}");
        }
        assert!(labels(&build(&src, d("2026-11-28"), d("2026-11-18"), Language::De, View::Day, &Features::default()), RowKind::Entry).is_empty());
        let wed = build(&src, d("2026-11-25"), d("2026-11-18"), Language::De, View::Day, &Features::default());
        let holiday = wed.rows.iter().find(|row| row.label == "Urlaub").unwrap();
        assert_eq!((holiday.detail.as_str(), holiday.foreign), ("Mo 23.11. – Fr 27.11.", true), "Changed on its first day.");
        assert_eq!(wed.relative, "in 7 d");
        assert_eq!(build(&src, d("2026-11-20"), d("2026-11-18"), Language::De, View::Day, &Features::default()).rows.iter().find(|row| row.label == "Messe").unwrap().detail, "14:00 – Sa 21.11.");
        let second = build(&src, d("2026-11-21"), d("2026-11-22"), Language::De, View::Day, &Features::default());
        assert_eq!(second.rows.iter().find(|row| row.label == "Messe").unwrap().detail, "Fr 20.11. – 16:00");
        assert_eq!(second.relative, "vor 1 d");
    }

    #[test]
    fn the_day_itself_gives_its_title_and_an_empty_day_says_so() {
        let days = BTreeMap::new();
        let (period, timers) = (PeriodData::default(), BTreeMap::new());
        let own: Day = serde_json::from_value(serde_json::json!({ "date": "2026-11-18", "title": "Ruhiger Tag", "body": "", "revision": 1, "entries": [] })).unwrap();
        let view = build(&Source { own: Some(&own), ..source(&days, &[], &period, &timers) }, d("2026-11-18"), d("2026-11-18"), Language::En, View::Day, &Features::default());
        assert_eq!((view.heading.as_str(), view.title.as_str()), ("Wednesday, November 18, 2026", "Ruhiger Tag"));
        assert_eq!(view.rows[1].label, "Entries");
        assert_eq!(view.rows[2].kind, RowKind::Empty);
        let rating = &dials(&view)[0];
        assert_eq!((rating.label.as_str(), rating.value.as_str(), rating.fill), ("Rating", "–", None));
    }

    #[test]
    fn reads_rating_values_activities_and_timers_from_the_shared_data() {
        let json = serde_json::json!({
            "definitions": [
                { "id": "run", "name": "Laufen", "color": "#ff9f43", "trackTime": true, "active": true },
                { "id": "read", "name": "Lesen", "color": "#569eff", "trackTime": true, "active": true },
                { "id": "old", "name": "Alt", "color": "#569eff", "active": false },
                { "id": "yoga", "name": "Yoga", "color": "nonsense", "trackTime": false }
            ],
            "scales": [
                { "id": "stress", "name": "Stress", "color": "#e57b7b", "min": 1, "max": 5, "active": true },
                { "id": "sleep", "name": "Schlaf", "color": "#76d982", "min": 10, "max": 3, "active": true },
                { "id": "gone", "name": "Weg", "color": "#76d982", "min": 0, "max": 10, "active": false }
            ],
            "rating": { "color": "#569eff", "min": 0, "max": 10 },
            "days": {
                "2026-11-18": { "rating": 7, "scales": { "stress": 9, "sleep": 6 }, "items": { "run": { "done": true }, "read": { "done": false, "minutes": 95 } } },
                "2026-11-17": { "rating": 3, "items": {} }
            },
            "notes": {}
        }).to_string();
        let period = PeriodData::parse(&json);
        let days = BTreeMap::new();
        let timer = |started: Option<i64>| ActivityTimer { id: "s".into(), started_at: started, elapsed_ms: 60_000, segments: vec![], tag_id: "t".into() };
        let timers = BTreeMap::from([("2026-11-18:read".to_string(), timer(Some(0))), ("2026-11-15:old".to_string(), timer(None))]);
        let view = build(&Source { now: 65_000, ..source(&days, &[], &period, &timers) }, d("2026-11-18"), d("2026-11-18"), Language::De, View::Day, &Features::default());
        let shown: Vec<_> = dials(&view).iter().map(|dial| (dial.label.clone(), dial.value.clone(), dial.fill, dial.min, dial.max)).collect();
        assert_eq!(shown, [("Bewertung".into(), "7".into(), Some(0.7), 0, 10), ("Stress".into(), "5".into(), Some(1.0), 1, 5), ("Schlaf".into(), "6".into(), Some(0.6), 0, 10)],
            "Clamped to the span; an invalid span is 0–10; inactive scales hidden.");
        let activities: Vec<_> = view.rows.iter().filter(|row| row.kind == RowKind::Activity).map(|row| (row.label.as_str(), row.done, row.detail.as_str(), row.track, row.timer.clone())).collect();
        assert_eq!(activities, [("Laufen", true, "", true, None), ("Lesen", true, "1 Std. 35 Min.", true, Some(TimerView { running: true, clock: "00:02:05".into() })), ("Yoga", false, "", false, None)]);
        let other = view.rows.iter().find(|row| row.kind == RowKind::Timer).expect("a timer of another day stays visible");
        assert_eq!((other.label.as_str(), other.detail.as_str(), other.item.clone()), ("Alt", "So 15.11.", Some(Item::Timer("2026-11-15:old".into()))));
        assert_eq!(view.rows.iter().find(|row| row.label == "Aktivitäten").unwrap().detail, "2 / 3");
        assert_eq!(view.rows.iter().find(|row| row.label == "Yoga").unwrap().color, Some([0x56, 0x9e, 0xff]), "An unreadable colour falls back to the accent.");
        let before = build(&source(&days, &[], &period, &BTreeMap::new()), d("2026-11-17"), d("2026-11-18"), Language::De, View::Day, &Features::default());
        assert_eq!(dials(&before)[0].value, "3", "Another day: its own values.");
        assert!(before.rows.iter().filter(|row| row.kind == RowKind::Activity).all(|row| !row.done));
        assert!(PeriodData::parse("not json").definitions.is_empty());
    }
}
